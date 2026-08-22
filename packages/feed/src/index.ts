/**
 * @crush/feed — the price-feed seam.
 *
 * Home of the `IndexSource` contract (`start`/`stop`, `resetRound`,
 * `onTick(fn) → {t, v, ret}`), `SimulatedIndexSource`, `InterpBuffer`, and the
 * `ReplayIndexSource` added by M1.6. `WsIndexSource` lands here in M2.1.
 *
 * Structural rule (CLAUDE.md invariant 2): nothing outside this package may
 * know which source is running. Consumers import the source singleton, never a
 * concrete implementation.
 *
 * Populated by moving apps/client/src/feed/* here during M1.6.
 */

export const FEED_PACKAGE = '@crush/feed';
