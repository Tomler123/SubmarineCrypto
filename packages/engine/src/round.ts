/**
 * Round-level fan-out — M2.0, RS-1…RS-8.
 *
 * The engine was pure and correct and modelled **one player**. A round server
 * applies one authoritative tick to every open position in the round and settles
 * each against the same `I_t`. This module is that shape, established in the
 * package before a server needs it.
 *
 * It is deliberately a **fan-out around** the existing per-player entry points,
 * not a rewrite of them: `open`, `onTick`, `requestAscent`, `settleAtRoundEnd`,
 * `clearSettled` and `setLossLocked` keep their signatures and their tests. The
 * per-player functions are where every M1.3–M1.5 acceptance id is pinned; a
 * rewrite would put 400-odd passing tests up for renegotiation to buy nothing.
 *
 * Three properties are the milestone, and each is a test rather than a claim:
 * fan-out determinism (RS-2), player isolation (RS-3) and canonical event
 * ordering (RS-4). All three follow from one structural decision, stated once
 * here: **the fan-out reads each player's state, calls the per-player function,
 * and writes the result back under that player's key — and does nothing else.**
 * No accumulator crosses players, no earlier player's result is an input to a
 * later one, and nothing is read from the map while it is being rebuilt. That is
 * why order cannot matter; the tests prove it rather than establish it.
 */

import { type Cents, ZERO, addCents, cents, subCents } from '@crush/ledger';
import {
  DEFAULT_CONFIG,
  clearSettled,
  onTick,
  open,
  requestAscent,
  setLossLocked,
  settleAtRoundEnd,
} from './engine.js';
import type { EngineConfig, EngineEvent, EngineResult, EngineState, Tick } from './types.js';
import type {
  DirectionalExposure,
  PlayerRef,
  RoundEvent,
  RoundOpenRequest,
  RoundPhase,
  RoundRejection,
  RoundResult,
  RoundState,
} from './round-types.js';

/**
 * RL-1's graph as data: the single legal successor of each phase.
 *
 * The same table the client's `round.js` holds, for the same reason — written
 * once and consulted by the setter, so "no other transitions exist" is a
 * property of the setter rather than of its callers (RL-1, RS-6).
 */
const NEXT_PHASE: Readonly<Record<RoundPhase, RoundPhase>> = Object.freeze({
  waiting: 'launching',
  launching: 'running',
  running: 'ending',
  ending: 'settling',
  settling: 'waiting',
});

/** A fresh round in `waiting` with no players and no ticks. */
export function initialRound(roundId: string): RoundState {
  return { roundId, phase: 'waiting', ticks: [], players: new Map() };
}

/**
 * Seat a player in the round with an existing per-player state.
 *
 * Explicit rather than implicit-on-first-request, because RS-5 forbids a round
 * authority creating a player from an arriving entry: a wallet that appears
 * because a request named it is a balance from nowhere. Seating is the
 * operator-session step (M2.5) and it happens before the entry, never as part
 * of it.
 *
 * Re-seating an existing reference replaces that player's state. That is the
 * reconnect and the test-fixture path; it is not something a request can reach.
 */
export function seatPlayer(
  round: RoundState,
  player: PlayerRef,
  state: EngineState,
): RoundState {
  const players = new Map(round.players);
  players.set(player, state);
  return { ...round, players };
}

/** Remove a player from the round, returning the round unchanged if absent. */
export function unseatPlayer(round: RoundState, player: PlayerRef): RoundState {
  if (!round.players.has(player)) return round;
  const players = new Map(round.players);
  players.delete(player);
  return { ...round, players };
}

/**
 * RS-4's canonical order: ascending by player reference, code-unit order.
 *
 * `localeCompare` is deliberately **not** used. It is locale- and
 * ICU-version-dependent, so two servers with different runtimes could order the
 * same round's events differently — and RS-4 exists precisely so the archive and
 * the ledger have *one* sequence. Code-unit comparison is fixed by the language.
 *
 * There is no equal case: the refs being sorted are `Map` keys, so they are
 * unique by construction. Written as two comparisons rather than three so the
 * absence of a tie-break is visible — a third branch here would be dead code
 * that looks like a decision.
 */
function byPlayerRef(a: PlayerRef, b: PlayerRef): number {
  return a < b ? -1 : 1;
}

/** The round's players in RS-4's canonical order. */
function orderedRefs(round: RoundState): PlayerRef[] {
  return [...round.players.keys()].sort(byPlayerRef);
}

/** Address one player's per-player events for the round log (RS-4, RL-5). */
function addressed(
  roundId: string,
  player: PlayerRef,
  events: readonly EngineEvent[],
): RoundEvent[] {
  return events.map((event) => ({ roundId, player, event }));
}

