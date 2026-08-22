import { S } from '../state/store.js';
import { clamp } from '../util/math.js';
import { rnd } from '../util/random.js';

/* ================================================================
   AUDIO — pressure-first synth. ASSUMPTION: no music; low drones,
   hull stress, sonar. Muted until first gesture (browser policy).
================================================================ */
export const Au = {
  ctx:null, master:null, droneG:null,
  init(){
    if (this.ctx) return;
    try{
      this.ctx = new (window.AudioContext||window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = S.soundOn?0.8:0;
      this.master.connect(this.ctx.destination);
      // abyssal drone: two detuned lows + filtered noise bed
      const g=this.ctx.createGain(); g.gain.value=0.0; g.connect(this.master);
      this.droneG=g;
      for (const f of [46,49.3]){
        const o=this.ctx.createOscillator(); o.type='sine'; o.frequency.value=f;
        o.connect(g); o.start();
      }
      const nb=this.ctx.createBuffer(1,this.ctx.sampleRate*2,this.ctx.sampleRate);
      const ch=nb.getChannelData(0);
      for(let i=0;i<ch.length;i++) ch[i]=(Math.random()*2-1)*0.4;
      const ns=this.ctx.createBufferSource(); ns.buffer=nb; ns.loop=true;
      const lp=this.ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value=180;
      ns.connect(lp); lp.connect(g); ns.start();
    }catch(e){}
  },
  setMuted(m){ if(this.master) this.master.gain.value = m?0:0.8; },
  env(freq,type,dur,peak,curve=3){
    if(!this.ctx||!S.soundOn) return;
    const t=this.ctx.currentTime;
    const o=this.ctx.createOscillator(), g=this.ctx.createGain();
    o.type=type; o.frequency.setValueAtTime(freq,t);
    g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(peak,t+0.012);
    g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t+dur+0.05);
    return o;
  },
  noiseBurst(dur,peak,fType,fFreq){
    if(!this.ctx||!S.soundOn) return;
    const t=this.ctx.currentTime;
    const len=Math.floor(this.ctx.sampleRate*dur);
    const b=this.ctx.createBuffer(1,len,this.ctx.sampleRate);
    const ch=b.getChannelData(0);
    for(let i=0;i<len;i++) ch[i]=(Math.random()*2-1)*(1-i/len);
    const s=this.ctx.createBufferSource(); s.buffer=b;
    const f=this.ctx.createBiquadFilter(); f.type=fType; f.frequency.value=fFreq;
    const g=this.ctx.createGain(); g.gain.value=peak;
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t);
  },
  ping(){ const o=this.env(920,'sine',0.7,0.10);
    if(o) o.frequency.exponentialRampToValueAtTime(640,this.ctx.currentTime+0.55); },
  creak(k){ this.noiseBurst(0.22+rnd()*0.2, 0.05+0.08*k, 'bandpass', 120+rnd()*320); },
  blow(){ this.noiseBurst(0.55,0.20,'highpass',700);
    this.env(70,'sine',0.4,0.12); },
  implode(){ this.env(52,'sine',0.6,0.5); this.noiseBurst(0.35,0.35,'lowpass',900); },
  horn(){ this.env(196,'triangle',0.8,0.12); },
  win(good){ if(good){ this.env(523,'sine',0.18,0.12);
      setTimeout(()=>this.env(784,'sine',0.3,0.12),120);
    } else this.env(330,'sine',0.3,0.08); },
  click(){ this.env(1400,'square',0.05,0.03); },
  droneUpdate(depth,tension){
    if(!this.droneG) return;
    const g = S.soundOn ? (0.015 + clamp(depth/3200,0,1)*0.06 + tension*0.05) : 0;
    this.droneG.gain.value = g;
  }
};
document.addEventListener('pointerdown', ()=>{ Au.init();
  if(Au.ctx && Au.ctx.state==='suspended') Au.ctx.resume(); }, {passive:true});
