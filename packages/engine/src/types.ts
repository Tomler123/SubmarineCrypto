/**
 * @crush/engine — domain types.
 *
 * Every type here is data. No behaviour, no I/O, no DOM. Values that represent
 * money are `Cents` from `@crush/ledger`, so a float in a money field is a
 * compile error (LG-2).
 */

import type { Cents } from '@crush/ledger';

/** Direction: `+1` Surface (long), `−1` Dive (short). Spec §5. */
export type Direction = 1 | -1;

/** Leverage set fixed by the parameter sheet (EN-4). M1.5 enforces membership. */
export type Leverage = number;

/**
 * One authoritative feed sample. Money moves on these and only these
 * (CLAUDE.md invariant 3); the 60 fps interpolated value never reaches here.
 *
 * `t` is a millisecond timestamp on the authority's clock (MF-5). `v` is the
 * index value `I_t`. `ret` is the raw log return carried by the feed contract;
 * the engine does not read it, but the tick type is the feed's type.
 */
export interface Tick {
  readonly t: number;
  readonly v: number;
  readonly ret?: number;
}

/** Lifecycle of a single position. */
export type PositionState = 'open' | 'ascending' | 'done';

/** Why a position stopped existing. */
export type SettlementReason =
  /** The index reached the crush line at a tick — CR-1. Payout is exactly zero. */
  | 'crush'
  /** A 500 ms ascent reached its settlement tick — CO-1. */
  | 'ascent'
  /** Round ended with the position still open — RL-4. */
  | 'round-end';

/**
 * An open or settled position. Immutable: every transition returns a new
 * object (coding-style rule), so a caller holding a pre-tick position still
 * sees pre-tick values.
 */
export interface Position {
  readonly id: string;
  readonly dir: Direction;
  readonly stake: Cents;
  readonly lev: Leverage;
  /** `I_e` — the index at the entry-execution tick (EN-2). */
  readonly entry: number;
  readonly state: PositionState;
  /** Timestamp of the entry-execution tick. */
  readonly openedT: number;
  /**
   * Earliest settlement time for an ascent: `t_r + ASCENT_MS` (CO-1).
   * Zero while the position is `open`.
   */
  readonly resolveT: number;
  /** Present once `state` is `done`. */
  readonly result?: Settlement;
}

/**
 * The outcome of a settled position. `payout` and `pnl` are the only numbers
 * the ledger consumes; both are integer cents produced by exactly one
 * rounding operation (PL-4).
 */
export interface Settlement {
  readonly positionId: string;
  readonly reason: SettlementReason;
  /** True for `reason === 'crush'`; kept explicit because the client reads it. */
  readonly crushed: boolean;
  /**
   * The position as it stood, so a settlement record is self-contained.
   * LG-4 requires direction, stake, leverage and `I_e` to be retained with the
   * settlement; carrying them here means the ledger writes one object and the
   * client never has to reach back into a position it has already dropped.
   */
  readonly dir: Direction;
  readonly stake: Cents;
  readonly lev: Leverage;
  /** `I_e` — the entry-execution index (EN-2). */
  readonly entry: number;
  /** The settlement tick — the tick the money derives from. */
  readonly tick: Tick;
  /** `M_settle`, unclamped, for display and audit (LG-4). */
  readonly multiplier: number;
  /** `stake × max(0, M)`, rounded once, half away from zero. Never negative (PL-5). */
  readonly payout: Cents;
  /** `payout − stake`. Never worse than `−stake` (PL-5). */
  readonly pnl: Cents;
}

/** Immutable wallet slice the engine reads and returns. All integer cents. */
export interface Wallet {
  readonly balance: Cents;
  readonly wagered: Cents;
  readonly net: Cents;
}

/** Everything the engine owns for one player. Replaces the prototype's `S` fields. */
export interface EngineState {
  readonly wallet: Wallet;
  readonly position: Position | null;
  /** Last settlement, kept for the settle card until the client clears it. */
  readonly lastResult: Settlement | null;
  /** Set by the client's responsible-play layer; blocks new entries (RP-2). */
  readonly lossLocked: boolean;
}

/** Tunables the engine reads. Frozen per round by the caller (PL-2 prepares M1.4). */
export interface EngineConfig {
  /** The Blow: 500 ms, audit-locked (parameter sheet, FA-2). */
  readonly ascentMs: number;
}

/** A request to open a position, as it arrives from the `Gateway` (invariant 5). */
export interface OpenRequest {
  readonly dir: Direction;
  readonly stake: Cents;
  readonly lev: Leverage;
  /** Client-generated idempotency id (EN-7); also becomes the position id. */
  readonly id: string;
}

/**
 * Machine-readable rejection codes, listed in EN-8 precedence order. The client
 * maps these to copy; the back office counts them (BO-2).
 */
export type RejectCode =
  /** Session-terminal: the player's loss limit is reached (RP-2). */
  | 'LOSS_LIMIT_REACHED'
  /** Round-scoped: a live position already exists (EN-5). */
  | 'POSITION_OPEN'
  /** Actionable: the stake exceeds the wallet. */
  | 'INSUFFICIENT_BALANCE'
  /**
   * System: no valid entry price to execute against (EN-9). Distinct from
   * MF-1 SIGNAL LOST — this rejects one request, settles nothing and aborts no
   * round, so it must not be surfaced as a feed outage.
   */
  | 'NO_PRICE'
  /**
   * Reserved for M2.1: an entry arriving during a round aborted under MF-1.
   * Per EN-6 the stake is never debited, so the position never existed in the
   * ledger. Declared now so MF-1 does not get overloaded onto `NO_PRICE`.
   */
  | 'ROUND_ABORTED';

/**
 * Events the engine emits instead of calling `FX` / `Au` / `feedMsg` / `toast` /
 * `checkLossLimit` directly. This list is the M1.3 decoupling: the engine says
 * what happened, the client decides what that looks and sounds like.
 */
export type EngineEvent =
  | { readonly kind: 'position-opened'; readonly position: Position }
  | { readonly kind: 'open-rejected'; readonly code: RejectCode }
  | { readonly kind: 'ascent-started'; readonly position: Position }
  | { readonly kind: 'settled'; readonly settlement: Settlement }
  /**
   * Emitted after every settlement so the client can run its loss-limit check.
   * Replaces the direct `checkLossLimit()` call; the engine does not own the
   * responsible-play policy, only the numbers it depends on.
   */
  | { readonly kind: 'wallet-changed'; readonly wallet: Wallet };

/**
 * Every engine entry point returns this: the next state plus what happened.
 * Nothing is mutated in place, so a caller can diff, log, or discard.
 */
export interface EngineResult {
  readonly state: EngineState;
  readonly events: readonly EngineEvent[];
}
