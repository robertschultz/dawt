import { LiveVoiceClient } from './afterhours/live-voice.js';

export function movementFeedback(text) {
  const phrase=text.toLowerCase().trim();
  const styles=[
    ['spin',/\bspin(?:s|ning)?\b/],['bounce',/\bbounc(?:e|es|ing)\b/],
    ['glide',/\bglid(?:e|es|ing)\b/],['roll',/\bbody roll(?:s|ing)?\b/],
    ['two-step',/\btwo[- ]step(?:s|ping)?\b/],['nod',/\b(?:nod(?:s|ding)?|head bob(?:s|bing)?)\b/],
    ['look',/\blook(?:ing)? around\b/],['twist',/\btwist(?:s|ing)?\b/],
    ['shimmy',/\b(?:shimmy|shimmies|shimmying)\b/],['jump',/\bjump(?:s|ing)?\b/],
    ['flip',/\bflip(?:s|ping)?\b/],['jack',/\bjack(?:ing)?\b/],['skating',/\bskat(?:e|es|ing)\b/],
    ['salsa-step',/\bsalsa\b/],['heel-toe',/\bheel[- ]toe\b/],
    ['running-man',/\brunning man\b/],['pas-de-bourree',/\bpas de bourr[ée]e\b/]
  ];
  const move=styles.find(([,test])=>test.test(phrase))?.[0]||'';
  const refersToMotion=/\b(?:that|this|last|previous) (?:dance|move|movement|spin|groove)\b|\bmoves? like that\b/.test(phrase);
  if(!move&&!refersToMotion)return null;
  if(move&&!refersToMotion&&/\b(?:track|record|song|playlist|mix|queue|bpm|tempo)\b/.test(phrase)&&
    !/\b(?:you|your|dot)\b/.test(phrase))return null;
  if(/\b(?:less|fewer|stop|avoid|don't like|do not like|too much|don't do|not a fan)\b/.test(phrase))return {move,direction:-1};
  if(/\b(?:more|again|keep doing|keep that|like|love|great|nice|enjoy)\b/.test(phrase))return {move,direction:1};
  return null;
}

