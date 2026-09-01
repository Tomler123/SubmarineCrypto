import { CFG } from '../config/constants.js';
import { S } from '../state/store.js';
import { buffer } from '../feed/index.js';
import { Engine } from '../core/engine.js';
import { createPixiRenderer } from './pixi-scene.ts';
import { createCanvasRenderer } from './canvas-port.js';
import { DEFAULT_VIEWPORT, projectScene } from './scene-model.ts';
import { trail } from './effects.js';

/* ================================================================
   RENDERER SEAM — the only place that knows which renderer is running.

   Same rule, and the same shape, as `feed/index.js`: nothing outside this
   directory may name a concrete implementation, so swapping one is a change
   to this file rather than a change across the client. SC-1 states it and
   `renderer-selection.test.js` enforces it by scanning the source tree.

   The Canvas 2D renderer stays the **default**. M1.8 ports the
   gameplay-critical layers to PixiJS, but the Canvas scene is retained as the
   visual reference until parity has been reviewed by eye — so the port is an
   explicit `?renderer=pixi` opt-in, exactly as replay is an explicit
   `?feed=replay` opt-in. An unrecognised value falls back to Canvas rather
   than failing: a typo in a query string must not blank the scene.

   This module is also where authoritative client state is *read* and turned
   into a `SceneModel`. That read happens here, once, and never inside a
   renderer — which is what keeps SC-2 true no matter how many renderers exist.
================================================================ */

/** Resolve the requested renderer name. Anything unrecognised means Canvas. */
export function selectRendererName(search = globalThis.location?.search ?? ''){
  return new URLSearchParams(search).get('renderer') === 'pixi' ? 'pixi' : 'canvas';
}

/** Build the selected renderer port. */
export function createRenderer(search = globalThis.location?.search ?? ''){
  return selectRendererName(search) === 'pixi'
    ? createPixiRenderer()
    : createCanvasRenderer();
}

/** The live port for this session. */
export const renderer = createRenderer();

/** Camera state, advanced by the seam and handed to the projection as data. */
const camera = { cam: CFG.BASE_DEPTH, pxm: 0.5 };

/** Latest measured viewport; updated by `resizeScene`, never read mid-frame. */
let viewport = { ...DEFAULT_VIEWPORT };

/** Last presentation value, held across phases where the buffer is idle. */
let lastValue = CFG.IDX0;

/**
 * Project the current client state into a renderer-agnostic scene.
 *
 * Every authority fact it needs — the crush line and the live P&L — comes
 * from `@crush/engine` through the adapter's accessors, never from a formula
 * here (SC-3, CR-6, UI-2).
 */
function currentSceneModel(t, dt){
  const rt = t - CFG.DELAY_MS;
  const active = S.phase === 'running' || S.phase === 'ending';
  let v = active ? buffer.valueAt(rt) : lastValue;
  if (v == null) v = CFG.IDX0;
  lastValue = v;

  const p = S.pos;
  const live = p && p.state !== 'done';

  return projectScene({
    t,
    dt,
    phase: S.phase,
    phaseT: S.phaseT,
    value: v,
    position: live
      ? {
          dir: p.dir,
          state: p.state,
          entryIndex: p.entry,
          crushIndex: Engine.liqIdx(p),
          stake: p.stake,
          livePnlCents: Engine.pnl(v),
          oxygen: Engine.oxygen(p),
        }
      : null,
    lastTick: S.lastTick,
    trail,
    viewport,
    camera,
  });
}

/**
 * Draw one frame through the live renderer port.
 *
 * Returns the presentation index value the HUD reads, preserving the shape the
 * Canvas `draw()` returned before M1.8 so the frame loop is unchanged in what
 * it consumes.
 */
export function renderFrame(t, dt){
  const model = currentSceneModel(t, dt);
  renderer.render(model);
  return {
    v: model.readout.index,
    tension: model.tension,
    depth: model.readout.depth,
    breached: model.readout.breached,
    zone: model.readout.zone,
  };
}

/** Measure the scene host and hand the dimensions to the port (SC-6). */
export function resizeScene(width, height, dpr){
  if (width > 0 && height > 0){
    viewport = { width, height, dpr: dpr ?? viewport.dpr };
  }
  renderer.resize({ ...viewport, dpr: dpr ?? viewport.dpr });
}

/** Start the live renderer against its host element. */
export function initScene(host, width, height, dpr){
  if (width > 0 && height > 0) viewport = { width, height, dpr: dpr ?? 1 };
  return renderer.init(host, viewport);
}
