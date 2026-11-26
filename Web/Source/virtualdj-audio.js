export function createVirtualDJOutput() {
  const audio=document.createElement('audio');
  let context, analyser, samples, connecting, controller;
  let lastPacket=0, lastSignal=0;
  audio.autoplay=true;
  audio.playsInline=true;
  audio.muted=true;

  async function receive(port,signal) {
    const response=await fetch('/dj-audio',{signal,cache:'no-store'});
    if(!response.ok||!response.body)throw new Error('VirtualDJ audio relay unavailable');
    const reader=response.body.getReader();
    let pending=new Uint8Array();
    let generation, sequence;
    try {
      while(!signal.aborted){
        const {done,value}=await reader.read();
        if(done)break;
        let bytes=value;
        if(pending.length){
          bytes=new Uint8Array(pending.length+value.length);
          bytes.set(pending);
          bytes.set(value,pending.length);
        }
        const data=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
        let offset=0;
        while(offset+16<=data.byteLength){
          const rate=data.getUint32(offset+4,true), seq=data.getUint32(offset+8,true);
          const stream=data.getUint16(offset+12,true), frames=data.getUint16(offset+14,true);
          if(data.getUint32(offset)!==0x43575043||rate<32000||rate>96000||frames<1||frames>240)
            throw new Error('Invalid VirtualDJ audio packet');
          const end=offset+16+4*frames;
          if(end>data.byteLength)break;
          if(stream!==generation||((seq-sequence)|0)>0){
            generation=stream;
            sequence=seq;
            const pcm=new Int16Array(frames*2);
            let signalPeak=0;
            for(let i=0;i<pcm.length;i++){
              pcm[i]=data.getInt16(offset+16+2*i,true);
              signalPeak=Math.max(signalPeak,Math.abs(pcm[i]));
            }
            lastPacket=performance.now();
            if(signalPeak>128)lastSignal=lastPacket;
            port.postMessage({pcm,rate,generation},[pcm.buffer]);
          }
          offset=end;
        }
        pending=bytes.slice(offset);
      }
    } finally {reader.releaseLock();}
  }
  function start() {
    if(connecting)return connecting;
    if(!window.AudioContext)return Promise.resolve(false);
    context ||= new AudioContext();
    const resumed=context.resume();
    connecting=(async()=>{
      try {
        if(!analyser){
          await context.audioWorklet.addModule('/dj-audio-worklet.js');
          const processor=new AudioWorkletNode(context,'virtualdj-output',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2]});
          const destination=context.createMediaStreamDestination();
          analyser=context.createAnalyser();
          analyser.fftSize=1024;
          samples=new Float32Array(analyser.fftSize);
          processor.connect(analyser).connect(destination);
          audio.srcObject=destination.stream;
          const reconnect=()=>{
            controller=new AbortController();
            void receive(processor.port,controller.signal).catch(()=>{}).finally(()=>{
              if(!controller.signal.aborted)setTimeout(reconnect,1000);
            });
          };
          reconnect();
          window.addEventListener('pagehide',()=>controller?.abort(),{once:true});
        }
        await resumed;
        await audio.play();
        return true;
      }catch {await resumed.catch(()=>{});return false;}
    })().finally(()=>{connecting=null;});
    return connecting;
  }
  return {audio,start,
    ready:()=>context?.state==='running'&&!audio.paused,
    capture:()=>performance.now()-lastPacket<1200&&lastPacket>0,
    signal:()=>performance.now()-lastSignal<1200&&lastSignal>0,
    level:()=>{
      if(!analyser||context.state!=='running')return 0;
      analyser.getFloatTimeDomainData(samples);
      return Math.min(1,Math.sqrt(samples.reduce((sum,x)=>sum+x*x,0)/samples.length)*5);
    }
  };
}
