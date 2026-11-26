import { Config, PixelStreaming, Logger, LogLevel } from '@epicgames-ps/lib-pixelstreamingfrontend-ue5.8';
import { liveScan, resolveActivity, searchCounts } from './dj-activity.js';
import { bindDotVoice } from './dj-voice.js';
import { createNowRecord } from './now-record.js';
import { createVirtualDJOutput } from './virtualdj-audio.js';
import { createTalkMix } from './talk-mix.js';
const clamp = (value,min,max) => Math.max(min,Math.min(value,max));
function clockText(seconds) {
  const whole=Math.floor(seconds);
  return `${Math.floor(whole/60)}:${String(whole%60).padStart(2,'0')}`;
}

function setText(element,text) {
  if(element.textContent!==text)element.textContent=text;
}

const by = id => document.getElementById(id);
const talkVoice=bindDotVoice({
  button:by('talk-to-dot'),notice:by('voice-notice'),label:by('voice-status'),hear:by('voice-hear'),
  onReady:()=>{claimUntil=performance.now()+1000;},
  onEngage:()=>{if(soundPreference!==false)streamAudio(true);},
  onPlayRequest:()=>{if(soundPreference!==false)streamAudio(true);}
});
const recordStage=by('record-stage');
const recordDisplay=createNowRecord(recordStage);
new ResizeObserver(([entry])=>{
  if(entry.contentRect.height>0)
    recordStage.style.setProperty('--record-size',`${entry.contentRect.height}px`);
}).observe(by('now-copy'));
const nativeOutput=createVirtualDJOutput();
let usingNativeOutput=false;
const talkMix=createTalkMix(()=>[...by('video').querySelectorAll('audio,video'),nativeOutput.audio],talkVoice.audio);
const stage = by('stage');
const studio = by('studio');
const boothPanel = by('booth-panel');
const activityPanel = by('dj-activity');
const activityStatus = by('activity-status');
const activityDetail = by('activity-detail');
const expand = by('expand');
const transport = by('transport');
const mix = by('mix');
const pacing=by('set-pacing');
const message = by('message');
const status = by('stream-state');
const owner = crypto.randomUUID();
let ready = false;
let liveLibrary = [];
let nativeState = null;
let nativeError = '';
let nativeErrorAt = -Infinity;
let nativeKey = '';
let soundPreference=null;
try{
  const saved=localStorage.getItem('dot.hearStream');
  if(saved!==null)soundPreference=saved==='true';
}catch{}
let hearStream=soundPreference===true;
let cinematic = false;
let operation = null;
let activityKey = '';
let agentActivity = null;
let agentActivityAt = -Infinity;
let activityPolling;
let trackKey = '';
const crateVisibility = by('show-crates');
const tableVisibility = by('show-table');
const venue = by('venue');
try { crateVisibility.checked=localStorage.getItem('dot.showCrates')!=='false'; } catch {}
try { tableVisibility.checked=localStorage.getItem('dot.showTable')!=='false'; } catch {}
try {
  const saved=localStorage.getItem('dot.venue');
  if([...venue.options].some(option=>option.value===saved))venue.value=saved;
} catch {}
let queueRenderKey = '';
let meterContext, remoteAnalyser, remoteMedia, remoteSamples;
let busy = false;
let sequence = 0;
let claimUntil = 0;
let gestureId = 0;
let gesture = '';
let gestureAt = -Infinity;
let follow = null;
let followKey = '';
let liveBusy = false;
let lastPoll = 0;


