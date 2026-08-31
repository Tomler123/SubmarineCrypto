import { draw, qualityCheck, resize } from './renderer.js';

/* ================================================================
   CANVAS PORT — the Phase 1 Canvas 2D renderer as a RendererPort (SC-1).

   This is an *adapter*, not a rewrite. `renderer.js` is untouched: it remains
   the verbatim visual reference the PixiJS port is diffed against, and it
   keeps its own `window` resize listener, its own quality tiers and its own
   direct reads of `S` / `Engine` / `buffer`. Wrapping it here is what lets the
   seam treat both renderers uniformly while the Canvas scene stays the
   default and stays byte-for-byte the thing it was before M1.8.

   Because the Canvas renderer still pulls its own state, `render(model)` uses
   the model only for the frame clock — the two renderers are therefore not yet
   symmetric in how they *source* state, and that asymmetry is deliberate and
   temporary. It disappears when Canvas is retired after visual parity review;
   until then, `renderer-parity.test.js` pins the geometry the two agree on.
================================================================ */

/** Wrap the retained Canvas 2D renderer as a conforming port. */
export function createCanvasRenderer(){
  let live = false;

  return {
    name: 'canvas',

    async init(){
      // `renderer.js` resolves its canvas at module load and registers its own
      // resize listener there, so there is nothing to acquire here.
      live = true;
      resize();
    },

    resize(){
      if (!live) return;
      // The Canvas renderer measures its own wrapper element, which is exactly
      // what it did before M1.8. It ignores the seam's measurements rather
      // than taking two sources of truth for one number.
      resize();
    },

    render(model){
      if (!live) return;
      draw(model.t, model.dt);
      qualityCheck(model.dt * 1000);
    },

    destroy(){
      live = false;
    },
  };
}
