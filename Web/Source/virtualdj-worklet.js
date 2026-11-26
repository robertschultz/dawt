class VirtualDJOutput extends AudioWorkletProcessor {
  constructor() {
    super();
    this.left=new Float32Array(32768);
    this.right=new Float32Array(this.left.length);
    this.read=0;
    this.write=0;
    this.rate=sampleRate;
    this.active=false;
    this.port.onmessage=({data})=>{
      const {pcm,rate,generation}=data;
      if(generation!==this.generation||rate!==this.rate){
        this.generation=generation;
        this.rate=rate;
        this.read=this.write=0;
        this.active=false;
      }
      for(let i=0;i<pcm.length;i+=2){
        const slot=this.write++%this.left.length;
        this.left[slot]=pcm[i]/32768;
        this.right[slot]=pcm[i+1]/32768;
      }
      if(this.write-this.read>this.rate*.24)this.read=this.write-Math.round(this.rate*.085);
    };
  }
  process(inputs,[output]) {
    const [left,right]=output;
    if(!left||!right)return true;
    if(!this.active){
      if(this.write-this.read<this.rate*.065)return true;
      this.active=true;
    }
    const step=this.rate/sampleRate;
    for(let i=0;i<left.length;i++){
      const index=Math.floor(this.read);
      if(index+1>=this.write){this.active=false;break;}
      const amount=this.read-index;
      const here=index%this.left.length, next=(index+1)%this.left.length;
      left[i]=this.left[here]+amount*(this.left[next]-this.left[here]);
      right[i]=this.right[here]+amount*(this.right[next]-this.right[here]);
      this.read+=step;
    }
    return true;
  }
}
registerProcessor('virtualdj-output',VirtualDJOutput);
