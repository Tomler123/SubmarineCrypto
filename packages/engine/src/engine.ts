/**
 * The engine: position lifecycle and tick-authoritative settlement.
 *
 * Ported from `apps/client/src/core/engine.js` (M1.3). Three things changed in
 * the port, each required by an exit criterion:
 *
 *  1. **No I/O.** The prototype called `FX`, `Au`, `feedMsg`, `toast` and
 *     `checkLossLimit` from inside `settle()`. Every one is now an entry in the
 *     returned `events` list. The client renders them; the Phase 2 server
 *     logs them.
 *  2. **No timers.** The prototype cleared `S.pos` from a 900 ms deferred
 *     callback. Clearing the settled position is now an explicit
 *     `clearSettled()` call the caller schedules, so the engine holds no
 *     wall-clock state.
 *  3. **Integer cents throughout**, with the float multiplier converted to money
 *     exactly once, half away from zero (PL-4) — replacing `Math.round`, which
 *     is half-up and therefore asymmetric across zero.
 *
 * Everything is pure: each entry point takes a state and returns a new one.
 */

import { type Cents, ZERO, addCents, subCents } from '@crush/ledger';
import { ascentDue, isCrushed, payoutFor, pnlFor, positionMultiplier } from './position.js';
import type {
  EngineConfig,
  EngineResult,
  EngineState,
  OpenRequest,
  Position,
  RejectCode,
  Settlement,
  SettlementReason,
  Tick,
  Wallet,
} from './types.js';

/** Ascent duration, audit-locked at 500 ms (parameter sheet, FA-2). */
export const DEFAULT_CONFIG: EngineConfig = Object.freeze({ ascentMs: 500 });

/** An empty engine state for a player with `balance` cents. */
export function initialState(balance: Cents): EngineState {
  return {
    wallet: { balance, wagered: ZERO, net: ZERO },
    position: null,
    lastResult: null,
    lossLocked: false,
  };
}

/** No-change result — returned when a request is a no-op (e.g. CO-3). */
function unchanged(state: EngineState): EngineResult {
  return { state, events: [] };
}

function rejected(state: EngineState, code: RejectCode): EngineResult {
  return { state, events: [{ kind: 'open-rejected', code }] };
}

/**
 * EN-3: debit the stake atomically with position creation.
 *
 * `open` builds the whole next state — wallet and position together — and
 * returns it in one value, so there is no interleaving at which the stake has
 * left the wallet but no position exists.
 *
 * EN-2 is the caller's contract: `tick` must be the first tick **after** server
 * receipt of the request, never a tick the player has already seen. The engine
 * uses whatever tick it is handed as `I_e`; enforcing which tick that is
 * belongs to the gateway (today) and the round server (M2.2).
 *
 * Range validation (EN-4: leverage set, minimum stake, `stake × lev ≤ $2,000`)
 * is M1.5 and is deliberately not implemented here.
 *
 * EN-8 fixes the order the checks run in. The principle: **report the condition
 * the player must resolve first, and never let a transient condition mask a
 * persistent one.** Hence loss-lock (session-terminal) before position-open
 * (round-scoped) before balance (actionable) before no-tick (a system
 * condition, not a player one).
 *
 * The loss-lock position is the one that matters. The prototype checked balance
 * first, so a loss-locked player with a small balance was told "INSUFFICIENT
 * BALANCE" — which implies "deposit more and continue" to someone the session
 * has already cut off. That is a responsible-play defect (RP-2), not a copy
 * preference, so the ordering is asserted rather than left to reading order.
 */
export function open(state: EngineState, req: OpenRequest, tick: Tick | null): EngineResult {
  // 1. Session-terminal: nothing the player does this round clears it (RP-2).
  if (state.lossLocked) {
    return rejected(state, 'LOSS_LIMIT_REACHED');
  }
  // 2. Round-scoped: resolves on its own when the position settles (EN-5).
  if (state.position !== null && state.position.state !== 'done') {
    return rejected(state, 'POSITION_OPEN');
  }
  // 3. Actionable by the player.
  if (state.wallet.balance < req.stake) {
    return rejected(state, 'INSUFFICIENT_BALANCE');
  }
  // 4. A system condition: no tick means no `I_e`, so there is nothing to price
  // the entry at. Distinct from MF-1 SIGNAL LOST, which is a round-level abort
  // — this rejects one request and settles nothing. The prototype could not
  // reach this state because it read `S.lastTick`, seeded at boot, and would
  // have priced an entry off a synthetic value.
  if (tick === null) {
    return rejected(state, 'NO_PRICE');
  }

  const wallet: Wallet = {
    balance: subCents(state.wallet.balance, req.stake),
    wagered: addCents(state.wallet.wagered, req.stake),
    net: state.wallet.net,
  };
  const position: Position = {
    id: req.id,
    dir: req.dir,
    stake: req.stake,
    lev: req.lev,
    entry: tick.v,
    state: 'open',
    openedT: tick.t,
    resolveT: 0,
  };

  return {
    state: { ...state, wallet, position },
    events: [
      { kind: 'position-opened', position },
      { kind: 'wallet-changed', wallet },
    ],
  };
}

