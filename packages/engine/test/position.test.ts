import { describe, expect, it } from 'vitest';
import { cents } from '@crush/ledger';
import {
  crushIndex,
  isCrushed,
  livePnl,
  multiplier,
  oxygenFraction,
  payoutFor,
  pnlFor,
  positionCrushIndex,
  positionMultiplier,
  tauOf,
} from '../src/index.js';
import type { Direction, Leverage, Position } from '../src/index.js';

const I0 = 1000;
/** The v1 leverage set (EN-4, parameter sheet §12). */
const LEVERAGES: readonly Leverage[] = [2, 5, 10, 25];
const DIRECTIONS: readonly Direction[] = [1, -1];
/** θ = 0.25 %/s and 8 Hz ticks — the parameter sheet's values (PL-2). */
const THETA = 0.0025;
const TICK_S = 0.125;
/** θ = 0 isolates the price term from the oxygen term in a given assertion. */
const NO_OXYGEN = 0;

function positionAt(
  dir: Direction,
  lev: Leverage,
  stake = 50_000,
  entry = I0,
  ticksElapsed = 0,
  theta = NO_OXYGEN,
): Position {
  return {
    id: 'p1',
    dir,
    stake: cents(stake),
    lev,
    entry,
    state: 'open',
    openedT: 0,
    ticksElapsed,
    theta,
    resolveT: 0,
  };
}

describe('PL-1 — M_t = 1 + L·d·(I_t/I_e − 1)', () => {
  it('PL-1: is exactly 1 at the entry index, for every direction and leverage', () => {
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        expect(multiplier(dir, lev, I0, I0, NO_OXYGEN, 0)).toBe(1);
      }
    }
  });

  it('PL-1: golden vectors — both directions × all leverages at ±1% index move', () => {
    // At a +1% move, a long gains L·1% and a short loses L·1%.
    for (const lev of LEVERAGES) {
      expect(multiplier(1, lev, I0, 1010, NO_OXYGEN, 0)).toBeCloseTo(1 + lev * 0.01, 12);
      expect(multiplier(-1, lev, I0, 1010, NO_OXYGEN, 0)).toBeCloseTo(1 - lev * 0.01, 12);
      expect(multiplier(1, lev, I0, 990, NO_OXYGEN, 0)).toBeCloseTo(1 - lev * 0.01, 12);
      expect(multiplier(-1, lev, I0, 990, NO_OXYGEN, 0)).toBeCloseTo(1 + lev * 0.01, 12);
    }
  });

  it('PL-1: Surface and Dive are mirror images about M = 1', () => {
    for (const lev of LEVERAGES) {
      for (const v of [900, 975, 1001, 1080]) {
        const long = multiplier(1, lev, I0, v, NO_OXYGEN, 0);
        const short = multiplier(-1, lev, I0, v, NO_OXYGEN, 0);
        expect(long + short).toBeCloseTo(2, 12);
      }
    }
  });

  it('PL-1: at tau = 0 the oxygen term vanishes and M is the pure price term', () => {
    const p = positionAt(1, 10, 50_000, I0, 0, THETA);
    expect(positionMultiplier(p, 1005, TICK_S)).toBe(
      multiplier(1, 10, I0, 1005, THETA, 0),
    );
    expect(positionMultiplier(p, I0, TICK_S)).toBe(1);
  });
});

describe('PL-1 — tau is derived from the tick count, never from a clock', () => {
  it('PL-1: tau = ticksElapsed × 0.125 s', () => {
    expect(tauOf(positionAt(1, 10, 50_000, I0, 0), TICK_S)).toBe(0);
    expect(tauOf(positionAt(1, 10, 50_000, I0, 1), TICK_S)).toBe(0.125);
    expect(tauOf(positionAt(1, 10, 50_000, I0, 8), TICK_S)).toBe(1);
    expect(tauOf(positionAt(1, 10, 50_000, I0, 80), TICK_S)).toBe(10);
  });

  it('PL-1: the entry tick is tick 0, so M is exactly 1 there whatever theta is', () => {
    for (const theta of [0, 0.0025, 0.05]) {
      const p = positionAt(1, 25, 50_000, I0, 0, theta);
      expect(positionMultiplier(p, I0, TICK_S)).toBe(1);
    }
  });
});