/**
 * The fan-out primitive: apply one pure per-player function to every player.
 *
 * Every round-level tick-shaped entry point goes through here, so the three
 * milestone properties have exactly one implementation to hold:
 *
 *  - **RS-2.** The iteration below runs over `orderedRefs`, a *sorted* copy of
 *    the key set, so the sequence of `apply` calls does not depend on `Map`
 *    insertion order. It would be order-independent anyway — nothing crosses
 *    players — but ordering the iteration too means the *event log* is
 *    insertion-order-independent as well, not merely the resulting state.
 *  - **RS-3.** `apply` receives one player's state and the shared arguments its
 *    closure captured. It cannot see another player's state, because it is
 *    never handed one, and the map being built is never read back.
 *  - **RS-4.** Events are concatenated in that same sorted order, each player's
 *    own per-player order preserved inside its block.
 *
 * Players whose state is unchanged and who emitted nothing keep their existing
 * object identity, so a tick over 10,000 players allocates only for the ones
 * something happened to (PF-3).
 */
function fanOut(
  round: RoundState,
  apply: (state: EngineState) => EngineResult,
): { players: Map<PlayerRef, EngineState>; events: RoundEvent[] } {
  const players = new Map<PlayerRef, EngineState>();
  const events: RoundEvent[] = [];

  for (const player of orderedRefs(round)) {
    // Non-null by construction: `orderedRefs` reads this map's own keys.
    const before = round.players.get(player) as EngineState;
    const result = apply(before);
    players.set(player, result.state);
    if (result.events.length > 0) {
      events.push(...addressed(round.roundId, player, result.events));
    }
  }

  return { players, events };
}

/**
 * Advance the round one authoritative tick — **the only path by which money
 * moves** in a round (invariant 3), fanned out across every seated player.
 *
 * The tick is appended to the round's series before the fan-out, so the retained
 * series is the one the settlements derive from (VR-1). Each player is advanced
 * by the unmodified per-player `onTick`, which owns the CR-1 evaluation order,
 * the τ advance and every settlement rule; this function owns only *who* it runs
 * for and *in what order the facts come out*.
 */
export function roundTick(
  round: RoundState,
  tick: Tick,
  config: EngineConfig = DEFAULT_CONFIG,
): RoundResult {
  const { players, events } = fanOut(round, (state) => onTick(state, tick, config));
  return {
    state: { ...round, ticks: [...round.ticks, tick], players },
    events,
  };
}

/**
 * RL-4 across the whole round: every still-open position auto-surfaces at the
 * final tick at its current multiplier.
 *
 * Exported for a caller that settles explicitly, and used by `settling`'s phase
 * entry (RS-6). It does **not** append the tick: the final tick has already been
 * delivered through `roundTick`, and counting it twice would charge every player
 * in the round an extra tick of oxygen for the privilege of the round ending —
 * the same reason the per-player `settleAtRoundEnd` does not advance τ.
 */
export function roundSettleAtRoundEnd(
  round: RoundState,
  tick: Tick,
  config: EngineConfig = DEFAULT_CONFIG,
): RoundResult {
  const { players, events } = fanOut(round, (state) => settleAtRoundEnd(state, tick, config));
  return { state: { ...round, players }, events };
}

/** Drop every settled position in the round (the round-level `clearSettled`). */
export function roundClearSettled(round: RoundState): RoundResult {
  const { players, events } = fanOut(round, (state) => clearSettled(state));
  return { state: { ...round, players }, events };
}

/**
 * RS-5: route one addressed entry request to its player's existing EN-8 path.
 *
 * The per-player `open` is called with the nested request unchanged, so every
 * validation code, every precedence rank and EN-7's idempotency behave exactly
 * as their tests pin them. A request naming a player the round does not hold is
 * refused here, before the engine is reached at all, and changes nothing.
 */
export function roundOpen(
  round: RoundState,
  req: RoundOpenRequest,
  tick: Tick | null,
  config: EngineConfig = DEFAULT_CONFIG,
): RoundResult & { readonly rejection: RoundRejection | null } {
  const before = round.players.get(req.player);
  if (before === undefined) {
    return {
      state: round,
      events: [],
      rejection: { kind: 'round-rejected', player: req.player, code: 'UNKNOWN_PLAYER' },
    };
  }

  const result = open(before, req.request, tick, config);
  const players = new Map(round.players);
  players.set(req.player, result.state);
  return {
    state: { ...round, players },
    events: addressed(round.roundId, req.player, result.events),
    rejection: null,
  };
}

/**
 * Route one addressed cash-out request (CO-1) to its player.
 *
 * `receivedT` is the authority's receipt timestamp, handed in exactly as the
 * per-player function expects — the engine owns no clock (MF-5), and a round
 * does not acquire one by holding more players.
 */
export function roundRequestAscent(
  round: RoundState,
  player: PlayerRef,
  receivedT: number,
  config: EngineConfig = DEFAULT_CONFIG,
): RoundResult & { readonly rejection: RoundRejection | null } {
  const before = round.players.get(player);
  if (before === undefined) {
    return {
      state: round,
      events: [],
      rejection: { kind: 'round-rejected', player, code: 'UNKNOWN_PLAYER' },
    };
  }

  const result = requestAscent(before, receivedT, config);
  const players = new Map(round.players);
  players.set(player, result.state);
  return {
    state: { ...round, players },
    events: addressed(round.roundId, player, result.events),
    rejection: null,
  };
}

