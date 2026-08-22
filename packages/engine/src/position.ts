/**
 * Position math — the multiplier, the crush line, and the float→money
 * conversion. Pure functions over numbers; no state, no I/O.
 *
 * Spec: game logic §5, acceptance criteria PL-1, PL-4, PL-5, CR-1, CR-3.
 */

import { type Cents, ZERO, scaleCents, subCents } from '@crush/ledger';
import type { Direction, Leverage, Position, Tick } from './types.js';

/**
 * `M_t = 1 + L·d·(I_t/I_e − 1)` — PL-1 without the oxygen term.
 *
 * The `− θ·τ` term is M1.4. It is deliberately absent rather than stubbed with
 * `θ = 0`: an absent term is a visible gap in the roadmap's gap list, whereas a
 * zeroed constant reads as implemented. There is consequently **no house edge**
 * in this build, which is the documented state after M1.3.
 */
export function multiplier(dir: Direction, lev: Leverage, entry: number, v: number): number {
  return 1 + lev * dir * (v / entry - 1);
}

/** `M_t` for an existing position at index value `v`. */
export function positionMultiplier(p: Position, v: number): number {
  return multiplier(p.dir, p.lev, p.entry, v);
}

/**
 * The crush line — the index value at which `M_t` reaches zero.
 *
 * `I_crush = I_e · (1 − d/L)`, the τ-independent form of CR-3's
 * `I_e·(1 − d·(1 − θτ)/L)`. M1.4 adds the τ term and the line begins to creep.
 */
export function crushIndex(dir: Direction, lev: Leverage, entry: number): number {
  return entry * (1 - dir / lev);
}

/** The crush line for an existing position. */
export function positionCrushIndex(p: Position): number {
  return crushIndex(p.dir, p.lev, p.entry);
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
 * ASSUMPTION: the spec states the condition as `M_t ≤ 0` and the line as
 * `I_crush(τ) = I_e·(1 − d·(1 − θτ)/L)`, and does not say which to evaluate
 * when float arithmetic separates them. This picks the line. M1.4 keeps the
 * property by moving τ into `crushIndex`, so this comparison stays exact.
 */
export function isCrushed(p: Position, v: number): boolean {
  const line = positionCrushIndex(p);
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
export function livePnl(p: Position, v: number): Cents {
  return pnlFor(p.stake, payoutFor(p.stake, positionMultiplier(p, v)));
}

/** True once a tick is at or past an ascending position's settlement time (CO-1). */
export function ascentDue(p: Position, tick: Tick): boolean {
  return p.state === 'ascending' && tick.t >= p.resolveT;
}
