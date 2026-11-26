const enginePhases = {
  discovering:'Searching the crate', loading:'Loading a record', preparing:'Preparing the decks',
  analyzing:'Analyzing the records', planning:'Planning the set', mixing:'Blending the decks'
};
const operations = {
  search:'Searching the crate', start:'Preparing the set', mix:'Requesting the next blend',
  load:'Loading a record', queue:'Updating the queue', takeover:'Switching deck control',
  stop:'Stopping the set', control:'Sending deck control', decode:'Reading the audio'
};
const reactions = {
  play:'Starting playback', pause:'Playback paused', cue:'Cueing the next deck',
  mix:'Blending the decks', handoff:'Handoff complete', tempo:'Adjusting tempo', library:'Analyzing the record'
};
const item = (title,detail='',busy=false)=>({title,detail,busy});
const bpm = value => Number.isFinite(value) ? `${Number(value.toFixed(1))} BPM` : '';
const searching = scan => ['queued','searching','reading'].includes(scan?.status);

export function searchCounts(scan){
  if(!searching(scan))return '';
  return [Number.isFinite(scan.examined)?`${scan.examined.toLocaleString()} checked`:'',
    Number.isFinite(scan.added)?`${scan.added.toLocaleString()} added`:''].filter(Boolean).join(' · ');
}

export function liveScan(dig,now=Date.now()/1000){
  if(dig?.status!=='digging'||!Number.isFinite(dig.updated)||now-dig.updated>25)return '';
  const perTerm=Number.isFinite(dig.termExamined);
  const checked=perTerm?dig.termExamined:dig.examined;
  const added=perTerm?dig.termAdded:dig.added;
  const counts=Number.isFinite(checked)&&Number.isFinite(added)
    ? `${checked.toLocaleString()} checked · ${added.toLocaleString()} added` : '';
  const record=[dig.latest?.title,dig.latest?.artist].filter(Boolean).join(' · ');
  return [dig.term?`Digging for “${dig.term}”`:'Digging in the crate',counts,
    record?`Checking ${record}`:''].filter(Boolean).join(' · ');
}

export function resolveActivity({isNative,state,agent,nativeError,operation,frame,next,selection,gesture,recent,ramp,voiceWork,talkPhase}) {
  if(isNative&&nativeError)return item('Afterhours needs attention',nativeError);
  if(operation&&operations[operation.name])return item(operations[operation.name],operation.detail,true);
  if(state?.phase==='mixing'||frame.mixing){
    const target=state?.blendTitle||next?.title;
    return item('Mixing tracks',state?.blendFrom&&target?'':target||'',true);
  }

  if(isNative&&state){
    const search=state.search;
    if(searching(search)){
      const record=[search.latest?.title,search.latest?.artist].filter(Boolean).join(' · ');
      return item(search.status==='queued'?'Crate search queued':'Searching the crate',
        [search.term,record?`Checking ${record}`:''].filter(Boolean).join(' · ')||search.message,true);
    }
    if(search?.status==='error')return item('Crate search paused',search.message);
    if(state.tempo?.status==='ramping'){
      const target=bpm(state.tempo.targetBpm);
      return item('Adjusting tempo',target?`Moving toward ${target}`:'Afterhours is changing deck speed',true);
    }
    if(state.phase==='error')return item('Afterhours needs attention',state.message);
    if(state.startup?.status==='handoff-held')return item('Next handoff on hold',state.message);
    if(['queued','analyzing'].includes(state.analysis?.status))
      return item('Preparing the next track',state.analysis.message,true);
    if(enginePhases[state.phase]&&state.phase!=='mixing')return item(enginePhases[state.phase],state.message,true);
  }
  const nativeBlend=isNative&&state?.nextBlend?.nextId&&state.nextBlend.nextId===next?.id
    ? state.nextBlend : null;
  if(voiceWork==='evaluating'||agent?.evaluating){
    const step=agent?.rounds?.at(-1)?.steps?.at(-1);
    return item('Choosing tracks',step?.text||agent?.message||'',true);
  }
  if(voiceWork==='starting')return item('Starting the opening track','',true);
  if(talkPhase==='speaking')return item('Dot is speaking');
  if(talkPhase==='hearing')return item('Dot is listening');
  if(ramp)return item('Adjusting tempo',bpm(ramp.target),true);
  if(selection&&frame.scheduled)return item('Next record selected',selection.detail);
  if(nativeBlend&&frame.scheduled)return item(nativeBlend.label,nativeBlend.reason);
  if(frame.scheduled)return item('Next deck cued',next?.title||'Waiting for the mix point');
  if(recent&&reactions[gesture]){
    const detail=gesture==='cue' ? next?.title : gesture==='handoff' ? frame.trackTitle : '';
    return item(reactions[gesture],detail||'');
  }
  if(!frame.playing&&next)return item('Queue ready',next.title);
  return item('');
}
