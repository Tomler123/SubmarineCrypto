/**
 * Property-based tests for the engine's money path — RUN 3 of the Phase 1.5
 * shakedown.
 *
 * `money.property.test.ts` in `@crush/ledger` proves the arithmetic in
 * isolation. This file drives the *engine* — open, tick, ascent, crush,
 * round-end — over thousands of generated random walks and asserts the ledger
 * invariants after **every** call rather than only at the end of a round, so a
 * transient state in which the books do not balance is a failure even if the
 * final state happens to reconcile.
 *
 * The generator is hand-written and seeded (`@crush/ledger`'s `test/support/rng.ts`)
 * — no `fast-check`, no new dependency. Failure messages carry the seed and the
 * case index; `caseRng` derives each case independently, so a reported case
 * reproduces on its own.
 *
 * SEED: PROPERTY_SEED (0x5eed1e55).
 *
 * Criteria: PL-4 (single rounded conversion), PL-5 (max loss is exactly the
 * stake; no mechanism produces a negative balance), LG-1 (the sum over accounts
 * is invariant), LG-2 (integer minor units end to end, no NaN/Infinity).
 */

import { describe, expect, it } from 'vitest';
import { type Cents, cents } from '@crush/ledger';
import {
  CASES,
  PROPERTY_SEED,
  caseLabel,
  caseRng,
} from '../../ledger/test/support/rng.js';
import {
  DEFAULT_CONFIG,
  clearSettled,
  crushIndex,
  initialState,
  multiplier,
  onTick,
  open,
  payoutFor,
  positionMultiplier,
  requestAscent,
  settleAtRoundEnd,
} from '../src/index.js';
import type { Direction, EngineState, Leverage, Tick } from '../src/index.js';

const I0 = 1000;
const START_BALANCE = 10_000_000; // $100,000 — deep enough that PL-5 is tested, not the balance guard.
const STAKE_MIN = 50;
const STAKE_MAX = 250_000;

/** The v1 leverage set (EN-4, parameter sheet §12). */
const LEVERAGES: readonly Leverage[] = [2, 5, 10, 25];
const DIRECTIONS: readonly Direction[] = [1, -1];

const THETA = DEFAULT_CONFIG.thetaPerSecond;
const TICK_S = DEFAULT_CONFIG.tickSeconds;
const ASCENT_MS = DEFAULT_CONFIG.ascentMs;
/** 8 Hz — the tick period in ms, matching `tickSeconds`. */
const TICK_MS = TICK_S * 1000;

function tick(t: number, v: number): Tick {
  return { t, v };
}

/**
 * LG-1's continuous invariant, as the criterion states it: the sum over all
 * accounts is unchanged by any operation.
 *
 * The accounts in Phase 1.5 are the player's `balance` and the stake escrowed
 * in a live position. `wagered` and `net` are running totals, not accounts, so
 * they are checked separately below rather than folded into the sum.
 *
 * A position in state `done` has already had its payout credited to `balance`,
 * so its stake is no longer escrowed anywhere — it is counted only while the
 * position is `open` or `ascending`.
 */
function escrow(state: EngineState): Cents {
  const p = state.position;
  if (p === null || p.state === 'done') return cents(0);
  return p.stake;
}

/** `balance + escrow` — the quantity LG-1 requires to move only by realised P&L. */
function accountsTotal(state: EngineState): number {
  return state.wallet.balance + escrow(state);
}

/**
 * Assert every money invariant that must hold in *any* engine state.
 *
 * Called after every single engine call in the walks below. This is the "assert
 * after EVERY engine call, not just at the end" requirement: a books-imbalanced
 * intermediate state is a defect even when the round's final state reconciles,
 * because Phase 2 serves reads from intermediate states.
 *
 * The checks are plain conditions rather than one `expect` each, and the
 * failure message is built only when a condition actually fails. Both matter at
 * this call count: the walks make roughly half a million of these calls, and
 * eagerly formatting ten template strings per call cost more than the engine
 * itself. `where` is a thunk for the same reason. A failure still reports the
 * seed, the case index and the step, so nothing about diagnosis is lost.
 */
