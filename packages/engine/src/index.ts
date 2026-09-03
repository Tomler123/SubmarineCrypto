/**
 * @crush/engine — pure game logic. No DOM, no renderer, no audio, no timers.
 *
 * M1.3 ported position math and settlement out of
 * `apps/client/src/core/engine.js`: the five direct calls to
 * `FX` / `Au` / `feedMsg` / `toast` / `checkLossLimit` became the `EngineEvent`
 * list every entry point returns, the deferred callback inside `settle()` became the
 * caller-scheduled `clearSettled()`, and the money path moved to integer
 * `Cents` with round-half-away-from-zero applied exactly once at settlement.
 *
 * M1.4 added oxygen: `M_t` carries the `−θ·τ` term (PL-1), the crush line creeps
 * with τ (CR-3), and τ is derived from the position's authoritative tick count
 * rather than any clock — so a replayed round reproduces its edge exactly. θ is
 * read from `EngineConfig` and snapshotted onto each position at entry, which is
 * how PL-2's "next round boundary only" rule is enforced rather than merely
 * documented.
 *
 * M1.5 closed two criteria that were declared but unenforced: PL-4's max-win
 * cap (`min(50 x stake, $10,000)`) is now clamped at the single float->money
 * conversion, on every settlement reason rather than only on an AO-5
 * auto-surface; and EN-7's idempotency key is now checked, so a replayed
 * `OpenRequest.id` is a no-op returning the existing position instead of a
 * second position and a second debit.
 *
 * M2.0 added the round-level fan-out (`round.ts`, RS-1…RS-8): a `RoundState`
 * holding a map of opaque player reference to the *existing* per-player
 * `EngineState`, plus round id, phase and tick series. It is a fan-out **around**
 * the per-player entry points, which are unchanged — every M1.3–M1.5 criterion
 * stays pinned to the same functions and the same objects. One authoritative
 * tick reaches every player through one primitive that shares no accumulator
 * between them, which is what makes order-independence (RS-2) and isolation
 * (RS-3) structural rather than incidental.
 *
 * Structural rule: this package must remain importable under plain Node with
 * no DOM shim. Adding a dependency on anything in apps/client breaks the
 * Phase 2 server migration, which is the whole reason the package exists.
 * `test/purity.test.ts` is the durable guard.
 */

export const ENGINE_PACKAGE = '@crush/engine';

export type {
  AscentCause,
  CloseCall,
  CloseCallApproach,
  CloseCallEvent,
  Direction,
  EngineConfig,
  EngineEvent,
  EngineResult,
  EngineState,
  Leverage,
  OpenRequest,
  Position,
  PositionState,
  RejectCode,
  Settlement,
  SettlementReason,
  Tick,
  Wallet,
} from './types.js';

export {
  CLOSE_CALL_THRESHOLD_BPS,
  closeCallForSettlement,
  observeCloseCallApproach,
} from './close-call.js';

export {
  DEFAULT_CONFIG,
  clearSettled,
  initialState,
  onTick,
  open,
  requestAscent,
  setLossLocked,
  settleAtRoundEnd,
} from './engine.js';

export type {
  AnyRejectCode,
  DirectionalExposure,
  PlayerRef,
  RoundEvent,
  RoundOpenRequest,
  RoundPhase,
  RoundRejectCode,
  RoundRejection,
  RoundResult,
  RoundState,
} from './round-types.js';

export {
  directionalExposure,
  initialRound,
  resetRoundPhase,
  roundClearSettled,
  roundOpen,
  roundRequestAscent,
  roundSetLossLocked,
  roundSettleAtRoundEnd,
  roundTick,
  seatPlayer,
  setRoundPhase,
  unseatPlayer,
} from './round.js';

export {
  ascentDue,
  crushIndex,
  isCrushed,
  livePnl,
  maxPayoutFor,
  multiplier,
  oxygenFraction,
  payoutFor,
  pnlFor,
  positionCrushIndex,
  positionMultiplier,
  tauOf,
} from './position.js';

export type { PayoutBounds } from './position.js';
