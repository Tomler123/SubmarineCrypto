/**
 * A hand-written, dependency-free, deterministic generator for property tests.
 *
 * Deliberately not `fast-check`: RUN 3's brief forbids adding a dependency, and
 * a property suite that guards a money path is itself audit surface — a
 * certification reviewer can read this file end to end and reproduce any
 * reported case from its seed alone, with no third-party version to pin.
 *
 * `mulberry32` is used rather than the client's LCG (`util/random.js`): an LCG's
 * low bits are notoriously non-random, and `next() < p` style predicates read
 * exactly those bits. mulberry32 is a 32-bit-state counter mixed through
 * multiply-xorshift, passes gjrand, and is four lines. It is a *test* utility;
 * invariant 1 (no RNG touches money) is unaffected because nothing here is
 * imported by `src/`, which `purity.test.ts` continues to guard.
 *
 * Every generator is a pure function of the stream, so a seed reproduces a run
 * exactly. Report the seed with any failure.
 */

/** The seed every property suite runs under unless a case overrides it. */
export const PROPERTY_SEED = 0x5eed_1e55;

/** Case counts. Kept here so the whole suite's cost is visible in one place. */
export const CASES = {
  /** Per-property default (PL-4, LG-1, float stress). */
  standard: 4000,
  /** Multi-step walks — each case is ~40 engine calls, so fewer of them. */
  walk: 1200,
} as const;

/** A deterministic stream of uniforms in [0, 1). */
export interface Rng {
  /** The seed this stream started from — quote it in a failure report. */
  readonly seed: number;
  /** Next uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  /** Uniform float in [min, max). */
  float(min: number, max: number): number;
  /** True with probability `p`. */
  bool(p: number): boolean;
  /** Uniform element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
}

/**
 * mulberry32 — 32-bit state, uniform output, no dependencies.
 * Reference: Tommy Ettinger's public-domain generator.
 */
export function rng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    seed: seed >>> 0,
    next,
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },
    float(min, max) {
      return min + next() * (max - min);
    },
    bool(p) {
      return next() < p;
    },
    pick<T>(items: readonly T[]): T {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw new Error('pick from empty array');
      return item;
    },
  };
}

/**
 * A per-case sub-stream, so case `i` of a property is reproducible on its own.
 *
 * Derived by hashing `(seed, index)` rather than by drawing from the parent
 * stream, so adding a property to this file does not shift the cases every
 * other property sees — a suite whose case set silently changes when an
 * unrelated test is added cannot be used as a regression record.
 */
export function caseRng(seed: number, index: number): Rng {
  let h = (seed ^ Math.imul(index + 1, 0x9e37_79b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85eb_ca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2_ae35) >>> 0;
  return rng((h ^ (h >>> 16)) >>> 0);
}

/** Formats a case for a failure message — seed plus index reproduces it exactly. */
export function caseLabel(seed: number, index: number, detail: string): string {
  return `seed=0x${(seed >>> 0).toString(16)} case=${index} ${detail}`;
}
