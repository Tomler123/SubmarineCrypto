/**
 * Adversarial tests against `@crush/engine` — RUN 2 of the Phase 1.5 shakedown.
 *
 * The existing suite was written alongside the implementation, in the same
 * sitting, by the same author, so it encodes the same assumptions the code does.
 * Everything here is written from the *spec* instead: each expectation is
 * derived from the acceptance criteria or the game-logic document and then
 * compared against the engine, rather than read off the engine and asserted
 * back. Where a number could be obtained either way — the flat-market crush tick
 * most of all — it is computed from the criterion's own algebra.
 *
 * The cases target boundaries, orderings and lifecycle states the happy path
 * never reaches: the exact float boundary of the crush line under a crept τ,
 * simultaneous crush-and-ascent, terminal-state re-entrancy, and the full EN-8
 * precedence lattice rather than its adjacent pairs.
 */

import { describe, expect, it } from 'vitest';
import { cents } from '@crush/ledger';
import {
  DEFAULT_CONFIG,
  clearSettled,
  crushIndex,
  initialState,
  onTick,
  open as engineOpen,
  requestAscent,
  setLossLocked,
  settleAtRoundEnd,
} from '../src/index.js';
import type {
  Direction,
  EngineConfig,
  EngineEvent,
  EngineState,
  Leverage,
  Tick,
} from '../src/index.js';

const I0 = 1000;
const START_BALANCE = 100_000; // $1,000.00
const STAKE = 50_000; // $500.00

/** Isolate non-EN-4 adversarial math from the production notional gate. */
const open: typeof engineOpen = (state, req, at, config = DEFAULT_CONFIG) => engineOpen(
  state,
  req,
  at,
  { ...config, maxNotionalCents: cents(Number.MAX_SAFE_INTEGER) },
);

/** The v1 leverage set (EN-4, parameter sheet §12). */
const LEVERAGES: readonly Leverage[] = [2, 5, 10, 25];
const DIRECTIONS: readonly Direction[] = [1, -1];

/** θ = 0.25 %/s and 8 Hz ticks — the parameter sheet's values (PL-2). */
const THETA = DEFAULT_CONFIG.thetaPerSecond;
const TICK_S = DEFAULT_CONFIG.tickSeconds;
const ASCENT_MS = DEFAULT_CONFIG.ascentMs;

function tick(t: number, v: number): Tick {
  return { t, v };
}

function fresh(balance = START_BALANCE): EngineState {
  return initialState(cents(balance));
}

function kinds(events: readonly EngineEvent[]): string[] {
  return events.map((e) => e.kind);
}

/** Open a position and return the resulting state; fails loudly if rejected. */
function opened(
  state: EngineState,
  dir: Direction,
  lev: Leverage,
  at: Tick,
  stake = STAKE,
  config: EngineConfig = DEFAULT_CONFIG,
): EngineState {
  const r = open(state, { dir, stake: cents(stake), lev, id: 'p1' }, at, config);
  expect(kinds(r.events), 'setup: entry must be accepted').toContain('position-opened');
  return r.state;
}

/**
 * Drive `n` ticks of a perfectly flat index through the engine.
 * Returns the tick number that settled, so a test can name it.
 */
function runFlat(
  state: EngineState,
  n: number,
  v: number,
  config: EngineConfig,
): { readonly state: EngineState; readonly settledOnTick: number | null } {
  let s = state;
  for (let i = 1; i <= n; i++) {
    const r = onTick(s, tick(i * 1000, v), config);
    s = r.state;
    if (kinds(r.events).includes('settled')) return { state: s, settledOnTick: i };
  }
  return { state: s, settledOnTick: null };
}

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

// ---------------------------------------------------------------------------
// CR-1 — the crush boundary, driven through the engine rather than the predicate
// ---------------------------------------------------------------------------

/**
 * The existing CR-1 boundary tests call `isCrushed` directly on a hand-built
 * position. These drive the same boundary through `open` → `onTick`, which is
 * the path money actually takes: it exercises τ advancing inside `onTick`, the
 * settlement branch, and the wallet, none of which the predicate-level test
 * reaches. CR-1: "a tick exactly at the line MUST crush, and the tick one
 * representable step short of it MUST NOT — the outcome may not vary by
 * leverage."
 */
