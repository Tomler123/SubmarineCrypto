import { CFG } from '../config/constants.js';
import { S } from '../state/store.js';
import { now } from '../util/math.js';
import { fmt$ } from '../util/format.js';
import { el, overlayEl } from '../ui/dom-refs.js';
import { overlayHTML } from '../ui/overlay.js';
import { syncConsole } from '../ui/console.js';
import { Engine } from '../core/engine.js';
import { roundUpdate } from '../core/round.js';
import { getLastSubDepth } from '../render/renderer.js';
import { renderFrame } from '../render/index.js';
import { zoneName } from '../render/palette.js';

/* ================================================================
   MAIN LOOP

   M1.8: the frame no longer calls a concrete renderer. It asks the render
   seam to draw, and the seam decides which RendererPort is live (SC-1). The
   HUD readout below still reads `getLastSubDepth()` from the Canvas renderer
   because that renderer remains the default and owns the value; when Canvas
   is retired after visual-parity review, the readout reads the projected
   `SceneModel` instead and this import goes with it.
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
  // Quality-tier degradation moved into the renderer port at M1.8: it is a
  // renderer-private concern, and a second caller here would double-count
  // every frame time the Canvas tier logic averages.
  requestAnimationFrame(frame);
}

