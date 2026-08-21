import { CFG } from '../config/constants.js';
import { clamp, now } from '../util/math.js';
import { rnd, gauss } from '../util/random.js';

/* ================================================================
   FEED — SimulatedIndexSource behind the sacred IndexSource seam.
   Contract: start()/stop(), resetRound(), onTick(fn) → {t,v,ret}.
   Phase 2: WsIndexSource implements the same contract; nothing
   downstream changes.
================================================================ */
export class SimulatedIndexSource {
  constructor(){
    this.subs=[]; this.idx=CFG.IDX0;
    this.logSig=0; this.mu=0; this.ew=1; this.live=false;
    this.timer=setInterval(()=>this._tick(), CFG.TICK_MS);
  }
  onTick(fn){ this.subs.push(fn); }
  resetRound(){ this.idx=CFG.IDX0; this.mu=0; this.live=true;
    this._emit(0); }
  halt(){ this.live=false; }
  _tick(){ if(this.live) this._step(); }
  _step(){
    // volatility clustering (log-vol OU) + drift regimes + whale jumps
    this.logSig += 0.06*(0-this.logSig) + 0.30*gauss();
    const sig = Math.exp(clamp(this.logSig,-1.4,1.6));
    if (rnd()<0.02) this.mu = (rnd()-0.5)*1.8;
    this.mu *= 0.994;
    let z = gauss()*sig + this.mu*0.16;
    if (rnd()<0.006) z += (rnd()<0.5?-1:1)*(2+rnd()*3)*sig;   // whale print
    this.ew = Math.sqrt(0.94*this.ew*this.ew + 0.06*z*z) || 1;
    const ret = clamp(z/this.ew,-3.2,3.2)*CFG.TICK_VOL;       // vol-normalised
    this.idx *= (1+ret);
    this._emit(ret);
  }
  _emit(ret){
    const tk = { t: now(), v: this.idx, ret };
    for (const f of this.subs) f(tk);
  }
}

