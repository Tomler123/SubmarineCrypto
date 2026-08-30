/**
 * CR-6b — τ-alignment of auto-order triggers.
 *
 * CR-6b: "a take-profit, stop-loss or max-win trigger evaluated at tick *n* MUST
 * be evaluated against `M_t` at the same τ the crush line at tick *n* is tested
 * against and the multiplier displayed at tick *n* is drawn from... A trigger
 * evaluated against a stale multiplier (τ=n−1 while the crush line is at τ=n) is
 * the same defect class as the CR-6 crush-line drift and carries the same
 * severity: a release blocker."
 *
 * These tests assert the foundation of the M1.5 trigger implementation: that the
 * τ visible at the auto-order slot's position in the tick sequence is this
 * tick's τ, not the previous tick's, and that it is the *same* τ the crush check
 * immediately above it and the settlement immediately below it use. The probe
 * is `observedTau` — the τ carried by the position the engine hands forward from
 * a tick — because that object is precisely what each trigger reads.
 */

import { describe, expect, it } from 'vitest';
import { cents } from '@crush/ledger';
import {
  DEFAULT_CONFIG,
  initialState,
  onTick,
  open,
  positionCrushIndex,
  positionMultiplier,
  requestAscent,
  tauOf,
} from '../src/index.js';
import type {
  Direction,
  EngineConfig,
  EngineState,
  Leverage,
  Position,
  Tick,
} from '../src/index.js';

const I0 = 1000;
const START_BALANCE = 10_000_000;
const STAKE = 5_000;
const TICK_MS = 125;
/** 90 s at 8 Hz (RL-2, parameter sheet §12). */
const ROUND_TICKS = 720;
const LEVERAGES: readonly Leverage[] = [2, 5, 10, 25];
const DIRECTIONS: readonly Direction[] = [1, -1];
const CONFIG: EngineConfig = DEFAULT_CONFIG;

function tick(t: number, v: number): Tick {
  return { t, v };
}

/**
 * A deterministic price series that stays inside every leverage's crush band,
 * so a position survives the whole round and every tick is observable. A drift
 * plus two incommensurable sinusoids: no RNG, and no periodicity that could
 * align with the tick grid and hide a one-tick error.
 */
function priceAt(n: number): number {
  return I0 * (1 + 0.004 * Math.sin(n / 37) + 0.002 * Math.sin(n / 11.3));
}

function openPosition(dir: Direction, lev: Leverage): EngineState {
  const state = initialState(cents(START_BALANCE));
  return open(state, { dir, stake: cents(STAKE), lev, id: 'ao' }, tick(0, I0), CONFIG).state;
}

/**
 * The τ an auto-order trigger would see at the slot CR-1 places it in.
 *
 * The slot sits between the crush check and the ascent settlement, and all
 * three read the same `Position` object — the one `onTick` advances at the top
 * of the tick. So the τ observable on the position the engine carries forward
 * is exactly the τ the trigger will be evaluated at.
 */
function observedTau(p: Position): number {
  return tauOf(p, CONFIG.tickSeconds);
}

/** The multiplier a trigger at tick n would compare against its threshold. */
function triggerWouldFireAt(p: Position, v: number, threshold: number): boolean {
  return positionMultiplier(p, v, CONFIG.tickSeconds) >= threshold;
}

