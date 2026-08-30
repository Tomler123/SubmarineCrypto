import { describe, expect, it, beforeEach } from 'vitest';
import { entryOpen, entrySecondsLeft } from '../src/core/entry-window.js';
import { S } from '../src/state/store.js';
import { CFG } from '../src/config/constants.js';

/* ================================================================
   EN-1 — the T−5 s entry cutoff, as a pure read of the store.

   entry-window.js imports only CFG, S and `now`, so it needs no DOM and no
   mocks. Both functions take an injectable `t`, which is what lets the cutoff
   be tested to the millisecond instead of raced against a real clock.
================================================================ */

/** Round end far enough from 0 that T−5 s is unambiguous. */
const ROUND_END = 1_000_000;
/** The exact instant the hatch seals. */
const CUTOFF = ROUND_END - CFG.ENTRY_CUTOFF_MS;

beforeEach(() => {
  S.phase = 'running';
  S.roundEnd = ROUND_END;
});

describe('EN-1 entryOpen()', () => {
  it('is open at T−5.001 s and shut at T−4.999 s', () => {
    expect(entryOpen(CUTOFF - 1)).toBe(true);
    expect(entryOpen(CUTOFF + 1)).toBe(false);
  });

  it('is shut exactly at the cutoff instant — the boundary is exclusive', () => {
    // `t < roundEnd - CUTOFF`: at equality the window is already closed, which
    // is the safe side of the boundary. A request landing on the tick the
    // hatch seals is late.
    expect(entryOpen(CUTOFF)).toBe(false);
  });

  it('is open at the very start of running and stays open until the cutoff', () => {
    expect(entryOpen(ROUND_END - CFG.ROUND_MS)).toBe(true);
    expect(entryOpen(CUTOFF - 1)).toBe(true);
  });

  it('is shut in every phase except running', () => {
    // Mid-window instant: only the phase can be responsible for the false.
    const t = CUTOFF - 10_000;
    for (const phase of ['waiting', 'launching', 'ending', 'settling']){
      S.phase = phase;
      expect(entryOpen(t), `phase ${phase}`).toBe(false);
    }
    S.phase = 'running';
    expect(entryOpen(t)).toBe(true);
  });

  it('is shut after the round has ended, not merely at the cutoff', () => {
    expect(entryOpen(ROUND_END + 1000)).toBe(false);
  });
});

describe('EN-1 entrySecondsLeft()', () => {
  it('reaches exactly 0 at the cutoff and never goes negative', () => {
    expect(entrySecondsLeft(CUTOFF)).toBe(0);
    expect(entrySecondsLeft(CUTOFF + 1)).toBe(0);
    expect(entrySecondsLeft(CUTOFF + 60_000)).toBe(0);
    // Not -0 either: a formatted "-0.0s" on the console would be a visible bug.
    expect(Object.is(entrySecondsLeft(CUTOFF + 1), 0)).toBe(true);
  });

  it('counts down in real seconds toward the cutoff', () => {
    expect(entrySecondsLeft(CUTOFF - 5000)).toBe(5);
    expect(entrySecondsLeft(CUTOFF - 1000)).toBe(1);
    expect(entrySecondsLeft(CUTOFF - 1)).toBeCloseTo(0.001, 6);
  });

  it('is 0 outside running, so the console never counts down a shut hatch', () => {
    const t = CUTOFF - 10_000;
    for (const phase of ['waiting', 'launching', 'ending', 'settling']){
      S.phase = phase;
      expect(entrySecondsLeft(t), `phase ${phase}`).toBe(0);
    }
  });

  it('agrees with entryOpen(): positive seconds left iff the window is open', () => {
    for (const t of [CUTOFF - 5000, CUTOFF - 1, CUTOFF, CUTOFF + 1, ROUND_END]){
      expect(entrySecondsLeft(t) > 0, `t=${t}`).toBe(entryOpen(t));
    }
  });
});
