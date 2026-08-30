/**
 * Property-based tests for the money rules — RUN 3 of the Phase 1.5 shakedown.
 *
 * The example-based suite in `money.test.ts` asserts the boundaries somebody
 * thought of. These assert the *rule* over several thousand generated cases
 * each, so a boundary nobody thought of has to survive it too.
 *
 * The generator is hand-written and seeded (`test/support/rng.ts`) — no
 * `fast-check`, no new dependency. Every failure message carries the seed and
 * the case index, and `caseRng` derives each case independently, so a reported
 * case reproduces on its own without replaying the whole suite.
 *
 * SEED: PROPERTY_SEED (0x5eed1e55). Change it to widen the search; keep it
 * fixed to keep the suite a regression record.
 *
 * Criteria: PL-4 (payout = stake × max(0, M), rounded half away from zero,
 * computed once, then clamped to min(50 × stake, $10,000)), LG-2 (integer minor
 * units end to end).
 */

import { describe, expect, it } from 'vitest';
import { CASES, PROPERTY_SEED, caseLabel, caseRng } from './support/rng.js';
import {
  type Cents,
  MoneyError,
  addCents,
  cents,
  clampCents,
  roundHalfAwayFromZero,
  scaleCents,
  subCents,
} from '../src/index.js';

/** PL-4's stated domain for this run: stake in [50, 250000] cents ($0.50–$2,500). */
const STAKE_MIN = 50;
const STAKE_MAX = 250_000;
/** M in [-5, 60] — spans a deep crush through past the 50× max-win cap. */
const M_MIN = -5;
const M_MAX = 60;

/** PL-4 / AO-5, parameter sheet §12: the max-win bound is min(50 × stake, $10,000). */
const MAX_WIN_MULTIPLE = 50;
const ABSOLUTE_CAP = 1_000_000;

/** `min(50 × stake, $10,000)` — PL-4's upper bound, from the criterion. */
function maxPayout(stake: Cents): Cents {
  return cents(Math.min(MAX_WIN_MULTIPLE * stake, ABSOLUTE_CAP));
}

/**
 * The payout rule as PL-4 states it, restated independently of `position.ts`.
 *
 * Written out here rather than imported from `@crush/engine` so the property is
 * checked against the *criterion*, not against the implementation under test.
 * `@crush/ledger` also may not depend on `@crush/engine` — the dependency runs
 * the other way — so importing it would be a layering violation as well. The
 * engine-side suite checks the engine's own `payoutFor` against the same rule.
 *
 * Both bounds are present: the floor at M <= 0, and the max-win clamp applied
 * after the single rounding. Until M1.5 only the floor existed here, and a
 * `PL-4 [GAP]` case recorded the missing ceiling as an executable assertion of
 * the uncapped behaviour, designed to fail the moment the cap landed. It has
 * landed — `@crush/engine`'s `payoutFor` clamps at the conversion — so that
 * case is deleted and its bound is folded into the property below.
 */
function payout(stake: Cents, m: number): Cents {
  if (m <= 0) return cents(0);
  return clampCents(scaleCents(stake, m), cents(0), maxPayout(stake));
}

