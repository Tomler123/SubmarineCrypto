import { CFG } from '../config/constants.js';
import { S } from '../state/store.js';
import { now } from '../util/math.js';
import { fmt$ } from '../util/format.js';
import { el, overlayEl } from '../ui/dom-refs.js';
import { overlayHTML } from '../ui/overlay.js';
import { syncConsole } from '../ui/console.js';
import { Engine } from '../core/engine.js';
import { roundUpdate } from '../core/round.js';
import { draw, getLastSubDepth, qualityCheck } from '../render/renderer.js';
import { zoneName } from '../render/palette.js';

/* ================================================================
   MAIN LOOP
================================================================ */
let lastT=now();
export function frame(){
  const t=now();
  let dt=(t-lastT)/1000; lastT=t;
  dt=Math.min(dt,0.05);
  roundUpdate(t);
  const out=draw(t,dt);
  const v=out.v;

  el.idxVal.textContent=v.toFixed(1);
  el.idxVal.style.color = S.pos&&S.pos.state!=='done'
    ? (Engine.pnl(v)>=0?'#4CF2C0':'#FF4B33') : '#EAF4F1';
  const subD=getLastSubDepth();
  el.idxSub.textContent = subD<=0
    ? 'SURFACED \u00B7 IDX'
    : 'DEPTH '+Math.round(subD)+'M \u00B7 IDX';
  el.zone.textContent = subD<=0 ? 'BREACH' : zoneName(subD);
  el.bal.textContent=fmt$(S.balance);

  if (S.phase==='running') el.rTimer.textContent=Math.max(0,(S.roundEnd-t)/1000).toFixed(0)+'s';
  else if (S.phase==='waiting') el.rTimer.textContent='DOCKED';
  else if (S.phase==='launching') el.rTimer.textContent='LAUNCH';
  else el.rTimer.textContent='SETTLING';

  if (S.phase==='waiting'){
    const left=Math.max(0,(CFG.WAIT_MS-(t-S.phaseT))/1000);
    let n=overlayEl.querySelector('.bigCount .num');
    if(!n){
      overlayHTML('<div class="bigCount">NEXT DIVE<span class="num"></span></div>');
      n=overlayEl.querySelector('.bigCount .num');
    }
    n.textContent=left.toFixed(1);
  }
  syncConsole(v);
  qualityCheck(dt*1000);
  requestAnimationFrame(frame);
}