describe('CR-1 — the crush boundary through the full engine path', () => {
  /**
   * τ is advanced by `onTick` *before* the crush test (CR-6), so a position
   * opened at tick 0 and given `holdTicks` surviving ticks is evaluated at
   * τ = (holdTicks + 1) × 0.125 on the tick under test. The line must be
   * computed at that τ, not the entry τ — computing it at the wrong τ is the
   * CR-6 defect, and here it would silently make the boundary case a
   * non-boundary case.
   */
  function lineOnTestTick(dir: Direction, lev: Leverage, holdTicks: number): number {
    return crushIndex(dir, lev, I0, THETA, (holdTicks + 1) * TICK_S);
  }

  /**
   * Hold the position flat at its entry index for `holdTicks`, then deliver one
   * tick at `v`. Flat holding never crushes on its own at these τ (the line is
   * still far from I₀), so the settlement — or its absence — is attributable to
   * the final tick alone.
   */
  function holdThenProbe(
    dir: Direction,
    lev: Leverage,
    holdTicks: number,
    v: number,
  ): { readonly settled: boolean; readonly state: EngineState } {
    let s = opened(fresh(), dir, lev, tick(0, I0));
    for (let i = 1; i <= holdTicks; i++) {
      const r = onTick(s, tick(i * 125, I0));
      expect(r.events, `flat hold must not settle at lev ${lev} tick ${i}`).toEqual([]);
      s = r.state;
    }
    const r = onTick(s, tick((holdTicks + 1) * 125, v));
    return { settled: kinds(r.events).includes('settled'), state: r.state };
  }

  // τ = 0.125 s (the first tick) and τ = 80.125 s, where at 10× the line has
  // crept from 900 to ~920 — 20 index points, far beyond display precision.
  const HOLDS: readonly { readonly ticks: number; readonly label: string }[] = [
    { ticks: 0, label: 'tau = 0.125 s (first tick)' },
    { ticks: 640, label: 'tau = 80.125 s (line has crept measurably)' },
  ];

  it('CR-1: a tick exactly ON the line crushes, every direction x leverage x tau', () => {
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        for (const { ticks, label } of HOLDS) {
          const line = lineOnTestTick(dir, lev, ticks);
          const { settled, state } = holdThenProbe(dir, lev, ticks, line);
          expect(settled, `dir ${dir} lev ${lev} ${label}`).toBe(true);
          expect(state.position?.result?.reason, `dir ${dir} lev ${lev} ${label}`).toBe('crush');
        }
      }
    }
  });

  it('CR-1: one representable step short of the line does NOT crush, at any leverage', () => {
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        for (const { ticks, label } of HOLDS) {
          const line = lineOnTestTick(dir, lev, ticks);
          // A Surface survives just above its line; a Dive just below.
          const survivor = dir > 0 ? nextUp(line) : nextDown(line);
          const { settled, state } = holdThenProbe(dir, lev, ticks, survivor);
          expect(settled, `dir ${dir} lev ${lev} ${label}`).toBe(false);
          expect(state.position?.state, `dir ${dir} lev ${lev} ${label}`).toBe('open');
        }
      }
    }
  });

  it('CR-1: the on-line/one-step-short verdict pair is identical at every leverage', () => {
    // CR-1's "the outcome may not vary by leverage" stated as one assertion over
    // the whole grid: collect (onLine, oneShort) for each cell and require a
    // single distinct pair. A leverage-dependent boundary — the float-epsilon
    // defect a return to `M <= 0` would reintroduce — makes this set grow.
    const verdicts = new Set<string>();
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        for (const { ticks } of HOLDS) {
          const line = lineOnTestTick(dir, lev, ticks);
          const onLine = holdThenProbe(dir, lev, ticks, line).settled;
          const survivor = dir > 0 ? nextUp(line) : nextDown(line);
          const oneShort = holdThenProbe(dir, lev, ticks, survivor).settled;
          verdicts.add(`${String(onLine)}/${String(oneShort)}`);
        }
      }
    }
    expect(verdicts).toEqual(new Set(['true/false']));
  });

  it('CR-1/CR-3: the crept line is a strictly different number from the entry line', () => {
    // Guards the premise of the two tests above: if the line did not actually
    // creep, the "large tau" cells would be duplicates of the tau=0 cells and
    // the coverage claim would be false.
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        const atEntry = crushIndex(dir, lev, I0, THETA, 0);
        const crept = crushIndex(dir, lev, I0, THETA, 80.125);
        expect(Math.abs(crept - atEntry), `dir ${dir} lev ${lev}`).toBeGreaterThan(1);
        // The line creeps TOWARD the entry from whichever side it began (CR-3).
        expect(Math.abs(crept - I0)).toBeLessThan(Math.abs(atEntry - I0));
      }
    }
  });
});

// ---------------------------------------------------------------------------
// CR-4 — crush and a due ascent on the same tick
// ---------------------------------------------------------------------------

/**
 * CR-4: "Crush during ascent is possible and takes precedence over ascent
 * settlement on the same tick." The existing suite asserts this once, for a
 * Surface, with a tick comfortably past both thresholds. These assert it for
 * both directions, at every leverage, with the tick sitting *exactly* on the
 * ascent's settlement time and *exactly* on the crush line — the one arrangement
 * where an ordering mistake in `onTick` would be invisible to a looser test.
 */