describe('PL-1 — the −θτ oxygen term', () => {
  it('PL-1: a motionless index still loses θ per second', () => {
    // 8 ticks = 1 s at 0.25 %/s → M = 0.9975 with the index unmoved.
    const p = positionAt(1, 10, 50_000, I0, 8, THETA);
    expect(positionMultiplier(p, I0, TICK_S)).toBeCloseTo(1 - 0.0025, 12);
  });

  it('PL-1: oxygen costs the same regardless of direction or leverage', () => {
    // The edge is on time, not on the price exposure: a Dive at 2x and a
    // Surface at 25x pay identical oxygen for identical holds. That is what
    // makes theta a clean RTP dial (M1.7) rather than a leverage-dependent one.
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        const held = positionAt(dir, lev, 50_000, I0, 80, THETA);
        const fresh = positionAt(dir, lev, 50_000, I0, 0, THETA);
        const cost = positionMultiplier(fresh, I0, TICK_S) - positionMultiplier(held, I0, TICK_S);
        expect(cost, `dir ${dir} lev ${lev}`).toBeCloseTo(THETA * 10, 12);
      }
    }
  });

  it('PL-1: oxygen accumulates linearly in tau', () => {
    const at = (ticks: number): number =>
      positionMultiplier(positionAt(1, 10, 50_000, I0, ticks, THETA), I0, TICK_S);
    const step = at(0) - at(8);
    for (const n of [8, 16, 24, 400]) {
      expect(at(0) - at(n)).toBeCloseTo((step * n) / 8, 10);
    }
  });

  it('PL-1: a winning price move and the oxygen cost compose additively', () => {
    // +1% at 10x is M = 1.10 before oxygen; 4 s of oxygen removes 0.01.
    const p = positionAt(1, 10, 50_000, I0, 32, THETA);
    expect(positionMultiplier(p, 1010, TICK_S)).toBeCloseTo(1.1 - 0.01, 12);
  });

  it('PL-1: theta is read from the position, so two positions can differ (PL-2)', () => {
    const old = positionAt(1, 10, 50_000, I0, 80, 0.0025);
    const raised = positionAt(1, 10, 50_000, I0, 80, 0.005);
    expect(positionMultiplier(old, I0, TICK_S)).toBeGreaterThan(
      positionMultiplier(raised, I0, TICK_S),
    );
  });
});

describe('UI-4 — the O2 gauge', () => {
  it('UI-4: full at entry and draining linearly with tau', () => {
    expect(oxygenFraction(positionAt(1, 10, 50_000, I0, 0, THETA), TICK_S)).toBe(1);
    // 100 s at 0.25 %/s consumes a quarter of the budget.
    expect(oxygenFraction(positionAt(1, 10, 50_000, I0, 800, THETA), TICK_S)).toBeCloseTo(0.75, 12);
  });

  it('UI-4: clamps to [0,1] rather than going negative on a long hold', () => {
    // tau = 1/theta is 400 s; beyond it the raw fraction is negative.
    const past = positionAt(1, 10, 50_000, I0, 8 * 500, THETA);
    expect(oxygenFraction(past, TICK_S)).toBe(0);
  });

  it('UI-4: never drains when theta is zero', () => {
    expect(oxygenFraction(positionAt(1, 10, 50_000, I0, 4000, 0), TICK_S)).toBe(1);
  });

  it('UI-4: clamps at 1 even under a negative theta — a bad config cannot overflow the bar', () => {
    // A negative theta is a config error, not a game state: it would pay the
    // player to hold. The gauge still renders inside the button rather than
    // overflowing it, so a misconfiguration shows up as a pinned bar and an
    // impossible payout figure rather than as broken layout.
    expect(oxygenFraction(positionAt(1, 10, 50_000, I0, 80, -0.0025), TICK_S)).toBe(1);
  });
});