describe('PL-4 (property) — payout is an integer, never negative, zero at M <= 0', () => {
  it(`PL-4: holds over ${CASES.standard} generated (stake, M) pairs`, () => {
    for (let i = 0; i < CASES.standard; i++) {
      const r = caseRng(PROPERTY_SEED, i);
      const stake = cents(r.int(STAKE_MIN, STAKE_MAX));
      // A quarter of cases land astride M = 0, so the boundary PL-4 names is
      // sampled densely rather than by luck: a uniform draw over [-5, 60] lands
      // within a millionth of zero essentially never.
      const m = r.bool(0.25) ? r.float(-1e-6, 1e-6) : r.float(M_MIN, M_MAX);
      const p = payout(stake, m);
      const where = caseLabel(PROPERTY_SEED, i, `stake=${stake} M=${m}`);

      expect(Number.isInteger(p), `${where} payout not integer: ${p}`).toBe(true);
      expect(Number.isSafeInteger(p), `${where} payout not safe: ${p}`).toBe(true);
      expect(p >= 0, `${where} payout negative: ${p}`).toBe(true);
      // PL-4's upper bound, in full: 0 <= payout <= min(50 x stake, $10,000).
      // M ranges to 60 here, so the domain's top corner — stake $2,500 at
      // M = 60, which paid $150,000 before the cap — is inside the sample.
      expect(p <= maxPayout(stake), `${where} payout ${p} above the cap`).toBe(true);
      if (m <= 0) {
        expect(p, `${where} payout must be 0 at M <= 0`).toBe(0);
      }
      // PL-5's per-position half, at the arithmetic level: pnl is bounded below
      // by -stake precisely because payout is bounded below by 0.
      const pnl = subCents(p, stake);
      expect(pnl >= -stake, `${where} pnl below -stake: ${pnl}`).toBe(true);
    }
  });

  it('PL-4: the M <= 0 floor is exact at the boundary itself, not merely near it', () => {
    for (let i = 0; i < CASES.standard; i++) {
      const r = caseRng(PROPERTY_SEED ^ 0x11, i);
      const stake = cents(r.int(STAKE_MIN, STAKE_MAX));
      const where = caseLabel(PROPERTY_SEED ^ 0x11, i, `stake=${stake}`);
      // Exactly zero, negative zero, and the smallest representable step below.
      expect(payout(stake, 0), `${where} at M=0`).toBe(0);
      expect(payout(stake, -0), `${where} at M=-0`).toBe(0);
      expect(payout(stake, -Number.MIN_VALUE), `${where} at M=-MIN_VALUE`).toBe(0);
      // Just above zero must not be *forced* to zero — it rounds to zero on its
      // own arithmetic, which is a different thing and must stay a real rounding.
      expect(payout(stake, Number.MIN_VALUE) >= 0, `${where} at M=+MIN_VALUE`).toBe(true);
    }
  });

  it('PL-4: payout is monotone in M above the floor', () => {
    // Not a rounding property, but the check that makes the rounding properties
    // meaningful: a bug that clamped, wrapped or truncated would still be
    // integral and non-negative, and would show only as a lost ordering.
    for (let i = 0; i < CASES.standard; i++) {
      const r = caseRng(PROPERTY_SEED ^ 0x22, i);
      const stake = cents(r.int(STAKE_MIN, STAKE_MAX));
      const a = r.float(0, M_MAX);
      const b = a + r.float(0, 1);
      const where = caseLabel(PROPERTY_SEED ^ 0x22, i, `stake=${stake} a=${a} b=${b}`);
      // Monotone non-decreasing, not strictly increasing: above the max-win
      // bound the payout plateaus at the cap, which is the cap working rather
      // than the ordering being lost.
      expect(payout(stake, b) >= payout(stake, a), `${where} not monotone`).toBe(true);
    }
  });
});

describe('PL-4 (property) — half away from zero at every .5 boundary, both signs', () => {
  it('PL-4: n + 0.5 rounds away from zero across the money range, both signs', () => {
    // Exhaustive over exactly-representable half-integers rather than sampled:
    // the .5 boundaries are the entire content of the rule, and there are few
    // enough in the money range that sampling would be the weaker test.
    for (let n = 0; n <= 20_000; n++) {
      expect(roundHalfAwayFromZero(n + 0.5), `+${n}.5`).toBe(n + 1);
      expect(roundHalfAwayFromZero(-(n + 0.5)), `-${n}.5`).toBe(-(n + 1));
    }
  });

  it('PL-4: our path does NOT do what Math.round does — the roadmap-flagged defect', () => {
    // The roadmap recorded the prototype's `pnl()` applying `Math.round` to a
    // float product. Math.round is half-UP: it rounds -2.5 to -2, toward
    // positive infinity, which is asymmetric across zero, so a short and its
    // mirrored long would round by different amounts. Both halves are asserted
    // — that JavaScript really does this, and that our path does not.
    expect(Math.round(-2.5)).toBe(-2);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);

    // And that the disagreement is exactly the negative halves, nowhere else.
    let disagreements = 0;
    for (let n = -5_000; n <= 5_000; n++) {
      const half = n + 0.5;
      const ours = roundHalfAwayFromZero(half);
      const theirs = Math.round(half);
      if (ours !== theirs) {
        disagreements++;
        expect(half < 0, `disagreement at a non-negative half: ${half}`).toBe(true);
        expect(ours, `ours at ${half}`).toBe(theirs - 1);
      }
    }
    // n + 0.5 for n in [-5000, -1] are the 5000 negative halves.
    expect(disagreements).toBe(5_000);
  });

  it('PL-4: rounding is exactly symmetric across zero for generated values', () => {
    for (let i = 0; i < CASES.standard; i++) {
      const r = caseRng(PROPERTY_SEED ^ 0x33, i);
      // Mix exact halves with arbitrary floats: symmetry must hold for both.
      const v = r.bool(0.5) ? r.int(-500_000, 500_000) + 0.5 : r.float(-500_000, 500_000);
      const where = caseLabel(PROPERTY_SEED ^ 0x33, i, `v=${v}`);
      expect(roundHalfAwayFromZero(v), `${where} not symmetric`).toBe(-roundHalfAwayFromZero(-v));
      // Never a negative zero — a signed zero in a ledger sum is a
      // reconciliation hazard, and Object.is distinguishes it from a credit of
      // nothing even though `===` does not.
      expect(Object.is(roundHalfAwayFromZero(v), -0), `${where} produced -0`).toBe(false);
    }
  });

  it('PL-4: rounding never moves a value by more than half a cent', () => {
    for (let i = 0; i < CASES.standard; i++) {
      const r = caseRng(PROPERTY_SEED ^ 0x44, i);
      const v = r.float(-1e9, 1e9);
      const where = caseLabel(PROPERTY_SEED ^ 0x44, i, `v=${v}`);
      const d = Math.abs(roundHalfAwayFromZero(v) - v);
      expect(d <= 0.5, `${where} moved by ${d}`).toBe(true);
      // Magnitude never shrinks below the truncation — i.e. it rounds away from
      // zero at the half, never toward it.
      expect(Math.abs(roundHalfAwayFromZero(v)) >= Math.floor(Math.abs(v)), where).toBe(true);
    }
  });
});

