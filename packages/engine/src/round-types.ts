/**
 * @crush/engine — round-level (multi-player) domain types. M2.0, RS-1…RS-8.
 *
 * Everything here is data, like `types.ts`. The distinction this file draws is
 * the whole point of M2.0: `EngineState` is **one player**, `RoundState` is
 * **one round holding many of them**. The per-player type is embedded verbatim
 * rather than adapted, so every M1.3–M1.5 acceptance id pinned to the
 * per-player functions is still pinned to the same objects inside a round
 * (RS-1).
 */

import type { Cents } from '@crush/ledger';
import type { EngineEvent, EngineState, OpenRequest, RejectCode, Tick } from './types.js';

/**
 * An opaque, operator-scoped player reference (LG-4).
 *
 * A string rather than a richer type because the provider must not hold
 * identity: under ADR 0011 the operator owns the player record and the provider
 * stores only the reference needed to reconstruct a round. It is also the
 * **sort key** for RS-4's canonical event order, so it must be comparable
 * without consulting anything outside the round.
 */
export type PlayerRef = string;

/** RL-1's phases, as a type. The graph itself lives in `round.ts`. */
export type RoundPhase = 'waiting' | 'launching' | 'running' | 'ending' | 'settling';

/**
 * A round-level event: one per-player `EngineEvent`, addressed.
 *
 * The per-player event is carried **unchanged** in `event` rather than being
 * flattened into new shapes, so a consumer that already handles `EngineEvent`
 * — the client adapter today, the M2.4 archive writer tomorrow — handles round
 * events by reading one extra field. `player` and `roundId` are what RS-4
 * requires to make the sequence self-describing (RL-5).
 */
export interface RoundEvent {
  readonly roundId: string;
  readonly player: PlayerRef;
  readonly event: EngineEvent;
}

/**
 * The result of any round-level entry point: the next round plus what happened,
 * in RS-4's canonical order. Mirrors `EngineResult` deliberately — a caller that
 * knows one knows the other.
 */
export interface RoundResult {
  readonly state: RoundState;
  readonly events: readonly RoundEvent[];
}

/**
 * Open notional per direction at a moment in the round (RS-7).
 *
 * Integer minor units end to end (LG-2): notional is `stake × leverage` and
 * leverage is an integer from a fixed allow-list, so the product stays exact.
 * This is the number RK-1's directional cap and M2.6's kill switch act on;
 * M2.0 computes it and enforces nothing.
 */
export interface DirectionalExposure {
  /** Summed `stake × lev` over open and ascending Surface (long) positions. */
  readonly surface: Cents;
  /** Summed `stake × lev` over open and ascending Dive (short) positions. */
  readonly dive: Cents;
  /** `surface − dive`. Positive means the round is net long. */
  readonly net: Cents;
}

/**
 * One round: the phase, the tick series applied so far, and every player's
 * existing per-player state (RS-1).
 *
 * `players` is a `ReadonlyMap` rather than a record so a `PlayerRef` containing
 * anything at all is safe as a key, and so the round cannot be mutated in place
 * by a caller holding a reference. Every round entry point returns a **new** map
 * (coding-style immutability rule); the per-player states inside it are shared
 * structurally where they did not change, which is what keeps a 10,000-player
 * tick (PF-3) from copying 10,000 objects that nothing happened to.
 */
export interface RoundState {
  /** Globally unique; appears on every tick, bet, settlement and log line (RL-5). */
  readonly roundId: string;
  readonly phase: RoundPhase;
  /**
   * Every authoritative tick applied to this round, in order. Retained because
   * VR-1 requires a settled round to be recomputable, and the tick series is
   * exactly the input that recomputation needs.
   */
  readonly ticks: readonly Tick[];
  readonly players: ReadonlyMap<PlayerRef, EngineState>;
}

/**
 * An entry request addressed to a player (RS-5).
 *
 * The nested `request` is the unchanged single-player `OpenRequest`, so EN-4's
 * validation and EN-8's precedence run on exactly the object they were written
 * against; the round adds only the addressing.
 */
export interface RoundOpenRequest {
  readonly player: PlayerRef;
  readonly request: OpenRequest;
}

/**
 * RS-5: a request naming a player the round does not hold.
 *
 * Deliberately **not** added to `RejectCode`. That union is the per-player
 * engine's answer to "why can't this player open a position?", and every code
 * in it is EN-8-ranked against the others. "This player is not in this round"
 * is a different question, asked one layer up, with no rank in EN-8 — folding
 * it in would put a round-addressing failure inside a precedence list that
 * never contemplated one.
 */
export type RoundRejectCode = 'UNKNOWN_PLAYER';

/** Round-level rejection, returned instead of an `EngineEvent` for RS-5. */
export interface RoundRejection {
  readonly kind: 'round-rejected';
  readonly player: PlayerRef;
  readonly code: RoundRejectCode;
}

/** Every code a round-level caller can see: the per-player set plus RS-5's. */
export type AnyRejectCode = RejectCode | RoundRejectCode;