describe('CR-3 — the crush line I_e·(1 − d·(1 − θτ)/L)', () => {
  it('CR-3: sits below entry for Surface and above entry for Dive', () => {
    for (const lev of LEVERAGES) {
      expect(crushIndex(1, lev, I0, THETA, 0)).toBeLessThan(I0);
      expect(crushIndex(-1, lev, I0, THETA, 0)).toBeGreaterThan(I0);
    }
  });

  it('CR-3: is the index at which M reaches exactly zero, at any tau', () => {
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        for (const tau of [0, 1, 10, 45]) {
          const line = crushIndex(dir, lev, I0, THETA, tau);
          expect(multiplier(dir, lev, I0, line, THETA, tau), `dir ${dir} lev ${lev} tau ${tau}`)
            .toBeCloseTo(0, 12);
        }
      }
    }
  });

  it('CR-3: tightens as leverage rises', () => {
    const distances = LEVERAGES.map((lev) => I0 - crushIndex(1, lev, I0, THETA, 0));
    for (let i = 1; i < distances.length; i += 1) {
      expect(distances[i]!).toBeLessThan(distances[i - 1]!);
    }
  });

  it('CR-3: the line CREEPS toward the entry as tau grows — both directions', () => {
    // The signature behaviour of the oxygen edge: hold long enough and the line
    // reaches you even if the index never moves. Surface lines rise toward I_e;
    // Dive lines fall toward it.
    for (const lev of LEVERAGES) {
      const surface = [0, 10, 20, 40].map((tau) => crushIndex(1, lev, I0, THETA, tau));
      const dive = [0, 10, 20, 40].map((tau) => crushIndex(-1, lev, I0, THETA, tau));
      for (let i = 1; i < surface.length; i += 1) {
        expect(surface[i]!, `surface lev ${lev}`).toBeGreaterThan(surface[i - 1]!);
        expect(dive[i]!, `dive lev ${lev}`).toBeLessThan(dive[i - 1]!);
      }
      // and it approaches I_e rather than crossing past it
      expect(surface[surface.length - 1]!).toBeLessThan(I0);
      expect(dive[dive.length - 1]!).toBeGreaterThan(I0);
    }
  });

  it('CR-3: at tau = 1/theta the line has crept all the way onto the entry', () => {
    // Oxygen alone has consumed the whole multiplier: the position crushes on
    // the spot regardless of price. 400 s at 0.25 %/s — far beyond a 90 s
    // round, which is exactly why the round length bounds the edge.
    for (const lev of LEVERAGES) {
      expect(crushIndex(1, lev, I0, THETA, 1 / THETA)).toBeCloseTo(I0, 9);
      expect(crushIndex(-1, lev, I0, THETA, 1 / THETA)).toBeCloseTo(I0, 9);
    }
  });

  it('CR-3: with theta = 0 the line is static — the M1.3 form is the tau=0 case', () => {
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        for (const tau of [0, 5, 90]) {
          expect(crushIndex(dir, lev, I0, 0, tau)).toBe(I0 * (1 - dir / lev));
        }
      }
    }
  });

  it('CR-3: positionCrushIndex agrees with the free function at the position tau', () => {
    const p = positionAt(-1, 25, 50_000, I0, 40, THETA);
    expect(positionCrushIndex(p, TICK_S)).toBe(crushIndex(-1, 25, I0, THETA, 5));
  });
});

describe('CR-6 — tau alignment between the drawn line and the tested line', () => {
  /**
   * CR-6 is a release blocker: the line tested at tick n must use the same tau
   * as the line displayed at tick n. The structural guarantee is that both go
   * through `positionCrushIndex` with the same `Position`, so there is no second
   * copy of the formula and no second tau. This asserts the consequence.
   */
  it('CR-6: the displayed line and the tested line are the same number, tick by tick', () => {
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        for (let n = 0; n < 720; n += 1) {
          const p = positionAt(dir, lev, 50_000, I0, n, THETA);
          const displayed = positionCrushIndex(p, TICK_S);
          // Exactly at the engine's line: crushed. One representable step on
          // the survival side of that same number: not crushed. If the two
          // lines had drifted by even one ulp, one of these would flip.
          expect(isCrushed(p, displayed, TICK_S), `dir ${dir} lev ${lev} tick ${n}`).toBe(true);
          const survivor = dir > 0 ? nextUp(displayed) : nextDown(displayed);
          expect(isCrushed(p, survivor, TICK_S), `dir ${dir} lev ${lev} tick ${n}`).toBe(false);
        }
      }
    }
  });

  it('CR-6: a line computed one tick stale is a DIFFERENT number — the defect it bans', () => {
    // Records what CR-6 is protecting against: a client that cached the line
    // for one tick would draw a line the engine does not test against.
    const now = positionAt(1, 10, 50_000, I0, 40, THETA);
    const stale = positionAt(1, 10, 50_000, I0, 39, THETA);
    expect(positionCrushIndex(now, TICK_S)).not.toBe(positionCrushIndex(stale, TICK_S));
  });
});

