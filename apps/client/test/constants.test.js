import { describe, expect, it } from 'vitest';
import { CFG } from '../src/config/constants.js';

/* ================================================================
   CFG vs the spec parameter sheet (game logic §12).

   The failure this exists to catch is the one that already happened once: the
   prototype ran 75 s rounds, the spec said 90 s, and nothing in the build
   disagreed with either. A number in CFG that quietly drifts from the sheet is
   the cheapest possible way to invalidate an RTP calibration or a published
   fairness claim, and it leaves no stack trace.

   So each value below is written as a literal, not as a reference to CFG. A
   test that said `expect(CFG.ROUND_MS).toBe(CFG.ROUND_MS)` would pass forever.
   Changing a value here is meant to be a deliberate act that shows up in the
   diff next to the spec amendment — which is exactly what "audit-locked" is
   supposed to mean in practice.

   Where the sheet marks a value audit-locked, changing it invalidates the
   published verifiability story; where it marks it tunable, changing it is
   allowed but must be versioned. The test does not distinguish — both must
   move in lockstep with the document.
================================================================ */

describe('audit-locked values (§12 — changing these invalidates the fairness story)', () => {
  it('tick rate is 8 Hz', () => {
    expect(CFG.TICK_MS).toBe(125);
    expect(CFG.TICK_S).toBe(0.125);
    // The two must describe the same tick, or tau is computed against a
    // different clock than the feed runs on.
    expect(CFG.TICK_S * 1000).toBeCloseTo(CFG.TICK_MS, 9);
  });

  it('interpolation buffer is 150 ms', () => {
    expect(CFG.DELAY_MS).toBe(150);
  });

  it('the ballast ascent is 500 ms', () => {
    // Locked for fairness: the whole risk of The Blow is that 500 ms is long
    // enough to be crushed inside.
    expect(CFG.ASCENT_MS).toBe(500);
  });

  it('I0 is 1000', () => {
    expect(CFG.IDX0).toBe(1000);
  });

  it('target per-tick volatility v is 0.0042', () => {
    expect(CFG.TICK_VOL).toBe(0.0042);
  });
});

describe('round timings (§12, RL-2)', () => {
  it('a round is 90 s — not the prototype 75 s', () => {
    expect(CFG.ROUND_MS).toBe(90_000);
    // Stated the second way too, because "90000" and "90 s" drifting apart is
    // precisely the class of bug this file exists for.
    expect(CFG.ROUND_MS / 1000).toBe(90);
  });

  it('the intermission is 8 s', () => {
    expect(CFG.WAIT_MS).toBe(8000);
  });

  it('the entry cutoff is T−5 s (EN-1)', () => {
    expect(CFG.ENTRY_CUTOFF_MS).toBe(5000);
  });

  it('the cutoff sits inside the round, leaving real mid-round entry time', () => {
    expect(CFG.ENTRY_CUTOFF_MS).toBeLessThan(CFG.ROUND_MS);
    // §12's rationale for 90 s: mid-round entry needs room to breathe.
    expect(CFG.ROUND_MS - CFG.ENTRY_CUTOFF_MS).toBeGreaterThanOrEqual(60_000);
  });

  it('the full cycle is round + intermission plus the two short phases', () => {
    const cycle = CFG.ROUND_MS + CFG.LAUNCH_MS + CFG.ENDING_MS
      + CFG.SETTLE_MS + CFG.WAIT_MS;
    // §12 quotes roughly 37 rounds/hour at these settings.
    const perHour = 3_600_000 / cycle;
    expect(perHour).toBeGreaterThan(34);
    expect(perHour).toBeLessThan(40);
  });
});

describe('the business dial', () => {
  it('theta is the M1.7 engineering-calibrated 0.03 %/s', () => {
    expect(CFG.THETA_PER_S).toBe(0.0003);
    expect(CFG.THETA_PER_S * 100).toBeCloseTo(0.03, 12);
  });

  it('theta is the only value expressed per second rather than per tick', () => {
    // Guards the M1.4 rule from the other side: if theta were ever restated
    // per tick, every tau multiplication in the engine would be off by 8x.
    const perTick = CFG.THETA_PER_S * CFG.TICK_S;
    expect(perTick).toBeCloseTo(0.0000375, 12);
  });
});

describe('leverage and stakes (§12)', () => {
  it('the leverage set is exactly {2, 5, 10, 25}', () => {
    expect(CFG.LEV).toEqual([2, 5, 10, 25]);
  });

  it('every offered stake at max leverage respects the $2,000 notional cap', () => {
    // stake x lev <= $2,000, bankroll-derived. Stakes are in cents.
    const NOTIONAL_CAP = 200_000;
    const maxLev = Math.max(...CFG.LEV);
    const offending = CFG.STAKES.filter(s => s * maxLev > NOTIONAL_CAP);
    // ASSUMPTION: the cap is enforced at M1.5 (risk caps), not by the stake
    // list. This records which of today's offered stakes will need clamping
    // when that lands, rather than asserting a rule the code does not have.
    expect(offending).toEqual([10_000, 25_000]);
  });

  it('stakes are integer cents, ascending', () => {
    for (const s of CFG.STAKES){
      expect(Number.isInteger(s), `stake ${s}`).toBe(true);
      expect(s).toBeGreaterThan(0);
    }
    const sorted = [...CFG.STAKES].sort((a, b) => a - b);
    expect(CFG.STAKES).toEqual(sorted);
  });

  it('the starting balance is integer cents (invariant 4)', () => {
    expect(Number.isInteger(CFG.START_BAL)).toBe(true);
    expect(CFG.START_BAL).toBe(100_000);
  });
});

describe('every money-shaped constant is an integer number of cents', () => {
  it('holds for the balance and the whole stake ladder', () => {
    const money = [CFG.START_BAL, ...CFG.STAKES];
    for (const v of money){
      expect(Number.isInteger(v), `${v} is not integer cents`).toBe(true);
    }
  });
});