Logger.InitLogging(LogLevel.Warning,false);
const streamConfig = new Config({initialSettings:{
  AutoPlayVideo:true, AutoConnect:true, StartVideoMuted:!hearStream, WaitForStreamer:true, KeyboardInput:false,
  KeepaliveDelay:10000, MaxReconnectAttempts:8
}});
const stream = new PixelStreaming(streamConfig,{videoElementParent:by('video')});
stream.addEventListener('playStreamRejected',() => by('stream-play').hidden = false);
by('stream-play').addEventListener('click',() => { if(hearStream)streamAudio(true);else stream.play(); by('stream-play').hidden = true; });
stream.addEventListener('videoInitialized',()=>applyStreamMute());
function applyStreamMute(){
  const useDirect=usingNativeOutput&&nativeOutput.ready()&&nativeOutput.capture();
  nativeOutput.audio.muted=!hearStream||!useDirect;
  for(const element of by('video').querySelectorAll('audio,video')){
    const muted=!hearStream||useDirect;
    if(element.muted!==muted)element.muted=muted;
  }
}
stream.addEventListener('webRtcConnected',() => {
  ready = true; status.textContent = 'Unreal live'; status.classList.add('station-live');
  stream.emitUIInteraction({action:'headphonesSet',visible:by('headphones').checked});
  stream.emitUIInteraction({action:'cinematic',enabled:cinematic});
  if(hearStream&&!meterContext)streamAudio(true);
});
stream.addEventListener('webRtcDisconnected',() => {
  ready = false; status.textContent = 'Reconnecting to Unreal'; status.classList.remove('station-live');
});
function streamAudio(audible) {
  hearStream = audible;
  streamConfig.setFlagEnabled('StartVideoMuted',!audible);
  by('video').querySelectorAll('audio,video').forEach(element=>{
    if(audible) element.play().catch(()=>{});
  });
  applyStreamMute();
  if(audible) {
    nativeOutput.start().then(available=>{
      usingNativeOutput=available;
      applyStreamMute();
    });
    stream.play();
    meterContext ||= new AudioContext();
    meterContext.resume().catch(()=>{});
  }
  syncStreamAudioControls();
}
function syncStreamAudioControls() {
  const label=hearStream?'Mute stream':'Hear stream';
  const icon=by('stream-sound');
  icon.setAttribute('aria-pressed',String(hearStream));
  icon.setAttribute('aria-label',label);
  const diagnostic=hearStream&&usingNativeOutput ?
    nativeOutput.signal()?'VirtualDJ master connected':nativeOutput.capture()?'VirtualDJ master is silent':'Waiting for the VirtualDJ master' : '';
  icon.title=diagnostic ? `${label} · ${diagnostic}` : label;
  by('native-listen').setAttribute('aria-pressed',String(hearStream));
  by('native-listen').textContent=label;
}
function toggleStreamAudio(){
  soundPreference=!hearStream;
  try{localStorage.setItem('dot.hearStream',String(soundPreference));}catch{}
  streamAudio(soundPreference);
}
function getNativeLevel() {
  if(!hearStream||!meterContext)return 0;
  applyStreamMute();
  if(usingNativeOutput&&nativeOutput.ready()&&nativeOutput.capture())return nativeOutput.level();
  const media=[...by('video').querySelectorAll('audio,video')].find(element=>element.srcObject?.getAudioTracks().length)?.srcObject;
  if(media && media!==remoteMedia && media.getAudioTracks().length){
    remoteAnalyser?.disconnect();
    const incoming=meterContext.createMediaStreamSource(media);
    remoteAnalyser=meterContext.createAnalyser();
    remoteAnalyser.fftSize=1024;
    incoming.connect(remoteAnalyser);
    remoteSamples=new Float32Array(remoteAnalyser.fftSize);
    remoteMedia=media;
  }
  if(!remoteAnalyser||meterContext.state!=='running')return 0;
  remoteAnalyser.getFloatTimeDomainData(remoteSamples);
  return clamp(Math.sqrt(remoteSamples.reduce((sum,x)=>sum+x*x,0)/remoteSamples.length)*5,0,1);
}
function setCinematic(enabled) {
  cinematic=enabled;
  claimUntil=performance.now()+600;
  document.body.classList.toggle('cinema-view',enabled);
  by('cinematic').setAttribute('aria-pressed',String(enabled));
  by('cinematic').title=enabled?'Return to the wide camera':'Follow Dot with cinematic cameras';
  if(ready)stream.emitUIInteraction({action:'cinematic',enabled});
}
crateVisibility.addEventListener('change',()=>{
  try { localStorage.setItem('dot.showCrates',String(crateVisibility.checked)); } catch {}
  claimUntil=performance.now()+350;
});
tableVisibility.addEventListener('change',()=>{
  try { localStorage.setItem('dot.showTable',String(tableVisibility.checked)); } catch {}
  claimUntil=performance.now()+350;
});
venue.addEventListener('change',()=>{
  try { localStorage.setItem('dot.venue',venue.value); } catch {}
  claimUntil=performance.now()+600;
});
by('cinematic').addEventListener('click',()=>setCinematic(!cinematic));
by('booth-controls').addEventListener('click',()=>boothPanel.showModal());
by('close-booth').addEventListener('click',()=>boothPanel.close());
boothPanel.addEventListener('click',event=>{if(event.target===boothPanel)boothPanel.close();});
addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!boothPanel.open&&!activityPanel.matches(':popover-open')&&!document.fullscreenElement&&cinematic)setCinematic(false);
});
function upcomingRecords() {
  const order=nativeState?.order || [];
  return nativeState?.active ? order.slice(Math.max(0,(nativeState.index??-1)+1)) : order;
}
function renderQueue(){
  const upcoming=upcomingRecords();
  const editable=!nativeState?.active&&!follow?.program?.playing&&!busy&&upcoming.length>1;
  const key=JSON.stringify([editable,upcoming.map(track=>[track.id,track.title])]);
  if(key===queueRenderKey)return;
  queueRenderKey=key;
  by('queue-count').textContent=upcoming.length ? `${upcoming.length} track${upcoming.length===1?'':'s'}` : '';
  by('queue-empty').hidden=upcoming.length>0;
  const list=by('queue-list');
  list.replaceChildren();
  for(const [index,track] of upcoming.entries()){
    const row=document.createElement('li');
    const position=document.createElement('span');position.className='position';position.textContent=index+1;
    const name=document.createElement('span');name.className='queued-title';name.textContent=track.title;name.title=track.title;
    row.append(position,name);
    if(editable){
      const controls=document.createElement('span');controls.className='queue-controls';
      for(const [label,offset] of [['Earlier',-1],['Later',1]]){
        const button=document.createElement('button');button.type='button';button.textContent=label;
        button.setAttribute('aria-label',`${label}: ${track.title}`);
        button.disabled=index+offset<0||index+offset>=upcoming.length;
        button.addEventListener('click',()=>{
          const ids=upcoming.map(record=>record.id);
          [ids[index],ids[index+offset]]=[ids[index+offset],ids[index]];
          void nativeAction({action:'reorder',ids});
        });
        controls.appendChild(button);
      }
      row.appendChild(controls);
    }
    list.appendChild(row);
  }
}
by('native-listen').addEventListener('click',toggleStreamAudio);
by('stream-sound').addEventListener('click',toggleStreamAudio);
syncStreamAudioControls();
by('native-search').addEventListener('submit',event=>{
  event.preventDefault();
  void nativeAction({action:'search',query:by('catalog-query').value});
});
async function nativeAction(payload, reaction) {
  if (busy) return;
  busy=true; nativeError='';
  operation={name:payload.action,detail:payload.query||''};
  updateButtons();
  try {
    const response=await fetch('/dj-native',{method:'POST',headers:{
      'Content-Type':'application/json','X-Dot-Afterhours':'1'
    },body:JSON.stringify(payload)});
    const state=await response.json();
    if(!response.ok) throw Error(state.error||'Afterhours declined the action');
    if(reaction)mark(reaction);
    nativeState=state;
    notice(state.message || 'Afterhours accepted the action');
    renderLibrary();
  } catch(error){
    nativeError=error.message;
    nativeErrorAt=performance.now();
    notice(nativeError);
  } finally {
    busy=false; operation=null; updateButtons();
    void pollNative();
  }
}
by('headphones').addEventListener('change',() => {
  if (ready) stream.emitUIInteraction({action:'headphonesSet',visible:by('headphones').checked});
});
expand.hidden=!document.fullscreenEnabled;
expand.addEventListener('click',() => {
  if (document.fullscreenElement) document.exitFullscreen().catch(()=>{});
  else studio.requestFullscreen().catch(()=>{});
});
document.addEventListener('fullscreenchange',()=>{
  const label=document.fullscreenElement?'Exit full screen':'Full screen';
  expand.title=label;
  expand.setAttribute('aria-label',label);
});