/**
 * Set one player's responsible-play lock (RP-2). Round-addressed, no events.
 *
 * Returns the round unchanged for an unknown player rather than a rejection:
 * unlike an entry, a loss lock carries no stake and there is nothing to refuse
 * — a lock for a player who has left the round is already in force by absence.
 */
export function roundSetLossLocked(
  round: RoundState,
  player: PlayerRef,
  lossLocked: boolean,
): RoundState {
  const before = round.players.get(player);
  if (before === undefined) return round;
  const players = new Map(round.players);
  players.set(player, setLossLocked(before, lossLocked));
  return { ...round, players };
}

/**
 * RS-7: open notional per direction, summed over open and ascending positions.
 *
 * Ascending positions are included because they are still exposed: a position
 * inside its 500 ms Blow can still crush (CO-2), so its notional is still live
 * risk. Excluding it would understate the aggregate for exactly the half-second
 * in which a fast move resolves it.
 *
 * `done` positions are excluded — they are settled, and their money has already
 * moved through the wallet.
 *
 * Computed on demand from round state rather than maintained incrementally: a
 * running total is a second source of truth that can drift from the positions it
 * claims to describe, and the drift would be silent. RK-1 and M2.6 need this
 * number to be re-derivable from the archive.
 *
 * The sum itself is **unbounded**, and is safe only because EN-4 caps each
 * position at `maxNotionalCents` ($2,000): overflowing `Number.MAX_SAFE_INTEGER`
 * would take on the order of 10^10 simultaneously open positions. If that
 * per-position cap is ever weakened or removed, this becomes a real bound to
 * check rather than a theoretical one. It fails loudly if it is ever reached —
 * `addCents` throws rather than wrapping — so the failure mode is a stopped
 * round, never a silently wrong exposure number that RK-1 would then act on.
 */
export function directionalExposure(round: RoundState): DirectionalExposure {
  let surface: Cents = ZERO;
  let dive: Cents = ZERO;

  for (const state of round.players.values()) {
    const p = state.position;
    if (p === null || p.state === 'done') continue;
    // Integer × integer stays exact in `Cents` (LG-2); leverage is an integer
    // from EN-4's allow-list, enforced at entry.
    const notional = cents(p.stake * p.lev);
    if (p.dir > 0) surface = addCents(surface, notional);
    else dive = addCents(dive, notional);
  }

  return { surface, dive, net: subCents(surface, dive) };
}

/**
 * RS-6 / RL-1: advance to `phase`, but only if it is the current phase's legal
 * successor, and run that phase's round-level entry effects.
 *
 * The guard exists because phase entry is **not idempotent**: entering
 * `settling` settles every still-open position in the round (RL-4), so an
 * illegal or repeated transition is a double settlement across the whole
 * population rather than a cosmetic state error. This is the client's `setPhase`
 * rule applied where the money actually is.
 *
 * A refused transition returns the round untouched with no events, and says so
 * through `changed` — a round authority logging every transition (RL-1) needs to
 * tell a refusal from a success, and a boolean is the honest answer.
 *
 * `settling` needs the final tick to settle against. It is read from the round's
 * own retained series rather than passed in, so the tick that settles a round is
 * necessarily one the round actually applied. A `settling` transition with no
 * ticks at all settles nothing: there is no `I_t` to settle against, and
 * inventing one would price a settlement off a value no player ever saw.
 */
export function setRoundPhase(
  round: RoundState,
  phase: RoundPhase,
  config: EngineConfig = DEFAULT_CONFIG,
): RoundResult & { readonly changed: boolean } {
  if (NEXT_PHASE[round.phase] !== phase) {
    return { state: round, events: [], changed: false };
  }
  return { ...enterPhase(round, phase, config), changed: true };
}

/**
 * Seed the round at `phase` out of band, ignoring the graph (RS-6's one
 * sanctioned bypass).
 *
 * A separate named export rather than a flag on `setRoundPhase`, so every place
 * the graph is skipped is greppable — the same discipline as the client's
 * `resetPhase`. For boot and for tests that start mid-cycle; never for a request
 * path.
 */
export function resetRoundPhase(
  round: RoundState,
  phase: RoundPhase,
  config: EngineConfig = DEFAULT_CONFIG,
): RoundResult {
  return enterPhase(round, phase, config);
}

/** Phase entry effects, shared by the guarded setter and the seed bypass. */
function enterPhase(
  round: RoundState,
  phase: RoundPhase,
  config: EngineConfig,
): RoundResult {
  const entered: RoundState = { ...round, phase };

  if (phase === 'settling') {
    const finalTick = entered.ticks[entered.ticks.length - 1];
    if (finalTick === undefined) return { state: entered, events: [] };
    return roundSettleAtRoundEnd(entered, finalTick, config);
  }

  return { state: entered, events: [] };
}
