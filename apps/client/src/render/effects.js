import { FX, trail } from './renderer.js';

/* ================================================================
   PRESENTATION EFFECTS — compatibility facade for the retained Canvas scene.

   `trail` and `FX` are still Canvas-backed while Canvas remains the visual
   reference. Keeping that detail inside `render/` means game-adjacent modules
   can request presentation effects without naming a concrete renderer (SC-1).
   This facade disappears with the Canvas reference renderer.
================================================================ */

export { FX, trail };