describe('CR-4 — a crush and a due ascent landing on the SAME tick', () => {
  /**
   * Build the exact collision. `requestAscent` at t_r makes the ascent due at
   * t_r + 500 ms; that tick is delivered at exactly that time, carrying exactly
   * the crush line for the τ that tick will be evaluated at.
   */
  function collide(dir: Direction, lev: Leverage): EngineState {
    let s = opened(fresh(), dir, lev, tick(0, I0));
    const receivedT = 1_000;
    s = requestAscent(s, receivedT).state;
    expect(s.position?.state, 'setup: must be ascending').toBe('ascending');
    // The collision tick is this position's first tick, so tau = 0.125 s.
    const line = crushIndex(dir, lev, I0, THETA, TICK_S);
    const r = onTick(s, tick(receivedT + ASCENT_MS, line));
    return r.state;
  }

  it('CR-4: crush wins over a simultaneously-due ascent — both directions', () => {
    for (const dir of DIRECTIONS) {
      const s = collide(dir, 10);
      expect(s.position?.result?.reason, `dir ${dir}`).toBe('crush');
      expect(s.position?.result?.crushed, `dir ${dir}`).toBe(true);
    }
  });

  it('CR-4/CR-2: the simultaneous case still pays exactly zero, both directions', () => {
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        const s = collide(dir, lev);
        expect(s.position?.result?.payout, `dir ${dir} lev ${lev}`).toBe(0);
        expect(s.position?.result?.pnl, `dir ${dir} lev ${lev}`).toBe(-STAKE);
        // PL-5: the wallet is down exactly the stake, never more.
        expect(s.wallet.balance, `dir ${dir} lev ${lev}`).toBe(START_BALANCE - STAKE);
      }
    }
  });

  it('CR-4: the collision tick settles exactly once — one settled event, not two', () => {
    // An ordering bug that fell through the crush branch into the ascent branch
    // would double-settle and credit the wallet twice.
    for (const dir of DIRECTIONS) {
      let s = opened(fresh(), dir, 10, tick(0, I0));
      s = requestAscent(s, 1_000).state;
      const line = crushIndex(dir, 10, I0, THETA, TICK_S);
      const r = onTick(s, tick(1_000 + ASCENT_MS, line));
      expect(kinds(r.events), `dir ${dir}`).toEqual(['settled', 'wallet-changed']);
    }
  });

  it('CR-4: an ascent due on a tick one step SHORT of the line settles as ascent', () => {
    // The negative control for the three tests above: move the same collision
    // tick one representable step to the safe side and the ascent — not the
    // crush — must be what settles. Without this, "crush wins" could be passing
    // because the crush branch fires on every tick.
    for (const dir of DIRECTIONS) {
      let s = opened(fresh(), dir, 10, tick(0, I0));
      s = requestAscent(s, 1_000).state;
      const line = crushIndex(dir, 10, I0, THETA, TICK_S);
      const survivor = dir > 0 ? nextUp(line) : nextDown(line);
      const r = onTick(s, tick(1_000 + ASCENT_MS, survivor));
      expect(r.state.position?.result?.reason, `dir ${dir}`).toBe('ascent');
    }
  });
});

// ---------------------------------------------------------------------------
// CO-5 / RL-4 — round end against an ascending position, and re-entrancy
// ---------------------------------------------------------------------------

describe('CO-5 / RL-4 — round end while ascending, and called twice', () => {
  it('CO-5: an ascent not yet due settles as round-end at the final tick', () => {
    let s = opened(fresh(), 1, 10, tick(0, I0));
    s = onTick(s, tick(125, I0)).state;
    s = requestAscent(s, 89_900).state; // due at 90_400 — after the final tick
    expect(s.position?.state).toBe('ascending');
    expect(s.position?.resolveT).toBe(90_400);

    const r = settleAtRoundEnd(s, tick(90_000, 1_010));
    expect(r.state.position?.result?.reason).toBe('round-end');
    // RL-4: "no penalty and no fee" — the multiplier is the ordinary one at the
    // final tick, so this is the same money an ascent settling there would pay.
    // tau = 0.125 s (one onTick), M = 1 + 10 x 0.01 - 0.0025 x 0.125 = 1.0996875
    // -> 50000 x 1.0996875 = 54984.375 -> 54984 half away from zero.
    expect(r.state.position?.result?.payout).toBe(54_984);
  });

  it('CO-5: the ascending position settles under RL-4 even before its resolveT', () => {
    // The engine must not require the ascent to be due; CO-5 is precisely the
    // case where it never becomes due.
    let s = opened(fresh(), -1, 25, tick(0, I0));
    s = requestAscent(s, 89_999).state;
    const r = settleAtRoundEnd(s, tick(90_000, 995));
    expect(kinds(r.events)).toEqual(['settled', 'wallet-changed']);
    expect(r.state.position?.result?.reason).toBe('round-end');
    expect(r.state.position?.state).toBe('done');
  });

  it('RL-4: a second settleAtRoundEnd on the same position is a no-op', () => {
    // Two round-end calls must not pay twice. The guard is `state === done`, so
    // this is the test that a double round-end cannot double-credit the wallet.
    let s = opened(fresh(), 1, 10, tick(0, I0));
    s = onTick(s, tick(125, I0)).state;

    const first = settleAtRoundEnd(s, tick(90_000, 1_020));
    expect(kinds(first.events)).toEqual(['settled', 'wallet-changed']);
    const afterFirst = first.state;

    const second = settleAtRoundEnd(afterFirst, tick(90_000, 1_020));
    expect(second.events).toEqual([]);
    expect(second.state).toBe(afterFirst); // same object: nothing was rebuilt
    expect(second.state.wallet).toEqual(afterFirst.wallet);
  });

  it('RL-4: a second settleAtRoundEnd at a DIFFERENT tick cannot revise the result', () => {
    // The dangerous variant: the second call carries a much better price. If the
    // done-guard were missing, this would overwrite a settled result with a more
    // generous one and credit the wallet again.
    let s = opened(fresh(), 1, 10, tick(0, I0));
    s = onTick(s, tick(125, I0)).state;
    const settled = settleAtRoundEnd(s, tick(90_000, 1_020)).state;
    const payout = settled.position?.result?.payout;
    const balance = settled.wallet.balance;

    const again = settleAtRoundEnd(settled, tick(90_125, 1_500));
    expect(again.events).toEqual([]);
    expect(again.state.position?.result?.payout).toBe(payout);
    expect(again.state.wallet.balance).toBe(balance);
  });

  it('RL-4: round end after a crush neither pays nor re-settles', () => {
    const s = opened(fresh(), 1, 10, tick(0, I0));
    const crushed = onTick(s, tick(125, 500)).state;
    expect(crushed.position?.result?.reason).toBe('crush');
    const after = settleAtRoundEnd(crushed, tick(90_000, 2_000));
    expect(after.events).toEqual([]);
    expect(after.state.wallet.balance).toBe(START_BALANCE - STAKE);
  });
});

