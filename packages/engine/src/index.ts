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
 * Still to come: oxygen and the `−θτ` term plus round timings (M1.4), risk caps
 * and auto-orders (M1.5). The CR-1 tick order in `onTick` already has the
 * auto-order slot, so M1.5 fills it rather than rewriting the loop.
 *
 * Structural rule: this package must remain importable under plain Node with
 * no DOM shim. Adding a dependency on anything in apps/client breaks the
 * Phase 2 server migration, which is the whole reason the package exists.
 * `test/purity.test.ts` is the durable guard.
 */

export const ENGINE_PACKAGE = '@crush/engine';

export type {
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
  DEFAULT_CONFIG,
  clearSettled,
  initialState,
  onTick,
  open,
  requestAscent,
  setLossLocked,
  settleAtRoundEnd,
} from './engine.js';

export {
  ascentDue,
  crushIndex,
  isCrushed,
  livePnl,
  multiplier,
  payoutFor,
  pnlFor,
  positionCrushIndex,
  positionMultiplier,
} from './position.js';
