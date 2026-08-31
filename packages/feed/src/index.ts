/**
 * @crush/feed — the price-feed seam.
 *
 * Home of the `IndexSource` contract (`resetRound`, `halt`,
 * `onTick(fn) → {t, v, ret}`), `SimulatedIndexSource`, `InterpBuffer`, and the
 * `ReplayIndexSource` added by M1.6. `WsIndexSource` lands here in M2.1.
 *
 * Structural rule (CLAUDE.md invariant 2): nothing outside this package may
 * know which source is running. Consumers import the source singleton, never a
 * concrete implementation.
 *
 * Populated by moving apps/client/src/feed/* here during M1.6.
 */

export { IndexSourceBase } from './index-source-base.js';
export {
  DEFAULT_INDEX_TRANSFORM_CONFIG,
  IndexTransform,
  type IndexTransformConfig,
  type IndexTransformSample,
} from './index-transform.js';
export { InterpBuffer } from './interp-buffer.js';
export {
  ReplayFixtureError,
  parseReplayCsv,
  validateReplayRows,
  type ReplayFixtureErrorCode,
} from './replay-fixture.js';
export { ReplayIndexSource, type ReplayIndexSourceOptions } from './replay-index-source.js';
export {
  SimulatedIndexSource,
  type SimulatedIndexSourceOptions,
} from './simulated-index-source.js';
export type {
  AlarmSubscriber,
  IndexAlarm,
  IndexSource,
  IndexTick,
  ReplayPriceRow,
  ReplayScheduler,
  TickSubscriber,
} from './types.js';
