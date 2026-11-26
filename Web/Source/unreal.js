import { Config, PixelStreaming, Logger, LogLevel } from '@epicgames-ps/lib-pixelstreamingfrontend-ue5.8';
import { labels } from './performance.js';

const get = id => document.getElementById(id);
const root = get('world');
const status = get('status');
const viewport = get('viewport');
const actions = [...document.querySelectorAll('[data-move],#headphones,#pause,#stage,#view')];
const moveButtons = [...document.querySelectorAll('[data-move]')];
const play = get('pause');
const headphones = get('headphones');
const stage = get('stage');
const stageNames = ['Studio','Sand','Violet','Black box'];
let ready = false;
let pause = false;
let wearing = true;
let stageIndex = 0;

function showStatus(message, live=false) {
  status.textContent = message;
  status.dataset.live = String(live);
}
actions.forEach(action => action.disabled = true);
showStatus('Connecting to Unreal');
Logger.InitLogging(LogLevel.Warning,false);
const config = new Config({ initialSettings:{
  AutoPlayVideo:true, AutoConnect:true, StartVideoMuted:true, WaitForStreamer:true, KeyboardInput:true
}});
const stream = new PixelStreaming(config,{videoElementParent:root});
const playback = document.createElement('button');
playback.type = 'button';
playback.className = 'stream-play';
playback.textContent = 'Start stream';
playback.hidden = true;
viewport.appendChild(playback);
playback.addEventListener('click',() => { stream.play(); playback.hidden = true; });
stream.addEventListener('playStreamRejected',() => playback.hidden = false);
stream.addEventListener('webRtcConnected',() => {
  ready = true;
  showStatus('Unreal live',true);
  actions.forEach(action => action.disabled = false);
});
stream.addEventListener('webRtcDisconnected',() => {
  ready = false;
  showStatus('Reconnecting to Unreal');
  actions.forEach(action => action.disabled = true);
});
stream.addEventListener('statsReceived',event => {
  const video = event.data.aggregatedStats.inboundVideoStats;
  if (ready && video.framesPerSecond) showStatus(`Unreal live · ${Math.round(video.framesPerSecond)} fps`,true);
});
function send(action) {
  if (ready) stream.emitUIInteraction({action});
}
function pauseLabel() {
  play.textContent = pause ? '▶' : 'Ⅱ';
  play.setAttribute('aria-label',pause ? 'Play performance' : 'Pause performance');
  play.title = play.getAttribute('aria-label');
}
moveButtons.forEach(button => button.addEventListener('click',() => {
  const cue = button.dataset.move;
  send(cue);
  pause = false;
  pauseLabel();
  moveButtons.forEach(choice => choice.setAttribute('aria-pressed',String(choice === button)));
  get('current').textContent = labels[cue];
}));
play.addEventListener('click',() => { send('pause'); pause = !pause; pauseLabel(); });
headphones.addEventListener('click',() => {
  send('headphones');
  wearing = !wearing;
  headphones.setAttribute('aria-checked',String(wearing));
});
stage.addEventListener('click',() => {
  send('stage');
  stageIndex = (stageIndex + 1) % stageNames.length;
  stage.querySelector('span').textContent = stageNames[stageIndex];
});
get('view').addEventListener('click',() => send('view'));
get('expand').addEventListener('click',() => {
  if (document.fullscreenElement) document.exitFullscreen().catch(()=>{});
  else viewport.requestFullscreen?.().catch(()=>{});
});