describe('CR-6b — the auto-order slot sees this tick τ, never the previous tick', () => {
  it('CR-6b: τ at the slot is exactly tick-count × tickSeconds on every tick of a round', () => {
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        let state = openPosition(dir, lev);
        for (let n = 1; n <= ROUND_TICKS; n++) {
          state = onTick(state, tick(n * TICK_MS, priceAt(n)), CONFIG).state;
          const p = state.position;
          if (p === null || p.state === 'done') {
            throw new Error(`position ended early at tick ${n} (dir=${dir} lev=${lev})`);
          }
          // The entry tick is tick 0, so the nth delivered tick is τ = n × 0.125.
          expect(p.ticksElapsed, `dir=${dir} lev=${lev} tick=${n}`).toBe(n);
          expect(observedTau(p), `dir=${dir} lev=${lev} tick=${n} tau`).toBe(
            n * CONFIG.tickSeconds,
          );
        }
      }
    }
  });

  it('CR-6b: the trigger multiplier and the crush line at tick n share one τ', () => {
    // The criterion itself: the number a trigger would test and the number the
    // crush check tests are computed from the same position at the same τ. If
    // the τ advance moved below the crush check, or the slot read a stale
    // position, these would differ by exactly one tick of oxygen.
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        let state = openPosition(dir, lev);
        for (let n = 1; n <= ROUND_TICKS; n++) {
          const v = priceAt(n);
          state = onTick(state, tick(n * TICK_MS, v), CONFIG).state;
          const p = state.position;
          if (p === null) throw new Error('position vanished');

          const tau = observedTau(p);
          const where = `dir=${dir} lev=${lev} tick=${n}`;

          // Both derived from the same position, so both carry the same τ.
          const m = positionMultiplier(p, v, CONFIG.tickSeconds);
          const line = positionCrushIndex(p, CONFIG.tickSeconds);

          // Restate each from τ independently and require exact equality — the
          // CR-3 standard, "the same computed number, not merely equal within
          // display precision".
          expect(m, `${where} trigger M drifted from tau`).toBe(
            1 + lev * dir * (v / p.entry - 1) - p.theta * tau,
          );
          expect(line, `${where} crush line drifted from tau`).toBe(
            p.entry * (1 - (dir * (1 - p.theta * tau)) / lev),
          );
        }
      }
    }
  });

  it('CR-6b: one tick of oxygen actually separates τ=n from τ=n−1 — the test can fail', () => {
    // A τ-alignment test is worthless if the two τ values produce the same
    // multiplier. This measures the gap the criterion protects: at θ = 0.25 %/s
    // a stale tick is 0.03125 of multiplier, which on a $2,500 stake is $78 of
    // edge landing on the wrong side of a payout decision.
    let state = openPosition(1, 10);
    state = onTick(state, tick(TICK_MS, I0), CONFIG).state;
    const p = state.position;
    if (p === null) throw new Error('position vanished');

    const atN = positionMultiplier(p, I0, CONFIG.tickSeconds);
    const stale: Position = { ...p, ticksElapsed: p.ticksElapsed - 1 };
    const atNMinus1 = positionMultiplier(stale, I0, CONFIG.tickSeconds);

    expect(atN).not.toBe(atNMinus1);
    expect(atNMinus1 - atN).toBeCloseTo(CONFIG.thetaPerSecond * CONFIG.tickSeconds, 15);
  });

  it('CR-6b: a threshold crossing is decided at this tick τ, not the previous one', () => {
    // A take-profit set exactly between the τ=n−1 and τ=n multipliers: the
    // criterion decides which way it goes. With this tick's τ the trigger must
    // NOT fire (oxygen has pushed M below the threshold); with a stale τ it
    // would. This is the defect stated as an outcome rather than as a number.
    let state = openPosition(1, 10);
    state = onTick(state, tick(TICK_MS, I0), CONFIG).state;
    const p = state.position;
    if (p === null) throw new Error('position vanished');

    const correct = positionMultiplier(p, I0, CONFIG.tickSeconds);
    const stale: Position = { ...p, ticksElapsed: p.ticksElapsed - 1 };
    const staleM = positionMultiplier(stale, I0, CONFIG.tickSeconds);
    const threshold = (correct + staleM) / 2;

    expect(triggerWouldFireAt(p, I0, threshold), 'fired on this tick tau').toBe(false);
    expect(triggerWouldFireAt(stale, I0, threshold), 'stale tau would have fired').toBe(true);
  });
});

describe('CR-6b — the slot ordering CR-1 fixes is preserved', () => {
  it('CR-1: the auto-order slot is unreachable on a tick that crushes', () => {
    // The slot sits below the crush check, so a position past its line settles
    // as a crush and no trigger is consulted. Asserted through the outcome: a
    // tick beyond the line settles with reason `crush` and payout zero, whatever
    // the multiplier would have been.
    let state = openPosition(1, 10);
    const p0 = state.position;
    if (p0 === null) throw new Error('no position');
    const line = positionCrushIndex(p0, CONFIG.tickSeconds);

    const res = onTick(state, tick(TICK_MS, line * 0.5), CONFIG);
    expect(res.state.lastResult?.reason).toBe('crush');
    expect(res.state.lastResult?.payout).toBe(0);
  });

  it('CR-1/AO-2: a due ascent settles below the slot, at this tick τ', () => {
    // The third member of the tick order. The settlement multiplier must carry
    // the same τ the slot above it would have seen — which is what makes the
    // ascent a *later* tick's settlement of a trigger decision taken earlier.
    let state = openPosition(1, 10);
    state = requestAscent(state, 0, CONFIG).state;
    const v = I0 * 1.01;
    const res = onTick(state, tick(CONFIG.ascentMs, v), CONFIG);
    const settlement = res.state.lastResult;
    if (settlement === null) throw new Error('no settlement');

    expect(settlement.reason).toBe('ascent');
    // ascentMs = 500 ms = 4 ticks at 8 Hz, but only one tick was delivered, so
    // τ is one tick — the count, never the clock (PL-1).
    expect(settlement.tau).toBe(CONFIG.tickSeconds);
    const p = res.state.position;
    if (p === null) throw new Error('no position');
    expect(settlement.multiplier).toBe(positionMultiplier(p, v, CONFIG.tickSeconds));
  });
});
