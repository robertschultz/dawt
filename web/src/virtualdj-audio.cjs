const {createSocket}=require('node:dgram');

function createVirtualDJAudio() {
  const input=createSocket('udp4');
  const listeners=new Set();
  let packets=[];
  let lastPacket=0;
  let lastSignal=0;
  input.on('error',error=>console.error('DOT_AUDIO_RELAY',error.message));
  input.on('message',packet=>{
    if(packet.length<20||packet.toString('ascii',0,4)!=='CWPC')return;
    const rate=packet.readUInt32LE(4), frames=packet.readUInt16LE(14);
    if(rate<32000||rate>96000||frames<1||frames>240||packet.length!==16+4*frames)return;
    const now=Date.now();
    lastPacket=now;
    if(now-lastSignal>150){
      for(let offset=16;offset<packet.length;offset+=2){
        if(Math.abs(packet.readInt16LE(offset))>128){lastSignal=now;break;}
      }
    }
    input.send(packet,8177,'127.0.0.1',()=>{});
    if(listeners.size&&packets.length<128)packets.push(packet);
  });
  input.bind(8176,'127.0.0.1');
  setInterval(()=>{
    if(!packets.length)return;
    const batch=Buffer.concat(packets);
    packets=[];
    for(const response of listeners){
      if(response.writableNeedDrain)response.destroy();
      else response.write(batch);
    }
  },20).unref();
  return {
    listen(response,headers) {
      if(listeners.size>=8)return response.writeHead(503,headers).end();
      response.writeHead(200,{...headers,'content-type':'application/octet-stream'});
      response.flushHeaders();
      listeners.add(response);
      response.on('close',()=>listeners.delete(response));
    },
    status:()=>({capture:Date.now()-lastPacket<1600,signal:Date.now()-lastSignal<1600})
  };
}
module.exports={createVirtualDJAudio};