describe('LG-2 (property) — no NaN or Infinity can reach a money field', () => {
  it('LG-2: every non-finite float→money path throws rather than returning', () => {
    const poison = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      0 / 0,
      1 / 0,
      -1 / 0,
    ];
    for (const bad of poison) {
      expect(() => roundHalfAwayFromZero(bad), `round(${bad})`).toThrow(MoneyError);
      expect(() => cents(bad), `cents(${bad})`).toThrow(MoneyError);
      expect(() => scaleCents(cents(1000), bad), `scale by ${bad}`).toThrow(MoneyError);
    }
    // 0 × Infinity is NaN — the case a naive `isFinite(factor)` guard misses,
    // because the factor only becomes poison after the multiply.
    expect(() => scaleCents(cents(0), Number.POSITIVE_INFINITY)).toThrow(MoneyError);
  });

  it('LG-2: overflow past the safe-integer range throws rather than silently rounding', () => {
    // Past 2^53 an integer `number` stops representing every integer, so a
    // balance would begin losing cents with no error raised. Fail fast instead.
    expect(() => scaleCents(cents(STAKE_MAX), 1e12)).toThrow(MoneyError);
    expect(() => addCents(cents(Number.MAX_SAFE_INTEGER), cents(1))).toThrow(MoneyError);
    expect(() => subCents(cents(-Number.MAX_SAFE_INTEGER), cents(1))).toThrow(MoneyError);
  });

  /**
   * A mutation-testing finding, recorded so it is not rediscovered as a bug.
   *
   * Deleting the `Number.isFinite` guard at the top of `roundHalfAwayFromZero`
   * leaves the whole suite green. That is *not* a hole in these tests: money is
   * still protected, because `cents()`'s `Number.isSafeInteger` check rejects
   * NaN and both infinities anyway. The two guards differ only in the error
   * message, never in the outcome — checked exhaustively over every non-finite
   * kind plus the safe-integer boundaries.
   *
   * The guard is therefore deliberate defence-in-depth, and this test states
   * the property that actually matters — *some* layer always refuses — so the
   * outer guard cannot be dropped on the strength of a passing suite without
   * the reason being visible here.
   */
  it('LG-2: rejection of a non-finite value is layered, not dependent on one guard', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      // The outer guard, by message — this is the layer a mutation can remove.
      expect(() => roundHalfAwayFromZero(bad)).toThrow(/non-finite/);
      // The inner guard, reached with an already-rounded value: `Math.round`
      // maps every non-finite input to itself, so `cents()` sees the same
      // poison and refuses it independently.
      expect(() => cents(Math.round(bad))).toThrow(MoneyError);
    }
    // And the values just past the safe-integer range, where only `cents()`
    // can catch the problem because they are perfectly finite.
    expect(() => cents(2 ** 53)).toThrow(MoneyError);
    expect(() => roundHalfAwayFromZero(2 ** 53)).toThrow(MoneyError);
  });

  it('LG-2: generated in-range scalings always land on a safe integer', () => {
    for (let i = 0; i < CASES.standard; i++) {
      const r = caseRng(PROPERTY_SEED ^ 0x55, i);
      const stake = cents(r.int(STAKE_MIN, STAKE_MAX));
      const m = r.float(0, M_MAX);
      const out = scaleCents(stake, m);
      const where = caseLabel(PROPERTY_SEED ^ 0x55, i, `stake=${stake} M=${m}`);
      expect(Number.isSafeInteger(out), `${where} unsafe: ${out}`).toBe(true);
      expect(Number.isNaN(out), `${where} NaN`).toBe(false);
    }
  });
});
