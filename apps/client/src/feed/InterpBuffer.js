import { clamp } from '../util/math.js';

/* InterpBuffer — ticks in, smooth 60fps samples out, DELAY_MS behind. */
export class InterpBuffer {
  constructor(){ this.a=[]; }
  reset(){ this.a.length=0; }
  push(tk){ this.a.push(tk); if(this.a.length>420) this.a.splice(0,120); }
  valueAt(rt){                       // rt already includes the delay
    const a=this.a; if(!a.length) return null;
    if (rt<=a[0].t) return a[0].v;
    for (let i=a.length-1;i>=0;i--){
      if (a[i].t<=rt){
        const p=a[i], q=a[i+1];
        if(!q) return p.v;
        let f=(rt-p.t)/(q.t-p.t); f=clamp(f,0,1);
        const s=f*f*(3-2*f);       // smoothstep — no robotic corners
        return p.v+(q.v-p.v)*s;
      }
    }
    return a[0].v;
  }
}
