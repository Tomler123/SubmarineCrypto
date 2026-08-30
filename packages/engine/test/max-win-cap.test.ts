/**
 * PL-4 / AO-5 — the max-win cap.
 *
 * PL-4 reads in full: "Settlement payout = stake × max(0, M) rounded
 * half-away-from-zero to integer cents, computed once, then clamped to the
 * max-win bound `min(50 × stake, $10,000)`. Property test: for all inputs,
 * 0 ≤ payout ≤ min(50 × stake, $10,000 cap)."
 *
 * Until M1.5 only the lower bound held: `clampCents` existed in `@crush/ledger`
 * and was correct, but no settlement path called it, so stake $2,500 at M = 60
 * paid $150,000 — fifteen times the cap. These are the tests for the upper
 * bound; the `PL-4 [GAP]` case in `packages/ledger/test/money.property.test.ts`
 * that asserted the uncapped behaviour is deleted with this change, and its
 * bound folded into that file's main PL-4 property.
 *
 * Two things are asserted separately, because AO-5 makes them separate
 * mechanisms:
 *
 *  1. the clamp is **unconditional** — it applies to every settlement reason,
 *     not only to a max-win auto-surface. A gap tick can carry `M` past 50
 *     between two ticks, and a round-end settlement (RL-4) has no trigger to
 *     route through at all;
 *  2. the clamp lands **after** the single rounding, never before. Rounding a
 *     pre-clamped float would be a second float→money conversion and would
 *     violate PL-4's computed-once rule.
 */

import { describe, expect, it } from 'vitest';
import { cents } from '@crush/ledger';
import { CASES, PROPERTY_SEED, caseLabel, caseRng } from '../../ledger/test/support/rng.js';
import {
  DEFAULT_CONFIG,
  initialState,
  maxPayoutFor,
  onTick,
  open,
  payoutFor,
  requestAscent,
  settleAtRoundEnd,
} from '../src/index.js';
import type { Direction, EngineConfig, Leverage, Settlement, Tick } from '../src/index.js';

/** Parameter sheet §12: 50× and $10,000. */
const MAX_WIN_MULTIPLE = 50;
const ABSOLUTE_CAP_CENTS = 1_000_000;

const I0 = 1000;
const START_BALANCE = 100_000_000;
const LEVERAGES: readonly Leverage[] = [2, 5, 10, 25];
const DIRECTIONS: readonly Direction[] = [1, -1];
const CONFIG: EngineConfig = DEFAULT_CONFIG;

function tick(t: number, v: number): Tick {
  return { t, v };
}

/** PL-4's bound, restated from the criterion rather than from the implementation. */
function bound(stake: number): number {
  return Math.min(MAX_WIN_MULTIPLE * stake, ABSOLUTE_CAP_CENTS);
}

describe('PL-4 — the cap is present in config and matches the parameter sheet', () => {
  it('PL-4: DEFAULT_CONFIG carries both bounds at their sheet values', () => {
    expect(CONFIG.maxWinMultiple).toBe(MAX_WIN_MULTIPLE);
    expect(CONFIG.maxWinCents).toBe(ABSOLUTE_CAP_CENTS);
  });

  it('PL-4: maxPayoutFor is min(50 × stake, $10,000) on both sides of the crossover', () => {
    // The crossover is at stake = $200: below it the 50× multiple binds, above
    // it the absolute cap does. Both regimes must be exercised, or a bug that
    // implemented only one bound would pass.
    expect(maxPayoutFor(cents(2_000), CONFIG)).toBe(100_000); // $20 → 50× binds
    expect(maxPayoutFor(cents(20_000), CONFIG)).toBe(1_000_000); // $200 → exactly equal
    expect(maxPayoutFor(cents(250_000), CONFIG)).toBe(1_000_000); // $2,500 → cap binds
  });
});