function notice(text) {
  message.textContent = text;
}
function mark(event) {
  gesture = event;
  gestureId++;
  gestureAt = performance.now();
}
function renderLibrary() {
  const list=by('tracks');
  list.replaceChildren();
  for(const track of liveLibrary){
    const row=document.createElement('div');
    row.className='record';
    row.dataset.trackId=track.id;
    const title=document.createElement('span');
    title.textContent=track.title||'Untitled';
    const artist=document.createElement('span');
    artist.className='muted artist';
    artist.textContent=track.artist||'—';
    const bpm=document.createElement('span');
    bpm.className='muted';
    bpm.textContent=Number.isFinite(track.bpm)?`${Number(track.bpm.toFixed(1))} BPM`:'—';
    const add=document.createElement('button');
    add.type='button';
    const queued=nativeState?.queuedIds?.includes(track.id)||nativeState?.order?.some(record=>record.id===track.id);
    add.textContent=queued?'Queued':'Queue';
    add.setAttribute('aria-label',`${queued?'Queued':'Queue'} ${track.title}`);
    add.disabled=busy||queued||!/^virtualdj:[a-f0-9]{64}$/.test(track.id||'');
    add.addEventListener('click',()=>void nativeAction({action:'queue',id:track.id},'cue'));
    row.append(title,artist,bpm,add);
    list.appendChild(row);
  }
}
function updateButtons() {
  const livePlay=Boolean(follow?.program?.playing);
  const running=livePlay||Boolean(nativeState?.active&&!['discovering','catalog-ready'].includes(nativeState.phase));
  transport.disabled=busy||(!running&&(!nativeState?.connected||(nativeState?.order?.length||0)<2));
  transport.textContent=running?'Stop set':'Start set';
  pacing.disabled=busy||running;
  mix.disabled=busy||!livePlay||!nativeState?.canMixNow;
  mix.title=mix.disabled?'Afterhours enables early mixing when the next deck is cued.':'Mix into the next record';
  renderQueue();
}
transport.addEventListener('click',()=>{
  const stopping=transport.textContent==='Stop set';
  if(!stopping&&soundPreference!==false)streamAudio(true);
  claimUntil=performance.now()+350;
  const setting=pacing.value;
  const timing=setting.startsWith('blend-')?{blendSeconds:Number(setting.slice(6))}:
    setting==='standard'?{}:{seconds:Number(setting)};
  void nativeAction(stopping?{action:'stop'}:{action:'start',...timing},stopping?'pause':'cue');
});
mix.addEventListener('click',()=>void nativeAction({action:'mix'},'mix'));

