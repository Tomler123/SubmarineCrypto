import { CFG } from '../config/constants.js';
import { S } from '../state/store.js';
import { now } from '../util/math.js';
import { fmt$ } from '../util/format.js';
import { el, overlayEl } from '../ui/dom-refs.js';
import { overlayHTML } from '../ui/overlay.js';
import { syncConsole } from '../ui/console.js';
import { Engine } from '../core/engine.js';
import { roundUpdate } from '../core/round.js';
import { renderFrame } from '../render/index.js';

/* ================================================================
   MAIN LOOP

   M1.8: the frame no longer calls a concrete renderer. It asks the render
   seam to draw, and the seam decides which RendererPort is live (SC-1). The
   The HUD reads the same projected SceneModel readout returned by the seam,
   so it does not know which implementation produced the frame.
================================================================ */
let lastT=now();
export function frame(){
  const t=now();
  let dt=(t-lastT)/1000; lastT=t;
  dt=Math.min(dt,0.05);
  roundUpdate(t);
  const out=renderFrame(t,dt);
  const v=out.v;

  el.idxVal.textContent=v.toFixed(1);
  el.idxVal.style.color = S.pos&&S.pos.state!=='done'
    ? (Engine.pnl(v)>=0?'#4CF2C0':'#FF4B33') : '#EAF4F1';
  const subD=out.depth;
  el.idxSub.textContent = out.breached
    ? 'SURFACED \u00B7 IDX'
    : 'DEPTH '+Math.round(subD)+'M \u00B7 IDX';
  el.zone.textContent = out.zone;
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
  // Quality-tier degradation moved into the renderer port at M1.8: it is a
  // renderer-private concern, and a second caller here would double-count
  // every frame time the Canvas tier logic averages.
  requestAnimationFrame(frame);
}