function assertStateInvariants(
  state: EngineState,
  startBalance: number,
  where: () => string,
): void {
  const w = state.wallet;
  const fail = (detail: string): never => {
    throw new Error(`${where()} — ${detail}`);
  };

  // LG-2: every money field is a safe integer, never a float, NaN or Infinity.
  if (!Number.isSafeInteger(w.balance)) fail(`wallet.balance not a safe integer: ${w.balance}`);
  if (!Number.isSafeInteger(w.wagered)) fail(`wallet.wagered not a safe integer: ${w.wagered}`);
  if (!Number.isSafeInteger(w.net)) fail(`wallet.net not a safe integer: ${w.net}`);

  // PL-5: no mechanism may produce a negative balance.
  if (w.balance < 0) fail(`negative balance: ${w.balance}`);
  // Wagered is a monotone running total; it can never be negative.
  if (w.wagered < 0) fail(`negative wagered: ${w.wagered}`);

  // LG-1: balance + escrowed stake == starting balance + realised net. Every
  // debit (the stake leaving the wallet) has its matching credit (the escrow),
  // and every settlement moves the escrow to balance plus the pnl recorded in
  // `net`. If any of those three legs is dropped or double-counted, this fails.
  const total = accountsTotal(state);
  if (total !== startBalance + w.net) {
    fail(`LG-1 reconciliation: balance+escrow=${total} != start+net=${startBalance + w.net}`);
  }

  const p = state.position;
  if (p !== null) {
    if (!Number.isSafeInteger(p.stake)) fail(`position stake not integral: ${p.stake}`);
    if (p.stake <= 0) fail(`non-positive stake: ${p.stake}`);
  }

  const r = state.lastResult;
  if (r !== null) {
    // PL-4: payout is an integer, never negative.
    if (!Number.isSafeInteger(r.payout)) fail(`payout not a safe integer: ${r.payout}`);
    if (r.payout < 0) fail(`negative payout: ${r.payout}`);
    // PL-5: a single position never loses more than its exact stake.
    if (!Number.isSafeInteger(r.pnl)) fail(`pnl not a safe integer: ${r.pnl}`);
    if (r.pnl < -r.stake) fail(`pnl worse than -stake: ${r.pnl} vs stake ${r.stake}`);
    if (r.pnl !== r.payout - r.stake) fail(`pnl != payout - stake: ${r.pnl}`);
    // CR-2: a crush pays exactly zero, so its loss is exactly the stake.
    if (r.crushed) {
      if (r.payout !== 0) fail(`crush paid out: ${r.payout}`);
      if (r.pnl !== -r.stake) fail(`crush pnl != -stake: ${r.pnl}`);
    }
    // LG-2: the recorded multiplier is for display and audit, but a NaN there
    // would mean the payout was computed from one.
    if (!Number.isFinite(r.multiplier)) fail(`non-finite multiplier: ${r.multiplier}`);
    if (!Number.isFinite(r.tau)) fail(`non-finite tau: ${r.tau}`);
  }
}