async function pollNative() {
  if (liveBusy) return;
  liveBusy = true;
  try {
    const response=await fetch('/dj-native',{cache:'no-store'});
    const data=await response.json();
    const current=data.program;
    if(!response.ok||!data.state)throw Error('Afterhours engine offline. Launch Dot Afterhours to start it.');
    nativeState=data.state;
    if(current?.playing&&!follow?.program?.playing)mark('play');
    else if(follow?.program?.playing&&!current?.playing)mark('pause');
    else if(followKey&&current?.current&&followKey!==current.current){
      nativeError='';
      mark('handoff');
    }
    else if(current?.sessionPhase==='mixing'&&follow?.program?.sessionPhase!=='mixing')mark('mix');
    else if(current?.playing&&Math.abs(current.clock?.bpm-(follow?.program?.clock?.bpm||current.clock?.bpm))>=.65)mark('tempo');
    followKey=current?.current||'';
    follow={program:current,telemetry:data.telemetry,receivedAt:performance.now()};
    const crate=new Map((current?.library||[]).map(track=>[track.id,track]));
    for(const track of [...nativeState.order,...nativeState.candidates])crate.set(track.id,track);
    liveLibrary=[...crate.values()];
    const key=JSON.stringify([liveLibrary.map(t=>t.id),nativeState.order.map(t=>t.id),nativeState.queuedIds,nativeState.active,nativeState.connected]);
    if(key!==nativeKey){nativeKey=key;renderLibrary();}
    if(!busy&&!nativeError){
      const searching=['queued','searching','reading','done','error'].includes(nativeState.search?.status) &&
        (nativeState.phase==='discovering'||nativeState.search.status==='error');
      notice(searching?nativeState.search.message:nativeState.connected?
        nativeState.message||'Afterhours connected • search the Beatport crate':
        'Afterhours is running • waiting for VirtualDJ readings');
    }
    updateButtons();
  } catch(error) {
    if(follow&&performance.now()-follow.receivedAt>=2500){follow=null;nativeState=null;}
    if(!nativeError)notice(error.message);
    updateButtons();
  } finally {liveBusy=false;}
}