function moodFrom(text) {
  if(/\b(?:wrong|sorry|frustrat\w*|hate|stop|too loud)\b/i.test(text))return 'concerned';
  if(/\b(?:amazing|excited|let's go|love it|banger|awesome)\b/i.test(text))return 'excited';
  if(/\b(?:thanks|thank you|great|nice|perfect|glad)\b/i.test(text))return 'warm';
  if(/[?]|\b(?:what|why|how|could we|wonder)\b/i.test(text))return 'curious';
  return 'neutral';
}

class SpeechMeter {
  sample(context,stream) {
    if(stream!==this.stream){
      this.disconnect();
      this.stream=stream;
      if(stream?.getAudioTracks().length&&context?.state==='running'){
        this.source=context.createMediaStreamSource(stream);
        this.analyser=context.createAnalyser();
        this.analyser.fftSize=512;
        this.buffer=new Float32Array(this.analyser.fftSize);
        this.source.connect(this.analyser);
      }
    }
    if(!this.analyser)return 0;
    this.analyser.getFloatTimeDomainData(this.buffer);
    const power=this.buffer.reduce((sum,n)=>sum+n*n,0)/this.buffer.length;
    return Math.min(1,Math.sqrt(power)*5);
  }
  disconnect() {
    this.source?.disconnect();
    this.source=null;
    this.analyser=null;
    this.stream=null;
  }
}

async function action(data) {
  const response=await fetch('/dj-voice',{
    method:'POST',headers:{'content-type':'application/json','x-dot-afterhours':'1'},
    body:JSON.stringify(data),keepalive:data.action==='end'
  });
  if(!response.headers.get('content-type')?.includes('application/json'))
    throw Error('Afterhours Talk is unavailable.');
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'Afterhours Talk is unavailable.');
  return result;
}

export function bindDotVoice({button,notice,label,hear,onReady=()=>{},onEngage=()=>{},onPlayRequest=()=>{}}) {
  let checking=false;
  let noticeTimer;
  let status='idle';
  let context;
  let lastUser=-Infinity;
  let lastMic=-Infinity;
  let lastDot=-Infinity;
  let lastAudible=-Infinity;
  let speech='';
  let speechRole='';
  let emotion='neutral';
  let emotionAt=-Infinity;
  let operatorWords='';
  let feedbackAt=-Infinity;
  let feedbackSerial=0;
  let feedback=null;
  let workPhase='';
  const input=new SpeechMeter();
  const output=new SpeechMeter();
  const requests=new Set();
  const session=new LiveVoiceClient({
    request:(_,payload)=>action(payload),
    operatorSpeaking:()=>performance.now()-lastMic<250,
    onState:({phase,detail})=>update(phase,detail),
    onTranscript:({role,text})=>{
      const now=performance.now();
      const gap=now-(role==='user'?lastUser:lastDot);
      speech=(speechRole===role&&gap<1200?speech+text:text).slice(-220);
      speechRole=role;
      if(role==='user'){
        operatorWords=(gap<700?operatorWords+text:text).slice(-360);
        lastUser=now;
      }
      else lastDot=now;
      const mood=moodFrom(speech);
      if(mood!=='neutral'){emotion=mood;emotionAt=now;}
    },
    onDelegate:request=>void delegate(request)
  });

  function update(phase,detail) {
    status=phase;
    const activated=['connecting','listening','muted','audio-blocked','closing'].includes(phase);
    button.setAttribute('aria-pressed',String(activated));
    button.title=activated?'End Talk with Dot':'Talk to Dot';
    notice.hidden=!detail;
    if(label.textContent!==detail)label.textContent=detail;
    hear.hidden=phase!=='audio-blocked';
    if(phase==='listening')onReady();
    if(!activated){
      requests.clear();
      workPhase='';
      input.disconnect();
      output.disconnect();
      lastUser=lastDot=emotionAt=-Infinity;
      lastAudible=-Infinity;
      speech=speechRole='';
      operatorWords='';
      feedback=null;
      emotion='neutral';
      context?.suspend().catch(()=>{});
    }
    clearTimeout(noticeTimer);
    if(!activated&&detail)noticeTimer=setTimeout(()=>{notice.hidden=true;},9000);
  }

  async function delegate({id,text,sessionId}) {
    const messageId=crypto.randomUUID();
    requests.add(messageId);
    let previous='';
    let announced='';
    try{
      let result=await action({action:'delegate',text,messageId,sessionId});
      if(result.freshStart)onPlayRequest();
      const deadline=Date.now()+45000;
      while(result.working&&session.sessionId===sessionId&&session.ready&&Date.now()<deadline){
        workPhase=result.phase||'';
        if(result.message&&result.message!==previous){
          session.context(result.message);
          previous=result.message;
        }
        if(result.freshStart&&announced!==workPhase&&['searching','preparing','starting'].includes(workPhase)){
          session.result('Give one quick spoken progress update based on this confirmed Afterhours status: '+result.message);
          announced=workPhase;
        }
        await new Promise(resolve=>setTimeout(resolve,850));
        if(session.sessionId!==sessionId||!session.ready)return;
        result=await action({action:'progress',messageId,sessionId});
      }
      if(session.sessionId===sessionId&&session.ready)
        session.result(result.message||(result.working?'Afterhours is still working.':'Afterhours finished the request.'),id);
    }catch(error){
      if(session.sessionId===sessionId&&session.ready)session.result(error.message,id);
    }finally{
      requests.delete(messageId);
      if(!requests.size)workPhase='';
    }
  }

  button.addEventListener('click',async()=>{
    if(['connecting','listening','muted','audio-blocked','closing'].includes(status)){
      session.end();
      return;
    }
    if(checking)return;
    checking=true;
    try{
      onEngage();
      if(globalThis.AudioContext){
        context ||= new AudioContext();
        void context.resume().catch(()=>{});
      }
      const config=await action({action:'status'});
      if(!config.configured)throw Error('Afterhours needs an OpenAI API key before Talk can start.');
      if(config.model!=='gpt-live-1.1')throw Error('Restart the Dot Afterhours engine to activate GPT-Live-1.1.');
      await session.start('rob');
    }catch(error){update('error',error.message);}
    finally{checking=false;}
  });
  hear.addEventListener('click',()=>session.hear().catch(()=>update('audio-blocked','Select Hear Dot to enable voice playback.')));
  addEventListener('pagehide',()=>session.disconnect());
  return {
    audio:()=>session.audio,
    pose(now){
      if(!session.ready)return null;
      if(lastUser>feedbackAt&&now-lastUser>620){
        const preference=movementFeedback(operatorWords);
        if(preference)feedback={id:++feedbackSerial,...preference};
        feedbackAt=lastUser;
      }
      const activeContext=context?.state==='running'?context:null;
      const voice=output.sample(activeContext,activeContext?session.audio?.srcObject:null);
      const mic=session.isMuted?0:input.sample(activeContext,activeContext?session.microphone:null);
      if(mic>.075)lastMic=now;
      const speaking=voice>.055||now-lastDot<390;
      if(voice>.055||now-lastDot<170)lastAudible=now;
      const audibleOutput=Boolean(session.audio?.srcObject&&!session.audio.paused&&!session.audio.muted&&
        status!=='audio-blocked'&&status!=='closing');
      const hearing=mic>.075||now-lastUser<520;
      return {
        phase:speaking?'speaking':requests.size?'working':hearing?'hearing':'listening',
        emotion:now-emotionAt<3600?emotion:'neutral',
        level:speaking?Math.max(voice,.11):hearing?mic:0,
        audibleOutput,
        duckMusic:audibleOutput&&now-lastAudible<280,
        workPhase,
        feedback
      };
    }
  };
}
