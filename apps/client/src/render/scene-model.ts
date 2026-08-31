import { CFG } from '../config/constants.js';
import { clamp } from '../util/math.js';
import { colAt, zoneName } from './palette.js';

/* ================================================================
   SCENE MODEL — the state → scene projection (M1.8, SC-2/SC-3/SC-7).

   This module is the whole renderer boundary in one place. A renderer is
   handed a `SceneModel` and may read nothing else: not `S`, not the engine,
   not the interpolation buffer, not the DOM, not a clock. That restriction is
   what makes a second renderer a drop-in rather than a rewrite, and it is what
   makes "presentation cannot decide gameplay" checkable by a test instead of
   by review.

   Three rules hold this file honest:

     1. **It derives geometry, never outcomes.** `crushIndex` and
        `livePnlCents` arrive already computed by `@crush/engine` through the
        adapter's accessors and are copied through untouched. Recomputing
        either here would be a second implementation of the crush line, which
        CR-6 makes a release blocker.
     2. **It is pure.** No timers, no RNG, no DOM, no clock. `t` and `dt` are
        parameters because the caller owns the clock. Identical input gives a
        deeply equal model, which is what lets SC-4 assert that frame cadence
        cannot reach the money.
     3. **The mappings live here and only here.** Both renderers import
        `depthOfIndex`, `yOfDepth`, `timeToX` and `subScreenX`, so the sub and
        the two lines cannot drift between implementations (SC-7).

   The Canvas renderer keeps its own copy of these formulas for now because it
   is retained verbatim as the visual reference; `renderer-parity.test.js`
   pins the two together bit-for-bit until Canvas is retired.
================================================================ */

/** Where the scene is drawn, in CSS pixels. Layout is read by the seam, not here. */
export interface Viewport {
  readonly width: number;
  readonly height: number;
  /** Device pixel ratio the seam has already clamped to the quality tier. */
  readonly dpr: number;
}

/** Camera state, advanced by the caller and handed in as data. */
export interface Camera {
  /** Depth in metres at the vertical anchor of the scene. */
  readonly cam: number;
  /** Pixels per metre of depth. */
  readonly pxm: number;
}

/** One recorded point of the index path. Presentation only — never a tick source. */
export interface TrailPoint {
  readonly t: number;
  readonly v: number;
}

/**
 * The open position, as the projection receives it.
 *
 * `entryIndex` and `crushIndex` are authority facts supplied by the engine
 * adapter (`Engine.liqIdx`), and `livePnlCents` by `Engine.pnl`. The
 * projection converts them to screen coordinates and copies the money value
 * through; it never derives one from the other.
 */
export interface ScenePosition {
  readonly dir: number;
  readonly state: string;
  readonly entryIndex: number;
  readonly crushIndex: number;
  readonly stake: number;
  readonly livePnlCents: number;
  readonly oxygen: number;
}

/** Everything the projection needs. Every field is data the client already holds. */
export interface SceneInput {
  readonly t: number;
  readonly dt: number;
  readonly phase: string;
  readonly phaseT: number;
  /** The interpolated presentation value (UI-2) — never a settlement input. */
  readonly value: number;
  readonly position: ScenePosition | null;
  readonly lastTick: { readonly t: number; readonly v: number };
  readonly trail: readonly TrailPoint[];
  readonly viewport: Viewport;
  readonly camera: Camera;
}

/** A position as it appears on screen. */
export interface SceneModelPosition {
  readonly dir: number;
  readonly entryIndex: number;
  readonly crushIndex: number;
  readonly entryY: number;
  readonly crushY: number;
  readonly stake: number;
  readonly livePnlCents: number;
  readonly oxygen: number;
  readonly ascending: boolean;
}

/** The projected scene. Plain data: structured-cloneable, no live handles. */
export interface SceneModel {
  readonly t: number;
  readonly dt: number;
  readonly phase: string;
  readonly viewport: Viewport;
  readonly camera: Camera;
  readonly sub: { readonly x: number; readonly y: number; readonly tilt: number };
  readonly water: { readonly topColor: readonly number[]; readonly bottomColor: readonly number[] };
  readonly surfaceY: number;
  readonly wake: readonly { readonly x: number; readonly y: number }[];
  readonly position: SceneModelPosition | null;
  readonly readout: {
    readonly index: number;
    readonly depth: number;
    readonly zone: string;
    readonly breached: boolean;
  };
  readonly tension: number;
}

/** The default viewport, used before the first real measurement arrives. */
export const DEFAULT_VIEWPORT: Viewport = { width: 390, height: 700, dpr: 1 };

/** The highest device pixel ratio we ever ask a renderer to allocate. */
export const MAX_DPR = 2;

/**
 * Depth in metres for an index value (presentation only — no money path).
 *
 * `depth = BASE_DEPTH − ln(I/I0) · DEPTH_K`, clamped as a numeric safety net
 * rather than as a playable boundary. Identical to the Canvas renderer's
 * `depthOf`; `renderer-parity.test.js` asserts they never diverge.
 */