function liveFrame() {
  const p=follow?.program,t=follow?.telemetry;
  const valid = p && performance.now()-follow.receivedAt<2500;
  const clock = p?.clock;
  const bpm = Number.isFinite(clock?.bpm) ? clock.bpm : 120;
  const sampled = Number.isFinite(clock?.sampledAtUnixMs) ? clock.sampledAtUnixMs : Date.now();
  const age = clamp((Date.now()-sampled)/1000,0,2.5);
  const playing = Boolean(valid&&p.playing&&Number.isFinite(clock?.beatPosition));
  const recordingPlaying = Boolean(valid&&p.playing&&p.current);
  const deck = p?.current && t?.decks?.[1]?.id === p.current ? 1 : 0;
  const beat = Math.max(0,(clock?.beatPosition||0)+(playing?bpm*age/60:0));
  const current = liveLibrary.find(track=>track.id===p?.current);
  const fader = Number.isFinite(t?.crossfader) ? t.crossfader : deck;
  const trackTitle=valid ? current?.title || (p.current && t?.decks?.[deck]?.id===p.current ? t.decks[deck].title : '') : '';
  const trackDuration=valid&&Number.isFinite(p.durationSeconds)&&p.durationSeconds>0 ? p.durationSeconds : null;
  const trackElapsed=valid&&Number.isFinite(p.positionSeconds)
    ? clamp(p.positionSeconds+(playing?age:0),0,trackDuration??Infinity) : null;
  const trackProgress=trackDuration!==null&&trackElapsed!==null ? trackElapsed/trackDuration : -1;
  const transitionIn=valid&&playing&&Number.isFinite(p.transitionInSeconds)
    ? Math.max(0,p.transitionInSeconds-age) : null;
  const trackPaused=Boolean(valid&&trackTitle&&!playing&&trackProgress>.001&&nativeState?.phase!=='completed');
  return {trackTitle:trackTitle||'',trackArtist:valid?current?.artist||'':'',artworkUrl:valid?current?.artworkUrl||'':'',
    trackProgress,trackDuration,trackElapsed,transitionIn,trackPaused,recordingPlaying,
    currentRecord:valid?p.current||'':'',currentGenre:valid?current?.genre||'':'',
    recordFinished:Boolean(valid&&!playing&&['completed','stopped'].includes(nativeState?.phase)),
    beat,bpm,playing,energy:playing?current?.energy||.45:0,bass:0,level:0,deck,fader,
    incoming:1-deck,progress:0,mixing:p?.sessionPhase==='mixing',
    scheduled:Number.isFinite(p?.transitionInSeconds)&&p.transitionInSeconds<8,
    deckA:t?.decks?.[0]?.playing?1:0,deckB:t?.decks?.[1]?.playing?1:0,
    titles:[t?.decks?.[0]?.title||(!deck?current?.title:null),t?.decks?.[1]?.title||(deck?current?.title:null)]};
}

activityPanel.addEventListener('toggle',()=>{
  activityPolling?.abort();
  activityPolling=null;
  agentActivity=null;
  agentActivityAt=-Infinity;
  if(!activityPanel.matches(':popover-open'))return;
  const poll=activityPolling=new AbortController();
  void pollNative();
  void pollAgentActivity(poll.signal);
});

async function pollAgentActivity(signal) {
  try {
    const response=await fetch('/dj-activity',{cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(3500)])});
    if(!response.ok)return;
    const current=await response.json();
    if(!signal.aborted){
      agentActivity=current;
      agentActivityAt=performance.now();
    }
  }catch{}finally{
    if(!signal.aborted)setTimeout(()=>{if(!signal.aborted)void pollAgentActivity(signal);},850);
  }
}

