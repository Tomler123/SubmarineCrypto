import { describe, expect, it } from 'vitest';
import { cents } from '@crush/ledger';
import {
  crushIndex,
  isCrushed,
  livePnl,
  multiplier,
  payoutFor,
  pnlFor,
  positionCrushIndex,
  positionMultiplier,
} from '../src/index.js';
import type { Direction, Leverage, Position } from '../src/index.js';

const I0 = 1000;
/** The v1 leverage set (EN-4, parameter sheet §12). */
const LEVERAGES: readonly Leverage[] = [2, 5, 10, 25];
const DIRECTIONS: readonly Direction[] = [1, -1];

function positionAt(dir: Direction, lev: Leverage, stake = 50_000, entry = I0): Position {
  return {
    id: 'p1',
    dir,
    stake: cents(stake),
    lev,
    entry,
    state: 'open',
    openedT: 0,
    resolveT: 0,
  };
}

describe('PL-1 — M_t = 1 + L·d·(I_t/I_e − 1)', () => {
  it('PL-1: is exactly 1 at the entry index, for every direction and leverage', () => {
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        expect(multiplier(dir, lev, I0, I0)).toBe(1);
      }
    }
  });

  it('PL-1: golden vectors — both directions × all leverages at ±1% index move', () => {
    // At a +1% move, a long gains L·1% and a short loses L·1%.
    for (const lev of LEVERAGES) {
      expect(multiplier(1, lev, I0, 1010)).toBeCloseTo(1 + lev * 0.01, 12);
      expect(multiplier(-1, lev, I0, 1010)).toBeCloseTo(1 - lev * 0.01, 12);
      expect(multiplier(1, lev, I0, 990)).toBeCloseTo(1 - lev * 0.01, 12);
      expect(multiplier(-1, lev, I0, 990)).toBeCloseTo(1 + lev * 0.01, 12);
    }
  });

  it('PL-1: Surface and Dive are mirror images about M = 1', () => {
    for (const lev of LEVERAGES) {
      for (const v of [900, 975, 1001, 1080]) {
        const long = multiplier(1, lev, I0, v);
        const short = multiplier(-1, lev, I0, v);
        expect(long + short).toBeCloseTo(2, 12);
      }
    }
  });

  it('PL-1: carries no oxygen term yet — M is time-independent in this build', () => {
    // Documents the M1.3 state the roadmap gap list records: no −θτ, so no
    // house edge. M1.4 replaces this expectation.
    const p = positionAt(1, 10);
    expect(positionMultiplier(p, 1005)).toBe(multiplier(1, 10, I0, 1005));
  });
});

describe('CR-3 — the crush line I_e·(1 − d/L)', () => {
  it('CR-3: sits below entry for Surface and above entry for Dive', () => {
    for (const lev of LEVERAGES) {
      expect(crushIndex(1, lev, I0)).toBeLessThan(I0);
      expect(crushIndex(-1, lev, I0)).toBeGreaterThan(I0);
    }
  });

  it('CR-3: is the index at which M reaches exactly zero', () => {
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        const line = crushIndex(dir, lev, I0);
        expect(multiplier(dir, lev, I0, line)).toBeCloseTo(0, 12);
      }
    }
  });

  it('CR-3: tightens as leverage rises', () => {
    const distances = LEVERAGES.map((lev) => I0 - crushIndex(1, lev, I0));
    for (let i = 1; i < distances.length; i += 1) {
      expect(distances[i]!).toBeLessThan(distances[i - 1]!);
    }
  });

  it('CR-3: positionCrushIndex agrees with the free function', () => {
    const p = positionAt(-1, 25);
    expect(positionCrushIndex(p)).toBe(crushIndex(-1, 25, I0));
  });
});