// ---------------------------------------------------------------------------
// Terminal-state re-entrancy — every entry point against a state it must ignore
// ---------------------------------------------------------------------------

/**
 * Each engine entry point has one state in which it must do nothing. The suite
 * tests some of these; this covers all of them uniformly and asserts the strong
 * form — zero events *and* the identical state object, which proves no new
 * object was built and therefore that no field was quietly rewritten.
 */
describe('Terminal-state re-entrancy — no-ops emit nothing and rebuild nothing', () => {
  /** A state whose position is `done` via a crush. */
  function doneState(): EngineState {
    const s = opened(fresh(), 1, 10, tick(0, I0));
    const r = onTick(s, tick(125, 500));
    expect(r.state.position?.state, 'setup: must be done').toBe('done');
    return r.state;
  }

  it('CR-1: onTick after a position is done is a no-op with zero events', () => {
    const done = doneState();
    for (const v of [500, 1_000, 5_000]) {
      const r = onTick(done, tick(10_000, v));
      expect(r.events, `v ${v}`).toEqual([]);
      expect(r.state, `v ${v}`).toBe(done);
    }
  });

  it('CR-1: onTick after done does not advance tau on the settled position', () => {
    // A tau advance on a done position would corrupt the retained settlement
    // record LG-4 requires — the tau in the record must be the tau it settled at.
    const done = doneState();
    const tauAtSettle = done.position?.result?.tau;
    const ticksAtSettle = done.position?.ticksElapsed;
    const after = onTick(done, tick(10_000, 900)).state;
    expect(after.position?.ticksElapsed).toBe(ticksAtSettle);
    expect(after.position?.result?.tau).toBe(tauAtSettle);
  });

  it('CO-3: requestAscent on a done position is a no-op with zero events', () => {
    const done = doneState();
    const r = requestAscent(done, 50_000);
    expect(r.events).toEqual([]);
    expect(r.state).toBe(done);
    // The settled position must not acquire a resolveT after the fact.
    expect(r.state.position?.state).toBe('done');
    expect(r.state.position?.resolveT).toBe(done.position?.resolveT);
  });

  it('CO-3: requestAscent on an already-ascending position is idempotent', () => {
    let s = opened(fresh(), 1, 10, tick(0, I0));
    s = requestAscent(s, 1_000).state;
    const firstResolveT = s.position?.resolveT;
    // A second request 400 ms later must NOT extend or reset the ascent — that
    // would let a player restart the Blow to dodge a bad tick (CO-2/CO-3).
    const r = requestAscent(s, 1_400);
    expect(r.events).toEqual([]);
    expect(r.state).toBe(s);
    expect(r.state.position?.resolveT).toBe(firstResolveT);
  });

  it('M1.3: clearSettled on an OPEN position is a no-op with zero events', () => {
    const s = opened(fresh(), 1, 10, tick(0, I0));
    const r = clearSettled(s);
    expect(r.events).toEqual([]);
    expect(r.state).toBe(s);
    expect(r.state.position?.state).toBe('open');
  });

  it('M1.3: clearSettled on an ASCENDING position is a no-op — the Blow is not cancellable', () => {
    // CO-2: ascent is irrevocable. If `clearSettled` dropped an ascending
    // position it would become a cancel path, and the stake would vanish with
    // neither a settlement nor a refund.
    let s = opened(fresh(), 1, 10, tick(0, I0));
    s = requestAscent(s, 1_000).state;
    const r = clearSettled(s);
    expect(r.events).toEqual([]);
    expect(r.state).toBe(s);
    expect(r.state.position?.state).toBe('ascending');
  });

  it('M1.3: clearSettled twice is a no-op the second time', () => {
    const done = doneState();
    const first = clearSettled(done);
    expect(first.state.position).toBeNull();
    const second = clearSettled(first.state);
    expect(second.events).toEqual([]);
    expect(second.state).toBe(first.state);
  });

  it('M1.3: every no-op path leaves the wallet byte-identical', () => {
    const done = doneState();
    const wallet = done.wallet;
    for (const next of [
      onTick(done, tick(10_000, 2_000)).state,
      requestAscent(done, 10_000).state,
      settleAtRoundEnd(done, tick(10_000, 2_000)).state,
      clearSettled(clearSettled(done).state).state,
    ]) {
      expect(next.wallet).toEqual(wallet);
    }
  });
});

// ---------------------------------------------------------------------------
// CR-5 / PL-5 — gap ticks far past the line
// ---------------------------------------------------------------------------