/**
 * CO-1: stamp a cash-out at server receipt `t_r` and settle at the first tick
 * `>= t_r + 500 ms`.
 *
 * CO-2 (irrevocable) and CO-3 (a second request is idempotent, no error) both
 * fall out of the state check: anything not `open` returns the state untouched
 * with no events.
 */
export function requestAscent(
  state: EngineState,
  receivedT: number,
  config: EngineConfig = DEFAULT_CONFIG,
): EngineResult {
  const p = state.position;
  if (p === null || p.state !== 'open') return unchanged(state);

  const position: Position = {
    ...p,
    state: 'ascending',
    resolveT: receivedT + config.ascentMs,
  };
  return {
    state: { ...state, position },
    events: [{ kind: 'ascent-started', position }],
  };
}

/**
 * Settle a position at `tick` and return the new state plus its events.
 *
 * `reason` decides the multiplier: a crush settles at exactly zero payout
 * (CR-2) regardless of how far past the line the tick landed (CR-5); every
 * other reason settles at the tick's own `M`.
 */
function settle(
  state: EngineState,
  p: Position,
  tick: Tick,
  reason: SettlementReason,
): EngineResult {
  const crushed = reason === 'crush';
  const multiplierAtTick = positionMultiplier(p, tick.v);
  // PL-4: the single float->money conversion for this position. `payoutFor`
  // floors at zero, so PL-5 (max loss is exactly the stake) holds by
  // construction rather than by a defensive clamp on the pnl.
  const payout = crushed ? ZERO : payoutFor(p.stake, multiplierAtTick);
  const pnl = pnlFor(p.stake, payout);

  const settlement: Settlement = {
    positionId: p.id,
    reason,
    crushed,
    dir: p.dir,
    stake: p.stake,
    lev: p.lev,
    entry: p.entry,
    tick,
    multiplier: multiplierAtTick,
    payout,
    pnl,
  };
  const wallet: Wallet = {
    balance: addCents(state.wallet.balance, payout),
    wagered: state.wallet.wagered,
    net: addCents(state.wallet.net, pnl),
  };
  const position: Position = { ...p, state: 'done', result: settlement };

  return {
    state: { ...state, wallet, position, lastResult: settlement },
    events: [
      { kind: 'settled', settlement },
      // Replaces the prototype's direct `checkLossLimit()` call. The engine
      // reports the numbers; the responsible-play policy lives in the client
      // (Phase 1.5) and moves server-side at M3.3.
      { kind: 'wallet-changed', wallet },
    ],
  };
}

/**
 * Advance one authoritative tick. **The only path by which money moves**
 * (invariant 3).
 *
 * Evaluation order is CR-1's: crush check -> auto-order triggers -> pending
 * ascent settlement. The middle slot is empty until M1.5 fills it; the order is
 * written out now because CR-1 makes it a correctness contract, and because
 * CR-4 requires that a crush on the same tick as a due ascent takes precedence
 * — which is exactly what checking crush first produces.
 */
export function onTick(state: EngineState, tick: Tick): EngineResult {
  const p = state.position;
  if (p === null || p.state === 'done') return unchanged(state);

  // 1. Crush check (CR-1, CR-4).
  if (isCrushed(p, tick.v)) {
    return settle(state, p, tick, 'crush');
  }

  // 2. Auto-order triggers (AO-1…AO-5) — M1.5.

  // 3. Pending ascent settlement (CO-1).
  if (ascentDue(p, tick)) {
    return settle(state, p, tick, 'ascent');
  }

  return unchanged(state);
}

/**
 * RL-4: at round end every still-open position auto-surfaces at the final tick
 * at its current multiplier, with no penalty and no fee. CO-5 routes an ascent
 * that has not reached its settlement tick through the same path.
 */
export function settleAtRoundEnd(state: EngineState, tick: Tick): EngineResult {
  const p = state.position;
  if (p === null || p.state === 'done') return unchanged(state);
  return settle(state, p, tick, 'round-end');
}

/**
 * Drop a settled position, moving its result to `lastResult`.
 *
 * The prototype did this from a 900 ms deferred callback inside `settle()` so the
 * client could hold the wreck on screen. Scheduling is presentation, so the
 * delay now belongs to the caller and the engine stays timer-free — one of the
 * six things the roadmap listed as blocking the server migration.
 */
export function clearSettled(state: EngineState): EngineResult {
  const p = state.position;
  if (p === null || p.state !== 'done') return unchanged(state);
  return { state: { ...state, position: null }, events: [] };
}

/** Set the responsible-play lock. Blocks new entries until the session ends (RP-2). */
export function setLossLocked(state: EngineState, lossLocked: boolean): EngineState {
  return { ...state, lossLocked };
}
