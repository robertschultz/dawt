function coverScale(image) {
  const size=80;
  const canvas=document.createElement('canvas');
  canvas.width=canvas.height=size;
  const context=canvas.getContext('2d',{willReadFrequently:true});
  if(!context)return 1;
  context.drawImage(image,0,0,size,size);
  let pixels;
  try{pixels=context.getImageData(0,0,size,size).data;}catch{return 1;}

  // Some catalog artwork includes a flat matte inside the image itself.
  // Trim narrow, matching bands without zooming ordinary full-bleed covers.
  const maxBand=10;
  function edgeBand(vertical,reverse,light) {
    for(let band=0;band<maxBand;band++){
      const edge=reverse?size-1-band:band;
      let matching=0;
      for(let span=8;span<size-8;span++){
        const offset=(vertical?span*size+edge:edge*size+span)*4;
        const r=pixels[offset],g=pixels[offset+1],b=pixels[offset+2];
        if(light?Math.min(r,g,b)>=239:Math.max(r,g,b)<=20)matching++;
      }
      if(matching<(size-16)*.95)return band;
    }
    return 0;
  }
  let trim=0;
  for(const light of [false,true]){
    for(const vertical of [false,true]){
      const near=edgeBand(vertical,false,light),far=edgeBand(vertical,true,light);
      if(near>=2&&far>=2&&Math.abs(near-far)<=2)trim=Math.max(trim,near,far);
    }
  }
  return trim?size/(size-2*(trim+1)):1;
}

export function createNowRecord(stage) {
  const carrier=document.createElement('div');
  carrier.className='record-carrier';
  const face=document.createElement('div');
  face.className='vinyl-face';
  const circle=document.createElement('div');
  circle.className='vinyl-label';
  const cover=document.createElement('img');
  cover.alt='';
  cover.hidden=true;
  cover.referrerPolicy='no-referrer';
  cover.addEventListener('load',()=>{
    if(!cover.naturalWidth)return;
    cover.style.setProperty('--cover-scale',String(coverScale(cover)));
    cover.hidden=false;
  });
  cover.addEventListener('error',()=>{
    cover.hidden=true;
    if(displayedUrl&&cover.hasAttribute('crossorigin')){
      cover.removeAttribute('crossorigin');
      cover.src=displayedUrl;
    }
  });
  circle.append(cover);
  face.append(circle);
  carrier.append(face);
  stage.append(carrier);

  let displayedUrl='';
  let preloadedUrl='';
  let preload;
  function warm(url) {
    if(!url||url===displayedUrl||url===preloadedUrl)return;
    preloadedUrl=url;
    preload=new Image();
    preload.referrerPolicy='no-referrer';
    preload.crossOrigin='anonymous';
    preload.src=url;
  }

  function present(key,url,playing) {
    stage.hidden=!key;
    carrier.classList.toggle('spinning',Boolean(key&&playing));
    if(url===displayedUrl)return;
    displayedUrl=url;
    cover.hidden=true;
    if(url){
      cover.crossOrigin='anonymous';
      cover.src=url;
    }
    else cover.removeAttribute('src');
  }
  return {present,warm};
}
