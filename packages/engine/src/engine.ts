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

import { type Cents, ZERO, addCents, cents, subCents } from '@crush/ledger';
import { ascentDue, isCrushed, payoutFor, pnlFor, positionMultiplier, tauOf } from './position.js';
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

/**
 * Default tunables.
 *
 * `ascentMs` and `tickSeconds` are audit-locked (parameter sheet §12): the
 * 500 ms Blow is a fairness constant (FA-2) and 0.125 s is the 8 Hz tick rate.
 * `thetaPerSecond` is the single business dial — 0.25 %/s is the spec's opening
 * value, targeting RTP 96.5 %, and M1.7's Monte-Carlo harness replaces it with a
 * calibrated figure. It lives here, in a config object, rather than as a literal
 * in the math, because Phase 2 serves it as remote config (PL-2) and because a
 * literal cannot be swept by a calibration run.
 */
export const DEFAULT_CONFIG: EngineConfig = Object.freeze({
  ascentMs: 500,
  thetaPerSecond: 0.0025,
  tickSeconds: 0.125,
  // PL-4 / AO-5, parameter sheet §12: 50× and $10,000. Operator-configurable
  // within house limits (RK-3) and audit-logged on change, unlike theta which
  // is the routine dial.
  maxWinMultiple: 50,
  maxWinCents: cents(1_000_000),
});

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
 * persistent one.** Hence loss-lock (session-terminal) before entry-closed
 * (round-terminal, M1.4) before position-open (round-scoped, self-clearing)
 * before balance (actionable) before no-tick (a system condition, not a player
 * one).
 *
 * The loss-lock position is the one that matters. The prototype checked balance
 * first, so a loss-locked player with a small balance was told "INSUFFICIENT
 * BALANCE" — which implies "deposit more and continue" to someone the session
 * has already cut off. That is a responsible-play defect (RP-2), not a copy
 * preference, so the ordering is asserted rather than left to reading order.
 */
