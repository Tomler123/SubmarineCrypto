import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VIEWPORT,
  depthOfIndex,
  projectScene,
  subScreenX,
  timeToX,
  yOfDepth,
} from '../src/render/scene-model.ts';
import { CFG } from '../src/config/constants.js';

/* ================================================================
   SC-2 / SC-3 / SC-7 / SC-8 — the state → scene projection.

   These tests are about the *seam*, not about pixels. The projection is the
   one place a renderer is allowed to learn anything about the game, so it is
   the place where "presentation may not decide gameplay" is enforceable by
   assertion rather than by review.
================================================================ */

/** Minimal authoritative input; every field is data the client already holds. */
function input(overrides = {}){
  return {
    t: 10_000,
    dt: 1 / 60,
    phase: 'running',
    phaseT: 0,
    value: CFG.IDX0,
    position: null,
    lastTick: { t: 9_900, v: CFG.IDX0 },
    trail: [],
    viewport: { ...DEFAULT_VIEWPORT, width: 390, height: 700 },
    camera: { cam: CFG.BASE_DEPTH, pxm: 0.5 },
    ...overrides,
  };
}

/** An open position as the projection receives it — lines already resolved. */
function openPosition(overrides = {}){
  return {
    dir: 1,
    state: 'open',
    entryIndex: 1000,
    crushIndex: 940,
    stake: 500,
    livePnlCents: 120,
    oxygen: 0.8,
    ...overrides,
  };
}

describe('SC-2 — the projection is pure and deterministic', () => {
  it('returns a deeply equal model for identical input, called twice', () => {
    const a = projectScene(input());
    const b = projectScene(input());
    expect(a).toEqual(b);
  });

  it('does not mutate its input', () => {
    const arg = input({ trail: [{ t: 1, v: 1000 }] });
    const snapshot = structuredClone(arg);
    projectScene(arg);
    expect(arg).toEqual(snapshot);
  });

  it('produces a structured-cloneable model — no functions, no live handles', () => {
    const model = projectScene(input({ position: openPosition() }));
    expect(() => structuredClone(model)).not.toThrow();
  });

  it('is independent of call order across differing inputs', () => {
    const one = input({ value: 1010 });
    const two = input({ value: 990 });
    const forward = [projectScene(one), projectScene(two)];
    const backward = [projectScene(two), projectScene(one)].reverse();
    expect(forward).toEqual(backward);
  });
});

describe('SC-3 — the projection carries authority facts, it never derives them', () => {
  it('passes the engine-supplied crush line through unchanged', () => {
    const model = projectScene(input({ position: openPosition({ crushIndex: 937.4321 }) }));
    expect(model.position.crushIndex).toBe(937.4321);
  });

  it('passes the engine-supplied live P&L through unchanged', () => {
    const model = projectScene(input({ position: openPosition({ livePnlCents: -4321 }) }));
    expect(model.position.livePnlCents).toBe(-4321);
  });

  it('emits no multiplier, payout, settlement or wallet field', () => {
    const model = projectScene(input({ position: openPosition() }));
    const keys = Object.keys(model.position);
    for (const forbidden of ['multiplier', 'payout', 'balance', 'settlement', 'pnl']){
      expect(keys).not.toContain(forbidden);
    }
  });
});

describe('SC-8 / UI-4 — an open position always projects its lines', () => {
  it('emits entry line, crush line and the readout whenever a position is open', () => {
    const model = projectScene(input({ position: openPosition() }));
    expect(model.position.entryY).toBeTypeOf('number');
    expect(model.position.crushY).toBeTypeOf('number');
    expect(model.readout.depth).toBeTypeOf('number');
  });

  it('emits them at every supported viewport width', () => {
    for (const width of [320, 390, 430, 768, 1280]){
      const model = projectScene(input({
        position: openPosition(),
        viewport: { ...DEFAULT_VIEWPORT, width, height: 700 },
      }));
      expect(model.position.entryY).toBeTypeOf('number');
      expect(model.position.crushY).toBeTypeOf('number');
    }
  });

  it('omits the position block when nothing is open', () => {
    expect(projectScene(input()).position).toBeNull();
  });

  it('omits the position block once the position is done', () => {
    const model = projectScene(input({ position: openPosition({ state: 'done' }) }));
    expect(model.position).toBeNull();
  });
});

describe('SC-7 — the shared mappings are the single implementation', () => {
  it('maps the index logarithmically, matching the Canvas formula', () => {
    const expected = CFG.BASE_DEPTH - Math.log(1100 / CFG.IDX0) * CFG.DEPTH_K;
    expect(depthOfIndex(1100)).toBeCloseTo(expected, 10);
  });

  it('puts I0 at the base depth exactly', () => {
    expect(depthOfIndex(CFG.IDX0)).toBe(CFG.BASE_DEPTH);
  });

  it('clamps a degenerate index rather than returning NaN or Infinity', () => {
    expect(Number.isFinite(depthOfIndex(0))).toBe(true);
    expect(depthOfIndex(0)).toBe(CFG.DEPTH_MAX);
  });

  it('maps depth to y around the camera, matching the Canvas formula', () => {
    const vp = { ...DEFAULT_VIEWPORT, width: 390, height: 700 };
    const cam = { cam: 2000, pxm: 0.5 };
    expect(yOfDepth(2000, cam, vp)).toBeCloseTo(700 * 0.46, 10);
    expect(yOfDepth(2100, cam, vp)).toBeCloseTo(700 * 0.46 + 100 * 0.5, 10);
  });

  it('maps tick time to x by the scroll rate, matching the Canvas formula', () => {
    const vp = { ...DEFAULT_VIEWPORT, width: 390, height: 700 };
    const x = timeToX(9_000, 10_000, vp);
    expect(x).toBeCloseTo(subScreenX(vp) - 1000 * (CFG.SCROLL / 1000), 10);
  });

  it('places the sub at the same fraction of width the Canvas renderer used', () => {
    expect(subScreenX({ ...DEFAULT_VIEWPORT, width: 390 })).toBeCloseTo(390 * 0.38, 10);
  });
});

describe('SC-6 — the viewport is data, never a layout read', () => {
  it('ignores a zero or negative dimension and keeps the last good one', () => {
    const model = projectScene(input({
      viewport: { ...DEFAULT_VIEWPORT, width: 0, height: -5 },
    }));
    expect(model.viewport.width).toBeGreaterThan(0);
    expect(model.viewport.height).toBeGreaterThan(0);
  });

  it('recomputes line positions when only the viewport changes', () => {
    const tall = projectScene(input({
      position: openPosition(),
      viewport: { ...DEFAULT_VIEWPORT, width: 390, height: 900 },
    }));
    const short = projectScene(input({
      position: openPosition(),
      viewport: { ...DEFAULT_VIEWPORT, width: 390, height: 500 },
    }));
    expect(tall.position.entryY).not.toBe(short.position.entryY);
  });
});