describe('CR-5 / PL-5 — a gap tick far past the crush line', () => {
  /**
   * CR-5: "A gap tick that jumps far beyond the crush line still settles at
   * exactly 0 (never negative)." Driven here at every direction x leverage and
   * at gaps out to the degenerate ends of the index range, because the criterion
   * is unconditional — FI-3's clamp bounds the gap in production, but the payout
   * floor must guarantee it regardless of whether the clamp held.
   */
  const GAPS = new Map<Direction, readonly number[]>([
    [1, [500, 1, 1e-6, Number.MIN_VALUE]],
    [-1, [2_000, 1e6, 1e12, Number.MAX_SAFE_INTEGER]],
  ]);

  it('CR-5: payout is exactly ZERO for every direction x leverage x gap size', () => {
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        for (const v of GAPS.get(dir) ?? []) {
          const s = opened(fresh(), dir, lev, tick(0, I0));
          const r = onTick(s, tick(125, v));
          const result = r.state.position?.result;
          const where = `dir ${dir} lev ${lev} v ${v}`;
          expect(result?.reason, where).toBe('crush');
          // Exactly zero, and an integer zero — not -0, not 0.0000001.
          expect(result?.payout, where).toBe(0);
          expect(Object.is(result?.payout, 0), `${where}: payout must not be -0`).toBe(true);
          expect(Number.isInteger(result?.payout), where).toBe(true);
        }
      }
    }
  });

  it('PL-5: the wallet never goes negative and never loses more than the stake', () => {
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        for (const v of GAPS.get(dir) ?? []) {
          // Stake the ENTIRE balance, so "never negative" is a live constraint
          // rather than one absorbed by leftover funds.
          const s = opened(fresh(), dir, lev, tick(0, I0), START_BALANCE);
          const r = onTick(s, tick(125, v));
          const where = `dir ${dir} lev ${lev} v ${v}`;
          expect(r.state.wallet.balance, where).toBe(0);
          expect(r.state.wallet.balance, where).toBeGreaterThanOrEqual(0);
          expect(r.state.position?.result?.pnl, where).toBe(-START_BALANCE);
          expect(r.state.wallet.net, where).toBe(-START_BALANCE);
        }
      }
    }
  });

  it('CR-5/LG-4: the true multiplier is retained even though payout is floored', () => {
    // The record must show how far past the line the tick landed (LG-4), while
    // the money says zero (CR-2). A settlement that clamped the multiplier too
    // would destroy the audit trail.
    const s = opened(fresh(), 1, 25, tick(0, I0));
    const r = onTick(s, tick(125, 1));
    const result = r.state.position?.result;
    expect(result?.payout).toBe(0);
    expect(result?.multiplier).toBeLessThan(-20);
    expect(Number.isFinite(result?.multiplier)).toBe(true);
  });

  it('PL-5: an extreme LOSING gap produces no NaN or Infinity in the money path', () => {
    // Each direction is probed with a gap on its own losing side, so every case
    // here genuinely crushes. (The winning-side extreme is a different scenario
    // entirely — see the max-win test below.)
    for (const dir of DIRECTIONS) {
      for (const v of GAPS.get(dir) ?? []) {
        const s = opened(fresh(), dir, 25, tick(0, I0));
        const r = onTick(s, tick(125, v));
        const result = r.state.position?.result;
        const where = `dir ${dir} v ${v}`;
        expect(result?.reason, where).toBe('crush');
        expect(Number.isInteger(result?.payout), where).toBe(true);
        expect(Number.isInteger(result?.pnl), where).toBe(true);
        expect(Number.isInteger(r.state.wallet.balance), where).toBe(true);
        expect(Number.isInteger(r.state.wallet.net), where).toBe(true);
      }
    }
  });

  it('AO-5: an extreme winning gap starts max-win ascent without immediate settlement', () => {
    // The mirror of CR-5, and the reason the gap lists above are per-direction:
    // a Surface at v = MAX_SAFE_INTEGER has gapped enormously in its favour, so
    // it must enter the normal 500 ms ascent instead of settling on this tick.
    const s = opened(fresh(), 1, 25, tick(0, I0));
    const r = onTick(s, tick(125, Number.MAX_SAFE_INTEGER));
    expect(kinds(r.events)).toEqual(['ascent-started']);
    expect(r.state.position?.state).toBe('ascending');
    expect(r.state.position?.ascentCause).toBe('max-win');
    expect(r.state.position?.result).toBeUndefined();
    expect(r.state.lastResult).toBeNull();
  });

  /**
   * A settlement whose payout exceeds the safe-integer range throws `MoneyError`
   * from `cents()` — the documented fail-fast boundary in `@crush/ledger`
   * ("Throws on floats, NaN, Infinity, and values beyond 2^53−1").
   *
   * This is recorded, not asserted as desirable. It is unreachable in production
   * for two independent reasons: FI-3 clamps a tick to ±3.5σ so the index cannot
   * gap this far, and the parameter sheet's max win (50× and $10,000) caps the
   * payout far below the safe range. Both of those live in **RK / AO, which
   * M1.5 builds** — until then the ledger's throw is the only thing standing
   * between an absurd tick and a silently wrong balance, and a throw is the
   * right failure mode: it cannot produce money that does not exist.
   *
   * When M1.5 lands the win cap, this test should be replaced by one asserting
   * the payout is capped rather than thrown on.
   */
  it('PL-5/LG-2: an unrepresentable payout throws rather than producing bad money', () => {
    const s = opened(fresh(), 1, 25, tick(0, I0));
    const gapped = onTick(s, tick(125, Number.MAX_SAFE_INTEGER)).state;
    expect(() => settleAtRoundEnd(gapped, tick(250, Number.MAX_SAFE_INTEGER))).toThrowError(
      /not integer minor units/,
    );
    // The throw leaves the caller's state untouched — no partial credit.
    expect(gapped.wallet.balance).toBe(START_BALANCE - STAKE);
  });
});