export function open(
  state: EngineState,
  req: OpenRequest,
  tick: Tick | null,
  config: EngineConfig = DEFAULT_CONFIG,
): EngineResult {
  // 0. EN-7: a replay of a request already accepted is a no-op that re-reports
  // the position it created. Ranked above every EN-8 rejection, because the
  // ranks answer "why can't you open a position?" and a replay is not asking
  // that — it is asking "did my request land?", to which the answer is yes.
  //
  // Concretely: a retry after a dropped ack must not be told POSITION_OPEN
  // about its own position, and must not be told LOSS_LIMIT_REACHED,
  // ENTRY_CLOSED, INSUFFICIENT_BALANCE or NO_PRICE either. Each of those would
  // tell the client its entry failed while the stake sits debited and the
  // position sits open — the exact reconciliation break the idempotency key
  // exists to prevent. The stake is already debited, so re-running the balance
  // check would also reject a position that is already paid for.
  //
  // `I_e` is not re-derived: the position keeps the entry tick it executed at
  // (EN-2), so a retry arriving many ticks later cannot re-price it. That is
  // what makes the retry safe to send at all.
  //
  // The window is the position's lifetime in engine state — through `done`,
  // until `clearSettled` drops it. Past that the id has left the engine and
  // EN-5 plus LG-3 (ledger idempotency by operation id) govern; a Phase 2
  // authority keeps a longer-lived id set, which is a server concern.
  if (state.position !== null && state.position.id === req.id) {
    return {
      state,
      // The original `position-opened`, repeated. No `wallet-changed`: nothing
      // moved, and a spurious one would re-run the client's responsible-play
      // check against an unchanged balance.
      events: [{ kind: 'position-opened', position: state.position }],
    };
  }
  // 1. Session-terminal: nothing the player does this round clears it (RP-2).
  if (state.lossLocked) {
    return rejected(state, 'LOSS_LIMIT_REACHED');
  }
  // 2. Round-scoped and unresolvable this round: once the window shuts, nothing
  // the player does reopens it (EN-1). Above POSITION_OPEN so a player whose
  // position is still settling as the cutoff passes is told the truth rather
  // than being invited to wait for a window that has already closed.
  if (req.entryOpen === false) {
    return rejected(state, 'ENTRY_CLOSED');
  }
  // 3. Round-scoped: resolves on its own when the position settles (EN-5).
  if (state.position !== null && state.position.state !== 'done') {
    return rejected(state, 'POSITION_OPEN');
  }
  // 4. Actionable by the player.
  if (state.wallet.balance < req.stake) {
    return rejected(state, 'INSUFFICIENT_BALANCE');
  }
  // 5. A system condition: no tick means no `I_e`, so there is nothing to price
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
    // PL-1: the entry tick is tick 0, so tau = 0 and M is exactly 1 here.
    ticksElapsed: 0,
    // PL-2: theta is frozen at entry. A config change between rounds cannot
    // reach back into a position that is already open, and LG-4's "theta in
    // force" is this number.
    theta: config.thetaPerSecond,
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
  config: EngineConfig,
): EngineResult {
  const crushed = reason === 'crush';
  // PL-3: oxygen accrues during ascent exactly as while open, so this reads the
  // position's own tau with no special case for `ascending`.
  const tau = tauOf(p, config.tickSeconds);
  const multiplierAtTick = positionMultiplier(p, tick.v, config.tickSeconds);
  // PL-4: the single float->money conversion for this position. `payoutFor`
  // floors at zero, so PL-5 (max loss is exactly the stake) holds by
  // construction rather than by a defensive clamp on the pnl, and caps at
  // min(50 x stake, $10,000) (AO-5) — on EVERY reason, because a gap tick can
  // cross the cap between two ticks and RL-4 has no trigger to route through.
  // `multiplierAtTick` stays unclamped: LG-4 retains M as it actually stood.
  const payout = crushed ? ZERO : payoutFor(p.stake, multiplierAtTick, config);
  const pnl = pnlFor(p.stake, payout);

  const settlement: Settlement = {
    positionId: p.id,
    reason,
    crushed,
    dir: p.dir,
    stake: p.stake,
    lev: p.lev,
    entry: p.entry,
    theta: p.theta,
    tau,
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
export function onTick(
  state: EngineState,
  tick: Tick,
  config: EngineConfig = DEFAULT_CONFIG,
): EngineResult {
  const prior = state.position;
  if (prior === null || prior.state === 'done') return unchanged(state);

  // 0. Advance tau, before anything is evaluated against it.
  //
  // Every check below — the crush line, the auto-order triggers M1.5 adds, the
  // settlement multiplier — must see this tick's own tau, not the previous
  // tick's. Incrementing here is what makes that true for all three at once,
  // and it is the CR-6 requirement stated as code: the position handed to the
  // checks is the same object the client will draw its line from, so the line
  // tested at tick n and the line displayed at tick n carry the same tau.
  //
  // The entry tick itself never reaches here (`open` returns before this tick
  // is replayed), so the first tick a position sees is tick 1 — tau = 0.125 s.
  const p: Position = { ...prior, ticksElapsed: prior.ticksElapsed + 1 };
  const advanced: EngineState = { ...state, position: p };

  // 1. Crush check (CR-1, CR-4).
  if (isCrushed(p, tick.v, config.tickSeconds)) {
    return settle(advanced, p, tick, 'crush', config);
  }

  // 2. Auto-order triggers (AO-1…AO-5) — M1.5 fills this slot. Its position
  // between the crush check and the ascent settlement is fixed by CR-1 and is a
  // correctness contract, not a style choice: a position past its crush line
  // must crush rather than take-profit, and a trigger firing on this tick starts
  // an ascent that settles on a *later* tick (AO-2), never this one.

  // 3. Pending ascent settlement (CO-1).
  if (ascentDue(p, tick)) {
    return settle(advanced, p, tick, 'ascent', config);
  }

  // No settlement, but tau moved: the advanced position is the new state, so
  // the next tick and every live readout between now and then see this tick's
  // oxygen.
  return { state: advanced, events: [] };
}

/**
 * RL-4: at round end every still-open position auto-surfaces at the final tick
 * at its current multiplier, with no penalty and no fee. CO-5 routes an ascent
 * that has not reached its settlement tick through the same path.
 */
export function settleAtRoundEnd(
  state: EngineState,
  tick: Tick,
  config: EngineConfig = DEFAULT_CONFIG,
): EngineResult {
  const p = state.position;
  if (p === null || p.state === 'done') return unchanged(state);
  // No tau advance here. The final tick was already delivered through `onTick`,
  // which counted it; counting it again would charge one extra tick of oxygen
  // for the privilege of the round ending. RL-4 settles "at the final tick at
  // its current multiplier" — the multiplier the player was already shown.
  return settle(state, p, tick, 'round-end', config);
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
