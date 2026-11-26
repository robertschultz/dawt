// GPT-Live's protocol is deliberately separate from music transport.
const boundedContext=content=>new TextDecoder().decode(new TextEncoder().encode(String(content)).slice(0,480));
// A complete, explicit transport request can go straight to Afterhours even
// when GPT-Live does not create a delegation for it.
function transportWords(text){
  return String(text||'').toLowerCase().trim()
    .replace(/^(?:hey\s+)?dot[, ]+/,'')
    .replace(/^(?:can|could|would|will) you (?:please )?/,'')
    .replace(/^please /,'').replace(/[.!?]+$/,'')
    .replace(/[, ]+please$/,'').trim();
}
export function explicitStop(text){
  const words=transportWords(text).replace(/[, ]+(?:right )?now$/,'');
  return /^(?:stop|pause)(?: (?:playing|it|this|playback|the (?:set|track|music)|music))?$/.test(words)
    || /^(?:hold the music|cancel playback|cancel start)$/.test(words);
}
function directTransport(text){
  if(explicitStop(text))return 'stop the music';
  const words=transportWords(text);
  if(/^(?:mix|transition) (?:right )?now$/.test(words) ||
     /^(?:next(?: track| song)?|play next|(?:play|go to|skip to) the next (?:track|song)|bring in the next track|mix (?:it in|into the next track)|transition(?: to| into) the next track)$/.test(words))return 'transition now';
  return null;
}
export class LiveVoiceClient {
  constructor({request,onState=()=>{},onTranscript=()=>{},onDelegate=()=>{},operatorSpeaking=()=>false,
               mediaDevices=globalThis.navigator?.mediaDevices,Peer=globalThis.RTCPeerConnection,
               audio=typeof Audio==='function'?new Audio():null}={}){
    Object.assign(this,{request,onState,onTranscript,onDelegate,operatorSpeaking,mediaDevices,Peer,audio});
    this.phase='idle';this.generation=0;this.input=[];this.pendingInput=[];this.latestContext='';this.seen=new Set();this.delegations=new Set();
    if(audio){audio.autoplay=true;audio.setAttribute('playsinline','');}
  }
  state(phase,detail=''){this.phase=phase;this.onState({phase,detail,sessionId:this.sessionId,expiresAt:this.expiresAt});}
  send(event){if(this.ready&&this.channel?.readyState==='open'){this.channel.send(JSON.stringify({...event,event_id:crypto.randomUUID()}));return true;}return false;}
  async microphones(){
    if(!this.mediaDevices?.enumerateDevices)throw Error('This browser cannot list microphones. Open Afterhours in Safari or Chrome.');
    return (await this.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audioinput').map((d,i)=>({id:d.deviceId,label:d.label||`Microphone ${i+1}`}));
  }
  async start(performer,deviceId=''){
    if(this.startPending||!['idle','error','closed'].includes(this.phase))return;
    this.startPending=true;this.sessionId=null;this.expiresAt=null;this.startedAt=null;this.maxSeconds=1800;this.isMuted=false;this.endDetail='';
    const generation=++this.generation;this.finalized=false;this.ready=false;this.input=[];this.pendingInput=[];this.latestContext='';this.seen.clear();this.delegations.clear();this.waitingDelegation=null;
    this.state('connecting','Requesting microphone…');
    try{
      if(!this.mediaDevices?.getUserMedia||!this.Peer)throw Error('Voice needs a browser with microphone access on localhost or HTTPS.');
      const mic=await this.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,...(deviceId?{deviceId:{exact:deviceId}}:{})},video:false});
      if(generation!==this.generation){mic.getTracks().forEach(t=>t.stop());return;}
      this.microphone=mic;const peer=this.peer=new this.Peer();
      peer.addEventListener('track',e=>{if(generation!==this.generation)return;this.audio.srcObject=new MediaStream([e.track]);this.audio.play().catch(()=>this.state('audio-blocked','Select Hear Dot to enable voice playback.'));});
      mic.getAudioTracks().forEach(t=>peer.addTrack(t,mic));
      const channel=this.channel=peer.createDataChannel('oai-events');
      channel.addEventListener('message',e=>{if(generation!==this.generation)return;try{this.event(JSON.parse(e.data));}catch{this.end('An unreadable voice event was received.');}});
      channel.addEventListener('close',()=>{if(generation===this.generation&&!this.finalized){const detail=this.closedDetail(false,'Voice disconnected.');this.disconnect();this.state('closed',detail);}});
      peer.addEventListener('connectionstatechange',()=>{if(generation===this.generation&&peer.connectionState==='failed')this.end('Voice connection failed.');});
      await peer.setLocalDescription(await peer.createOffer());
      if(generation!==this.generation)return;
      if(peer.iceGatheringState!=='complete')await new Promise((resolve,reject)=>{
        const changed=()=>{if(peer.iceGatheringState==='complete'){clearTimeout(timer);peer.removeEventListener('icegatheringstatechange',changed);resolve();}};
        const timer=setTimeout(()=>{peer.removeEventListener('icegatheringstatechange',changed);reject(Error('Microphone connection timed out.'));},10000);
        peer.addEventListener('icegatheringstatechange',changed);changed();
      });
      if(generation!==this.generation)return;
      this.state('connecting','Connecting to GPT-Live…');
      const result=await this.request('/api/voice',{action:'start',sdp:peer.localDescription.sdp,
        performer,requestId:crypto.randomUUID(),approveRequest:true,maxSeconds:1800,clientLease:true});
      if(generation!==this.generation){await this.closeRemote(result.session.id,true);return;}
      this.sessionId=result.session.id;this.expiresAt=result.expiresAt;
      this.maxSeconds=result.maxSeconds||120;this.startedAt=result.startedAt||this.expiresAt-this.maxSeconds;
      if(result.clientLeaseSeconds){
        const sessionId=this.sessionId;
        this.leaseTimer=setInterval(()=>{
          this.request('/api/voice',{action:'heartbeat',sessionId}).catch(()=>{
            if(this.generation===generation)this.end('Talk lost its connection to Afterhours.');
          });
        },8000);
      }
      await peer.setRemoteDescription({type:'answer',sdp:result.transport.sdp});
      this.limitTimer=setTimeout(()=>this.end(this.limitDetail()),Math.max(0,this.expiresAt*1000-Date.now()));
      this.startTimer=setTimeout(()=>{if(!this.ready)this.end('Voice did not become ready.');},15000);
    }catch(error){
      if(generation!==this.generation)return;
      await this.disconnect();
      const message={NotAllowedError:'Microphone access was denied. Allow it in your browser, then try again.',
        NotFoundError:'No microphone found. Connect a microphone or headset, then select Refresh inputs.',
        DevicesNotFoundError:'No microphone found. Connect a microphone or headset, then select Refresh inputs.',
        NotReadableError:'The microphone could not open. Check its connection and other apps using it, then try again.',
        OverconstrainedError:'The selected microphone is unavailable. Select Refresh inputs and choose a connected microphone.'}[error.name];
      this.state('error',message||error.message);
    }finally{
      this.startPending=false;
      if(generation!==this.generation&&this.phase==='closing')this.state('closed','Connection cancelled. Microphone off.');
    }
  }
  event(event){
    if(event.event_id){if(this.seen.has(event.event_id))return;this.seen.add(event.event_id);}
    if(event.type==='session.started'){
      this.ready=true;clearTimeout(this.startTimer);this.state('listening','Microphone live · AI voice');
      this.send({type:'session.commentary.append',delegation_id:null,content:'The operator has started talkback. Greet them briefly and ask what they want to hear.'});
    }else if(event.type==='session.input_transcript.delta'||event.type==='session.output_transcript.delta'){
      if(typeof event.delta!=='string')return;
      const role=event.type.includes('input_transcript')?'user':'assistant';
      const fragment={role,text:event.delta,startMs:event.start_ms,endMs:event.end_ms};
      if(role==='user'){
        this.input.push(fragment);this.input=this.input.slice(-160);
        const previous=this.pendingInput.at(-1);
        if(previous&&fragment.startMs-previous.endMs>950)this.pendingInput=[];
        this.pendingInput.push(fragment);this.pendingInput=this.pendingInput.slice(-160);
        this.scheduleDelegation();
      }
      this.onTranscript(fragment);
    }else if(event.type==='session.delegation.created'&&event.delegation?.target==='client'){
      const id=event.delegation.id;if(this.delegations.has(id))return;this.delegations.add(id);
      this.send({type:'session.thinking.append',delegation_id:id,content:''});
      if(this.waitingDelegation){
        this.result('Another task is already handling the current request. Wait for its result.',id);
      }else{
        this.waitingDelegation={id,offsetMs:event.offset_ms};
        this.scheduleDelegation();
      }
    }else if(event.type==='session.usage.updated'){
      this.request('/api/voice',{action:'usage',sessionId:this.sessionId,seconds:event.usage?.seconds,finalized:false}).catch(()=>{});
    }else if(event.type==='session.closed'){
      this.finalized=true;this.request('/api/voice',{action:'usage',sessionId:this.sessionId,seconds:event.usage?.seconds||0,finalized:true}).catch(()=>{});
      const reasons={expired:'Voice session reached its time limit.',connection_lost:'Voice connection lost.',remote_hangup:'Voice connection ended.',content:'The voice service ended this conversation.'};
      const detail=this.closedDetail(true,reasons[event.reason]||'Talk stopped.');this.cleanup();this.state('closed',detail);
    }else if(event.type==='error'){
      this.end('Voice reported a session error. Check the connection before retrying.');
    }
  }
  scheduleDelegation(){
    clearTimeout(this.dispatchTimer);
    const text=this.pendingInput.map(part=>part.text).join('').trim();
    if(!this.waitingDelegation&&!directTransport(text))return;
    this.dispatchTimer=setTimeout(()=>this.flushDelegation(),text?720:1050);
  }
  flushDelegation(){
    clearTimeout(this.dispatchTimer);
    if(!this.ready||this.phase==='closing')return;
    if(this.operatorSpeaking()){this.scheduleDelegation();return;}
    const waiting=this.waitingDelegation;
    const text=this.pendingInput.map(part=>part.text).join('').trim();
    const transport=directTransport(text);
    this.waitingDelegation=null;
    if(!waiting&&!transport)return;
    if(!text){
      this.result('No new operator direction. Do not restart discovery. Wait for the backend or new speech. '+this.latestContext,waiting.id);
      return;
    }
    this.pendingInput=[];
    this.onDelegate({id:waiting?.id??null,offsetMs:waiting?.offsetMs,
      text:transport||text,sessionId:this.sessionId});
  }
  context(content){this.latestContext=boundedContext(content);this.send({type:'session.thinking.append',delegation_id:null,content:this.latestContext});}
  result(content,delegationId=null){this.send({type:'session.commentary.append',delegation_id:delegationId,content:boundedContext(content)});}
  mute(value){
    if(!this.ready||this.phase==='closing')return;
    this.isMuted=value;
    this.microphone?.getAudioTracks().forEach(t=>t.enabled=!value);
    this.send({type:value?'session.input_audio.mute':'session.input_audio.unmute'});
    this.state(value?'muted':'listening',value?'Microphone muted · session time continues':'Microphone live · AI voice');
  }
  async hear(){await this.audio?.play();this.state(this.isMuted?'muted':'listening',this.isMuted?'Microphone muted · session time continues':'Microphone live · AI voice');}
  async closeRemote(sessionId=this.sessionId,transportClosed=false){
    if(sessionId)return this.request('/api/voice',{action:'end',sessionId,transportClosed}).catch(()=>{});
  }
  disconnect(){
    const id=this.sessionId;
    this.send({type:'session.close'});
    this.cleanup();
    return this.closeRemote(id,true);
  }
  limitDetail(){return `${Math.round(this.maxSeconds/60)}-minute talk limit reached.`;}
  closedDetail(confirmed=true,fallback='Talk stopped.'){
    const expired=this.expiresAt&&Date.now()/1000>=this.expiresAt-1;
    return `${this.endDetail||(expired?this.limitDetail():fallback)} Microphone off.${confirmed?'':' Final usage unconfirmed.'}`;
  }
  end(detail='Talk stopped.'){
    if(['closed','idle','closing'].includes(this.phase))return;
    this.endDetail=detail;this.state('closing',`${detail} Closing voice…`);this.microphone?.getTracks().forEach(t=>t.stop());
    if(this.send({type:'session.close'})){
      this.closeTimer=setTimeout(()=>{const message=this.closedDetail(false);this.disconnect();this.state('closed',message);},8000);
    }else{
      this.disconnect();
      if(!this.startPending)this.state('closed',this.closedDetail(false));
    }
  }
  cleanup(){
    clearInterval(this.leaseTimer);clearTimeout(this.limitTimer);clearTimeout(this.startTimer);clearTimeout(this.closeTimer);clearTimeout(this.dispatchTimer);
    this.waitingDelegation=null;
    this.microphone?.getTracks().forEach(t=>t.stop());this.microphone=null;this.ready=false;
    const channel=this.channel;this.channel=null;if(channel)channel.onclose=null;
    ++this.generation;channel?.close();this.peer?.close();this.peer=null;
    if(this.audio){this.audio.pause();this.audio.srcObject=null;}
  }
}