// ---------------------------------------------------------------------------
// PL-1 — M is EXACTLY 1 when I_t == I_e
// ---------------------------------------------------------------------------

describe('PL-1 — entry at a tick where I_t == I_e exactly', () => {
  it('PL-1: M is exactly 1 at the entry tick — not 0.9999…', () => {
    // The entry tick is tick 0, so tau = 0 and the oxygen term vanishes (PL-1).
    // Settling right there must return the stake to the cent.
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        for (const entry of [I0, 1_000.000_000_1, 0.000_1, 98_765.432_1]) {
          const s = opened(fresh(), dir, lev, tick(0, entry));
          const r = settleAtRoundEnd(s, tick(0, entry));
          const result = r.state.position?.result;
          const where = `dir ${dir} lev ${lev} entry ${entry}`;
          // Exact equality, not toBeCloseTo: an M of 0.9999999999999998 would
          // round to the same cents here and hide the defect at a larger stake.
          expect(result?.multiplier, where).toBe(1);
          expect(result?.tau, where).toBe(0);
          expect(result?.payout, where).toBe(STAKE);
          expect(result?.pnl, where).toBe(0);
          expect(r.state.wallet.balance, where).toBe(START_BALANCE);
        }
      }
    }
  });

  it('PL-1: M is exactly 1 - theta*tau when the index returns to I_e later', () => {
    // The price term must vanish exactly at I_t == I_e for any tau, leaving the
    // oxygen term alone. If (v/entry - 1) did not cancel exactly, the residue
    // would scale with leverage and show up here at 25x.
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        let s = opened(fresh(), dir, lev, tick(0, I0));
        // Wander away and come back, so the equality is not trivially preserved.
        s = onTick(s, tick(125, 1_005)).state;
        s = onTick(s, tick(250, 995)).state;
        s = onTick(s, tick(375, I0)).state;
        const r = settleAtRoundEnd(s, tick(375, I0));
        // tau = 3 x 0.125 = 0.375 s.
        expect(r.state.position?.result?.tau, `dir ${dir} lev ${lev}`).toBe(0.375);
        expect(r.state.position?.result?.multiplier, `dir ${dir} lev ${lev}`).toBe(
          1 - THETA * 0.375,
        );
      }
    }
  });

  it('PL-1: an entry priced at I_e settles for the stake at EVERY leverage', () => {
    // Leverage multiplies a zero price move, so it must not appear in the
    // result at all. A residual epsilon times 25 is what this would catch.
    const payouts = new Set<number | undefined>();
    for (const lev of LEVERAGES) {
      const s = opened(fresh(), 1, lev, tick(0, I0));
      payouts.add(settleAtRoundEnd(s, tick(0, I0)).state.position?.result?.payout);
    }
    expect(payouts).toEqual(new Set([STAKE]));
  });
});

// ---------------------------------------------------------------------------
// CR-1 / PL-1 — oxygen alone crushes a perfectly flat position
// ---------------------------------------------------------------------------

/**
 * The crush tick here is derived from the spec, not from the engine.
 *
 * CR-1 crushes at the first tick where `I_t ≤ I_crush(τ)` (Surface). With the
 * index perfectly flat at `I_e`, substituting CR-3's line:
 *
 *     I_e ≤ I_e·(1 − d·(1 − θτ)/L)
 *
 * For Surface (d = +1) this reduces to `(1 − θτ)/L ≤ 0`; for Dive (d = −1) the
 * comparison and the sign both flip and it reduces to the same thing. `L > 0`,
 * so in both cases the condition is `1 − θτ ≤ 0`, i.e. **τ ≥ 1/θ** — independent
 * of both direction and leverage, which is the interesting part.
 *
 * τ = ticksElapsed × tickSeconds (PL-1), and `onTick` advances τ before testing,
 * so the crush lands on tick number `ceil((1/θ) / tickSeconds)`.
 *
 * At the parameter sheet's θ = 0.25 %/s that is 1/0.0025 = 400 s = tick 3200 —
 * beyond a 90 s round, so the case is unreachable in play but is exactly where
 * the formula must still hold. The faster θ values below reach it inside a round
 * and prove the general formula rather than one arithmetic coincidence.
 */
