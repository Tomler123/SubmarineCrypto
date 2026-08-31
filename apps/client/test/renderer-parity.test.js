import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIEWPORT,
  depthOfIndex,
  projectScene,
  subScreenX,
  yOfDepth,
} from '../src/render/scene-model.ts';
import { CFG } from '../src/config/constants.js';

/* ================================================================
   SC-7 — parity-critical mappings have exactly one implementation.

   Visual parity for particles and gradients is a human judgement, which is why
   the Canvas renderer is retained for diffing. What a test *can* pin down is
   the geometry a player reads a decision from: where the sub sits, where the
   entry line sits, where the crush line sits. Those come from `scene-model`,
   and this file asserts that the Canvas renderer's own formulas — transcribed
   here from `render/renderer.js` as the reference implementation — agree with
   it to the last representable bit.

   If someone later "optimises" one of the shared mappings, this fails.
================================================================ */

/* --- the Canvas 2D reference formulas, copied verbatim from renderer.js --- */
const canvasDepthOf = v => Math.min(Math.max(
  CFG.BASE_DEPTH - Math.log(Math.max(v, 1e-9) / CFG.IDX0) * CFG.DEPTH_K,
  CFG.DEPTH_MIN), CFG.DEPTH_MAX);
const canvasSubX = W => W * 0.38;
const canvasYOf = (d, cam, pxm, H) => H * 0.46 + (d - cam) * pxm;

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 700 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
];

const INDICES = [820, 940, 990, 1000, 1000.0001, 1075, 1240];

describe('SC-7 — depth mapping is identical in both renderers', () => {
  it('agrees with the Canvas formula on every sampled index', () => {
    for (const v of INDICES){
      expect(depthOfIndex(v)).toBe(canvasDepthOf(v));
    }
  });

  it('agrees at the clamp boundaries', () => {
    expect(depthOfIndex(0)).toBe(canvasDepthOf(0));
    expect(depthOfIndex(1e12)).toBe(canvasDepthOf(1e12));
  });
});

describe('SC-7 — screen placement is identical in both renderers', () => {
  it('places the sub at the same x on every viewport', () => {
    for (const vp of VIEWPORTS){
      expect(subScreenX({ ...DEFAULT_VIEWPORT, ...vp }))
        .toBe(canvasSubX(vp.width));
    }
  });

  it('places a depth at the same y on every viewport and camera', () => {
    for (const vp of VIEWPORTS){
      for (const cam of [1500, 2000, 2600]){
        for (const pxm of [0.12, 0.5, 1.9]){
          expect(yOfDepth(2000, { cam, pxm }, { ...DEFAULT_VIEWPORT, ...vp }))
            .toBe(canvasYOf(2000, cam, pxm, vp.height));
        }
      }
    }
  });
});

describe('SC-7 — the entry and crush lines land where Canvas put them', () => {
  const camera = { cam: CFG.BASE_DEPTH, pxm: 0.5 };

  function model(vp){
    return projectScene({
      t: 5000,
      dt: 1 / 60,
      phase: 'running',
      phaseT: 0,
      value: 1000,
      position: {
        dir: 1,
        state: 'open',
        entryIndex: 1000,
        crushIndex: 943.21,
        stake: 500,
        livePnlCents: 0,
        oxygen: 0.7,
      },
      lastTick: { t: 4900, v: 1000 },
      trail: [],
      viewport: { ...DEFAULT_VIEWPORT, ...vp },
      camera,
    });
  }

  it('matches the Canvas entry-line y on every viewport', () => {
    for (const vp of VIEWPORTS){
      const expected = canvasYOf(canvasDepthOf(1000), camera.cam, camera.pxm, vp.height);
      expect(model(vp).position.entryY).toBe(expected);
    }
  });

  it('matches the Canvas crush-line y on every viewport', () => {
    for (const vp of VIEWPORTS){
      const expected = canvasYOf(canvasDepthOf(943.21), camera.cam, camera.pxm, vp.height);
      expect(model(vp).position.crushY).toBe(expected);
    }
  });

  it('matches the Canvas sub y for the current index', () => {
    for (const vp of VIEWPORTS){
      const expected = canvasYOf(canvasDepthOf(1000), camera.cam, camera.pxm, vp.height);
      expect(model(vp).sub.y).toBe(expected);
    }
  });

  it('keeps the crush line below the entry line for a Surface position', () => {
    // A long crushes when the index falls, and falling index means greater
    // depth, which means a larger y. Getting this backwards would invert the
    // one geometric cue the player reads danger from.
    const m = model({ width: 390, height: 700 });
    expect(m.position.crushY).toBeGreaterThan(m.position.entryY);
  });
});

describe('SC-7 — the depth colour ramp is shared', () => {
  it('reports the same zone name the Canvas palette does', async () => {
    const { zoneName } = await import('../src/render/palette.js');
    const m = projectScene({
      t: 0,
      dt: 1 / 60,
      phase: 'running',
      phaseT: 0,
      value: 1000,
      position: null,
      lastTick: { t: 0, v: 1000 },
      trail: [],
      viewport: { ...DEFAULT_VIEWPORT, width: 390, height: 700 },
      camera: { cam: CFG.BASE_DEPTH, pxm: 0.5 },
    });
    expect(m.readout.zone).toBe(zoneName(m.readout.depth));
  });
});