describe('PL-5 / LG-1 (property) — random walks of ticks and player actions', () => {
  it(`PL-5 + LG-1: hold after every engine call across ${CASES.walk} generated rounds`, () => {
    let roundsWithSettlement = 0;
    let crushes = 0;
    let ascents = 0;
    let roundEnds = 0;
    let maxObservedLoss = 0;

    for (let i = 0; i < CASES.walk; i++) {
      const r = caseRng(PROPERTY_SEED, i);
      const where0 = caseLabel(PROPERTY_SEED, i, '');

      let state = initialState(cents(START_BALANCE));
      assertStateInvariants(state, START_BALANCE, () => `${where0} step=init`);

      // Total staked across the round — PL-5's floor is `start - total staked`.
      let totalStaked = 0;
      let step = 0;
      let t = 0;
      let v = I0;

      // A round is 90 s at 8 Hz = 720 ticks; walk a representative slice so the
      // suite stays fast while still crossing crush lines at every leverage.
      const ticks = r.int(10, 80);
      // Volatility wide enough that positions genuinely crush at every
      // leverage, and mild enough that some survive the whole walk. The upper
      // end is far above the calibrated feed's — deliberately, because PL-5
      // must hold on a violent series as much as a calm one, and because a
      // walk that never reaches the crush line would be asserting PL-5 only
      // against rounds that cannot violate it. The coverage assertions at the
      // end of this test are what keep that honest.
      const sigma = r.float(0.001, 0.12);

      for (let n = 0; n < ticks; n++) {
        step++;
        t += TICK_MS;
        // A bounded random walk on the index. Not the spec's OU process — this
        // is a stress domain, not a simulation; it deliberately reaches values
        // the calibrated feed would not, because PL-5 must hold there too.
        v = v * (1 + r.float(-sigma, sigma));

        // Player action, before the tick — the gateway's ordering.
        if (state.position === null || state.position.state === 'done') {
          if (r.bool(0.35)) {
            const stake = r.int(STAKE_MIN, STAKE_MAX);
            const before = state.wallet.balance;
            const res = open(
              state,
              {
                dir: r.pick(DIRECTIONS),
                stake: cents(stake),
                lev: r.pick(LEVERAGES),
                id: `p${i}-${step}`,
              },
              tick(t, v),
            );
            state = res.state;
            const opened = res.events.some((e) => e.kind === 'position-opened');
            if (opened) {
              totalStaked += stake;
              // EN-3: the debit is atomic with position creation — the stake is
              // gone from balance and present in escrow in the same state.
              expect(state.wallet.balance, `${where0} step=${step} stake not debited`).toBe(
                before - stake,
              );
            }
            assertStateInvariants(state, START_BALANCE, () => `${where0} step=${step} after open`);
          }
        } else if (state.position.state === 'open' && r.bool(0.12)) {
          state = requestAscent(state, t).state;
          assertStateInvariants(state, START_BALANCE, () => `${where0} step=${step} after ascent req`);
        }

        // Occasionally clear a settled position, as the client's 900 ms timer
        // would — the invariants must survive that transition too.
        if (state.position?.state === 'done' && r.bool(0.5)) {
          state = clearSettled(state).state;
          assertStateInvariants(state, START_BALANCE, () => `${where0} step=${step} after clear`);
        }

        const res = onTick(state, tick(t, v));
        state = res.state;
        assertStateInvariants(state, START_BALANCE, () => `${where0} step=${step} after tick`);

        for (const e of res.events) {
          if (e.kind === 'settled') {
            roundsWithSettlement++;
            if (e.settlement.reason === 'crush') crushes++;
            if (e.settlement.reason === 'ascent') ascents++;
            maxObservedLoss = Math.max(maxObservedLoss, -e.settlement.pnl);
            // PL-5, per position: the loss is at most the exact stake.
            expect(
              -e.settlement.pnl <= e.settlement.stake,
              `${where0} step=${step} loss exceeds stake`,
            ).toBe(true);
          }
        }
      }

      // RL-4: the round ends and anything still live auto-surfaces.
      t += TICK_MS;
      const end = settleAtRoundEnd(state, tick(t, v));
      state = end.state;
      assertStateInvariants(state, START_BALANCE, () => `${where0} step=end`);
      for (const e of end.events) {
        if (e.kind === 'settled') {
          roundEnds++;
          roundsWithSettlement++;
        }
      }

      // PL-5, across the whole round: the wallet never drops below
      // (start - total staked). Payouts are >= 0, so the worst case is every
      // position crushing, and the balance floor is exactly that.
      expect(
        state.wallet.balance >= START_BALANCE - totalStaked,
        `${caseLabel(PROPERTY_SEED, i, `balance=${state.wallet.balance} staked=${totalStaked}`)}`,
      ).toBe(true);
      expect(state.wallet.wagered, `${where0} wagered != total staked`).toBe(totalStaked);
    }

    // Coverage of the generated space: a property suite that never reached a
    // crush would be asserting PL-5 against rounds that cannot violate it.
    expect(roundsWithSettlement, 'no settlements generated').toBeGreaterThan(CASES.walk);
    expect(crushes, 'no crushes generated — PL-5 untested at its bound').toBeGreaterThan(100);
    expect(ascents, 'no ascent settlements generated').toBeGreaterThan(100);
    expect(roundEnds, 'no round-end settlements generated').toBeGreaterThan(50);
    expect(maxObservedLoss, 'a loss exceeded the maximum possible stake').toBeLessThanOrEqual(
      STAKE_MAX,
    );
  });

  it('LG-1: a forced crush-heavy walk still reconciles after every call', () => {
    // The walk above is generic. This one aims the index straight at the crush
    // line every round, so the settlement path most likely to lose a leg —
    // payout zero, escrow released, net debited — runs on nearly every case.
    for (let i = 0; i < 500; i++) {
      const r = caseRng(PROPERTY_SEED ^ 0x66, i);
      const dir = r.pick(DIRECTIONS);
      const lev = r.pick(LEVERAGES);
      const stake = r.int(STAKE_MIN, STAKE_MAX);
      const where = caseLabel(PROPERTY_SEED ^ 0x66, i, `dir=${dir} lev=${lev} stake=${stake}`);

      let state = initialState(cents(START_BALANCE));
      state = open(state, { dir, stake: cents(stake), lev, id: `c${i}` }, tick(0, I0)).state;
      assertStateInvariants(state, START_BALANCE, () => `${where} after open`);

      // Walk the index past the crush line — deliberately overshooting, so CR-5
      // (a gap tick far past the line still pays exactly zero) is exercised.
      const overshoot = r.float(1.0001, 3);
      const line = crushIndex(dir, lev, I0, THETA, TICK_S);
      const target = dir > 0 ? line / overshoot : line * overshoot;
      const res = onTick(state, tick(TICK_MS, target));
      state = res.state;
      assertStateInvariants(state, START_BALANCE, () => `${where} after crush tick`);

      const settled = res.events.find((e) => e.kind === 'settled');
      expect(settled, `${where} did not crush`).toBeDefined();
      if (settled?.kind === 'settled') {
        expect(settled.settlement.crushed, `${where} not marked crushed`).toBe(true);
        expect(settled.settlement.payout, `${where} crush paid out`).toBe(0);
        expect(settled.settlement.pnl, `${where} crush pnl`).toBe(-stake);
      }
      expect(state.wallet.balance, `${where} balance after crush`).toBe(START_BALANCE - stake);
      expect(state.wallet.net, `${where} net after crush`).toBe(-stake);
    }
  });
});