describe('CR-1 / PL-1 — theta*tau alone crushes a flat position', () => {
  /** The spec's answer: first tick n with n × tickSeconds ≥ 1/θ. */
  function specCrushTick(theta: number, tickSeconds: number): number {
    return Math.ceil(1 / theta / tickSeconds);
  }

  const THETAS: readonly number[] = [0.05, 0.02, 0.0125];

  it('CR-1: a flat position crushes on exactly the spec-derived tick', () => {
    for (const theta of THETAS) {
      const config: EngineConfig = { ...DEFAULT_CONFIG, thetaPerSecond: theta };
      const expectedTick = specCrushTick(theta, config.tickSeconds);
      for (const dir of DIRECTIONS) {
        for (const lev of LEVERAGES) {
          const s = opened(fresh(), dir, lev, tick(0, I0), STAKE, config);
          const { settledOnTick } = runFlat(s, expectedTick + 5, I0, config);
          expect(settledOnTick, `theta ${theta} dir ${dir} lev ${lev}`).toBe(expectedTick);
        }
      }
    }
  });

  it('CR-1: the flat-market crush tick does not vary with direction or leverage', () => {
    // The reduction above eliminates both L and d. If the implementation ever
    // reintroduced either — e.g. by testing `M <= 0` at large tau, where the
    // float residue is leverage-scaled — this set would grow past one element.
    const config: EngineConfig = { ...DEFAULT_CONFIG, thetaPerSecond: 0.05 };
    const ticks = new Set<number | null>();
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        const s = opened(fresh(), dir, lev, tick(0, I0), STAKE, config);
        ticks.add(runFlat(s, 200, I0, config).settledOnTick);
      }
    }
    expect(ticks).toEqual(new Set([specCrushTick(0.05, config.tickSeconds)]));
  });

  it('CR-1: the tick BEFORE the spec-derived crush tick leaves the position open', () => {
    const config: EngineConfig = { ...DEFAULT_CONFIG, thetaPerSecond: 0.05 };
    const n = specCrushTick(0.05, config.tickSeconds);
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        const s = opened(fresh(), dir, lev, tick(0, I0), STAKE, config);
        const before = runFlat(s, n - 1, I0, config);
        expect(before.settledOnTick, `dir ${dir} lev ${lev}`).toBeNull();
        expect(before.state.position?.state, `dir ${dir} lev ${lev}`).toBe('open');
        expect(before.state.position?.ticksElapsed, `dir ${dir} lev ${lev}`).toBe(n - 1);
      }
    }
  });

  it('CR-1/CR-2: the oxygen crush pays zero — the house edge, not a price move', () => {
    const config: EngineConfig = { ...DEFAULT_CONFIG, thetaPerSecond: 0.05 };
    const s = opened(fresh(), 1, 10, tick(0, I0), STAKE, config);
    const { state } = runFlat(s, 300, I0, config);
    const result = state.position?.result;
    expect(result?.reason).toBe('crush');
    expect(result?.payout).toBe(0);
    // The multiplier at the crush is exactly zero here: the price term is zero
    // and theta x tau is exactly 1, so this is the M = 0 boundary itself.
    expect(result?.multiplier).toBe(0);
    expect(result?.tau).toBe(1 / config.thetaPerSecond);
  });

  it('PL-1: at the parameter sheet theta the flat crush is tick 3200 — beyond a round', () => {
    // 1/0.0025 = 400 s = 3200 ticks, against a 90 s (720 tick) round. Asserted
    // so a future theta change that brings the oxygen crush INSIDE a round —
    // a materially different game — cannot land silently.
    const n = specCrushTick(THETA, TICK_S);
    expect(n).toBe(3_200);
    expect(n * TICK_S).toBe(400);
    const ticksPerRound = 90 / TICK_S;
    expect(n).toBeGreaterThan(ticksPerRound);

    // And it really does crush there, at the sheet's own theta.
    const s = opened(fresh(), 1, 10, tick(0, I0));
    const { settledOnTick } = runFlat(s, n + 2, I0, DEFAULT_CONFIG);
    expect(settledOnTick).toBe(n);
  });
});

// ---------------------------------------------------------------------------
// EN-8 — the full precedence lattice
// ---------------------------------------------------------------------------

/**
 * EN-8: "hold every condition from a given rank downward simultaneously and
 * assert the higher-ranked code is returned. Every rejection leaves the wallet
 * untouched regardless of rank."
 *
 * The existing tests walk adjacent pairs. This builds the whole lattice: for
 * every rank, every *subset* of the lower-ranked conditions is held alongside
 * it, so a mis-ordering that only shows up in a particular combination — say
 * ENTRY_CLOSED checked after INSUFFICIENT_BALANCE but before POSITION_OPEN —
 * cannot slip through.
 */
