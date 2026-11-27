const {randomUUID}=require('node:crypto');
const {request:httpRequest}=require('node:http');
const port=Number(process.env.DOT_AFTERHOURS_PORT||8765);
if (!Number.isInteger(port)||port<1024||port>65535) throw Error('Invalid Afterhours engine port');
const MAX_RESPONSE=3_000_000;
let statusRequest;
let activityRequest;
let mutation=false;

function engineResponse(path,body,token,timeout) {
  const payload=body?Buffer.from(JSON.stringify(body)):null;
  const headers={
    ...(token?{'X-DJ-Token':token}:{}),
    ...(payload?{'Content-Type':'application/json','Content-Length':payload.length}:{})
  };
  // Keep loopback traffic off the Undici DSCP socket path on macOS.
  return new Promise((resolve,reject)=>{
    const outgoing=httpRequest({hostname:'127.0.0.1',port,path,headers,method:payload?'POST':'GET',
      signal:AbortSignal.timeout(timeout)},resolve);
    outgoing.once('error',reject);
    outgoing.end(payload);
  });
}

async function readResponse(response,limit) {
  const chunks=[];
  let length=0;
  for await (const chunk of response) {
    length+=chunk.length;
    if(length>limit) throw Error('Afterhours returned an oversized response.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks,length);
}

async function request(path,body,token,timeout=body?6500:1800) {
  let response;
  try {
    response=await engineResponse(path,body,token,timeout);
    if(response.statusCode>=300&&response.statusCode<400) {
      response.destroy();
      throw Error('Afterhours returned an unexpected redirect.');
    }
  } catch {
    throw Object.assign(Error('Afterhours engine did not respond.'),{status:503});
  }
  const result=JSON.parse((await readResponse(response,MAX_RESPONSE)).toString());
  if(response.statusCode>=400)throw Object.assign(Error(result.error||'Afterhours declined the request.'),{status:response.statusCode});
  return result;
}
const trackId=id=>typeof id==='string'&&/^virtualdj:[a-f0-9]{64}$/.test(id);
function artworkUrl(value){
  if(typeof value!=='string'||value.length>2048)return undefined;
  try{
    const url=new URL(value);
    if(url.protocol==='https:'&&['geo-media.beatport.com','media.beatport.com'].includes(url.hostname)&&
      !url.port&&!url.username&&!url.password&&!url.search&&!url.hash&&
      /^\/image_size\/\d{1,4}x\d{1,4}\/[a-f0-9-]+\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname))return url.href;
  }catch{}
}
const record=({id,title,artist,bpm,energy,genre,provider,source,artworkUrl:art})=>
  ({id,title,artist,bpm,energy,genre:typeof genre==='string'?genre.slice(0,80):'',provider,source,artworkUrl:artworkUrl(art)});
const deckRecord=({id,title,playing,bpm,controls})=>({id,title,playing,bpm,originalBpm:controls?.originalBpm,pitch:controls?.pitch});
const activityText=(value,max=240)=>typeof value==='string'?value.slice(0,max):'';
function publicScan(scan){
  return scan&&{status:activityText(scan.status,30),message:activityText(scan.message),
    term:activityText(scan.term||scan.query,120),updated:scan.updated,
    examined:scan.examined,added:scan.added,termExamined:scan.termExamined,termAdded:scan.termAdded,
    latest:scan.latest&&{title:activityText(scan.latest.title,120),artist:activityText(scan.latest.artist,100)}};
}
function publicState(session){
  const index=session.index;
  const offset=session.active&&Number.isInteger(index) ? Math.max(0,index-2) : 0;
  const staged=session.queuedUpdate;
  const transition=session.active&&Number.isInteger(index)&&index>=0
    ? session.mixPlans?.[index] : null;
  const nextId=session.active&&Number.isInteger(index)&&index>=0?session.order?.[index+1]?.id:null;
  return {id:session.id,phase:session.phase,active:session.active,index:Number.isInteger(index)?index-offset:index,
    message:session.message,startedAt:session.startedAt,planId:session.executionPlan?.id||null,
    blendFrom:session.phase==='mixing' ? activityText(session.order?.[index]?.title,120) : '',
    blendTitle:session.phase==='mixing' ? activityText(session.order?.find(t=>t.id===session.activeHandoff?.to)?.title ||
      session.order?.[index+1]?.title,120) : '',
    canMixNow:Boolean(session.active&&session.phase==='playing'&&nextId&&(session.executionPlan?.applied||session.mixStyle==='quick'&&session.timing?.basis==='native-beat-grid')&&
      ['leading','mix'].includes(session.copilot?.mode)&&session.copilot?.command?.status!=='pending'),
    connected:typeof session.telemetry?.sampledAt==='number'&&Math.abs(Date.now()/1000-session.telemetry.sampledAt)<3,
    tempo:session.tempoControl&&{status:session.tempoControl.status,targetBpm:session.tempoControl.targetBpm},
    nextBlend:nextId&&typeof transition?.label==='string'&&typeof transition.reason==='string'
      ? {nextId,label:transition.label.slice(0,60),reason:transition.reason.slice(0,145)} : null,
    search:publicScan(session.catalogSearch),
    dig:publicScan(session.crateDig),
    events:(session.events||[]).slice(-14).map(row=>({at:row.at,kind:activityText(row.kind,30),text:activityText(row.text)})),
    analysis:session.backgroundAnalysis&&{status:session.backgroundAnalysis.status,message:session.backgroundAnalysis.message},
    startup:session.startup&&{status:session.startup.status},
    rolling:session.active&&session.rollingQueue&&{status:session.rollingQueue.status},
    staged:staged&&['needs-analysis','analyzing','ready'].includes(staged.status)
      ? staged.tracks.slice(offset,offset+12).map(record) : [],
    queuedIds:(staged?.tracks||session.order||[]).slice(offset,offset+12).map(track=>track.id),
    order:(session.order||[]).slice(offset,offset+12).map(record),
    candidates:(session.candidates||[]).slice(0,120).map(record)};
}
function getActivity(){
  activityRequest||=(async()=>{
    const config=await request('/api/config');
    if(config.service!=='afterhours-music'||typeof config.token!=='string')throw Error('Afterhours is unavailable.');
    const agent=await request('/api/dj-agent',undefined,config.token);
    return {status:activityText(agent.status,30),message:activityText(agent.message),at:agent.statusAt,
      evaluating:agent.evaluating===true,
      rounds:(agent.reasoning?.rounds||[]).slice(-4).map(round=>{
        const changed=round.selectedIds?.find((id,index)=>round.before?.orderIds?.[index]!==id);
        return {status:activityText(round.status,30),at:round.updatedAt,reason:activityText(round.reason),
          winner:activityText(round.titles?.[round.comparison?.winnerId||changed],120),
          steps:(round.steps||[]).slice(-10).map(step=>({at:step.at,text:activityText(step.text,180),result:activityText(step.result)}))};
      })};
  })().finally(()=>activityRequest=null);
  return activityRequest;
}
function getState(){
  statusRequest||=(async()=>{
    const own=await request('/api/control-state');
    const safe=publicState(await request('/api/set-session'));
    const p=own.program;
    const t=own.telemetry;
    return {state:safe,
      program:p&&{connected:p.connected,playing:p.playing,current:p.current,session:p.session,
        sessionPhase:p.sessionPhase,transitionInSeconds:p.transitionInSeconds,clock:p.clock,
        positionSeconds:p.positionSeconds,durationSeconds:p.durationSeconds,
        nextTrack:p.nextTrack&&record(p.nextTrack),
        library:(p.library||[]).filter((track,index)=>index<100||track.id===p.current).map(record)},
      telemetry:{sampledAt:t?.sampledAt,crossfader:t?.crossfader,decks:t?.decks?.slice(0,2).map(deckRecord)}};
  })().finally(()=>statusRequest=null);
  return statusRequest;
}
async function run(input) {
  if(mutation)throw Object.assign(Error('Wait for the current Afterhours request to finish.'),{status:409});
  mutation=true;
  try{
    const cfg=await request('/api/config');
    if(cfg.service!=='afterhours-music'||typeof cfg.token!=='string')throw Error('The local service is not an Afterhours engine.');
    const post=(route,body)=>request(route,body,cfg.token);
    if(input.action==='search'){
      if(typeof input.query!=='string'||!input.query.trim()||input.query.length>120)throw Error('Enter a track, artist or crate search under 120 characters.');
      return publicState(await post('/api/library',{action:'search',query:input.query.trim(),bpmMin:40,bpmMax:300}));
    }
    const current=await request('/api/set-session');
    if(input.action==='start'){
      if(current.active)throw Error('An Afterhours set is already active.');
      if(input.ids!==undefined&&(!Array.isArray(input.ids)||input.ids.length<2||input.ids.length>12||
        new Set(input.ids).size!==input.ids.length||!input.ids.every(trackId)))throw Error('Choose two to twelve unique recordings from the live crate.');
      const {seconds=null,blendSeconds=null}=input;
      const supported=[15,20,30];
      if((seconds!==null&&!supported.includes(seconds))||
        (blendSeconds!==null&&!supported.includes(blendSeconds))||
        (seconds!==null&&blendSeconds!==null))throw Error('Choose a supported set pacing option.');
      const ids=input.ids||current.order?.map(track=>track.id)||[];
      if(ids.length<2)throw Error('Queue at least two tracks to start a set.');
      const measured=seconds===null&&blendSeconds===null;
      await post('/api/set-session',{action:'plan',ids,seconds:seconds??(measured?30:60),excerptBars:0,
        maxTempoShift:current.maxTempoShift??8,mixStyle:measured?'phrase':'quick',quickBlendSeconds:blendSeconds});
      return publicState(await post('/api/set-session',{action:'start',prepareWhilePlaying:measured,rollingQueue:true}));
    }
    if(input.action==='stop'||input.action==='takeover'){
      return publicState(await post('/api/set-session',{action:input.action}));
    }
    if(input.action==='mix'){
      const index=Number.isInteger(current.index)?current.index:-1;
      const expected={sessionId:current.id,startedAt:current.startedAt??null,planId:current.executionPlan?.id??null,
        index,trackIds:(current.order||[]).slice(Math.max(0,index),Math.max(0,index)+2).map(x=>x.id)};
      return publicState(await post('/api/set-session',{action:'copilot',command:'go',commandId:randomUUID(),expected}));
    }
    if(input.action==='queue'){
      if(!trackId(input.id))throw Error('Choose a recognized Afterhours recording.');
      if(current.active)return publicState(await post('/api/set-session',{action:'insert-track',trackId:input.id}));
      return publicState(await post('/api/library',{action:'queue',trackId:input.id}));
    }
    if(input.action==='reorder'){
      if(!Array.isArray(input.ids)||input.ids.length>12||!input.ids.every(trackId))throw Error('Choose a valid set order.');
      return publicState(await post('/api/set-session',{action:'setlist',operation:'reorder',ids:input.ids}));
    }
    throw Error('Unknown Afterhours action.');
  }finally{mutation=false;}
}
async function voice(input) {
  const config=await request('/api/config');
  if(config.service!=='afterhours-music'||typeof config.token!=='string')throw Error('The local Afterhours engine is unavailable.');
  const token=config.token;
  const {action}=input;
  if(action==='status'){
    const state=await request('/api/voice',undefined,token);
    return {configured:state.configured,model:state.model,voice:state.voice,status:state.status};
  }
  if(action==='start'){
    const state=await voice({action:'status'});
    if(!state.configured)throw Error('Set up an OpenAI API key for Afterhours to talk to Dot.');
    if(state.model!=='gpt-live-1.1')throw Error('Restart the Dot Afterhours engine to activate GPT-Live-1.1.');
    if(input.approveRequest!==true)throw Error('Start Talk from the booth.');
    return request('/api/voice',{action,sdp:input.sdp,requestId:input.requestId,
      approveRequest:true,maxSeconds:1800,voice:'gleam',clientLease:input.clientLease===true},token,34000);
  }
  if(action==='end'||action==='usage'||action==='heartbeat'){
    await request('/api/voice',{action,sessionId:input.sessionId,seconds:input.seconds,finalized:input.finalized===true,transportClosed:input.transportClosed===true},token,12000);
    return {ok:true};
  }
  if(action==='delegate'||action==='progress'){
    if(typeof input.messageId!=='string'||!/^[a-zA-Z0-9_-]{8,80}$/.test(input.messageId))throw Error('Invalid Afterhours request ID.');
    if(action==='delegate'&&(typeof input.text!=='string'||!input.text.trim()||input.text.length>1800))throw Error('The voice request was empty or too long.');
    const state=action==='delegate'
      ? await request('/api/dj-agent',{action:'message',source:'voice',text:input.text,
          messageId:input.messageId,sessionId:input.sessionId,queueMode:'steer',approveRequest:true},token,15000)
      : await request('/api/dj-agent',undefined,token);
    const reply=state.messages?.find(m=>m.id===input.messageId+'-reply');
    const playback=state.playbackRequest?.id===input.messageId?state.playbackRequest:null;
    const working=Boolean(state.evaluating||state.preparation||
      ['choosing','preparing','starting'].includes(playback?.status)||
      ['pending','evaluating','searching','preparing','starting'].includes(state.status));
    return {message:String(playback?.message||(!working&&reply?.text)||state.message||'').slice(0,400),
      working,phase:state.status,freshStart:playback?.freshQueue===true};
  }
  throw Error('Unknown Talk action.');
}
module.exports={getState,getActivity,run,voice};