describe('LG-2 / float stress (property) — no NaN or Infinity reaches a money field', () => {
  it('LG-2: entries near I0 and far from it, at 25×, with large tau, stay finite and integral', () => {
    // The stress domain: entry values spanning nine orders of magnitude either
    // side of I0, the highest leverage, and tau far past the point at which
    // oxygen alone has taken the whole multiplier (1/theta = 400 s).
    const ENTRIES = [
      1e-6, 1e-3, 0.5, 1, 999.999_999, I0, 1000.000_001, 1e4, 1e7, 1e12, 1e15,
      Number.MIN_SAFE_INTEGER * -1,
    ];
    for (let i = 0; i < CASES.standard; i++) {
      const r = caseRng(PROPERTY_SEED ^ 0x77, i);
      const entry = r.bool(0.5) ? r.pick(ENTRIES) : r.float(1e-6, 1e9);
      const dir = r.pick(DIRECTIONS);
      const lev = r.pick(LEVERAGES);
      const stake = cents(r.int(STAKE_MIN, STAKE_MAX));
      // Ticks up to 8000 = 1000 s, well past 1/theta, so `1 - theta*tau` goes
      // strongly negative and the crush line crosses to the far side of I_e.
      const ticksElapsed = r.int(0, 8000);
      const tau = ticksElapsed * TICK_S;
      // The index at settlement: sometimes a near-identical neighbour of the
      // entry (the catastrophic-cancellation case), sometimes far away.
      const v = r.bool(0.5) ? entry * (1 + r.float(-1e-12, 1e-12)) : entry * r.float(0.01, 100);

      const where = caseLabel(
        PROPERTY_SEED ^ 0x77,
        i,
        `entry=${entry} v=${v} dir=${dir} lev=${lev} tau=${tau}`,
      );

      const m = multiplier(dir, lev, entry, v, THETA, tau);
      expect(Number.isNaN(m), `${where} multiplier NaN`).toBe(false);
      expect(Number.isFinite(m), `${where} multiplier non-finite`).toBe(true);

      const line = crushIndex(dir, lev, entry, THETA, tau);
      expect(Number.isFinite(line), `${where} crush line non-finite`).toBe(true);

      // The money field. `payoutFor` floors at M <= 0, so the only values that
      // reach `scaleCents` are positive and bounded by stake × M.
      const p = payoutFor(stake, m, DEFAULT_CONFIG);
      expect(Number.isSafeInteger(p), `${where} payout not a safe integer: ${p}`).toBe(true);
      expect(p >= 0, `${where} negative payout: ${p}`).toBe(true);
      const pnl = p - stake;
      expect(pnl >= -stake, `${where} pnl worse than -stake`).toBe(true);
    }
  });

  it('LG-2: an engine round driven to extreme index values keeps money finite', () => {
    // The same stress, but through the engine's own lifecycle rather than the
    // pure functions, so `settle`'s wallet arithmetic is included.
    for (let i = 0; i < 800; i++) {
      const r = caseRng(PROPERTY_SEED ^ 0x88, i);
      const entry = r.bool(0.5) ? r.float(1e-4, 1) : r.float(1e6, 1e12);
      const dir = r.pick(DIRECTIONS);
      const lev = r.pick(LEVERAGES);
      const stake = r.int(STAKE_MIN, STAKE_MAX);
      const where = caseLabel(PROPERTY_SEED ^ 0x88, i, `entry=${entry} dir=${dir} lev=${lev}`);

      let state = initialState(cents(START_BALANCE));
      state = open(state, { dir, stake: cents(stake), lev, id: `s${i}` }, tick(0, entry)).state;
      assertStateInvariants(state, START_BALANCE, () => `${where} after open`);

      state = requestAscent(state, 0).state;
      // A single enormous jump in the favourable direction: the max-win cap is
      // M1.6's job, so the payout here is legitimately huge — the property is
      // that it stays a safe integer rather than becoming Infinity.
      const v = dir > 0 ? entry * r.float(1, 5) : entry * r.float(0.2, 1);
      const res = onTick(state, tick(ASCENT_MS, v));
      state = res.state;
      assertStateInvariants(state, START_BALANCE, () => `${where} after settle`);
    }
  });

  it('LG-2: a subnormal or zero entry never yields a NaN payout through the engine', () => {
    // `v / entry` with entry = 0 is Infinity (or NaN when v is 0 too). The
    // engine must not turn that into a money value — the payout floor and
    // `roundHalfAwayFromZero`'s finite check are the two lines of defence.
    const stake = cents(1000);
    let nonFiniteSeen = 0;

    for (const entry of [0, -0, Number.MIN_VALUE]) {
      for (const v of [0, 1000, -1000]) {
        for (const dir of DIRECTIONS) {
          for (const lev of LEVERAGES) {
            const m = multiplier(dir, lev, entry, v, THETA, 1);
            const where = `entry=${entry} v=${v} dir=${dir} lev=${lev} m=${m}`;
            if (Number.isFinite(m)) continue;
            nonFiniteSeen++;

            // The property, stated exactly: a non-finite multiplier resolves to
            // one of two outcomes and never to a third. Either the M <= 0 floor
            // catches it and the payout is exactly zero (−Infinity), or the
            // conversion refuses it outright (+Infinity and NaN, the latter
            // because NaN fails `m <= 0` and falls through to `scaleCents`).
            // What must never happen is a NaN or Infinity *returned* as money.
            let outcome: 'zero' | 'threw' | 'poison';
            try {
              const p = payoutFor(stake, m, DEFAULT_CONFIG);
              outcome = p === 0 && Number.isSafeInteger(p) ? 'zero' : 'poison';
            } catch {
              outcome = 'threw';
            }
            expect(outcome, `${where} — non-finite M reached a money field`).not.toBe('poison');
          }
        }
      }
    }

    // The cases above must actually produce non-finite multipliers, or the
    // property is vacuous — a division that quietly returned 0 would pass.
    expect(nonFiniteSeen, 'no non-finite multiplier generated').toBeGreaterThan(0);
  });
});