describe('PL-4 — the gap the audit recorded is closed', () => {
  it('PL-4: stake $2,500 at M = 60 pays the $10,000 cap, not $150,000', () => {
    // The exact case the deleted `PL-4 [GAP]` test documented.
    const stake = cents(250_000);
    expect(payoutFor(stake, 60, CONFIG)).toBe(1_000_000);
  });

  it('PL-4: 0 <= payout <= min(50 × stake, $10,000) over generated (stake, M) pairs', () => {
    for (let i = 0; i < CASES.standard; i++) {
      const r = caseRng(PROPERTY_SEED ^ 0xca9, i);
      const stake = cents(r.int(50, 250_000));
      const m = r.bool(0.3) ? r.float(45, 200) : r.float(-5, 60);
      const p = payoutFor(stake, m, CONFIG);
      const where = caseLabel(PROPERTY_SEED ^ 0xca9, i, `stake=${stake} M=${m}`);

      expect(p >= 0, `${where} payout negative: ${p}`).toBe(true);
      expect(p <= bound(stake), `${where} payout ${p} exceeds bound ${bound(stake)}`).toBe(true);
      expect(Number.isSafeInteger(p), `${where} payout not a safe integer`).toBe(true);
    }
  });

  it('PL-4: the cap binds only above it — payouts below the bound are untouched', () => {
    // A clamp that returned the bound unconditionally would pass every
    // upper-bound assertion above. This is the test such a bug fails.
    for (let i = 0; i < CASES.standard; i++) {
      const r = caseRng(PROPERTY_SEED ^ 0xcab, i);
      const stake = cents(r.int(50, 250_000));
      const m = r.float(0.01, 20);
      const where = caseLabel(PROPERTY_SEED ^ 0xcab, i, `stake=${stake} M=${m}`);
      const capped = payoutFor(stake, m, CONFIG);
      const expected = Math.min(Math.round(stake * m), bound(stake));
      expect(capped, `${where} clamp altered a payout below the bound`).toBe(expected);
    }
  });

  it('PL-4: a payout landing exactly on the bound is admitted, not nudged', () => {
    const stake = cents(20_000); // bound = 1_000_000 exactly, at M = 50.
    expect(payoutFor(stake, 50, CONFIG)).toBe(1_000_000);
    // One cent below the bound must survive unclamped, which is what shows the
    // clamp is a ceiling and not a target. M = 49.99995 gives 999,999 exactly.
    expect(payoutFor(stake, 49.999_95, CONFIG)).toBe(999_999);
    // And the rounding still happens before the clamp: 999,999.5 rounds up to
    // the bound and is admitted, rather than being rounded down to stay under.
    expect(payoutFor(stake, 49.999_975, CONFIG)).toBe(1_000_000);
  });
});

