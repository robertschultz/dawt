const { readFileSync } = require('node:fs');
const { createServer } = require('node:http');
const { join } = require('node:path');
const {createVirtualDJAudio}=require('./virtualdj-audio.cjs');
const { getState,getActivity,run,voice } = require('./native-afterhours.cjs');
const { SignallingServer } = require('@epicgames-ps/lib-pixelstreamingsignalling-ue5.8');
const playerPort = Number(process.argv[2] || 8170);
const streamerPort = Number(process.argv[3] || 8172);
const audio=createVirtualDJAudio();
const files = new Map([
  ['/dj-audio-worklet.js',['src/virtualdj-worklet.js','text/javascript; charset=UTF-8']],
  ['/', ['index.html','text/html; charset=UTF-8']],
  ['/dj', ['dj.html','text/html; charset=UTF-8']]
]);
const safeHosts = new Set([`127.0.0.1:${playerPort}`,`localhost:${playerPort}`]);
const headers = {'cache-control':'no-store','x-content-type-options':'nosniff'};
const players = createServer(async (request,response) => {
  if (!safeHosts.has(request.headers.host)) return response.writeHead(403).end();
  const path = request.url?.split('?')[0];
  if ((path === '/dj-native'||path === '/dj-voice') && request.method === 'POST') {
    if (!safeHosts.has(request.headers.host) || request.headers.origin !== `http://${request.headers.host}` ||
      request.headers['sec-fetch-site']==='cross-site' || request.headers['x-dot-afterhours']!=='1')
      return response.writeHead(403).end();
    const reply=(status,json)=>response.writeHead(status,{...headers,'content-type':'application/json'}).end(JSON.stringify(json));
    try {
      const chunks=[];
      let size=0;
      for await(const chunk of request) {
        size+=chunk.length;
        if(size>(path==='/dj-voice'?65536:4096)) return reply(413,{error:'Request is too large.'});
        chunks.push(chunk);
      }
      const body=JSON.parse(Buffer.concat(chunks).toString());
      if(!body||typeof body!=='object'||Array.isArray(body))return reply(400,{error:'Invalid action.'});
      return reply(200,await (path==='/dj-voice'?voice(body):run(body)));
    } catch(error) {
      return reply(error.status||400,{error:error.message});
    }
  }
  if (request.method !== 'GET') return response.writeHead(405).end();
  if (path === '/dj-audio') {
    if(request.headers['sec-fetch-site']!=='same-origin')return response.writeHead(403).end();
    return audio.listen(response,headers);
  }
  if (path === '/health') {
    return response.writeHead(200,{...headers,'content-type':'application/json'})
      .end(JSON.stringify({demo:'dot-unreal',afterhours:true,audio:audio.status()}));
  }
  if(path==='/dj-activity'){
    if(request.headers['sec-fetch-site']==='cross-site')return response.writeHead(403).end();
    try{
      const activity=await getActivity();
      return response.writeHead(200,{...headers,'content-type':'application/json'}).end(JSON.stringify(activity));
    }catch{
      return response.writeHead(503,headers).end();
    }
  }
  if (path === '/dj-native' || path === '/dj-cue') {
    if (request.headers['sec-fetch-site'] === 'cross-site') return response.writeHead(403).end();
    try {
      const value=await getState();
      return response.writeHead(200,{...headers,'content-type':'application/json'}).end(JSON.stringify(value));
    } catch {
      return response.writeHead(503,{...headers,'content-type':'application/json'}).end(JSON.stringify({program:null,state:null}));
    }
  }
  const file=files.get(path);
  if (!file) return response.writeHead(404).end();
  try {
    const content=readFileSync(join(__dirname,file[0]));
    response.writeHead(200,{...headers,'content-type':file[1],'content-length':content.length}).end(content);
  } catch {
    response.writeHead(404).end();
  }
});
players.listen(playerPort,'127.0.0.1',() => console.log(`DOT_UNREAL_HTTP http://127.0.0.1:${playerPort}/`));
new SignallingServer({
  httpServer:players, streamerPort, peerOptions:{iceServers:[]}, maxSubscribers:6,
  streamerWsOptions:{host:'127.0.0.1'},
  playerWsOptions:{verifyClient:info => {
    try {
      return safeHosts.has(info.req.headers.host) && safeHosts.has(new URL(info.origin).host);
    } catch { return false; }
  }}
});