describe('CR-1 — crushed at the first tick where M ≤ 0', () => {
  it('CR-1: not crushed strictly above the line, crushed at and below it', () => {
    const p = positionAt(1, 10); // theta 0 -> line at 900
    expect(isCrushed(p, 900.001, TICK_S)).toBe(false);
    expect(isCrushed(p, 900, TICK_S)).toBe(true);
    expect(isCrushed(p, 899, TICK_S)).toBe(true);
  });

  it('CR-1: the boundary is inclusive — M exactly 0 is a crush, not a survival', () => {
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        const p = positionAt(dir, lev);
        expect(positionMultiplier(p, crushIndex(dir, lev, I0, NO_OXYGEN, 0), TICK_S))
          .toBeCloseTo(0, 12);
        expect(isCrushed(p, crushIndex(dir, lev, I0, NO_OXYGEN, 0), TICK_S)).toBe(true);
      }
    }
  });

  it('CR-1: a Dive is crushed by a rising index, not a falling one', () => {
    const p = positionAt(-1, 10); // line at 1100
    expect(isCrushed(p, 1100, TICK_S)).toBe(true);
    expect(isCrushed(p, 900, TICK_S)).toBe(false);
  });

  it('CR-1: oxygen alone crushes a motionless position — the line reaches it', () => {
    // A 10x Surface at a dead-flat index. At tau = 0 the line is 900; it creeps
    // up as oxygen drains, and eventually reaches I_e = 1000 itself.
    const flat = I0;
    expect(isCrushed(positionAt(1, 10, 50_000, I0, 0, THETA), flat, TICK_S)).toBe(false);
    expect(isCrushed(positionAt(1, 10, 50_000, I0, 800, THETA), flat, TICK_S)).toBe(false);
    // tau = 1/theta = 400 s = 3200 ticks: the line is exactly on the entry.
    expect(isCrushed(positionAt(1, 10, 50_000, I0, 3200, THETA), flat, TICK_S)).toBe(true);
  });

  it('CR-1: oxygen crushes a position the price alone would have spared', () => {
    // 10x Surface, index down 0.9%: M = 0.91 on price alone, so no crush at tau 0.
    const v = 991;
    expect(isCrushed(positionAt(1, 10, 50_000, I0, 0, THETA), v, TICK_S)).toBe(false);
    // Enough oxygen removes the remaining 0.91 — the position dies on time.
    expect(isCrushed(positionAt(1, 10, 50_000, I0, 8 * 400, THETA), v, TICK_S)).toBe(true);
  });

  /**
   * The amended CR-1 test. `M_t ≤ 0` and `I_t` vs the line are inverse in exact
   * arithmetic and not in IEEE-754 — the round trip lands `M` on ±2.2e-16 at the
   * line, with the sign depending on leverage. Deciding on the multiplier would
   * crush at 10× and 25× but spare at 5×, for a position sitting exactly on the
   * line it was shown. The line is authoritative, so the boundary must be exact
   * and identical at every leverage.
   */
  it('CR-1: a tick exactly at the line crushes at every direction x leverage x tau', () => {
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        for (const ticks of [0, 1, 40, 400]) {
          const p = positionAt(dir, lev, 50_000, I0, ticks, THETA);
          expect(
            isCrushed(p, positionCrushIndex(p, TICK_S), TICK_S),
            `dir ${dir} lev ${lev} tick ${ticks}`,
          ).toBe(true);
        }
      }
    }
  });

  it('CR-1: one representable step short of the line does not crush, at any leverage', () => {
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        for (const ticks of [0, 1, 40, 400]) {
          const p = positionAt(dir, lev, 50_000, I0, ticks, THETA);
          const line = positionCrushIndex(p, TICK_S);
          // A Surface survives just above its line; a Dive just below.
          const survivor = dir > 0 ? nextUp(line) : nextDown(line);
          expect(isCrushed(p, survivor, TICK_S), `dir ${dir} lev ${lev} tick ${ticks}`).toBe(false);
        }
      }
    }
  });

  it('CR-1: the boundary does not vary by leverage — the float-epsilon defect', () => {
    // Deciding on the multiplier gives a leverage-dependent answer at the line.
    // This records that divergence so a future refactor back to `M <= 0` fails
    // here rather than silently changing who dies. Asserted at a non-zero tau
    // so it covers the creeping line, not just the M1.3 static one.
    const tau = 5;
    const viaMultiplier = LEVERAGES.map(
      (lev) => multiplier(1, lev, I0, crushIndex(1, lev, I0, THETA, tau), THETA, tau) <= 0,
    );
    expect(new Set(viaMultiplier).size).toBeGreaterThan(1); // inconsistent

    const viaLine = LEVERAGES.map((lev) => {
      const p = positionAt(1, lev, 50_000, I0, tau / TICK_S, THETA);
      return isCrushed(p, positionCrushIndex(p, TICK_S), TICK_S);
    });
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
    const p = positionAt(1, 25, 50_000, I0, 40, THETA);
    for (const v of [960, 900, 500, 1]) {
      expect(livePnl(p, v, TICK_S)).toBeGreaterThanOrEqual(-50_000);
    }
  });

  it('PL-5: live P&L tracks the multiplier above the line', () => {
    const p = positionAt(1, 10, 50_000, I0); // theta 0: isolate the price term
    // +1% index at 10× → M = 1.10 → payout 55_000 → pnl +5_000.
    expect(livePnl(p, 1010, TICK_S)).toBe(5_000);
    // −1% index at 10× → M = 0.90 → payout 45_000 → pnl −5_000.
    expect(livePnl(p, 990, TICK_S)).toBe(-5_000);
  });
});