describe('PL-4 / AO-5 — the clamp is unconditional across settlement reasons', () => {
  /**
   * Drive a position from entry to a settlement far above the cap.
   *
   * Longs only, and that is a fact about the game rather than a gap in the
   * test: a Dive's multiplier is `1 + L·(1 − I_t/I_e)`, and since the index
   * cannot go below zero, a short's `M` is bounded above by `1 + L` — 26 at the
   * top leverage of 25×. **No short position can ever reach 50× by price.** The
   * cap is therefore reachable only by longs, which is why `settleAtHugeMultiplier`
   * takes `dir` but the callers pass `1`; the short side's own bound is asserted
   * separately below so the asymmetry is recorded rather than merely avoided.
   */
  function settleAtHugeMultiplier(
    dir: Direction,
    lev: Leverage,
    stake: number,
    via: 'ascent' | 'round-end',
  ): Settlement {
    let state = initialState(cents(START_BALANCE));
    state = open(state, { dir, stake: cents(stake), lev, id: 'cap' }, tick(0, I0), CONFIG).state;
    // A gap far enough up to blow past M = 50 even at the lowest leverage: at
    // 2× a 25× index move is needed, so use one larger still.
    const v = dir > 0 ? I0 * 40 : I0 / 40;

    if (via === 'ascent') {
      state = requestAscent(state, 0, CONFIG).state;
      state = onTick(state, tick(CONFIG.ascentMs, v), CONFIG).state;
    } else {
      state = onTick(state, tick(125, v), CONFIG).state;
      state = settleAtRoundEnd(state, tick(125, v), CONFIG).state;
    }
    const result = state.lastResult;
    if (result === null) throw new Error('no settlement produced');
    return result;
  }

  for (const via of ['ascent', 'round-end'] as const) {
    it(`PL-4: a ${via} settlement past the cap pays the bound, at every leverage`, () => {
      for (const lev of LEVERAGES) {
        const stake = 250_000; // $2,500 — the cap regime.
        const r = settleAtHugeMultiplier(1, lev, stake, via);
        const where = `lev=${lev} via=${via} M=${r.multiplier}`;

        // The case must actually exceed the cap, or the assertion is vacuous.
        expect(r.multiplier > MAX_WIN_MULTIPLE, `${where} did not exceed 50×`).toBe(true);
        expect(r.payout, `${where} payout not capped`).toBe(bound(stake));
        expect(r.reason, `${where} reason`).toBe(via);
      }
    });
  }

  it('PL-4: the uncapped multiplier is still reported for display and audit (LG-4)', () => {
    // The cap is on the money, not on the record. LG-4 retains `M`, and a
    // settlement that silently rewrote M to 50 would misreport what happened.
    const r = settleAtHugeMultiplier(1, 25, 250_000, 'ascent');
    expect(r.multiplier).toBeGreaterThan(MAX_WIN_MULTIPLE);
    expect(r.payout).toBe(1_000_000);
  });

  it('PL-5 still holds under the cap: pnl is never worse than -stake', () => {
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        const r = settleAtHugeMultiplier(dir, lev, 250_000, 'ascent');
        expect(r.pnl).toBe(r.payout - r.stake);
        expect(r.pnl >= -r.stake).toBe(true);
      }
    }
  });

  it('PL-4: a Dive cannot reach the cap by price at all — M is bounded by 1 + L', () => {
    // The asymmetry stated as a test rather than left implicit in the loops
    // above. A short at the index floor (v = 0) has M = 1 + L, which at the
    // top leverage of 25× is 26 — half the 50× cap. So the 50× bound is
    // unreachable from the short side however far the index falls.
    //
    // A small stake is used so the *multiple* is the binding bound: at $2,500
    // the $10,000 absolute cap binds from M = 4 upward, which would mask the
    // property under test. At $20 the bound is 50 × $20 = $1,000, and a short
    // capped at M = 1 + L can never reach it.
    const stake = 2_000; // $20 — bound = 50× = $1,000, well below the $10k cap.
    for (const lev of LEVERAGES) {
      const r = settleAtHugeMultiplier(-1, lev, stake, 'ascent');
      expect(r.multiplier, `lev=${lev}`).toBeLessThan(1 + lev);
      expect(r.multiplier, `lev=${lev}`).toBeLessThan(MAX_WIN_MULTIPLE);
      // Uncapped, therefore, and paid in full.
      expect(r.payout, `lev=${lev}`).toBeLessThan(bound(stake));
    }
  });

  it('LG-1: the wallet credit equals the capped payout, not the uncapped one', () => {
    // The invariant that actually protects the house: the clamp has to reach
    // the balance, not merely the settlement record.
    let state = initialState(cents(START_BALANCE));
    const stake = 250_000;
    state = open(
      state,
      { dir: 1, stake: cents(stake), lev: 25, id: 'cap' },
      tick(0, I0),
      CONFIG,
    ).state;
    const afterDebit = state.wallet.balance;
    state = requestAscent(state, 0, CONFIG).state;
    state = onTick(state, tick(CONFIG.ascentMs, I0 * 40), CONFIG).state;
    expect(state.wallet.balance - afterDebit).toBe(1_000_000);
    expect(state.wallet.net).toBe(1_000_000 - stake);
  });
});