describe('EN-8 — rejection precedence across the full condition lattice', () => {
  const RANKS = [
    'LOSS_LIMIT_REACHED',
    'ENTRY_CLOSED',
    'POSITION_OPEN',
    'COOLING_OFF',
    'INSUFFICIENT_BALANCE',
    'NO_PRICE',
  ] as const;

  type Condition = (typeof RANKS)[number];

  /**
   * Build a state + request + tick holding exactly `conditions` and nothing
   * else. Balance is generous unless INSUFFICIENT_BALANCE is being held, and a
   * position is opened (and left open) only when POSITION_OPEN is.
   */
  function scenario(conditions: readonly Condition[]): {
    readonly state: EngineState;
    readonly at: Tick | null;
    readonly entryOpen: boolean;
  } {
    const holds = new Set<Condition>(conditions);
    // A big balance so the entry is affordable unless we deliberately starve it.
    let state = fresh(holds.has('INSUFFICIENT_BALANCE') ? STAKE - 1 : START_BALANCE * 10);
    if (holds.has('COOLING_OFF')) {
      const prior = open(
        fresh(START_BALANCE),
        { dir: 1, stake: cents(50), lev: 10, id: 'prior' },
        tick(0, I0),
      ).state;
      const settled = settleAtRoundEnd(prior, tick(100, I0)).state;
      // Keep the scenario's wallet controls; only the authoritative prior
      // settlement is needed to hold COOLING_OFF.
      state = { ...state, lastResult: settled.lastResult };
    }
    if (holds.has('POSITION_OPEN')) {
      // Graft a valid live position so POSITION_OPEN can be tested together
      // with the otherwise mutually exclusive post-settlement cooldown state.
      const live = open(
        fresh(START_BALANCE),
        { dir: 1, stake: cents(50), lev: 10, id: 'held' },
        tick(0, I0),
      ).state.position;
      state = { ...state, position: live };
      expect(state.position?.state).toBe('open');
    }
    if (holds.has('LOSS_LIMIT_REACHED')) {
      state = setLossLocked(state, true);
    }
    return {
      state,
      at: holds.has('NO_PRICE') ? null : tick(holds.has('COOLING_OFF') ? 125 : 1_025, I0),
      entryOpen: !holds.has('ENTRY_CLOSED'),
    };
  }

  /** Every subset of `items`, as arrays. */
  function subsets<T>(items: readonly T[]): T[][] {
    return items.reduce<T[][]>((acc, item) => [...acc, ...acc.map((s) => [...s, item])], [[]]);
  }

  /** Every (rank, held-subset-of-lower-ranks) pair — the whole lattice. */
  function lattice(): { readonly rank: Condition; readonly conditions: Condition[] }[] {
    const out: { rank: Condition; conditions: Condition[] }[] = [];
    for (let i = 0; i < RANKS.length; i++) {
      const rank = RANKS[i] as Condition;
      for (const held of subsets(RANKS.slice(i + 1) as readonly Condition[])) {
        const conditions = [rank, ...held];
        // NO_PRICE has no candidate authoritative timestamp, so EN-10 cannot
        // simultaneously determine that timestamp is inside cooldown.
        if (conditions.includes('COOLING_OFF') && conditions.includes('NO_PRICE')) continue;
        out.push({ rank, conditions });
      }
    }
    return out;
  }

  it('EN-8: for every rank, every combination of lower ranks yields the higher code', () => {
    const cells = lattice();
    for (const { rank, conditions } of cells) {
      const { state, at, entryOpen } = scenario(conditions);
      const r = open(state, { dir: 1, stake: cents(STAKE), lev: 10, id: 'probe', entryOpen }, at);
      expect(r.events, `holding ${conditions.join(' + ')}`).toEqual([
        { kind: 'open-rejected', code: rank },
      ]);
    }
    // 47 reachable combinations across six ranks, not merely adjacent pairs.
    expect(cells.length).toBe(47);
  });

  it('EN-8: every rejection in the lattice leaves the wallet byte-identical', () => {
    for (const { conditions } of lattice()) {
      const { state, at, entryOpen } = scenario(conditions);
      const before = state.wallet;
      const r = open(state, { dir: 1, stake: cents(STAKE), lev: 10, id: 'probe', entryOpen }, at);
      expect(r.state.wallet, `holding ${conditions.join(' + ')}`).toEqual(before);
    }
  });

  it('EN-8: a rejection never creates, replaces or disturbs a position', () => {
    for (const { conditions } of lattice()) {
      const { state, at, entryOpen } = scenario(conditions);
      const before = state.position;
      const r = open(state, { dir: 1, stake: cents(STAKE), lev: 10, id: 'probe', entryOpen }, at);
      expect(r.state.position, `holding ${conditions.join(' + ')}`).toBe(before);
    }
  });

  it('EN-8/RP-2: a loss-locked player is never told to add funds, in any combination', () => {
    // The specific defect EN-8 calls out by name, asserted across the whole
    // lower lattice rather than at one point.
    for (const { rank, conditions } of lattice()) {
      if (rank !== 'LOSS_LIMIT_REACHED') continue;
      const { state, at, entryOpen } = scenario(conditions);
      const r = open(state, { dir: 1, stake: cents(STAKE), lev: 10, id: 'probe', entryOpen }, at);
      const event = r.events[0];
      const code = event?.kind === 'open-rejected' ? event.code : null;
      expect(code, `holding ${conditions.join(' + ')}`).not.toBe('INSUFFICIENT_BALANCE');
      expect(code).toBe('LOSS_LIMIT_REACHED');
    }
  });

  it('EN-8: with NO condition held the entry is accepted — the lattice has a floor', () => {
    // Guards the scenario builder: if `scenario` accidentally held a condition
    // permanently, every assertion above would pass vacuously.
    const { state, at, entryOpen } = scenario([]);
    const r = open(state, { dir: 1, stake: cents(STAKE), lev: 10, id: 'probe', entryOpen }, at);
    expect(kinds(r.events)).toEqual(['position-opened', 'wallet-changed']);
  });

  it('EN-8/EN-10: a settled-but-uncleared position does not block entry after cooldown', () => {
    // EN-5's "resolves on its own" — the guard is `state !== done`, so a done
    // position awaiting clearSettled must not block the next entry once the
    // authoritative 900 ms cooldown has elapsed.
    let s = opened(fresh(), 1, 10, tick(0, I0));
    s = onTick(s, tick(125, 500)).state; // crushed, still present as `done`
    expect(s.position?.state).toBe('done');
    const r = open(s, { dir: 1, stake: cents(1_000), lev: 10, id: 'p2' }, tick(1_025, I0));
    expect(kinds(r.events)).toEqual(['position-opened', 'wallet-changed']);
  });
});