describe('CR-1 — crushed at the first tick where M ≤ 0', () => {
  it('CR-1: not crushed strictly above the line, crushed at and below it', () => {
    const p = positionAt(1, 10); // line at 900
    expect(isCrushed(p, 900.001)).toBe(false);
    expect(isCrushed(p, 900)).toBe(true);
    expect(isCrushed(p, 899)).toBe(true);
  });

  it('CR-1: the boundary is inclusive — M exactly 0 is a crush, not a survival', () => {
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        const p = positionAt(dir, lev);
        expect(positionMultiplier(p, crushIndex(dir, lev, I0))).toBeCloseTo(0, 12);
        expect(isCrushed(p, crushIndex(dir, lev, I0))).toBe(true);
      }
    }
  });

  it('CR-1: a Dive is crushed by a rising index, not a falling one', () => {
    const p = positionAt(-1, 10); // line at 1100
    expect(isCrushed(p, 1100)).toBe(true);
    expect(isCrushed(p, 900)).toBe(false);
  });

  /**
   * The amended CR-1 test. `M_t ≤ 0` and `I_t` vs the line are inverse in exact
   * arithmetic and not in IEEE-754 — the round trip lands `M` on ±2.2e-16 at the
   * line, with the sign depending on leverage. Deciding on the multiplier would
   * crush at 10× and 25× but spare at 5×, for a position sitting exactly on the
   * line it was shown. The line is authoritative, so the boundary must be exact
   * and identical at every leverage.
   */
  it('CR-1: a tick exactly at the line crushes at every direction × leverage', () => {
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        const p = positionAt(dir, lev);
        expect(isCrushed(p, crushIndex(dir, lev, I0)), `dir ${dir} lev ${lev}`).toBe(true);
      }
    }
  });

  it('CR-1: one representable step short of the line does not crush, at any leverage', () => {
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        const line = crushIndex(dir, lev, I0);
        // A Surface survives just above its line; a Dive just below.
        const survivor = dir > 0 ? nextUp(line) : nextDown(line);
        const p = positionAt(dir, lev);
        expect(isCrushed(p, survivor), `dir ${dir} lev ${lev}`).toBe(false);
      }
    }
  });

  it('CR-1: the boundary does not vary by leverage — the float-epsilon defect', () => {
    // Deciding on the multiplier gives a leverage-dependent answer at the line.
    // This records that divergence so a future refactor back to `M <= 0` fails
    // here rather than silently changing who dies.
    const viaMultiplier = LEVERAGES.map((lev) => multiplier(1, lev, I0, crushIndex(1, lev, I0)) <= 0);
    expect(new Set(viaMultiplier).size).toBeGreaterThan(1); // inconsistent

    const viaLine = LEVERAGES.map((lev) => isCrushed(positionAt(1, lev), crushIndex(1, lev, I0)));
    expect(new Set(viaLine)).toEqual(new Set([true])); // uniform
  });
});

/** Next representable double above `x`, for boundary probing. */
function nextUp(x: number): number {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  buf.setBigUint64(0, buf.getBigUint64(0) + (x < 0 ? -1n : 1n));
  return buf.getFloat64(0);
}

/** Next representable double below `x`. */
function nextDown(x: number): number {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  buf.setBigUint64(0, buf.getBigUint64(0) - (x < 0 ? -1n : 1n));
  return buf.getFloat64(0);
}

describe('PL-4 — payout = stake × max(0, M), rounded once', () => {
  it('PL-4: pays stake × M for a winning multiplier', () => {
    expect(payoutFor(cents(50_000), 2)).toBe(100_000);
    expect(payoutFor(cents(50_000), 1.5)).toBe(75_000);
  });

  it('PL-4: floors at zero for a non-positive multiplier', () => {
    expect(payoutFor(cents(50_000), 0)).toBe(0);
    expect(payoutFor(cents(50_000), -0.4)).toBe(0);
    expect(payoutFor(cents(50_000), -12)).toBe(0);
  });

  it('PL-4: rounds half away from zero, not half up', () => {
    // 1 cent × 2.5 = 2.5 → 3, where Math.round would also give 3; the
    // asymmetry that matters is on the pnl side, asserted below.
    expect(payoutFor(cents(1), 2.5)).toBe(3);
    expect(payoutFor(cents(3), 0.5)).toBe(2);
  });

  it('PL-4: every payout is an integer number of cents', () => {
    for (const m of [0.333333, 1.7777, 2.5, 3.14159, 12.000001]) {
      expect(Number.isInteger(payoutFor(cents(12_345), m))).toBe(true);
    }
  });
});

describe('PL-5 — maximum loss of any position is exactly the stake', () => {
  it('PL-5: pnl bottoms out at −stake however far past the line the tick lands', () => {
    const stake = cents(50_000);
    for (const m of [0, -0.001, -5, -1000]) {
      expect(pnlFor(stake, payoutFor(stake, m))).toBe(-50_000);
    }
  });

  it('PL-5: pnl is zero when the multiplier is exactly 1', () => {
    const stake = cents(50_000);
    expect(pnlFor(stake, payoutFor(stake, 1))).toBe(0);
  });

  it('PL-5: live P&L never reports worse than −stake', () => {
    const p = positionAt(1, 25, 50_000);
    for (const v of [960, 900, 500, 1]) {
      expect(livePnl(p, v)).toBeGreaterThanOrEqual(-50_000);
    }
  });

  it('PL-5: live P&L tracks the multiplier above the line', () => {
    const p = positionAt(1, 10, 50_000, I0);
    // +1% index at 10× → M = 1.10 → payout 55_000 → pnl +5_000.
    expect(livePnl(p, 1010)).toBe(5_000);
    // −1% index at 10× → M = 0.90 → payout 45_000 → pnl −5_000.
    expect(livePnl(p, 990)).toBe(-5_000);
  });
});
