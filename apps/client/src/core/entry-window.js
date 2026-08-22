import { CFG } from '../config/constants.js';
import { S } from '../state/store.js';
import { now } from '../util/math.js';

/* ================================================================
   ENTRY WINDOW — EN-1, the T−5s cutoff.

   Its own module, and a pure read of the store, so both the Gateway (which
   asks at ack time) and the console (which greys the buttons) can use it
   without either importing `round.js` — that would close a
   round → gateway → round cycle for one predicate.

   The round clock lives on this side of the seam deliberately: the engine owns
   no clock (MF-5, and the M1.4 rule that tau never comes from `now()`). It is
   handed the answer as `OpenRequest.entryOpen` and owns only the rejection and
   its EN-8 rank. At M2.2 the round server answers the same question against the
   authority's clock and nothing else about the entry path changes.
================================================================ */

/**
 * True while entries are accepted: `running`, and not yet inside the last 5 s.
 *
 * `armed` bets placed during `waiting`/`launching` are not entries yet — they
 * execute at launch, well inside the window — so this is asked only of a live
 * request.
 */
export function entryOpen(t = now()){
  return S.phase === 'running' && t < S.roundEnd - CFG.ENTRY_CUTOFF_MS;
}

/** Seconds until the hatch seals; 0 once it has. Drives the console countdown. */
export function entrySecondsLeft(t = now()){
  if (S.phase !== 'running') return 0;
  return Math.max(0, (S.roundEnd - CFG.ENTRY_CUTOFF_MS - t) / 1000);
}