function tick() {
  const clock=performance.now();
  if(clock-lastPoll>400){lastPoll=clock;void pollNative();}
  const frame=liveFrame();
  frame.level=getNativeLevel();
  if(hearStream&&usingNativeOutput)syncStreamAudioControls();
  const currentIndex=nativeState?.order.findIndex(track=>track.id===frame.currentRecord)??-1;
  const queued=follow?.program?.nextTrack?.id ? follow.program.nextTrack
    : nativeState?.active && currentIndex>=0 ? nativeState.order[currentIndex+1] : null;
  const next=queued ? liveLibrary.find(item=>item.id===queued.id&&item.artworkUrl)||queued : null;
  const talk=talkVoice.pose(clock);
  talkMix(Boolean(talk?.duckMusic),Boolean(talk?.audibleOutput));
  const preparing=frame.scheduled||frame.mixing||(frame.playing&&Number.isFinite(follow?.program?.transitionInSeconds)&&follow.program.transitionInSeconds<13);
  const payload={...frame,venue:Number(venue.value),showCrates:crateVisibility.checked,showTable:tableVisibility.checked,
    talkPhase:talk?.phase||'',talkEmotion:talk?.emotion||'',talkLevel:talk?.level||0,
    moveFeedbackId:talk?.feedback?.id??0,moveFeedbackName:talk?.feedback?.move||'',
    moveFeedbackDirection:talk?.feedback?.direction??0,
    recordTarget:preparing&&next?next.id||next.title:'',targetGenre:next?.genre||''};
  if(ready)stream.emitUIInteraction({action:'afterhours',owner,origin:'native',sequence:sequence++,
    claim:clock<claimUntil,gestureId,gesture,...payload});
  stage.dataset.music=JSON.stringify({source:'native',...payload,gesture,gestureId});
  const recordKey=frame.recordFinished?'':frame.currentRecord;
  recordDisplay.warm(next?.artworkUrl);
  recordDisplay.present(recordKey,frame.artworkUrl,frame.recordingPlaying);
  by('now-playing').hidden=!frame.trackTitle||!(cinematic||by('native-hud').checked)||frame.recordFinished;
  const trackDisplay=[frame.trackTitle,frame.trackArtist,frame.trackPaused].join('\u001f');
  if(trackDisplay!==trackKey){
    trackKey=trackDisplay;
    by('now-title').textContent=frame.trackTitle;
    by('now-artist').textContent=[frame.trackArtist,frame.trackPaused?'Paused':''].filter(Boolean).join(' · ');
  }
  by('now-timing').hidden=frame.trackElapsed===null&&frame.trackDuration===null;
  by('now-progress').hidden=frame.trackProgress<0;
  by('now-progress').value=Math.max(0,frame.trackProgress);
  setText(by('now-time'),[frame.trackElapsed,frame.trackDuration].map(value=>value===null?'—':clockText(value)).join(' / '));
  const stagedIndex=nativeState?.staged?.findIndex(track=>track.id===frame.currentRecord)??-1;
  const staged=stagedIndex>=0 ? nativeState.staged[stagedIndex+1] : null;
  const upcoming=next?.id!==frame.currentRecord ? next : null;
  const suggested=upcoming||staged;
  const continuing=nativeState?.rolling?.status;
  const waiting=frame.mixing||Boolean(continuing)||Boolean(frame.playing&&nativeState?.active);
  const nextLabel=[suggested?.title,suggested?.artist].filter(Boolean).join(' · ')||
    (continuing==='held'?'No compatible track found':continuing?'Finding a track':'End of queue');
  by('now-next').hidden=!suggested?.title&&!waiting;
  setText(by('now-next-track'),nextLabel);
  const transition=!upcoming?(staged?'Preparing':''):frame.mixing&&frame.transitionIn!==null?'Mixing now':
    frame.transitionIn===null?'':frame.transitionIn>0?`Mix in ${clockText(Math.ceil(frame.transitionIn))}`:'Mix due';
  by('now-transition').hidden=!transition;
  setText(by('now-transition'),transition);
  by('bpm').textContent=Number.isFinite(follow?.program?.clock?.bpm)?`${frame.bpm.toFixed(1)} BPM`:'—';
  if(activityPanel.matches(':popover-open')){
    const agent=clock-agentActivityAt<5000?agentActivity:null;
    const activity=resolveActivity({isNative:true,state:nativeState,agent,operation,frame,next,
      nativeError:clock-nativeErrorAt<6000?nativeError:'',gesture,recent:clock-gestureAt<1600,
      voiceWork:talk?.workPhase,talkPhase:talk?.phase});
    const title=activity.title||(frame.playing?'Playing':nativeState?'Waiting for playback':'Connecting to Afterhours');
    const from=nativeState?.blendFrom, to=nativeState?.blendTitle;
    const detail=title==='Mixing tracks'&&from&&to?`${from} → ${to}`:activity.detail||(title==='Playing'?frame.trackTitle:'');
    const counts=searchCounts(nativeState?.search);
    const searching=title==='Searching the crate'||title==='Crate search queued';
    const scan=counts?(searching?counts:`Crate search · ${counts}`):liveScan(nativeState?.dig);
    const text=[detail,scan].filter(Boolean).join('\n');
    const key=JSON.stringify([title,text]);
    if(key!==activityKey){
      activityKey=key;
      setText(activityStatus,title);
      setText(activityDetail,text);
      activityDetail.hidden=!text;
    }
  }else{
    activityKey='';
  }
}
updateButtons();
setInterval(tick,62);