describe('PL-4 (property) — the engine converts to money exactly once', () => {
  it('PL-4: the engine payout equals the criterion applied to the recorded multiplier', () => {
    // If settlement rounded twice — say, a rounded interim P&L then a rounded
    // payout — the result would differ from a single conversion on roughly one
    // case in four. Recomputing the criterion from the settlement's own
    // recorded `multiplier` and `stake` catches that.
    for (let i = 0; i < CASES.standard; i++) {
      const r = caseRng(PROPERTY_SEED ^ 0x99, i);
      const dir = r.pick(DIRECTIONS);
      const lev = r.pick(LEVERAGES);
      const stake = r.int(STAKE_MIN, STAKE_MAX);
      const where = caseLabel(PROPERTY_SEED ^ 0x99, i, `dir=${dir} lev=${lev} stake=${stake}`);

      let state = initialState(cents(START_BALANCE));
      state = open(state, { dir, stake: cents(stake), lev, id: `r${i}` }, tick(0, I0)).state;
      state = requestAscent(state, 0).state;

      // A value close enough to the entry that the payout lands near a half
      // cent often — where a double-rounding bug actually shows.
      const v = I0 * (1 + r.float(-0.05, 0.05));
      const res = onTick(state, tick(ASCENT_MS, v));
      const settled = res.events.find((e) => e.kind === 'settled');
      expect(settled, `${where} did not settle`).toBeDefined();
      if (settled?.kind !== 'settled') continue;
      const s = settled.settlement;

      // The recorded multiplier must be the one the position math produces for
      // this tick — one number, not a re-derivation.
      const p = res.state.position;
      expect(p, `${where} position missing`).not.toBeNull();
      if (p !== null) {
        expect(s.multiplier, `${where} multiplier drift`).toBe(
          positionMultiplier(p, v, TICK_S),
        );
      }

      // And the payout must be exactly PL-4 applied to it, once.
      const expected = s.multiplier <= 0 ? 0 : Math.sign(stake * s.multiplier) *
        Math.round(Math.abs(stake * s.multiplier));
      expect(s.payout, `${where} payout != single half-away-from-zero conversion`).toBe(
        expected === 0 ? 0 : expected,
      );
      expect(s.pnl, `${where} pnl != payout - stake`).toBe(s.payout - stake);
    }
  });
});
