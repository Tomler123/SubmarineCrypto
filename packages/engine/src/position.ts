/**
 * Position math — the multiplier, the crush line, and the float→money
 * conversion. Pure functions over numbers; no state, no I/O.
 *
 * Spec: game logic §5, acceptance criteria PL-1, PL-4, PL-5, CR-1, CR-3.
 */

import { type Cents, ZERO, scaleCents, subCents } from '@crush/ledger';
import type { Direction, Leverage, Position, Tick } from './types.js';

/**
 * τ for a position, in seconds: `ticksElapsed × tickSeconds` (PL-1).
 *
 * Derived from the authoritative tick count and never from a clock, which is
 * what makes a replayed round reproduce its oxygen exactly (M1.6, VR-2). The
 * entry tick is tick 0, so τ = 0 there and `M` is exactly 1.
 */
export function tauOf(p: Position, tickSeconds: number): number {
  return p.ticksElapsed * tickSeconds;
}

/**
 * `M_t = 1 + L·d·(I_t/I_e − 1) − θ·τ` — PL-1 in full.
 *
 * The `−θ·τ` term is oxygen: the sole house edge (game logic §5). It is
 * subtracted from the multiplier itself rather than taken as a spread on entry
 * or a fee on cash-out, so what the player sees on the button is what the house
 * takes, continuously and visibly.
 */
export function multiplier(
  dir: Direction,
  lev: Leverage,
  entry: number,
  v: number,
  theta: number,
  tau: number,
): number {
  return 1 + lev * dir * (v / entry - 1) - theta * tau;
}

/**
 * `M_t` for an existing position at index value `v`, at the position's own τ.
 *
 * τ comes from the position's tick count, so every caller — engine, renderer,
 * console — computes the same `M` for the same tick without needing to agree on
 * a clock. That is the CR-6 property applied to the multiplier.
 */
export function positionMultiplier(p: Position, v: number, tickSeconds: number): number {
  return multiplier(p.dir, p.lev, p.entry, v, p.theta, tauOf(p, tickSeconds));
}

/**
 * The crush line — the index value at which `M_t` reaches zero at time τ.
 *
 * `I_crush(τ) = I_e·(1 − d·(1 − θτ)/L)` (CR-3). Solving `M_t = 0` for `I_t`:
 * `1 + L·d·(I/I_e − 1) − θτ = 0` → `I = I_e·(1 + (θτ − 1)/(L·d))`, and since
 * `d ∈ {+1, −1}` so `1/d = d`, that is `I_e·(1 − d·(1 − θτ)/L)`.
 *
 * As τ grows the `(1 − θτ)` factor shrinks, so the line creeps *toward* `I_e` —
 * toward the sub — from whichever side it started on. Draw it creeping (§5).
 */
export function crushIndex(
  dir: Direction,
  lev: Leverage,
  entry: number,
  theta: number,
  tau: number,
): number {
  return entry * (1 - (dir * (1 - theta * tau)) / lev);
}

/**
 * The crush line for an existing position, at its own τ.
 *
 * CR-6 requires the line the engine tests against and the line the client draws
 * to be *the same computed number*, not merely equal within display precision.
 * Both go through this function with the same `Position`, so they agree by
 * construction: there is no second copy of the formula and no second τ to get
 * out of step. The client renders a rounded copy of this value (CR-3) and never
 * recomputes it independently.
 */
export function positionCrushIndex(p: Position, tickSeconds: number): number {
  return crushIndex(p.dir, p.lev, p.entry, p.theta, tauOf(p, tickSeconds));
}

/**
 * Oxygen remaining as a fraction in [0, 1] — the O₂ bar on the cash-out button.
 *
 * `1 − θτ` is the surviving fraction of the entry multiplier's oxygen budget:
 * at τ = 0 the position has full oxygen, and at `τ = 1/θ` (400 s at θ = 0.25 %/s)
 * oxygen alone would have taken the whole multiplier. Presentation only — no
 * money path reads this — but it is derived from the position's own θ and τ so
 * the bar cannot drift from the math it depicts (UI-4).
 */
export function oxygenFraction(p: Position, tickSeconds: number): number {
  const remaining = 1 - p.theta * tauOf(p, tickSeconds);
  return remaining < 0 ? 0 : remaining > 1 ? 1 : remaining;
}

/**
 * CR-1: a position is crushed at the first tick where `M_t ≤ 0`.
 *
 * Decided by comparing the tick against the crush line rather than by testing
 * `positionMultiplier(p, v) <= 0` directly. The two are algebraically identical
 * and numerically are not: `I_e·(1 − d/L)` and `1 + L·d·(I/I_e − 1)` are
 * inverse in exact arithmetic, but in IEEE-754 the round trip lands `M` on
 * ±2.2e-16 at the line, with the sign depending on the leverage. Testing the
 * multiplier would therefore crush a position sitting exactly on its displayed
 * line at 10× and 25× while sparing it at 5× — an arbitrary difference between
 * leverages, and a mismatch against the line CR-3 requires the client to draw.
 *
 * Comparing indices instead makes the boundary exact and inclusive at every
 * leverage, and makes the crushed set exactly the set at or beyond the line the
 * player was shown.
 *
 * Settled in the v0.2 spec amendment: the line is authoritative (game logic §5,
 * CR-1). M1.4 moved τ into `crushIndex` rather than into the multiplier test, so
 * the comparison stays exact and inclusive at every leverage as the line creeps.
 */
export function isCrushed(p: Position, v: number, tickSeconds: number): boolean {
  const line = positionCrushIndex(p, tickSeconds);
  return p.dir > 0 ? v <= line : v >= line;
}

/**
 * PL-4: `payout = stake × max(0, M)`, rounded half away from zero to integer
 * cents, computed **once**.
 *
 * The floor at zero is what makes PL-5 unconditional — a gap tick far past the
 * crush line still pays exactly zero, never a negative balance (CR-5).
 */
export function payoutFor(stake: Cents, m: number): Cents {
  if (m <= 0) return ZERO;
  return scaleCents(stake, m);
}

/** `pnl = payout − stake`. Bounded below by `−stake` because payout ≥ 0 (PL-5). */
export function pnlFor(stake: Cents, payout: Cents): Cents {
  return subCents(payout, stake);
}

/**
 * Live P&L for an open position at index value `v`, for display.
 *
 * The client calls this every frame with the *interpolated* value; the result
 * is presentation only (UI-2, invariant 3). Settlement never routes through
 * here — it goes through `payoutFor` at a tick.
 */
export function livePnl(p: Position, v: number, tickSeconds: number): Cents {
  return pnlFor(p.stake, payoutFor(p.stake, positionMultiplier(p, v, tickSeconds)));
}

/** True once a tick is at or past an ascending position's settlement time (CO-1). */
export function ascentDue(p: Position, tick: Tick): boolean {
  return p.state === 'ascending' && tick.t >= p.resolveT;
}
