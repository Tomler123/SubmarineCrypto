/**
 * @crush/engine — pure game logic. No DOM, no renderer, no audio, no timers.
 *
 * Filled in by M1.3 (port position math + settlement from
 * apps/client/src/core/engine.js, returning an event list instead of calling
 * FX / Au / feedMsg / toast / checkLossLimit), then M1.4 (oxygen, round
 * timings, CR-1 tick order) and M1.5 (risk caps, auto-orders).
 *
 * Structural rule: this package must remain importable under plain Node with
 * no DOM shim. Adding a dependency on anything in apps/client breaks the
 * Phase 2 server migration, which is the whole reason the package exists.
 */

export const ENGINE_PACKAGE = '@crush/engine';