export function depthOfIndex(v: number): number {
  return clamp(
    CFG.BASE_DEPTH - Math.log(Math.max(v, 1e-9) / CFG.IDX0) * CFG.DEPTH_K,
    CFG.DEPTH_MIN,
    CFG.DEPTH_MAX,
  );
}

/** Screen y for a depth, given the camera and viewport. */
export function yOfDepth(depth: number, camera: Camera, viewport: Viewport): number {
  return viewport.height * 0.46 + (depth - camera.cam) * camera.pxm;
}

/** The sub's fixed horizontal anchor. */
export function subScreenX(viewport: Viewport): number {
  return viewport.width * 0.38;
}

/** Screen x for a recorded time, relative to the render time `rt`. */
export function timeToX(t: number, rt: number, viewport: Viewport): number {
  return subScreenX(viewport) - (rt - t) * (CFG.SCROLL / 1000);
}

/**
 * The depth colour ramp as a typed triple.
 *
 * `palette.js` is still unchecked prototype JavaScript, so `colAt` infers as
 * a loose union. Normalising here — rather than asserting the type away —
 * means a malformed ramp entry becomes black instead of `undefined` reaching a
 * renderer, and keeps the ramp itself the single shared implementation (SC-7).
 */
function rampColor(depth: number): readonly number[] {
  const c: unknown = colAt(depth);
  if (!Array.isArray(c)) return [0, 0, 0];
  return [Number(c[0]) || 0, Number(c[1]) || 0, Number(c[2]) || 0];
}

/** Replace a non-positive dimension with the last known good default (SC-6). */
function sanitiseViewport(viewport: Viewport): Viewport {
  const width = viewport.width > 0 ? viewport.width : DEFAULT_VIEWPORT.width;
  const height = viewport.height > 0 ? viewport.height : DEFAULT_VIEWPORT.height;
  const dpr = clamp(viewport.dpr > 0 ? viewport.dpr : 1, 1, MAX_DPR);
  return { width, height, dpr };
}

/**
 * Proximity of the index to the player's crush line, in [0,1].
 *
 * Purely a visual intensity: it drives the pressure vignette and hull creak.
 * It reads the engine's own line and never decides anything — a position is
 * crushed by `@crush/engine`, never by this number reaching 1.
 */
function tensionOf(value: number, position: ScenePosition | null): number {
  if (!position || position.state === 'done') return 0;
  const span = Math.max(Math.abs(position.entryIndex - position.crushIndex), 1e-9);
  return clamp(1 - Math.abs(value - position.crushIndex) / (span * 0.55), 0, 1);
}

/** Tilt from the recent slope of the recorded path. Cosmetic. */
function tiltOf(trail: readonly TrailPoint[], camera: Camera): number {
  if (trail.length <= 3) return 0;
  const a = trail[trail.length - 3];
  const b = trail[trail.length - 1];
  if (!a || !b) return 0;
  const slope = (depthOfIndex(b.v) - depthOfIndex(a.v)) / Math.max(b.t - a.t, 1);
  return clamp(slope * camera.pxm * 260, -0.4, 0.4);
}

/**
 * Project authoritative client state into a renderer-agnostic scene.
 *
 * Pure: same input, deeply equal output, no mutation of the input (SC-2).
 */
export function projectScene(input: SceneInput): SceneModel {
  const viewport = sanitiseViewport(input.viewport);
  const camera = input.camera;
  const rt = input.t - CFG.DELAY_MS;

  const depth = depthOfIndex(input.value);
  const subX = subScreenX(viewport);
  const subY = yOfDepth(depth, camera, viewport);
  const surfaceY = yOfDepth(0, camera, viewport);

  const dTop = camera.cam + (0 - viewport.height * 0.46) / camera.pxm;
  const dBot = camera.cam + (viewport.height - viewport.height * 0.46) / camera.pxm;

  const wake = input.trail.map(p => ({
    x: timeToX(p.t, rt, viewport),
    y: yOfDepth(depthOfIndex(p.v), camera, viewport),
  }));

  const live = input.position && input.position.state !== 'done' ? input.position : null;

  return {
    t: input.t,
    dt: input.dt,
    phase: input.phase,
    viewport,
    camera,
    sub: { x: subX, y: subY, tilt: tiltOf(input.trail, camera) },
    water: { topColor: rampColor(dTop), bottomColor: rampColor(dBot) },
    surfaceY,
    wake,
    position: live
      ? {
          dir: live.dir,
          entryIndex: live.entryIndex,
          crushIndex: live.crushIndex,
          entryY: yOfDepth(depthOfIndex(live.entryIndex), camera, viewport),
          crushY: yOfDepth(depthOfIndex(live.crushIndex), camera, viewport),
          stake: live.stake,
          livePnlCents: live.livePnlCents,
          oxygen: live.oxygen,
          ascending: live.state === 'ascending',
        }
      : null,
    readout: {
      index: input.value,
      depth,
      zone: depth <= 0 ? 'BREACH' : zoneName(depth),
      breached: depth <= 0,
    },
    tension: tensionOf(input.value, live),
  };
}
