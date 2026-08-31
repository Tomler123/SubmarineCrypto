# 0008 — Authoritative Close Call events

**Status:** accepted · **Date:** 2026-08-31 · **Milestone:** Phase 1.5 Close Calls

## Context

The roadmap named a Close Calls ticker and gave one illustrative line —
“K4raken escaped 0.4% from crush” — but did not define eligibility, proximity,
threshold equality, long/short symmetry, observation window, ordering or
duplicate suppression. Those choices determine whether the room is shown an
auditable near-crush fact or marketing copy reconstructed from client state.

The current fake bots also calculate a simplified static liquidation line,
multiplier and P&L in the client. Those values omit oxygen and the 500 ms ascent
settlement lifecycle, so they cannot support a Close Call without violating the
rule that the engine owns every outcome fact.

## Decisions

### 1. A Close Call is successful settlement evidence

Only non-crushed `ascent` and `round-end` settlements with positive payout are
eligible. Manual and automatic ascents are equivalent. Crushes are excluded
even if the position was close on an earlier surviving tick: “close” is not the
same claim as “escaped”. A losing P&L remains eligible when payout is positive;
Close Call describes proximity to liquidation, not profitability.

### 2. Proximity is minimum signed index headroom from the live crush line

On every authoritative post-entry tick that survives CR-1, the engine observes:

```text
headroom = d × (I_t − I_crush(τ)) / I_crush(τ)
headroomBps = 10,000 × headroom
```

The direction sign gives Surface and Dive the same positive survival scale.
The engine retains the minimum over the whole exposure, including the complete
500 ms ascent and settlement tick. An exact tie keeps the earliest tick. This
captures the actual near-death moment rather than only the final tick, while
remaining reconstructable from authoritative ticks and the same crush line
CR-1 tests and CR-3 displays.

The threshold is 50 basis points, inclusive. Boundary qualification compares
the tick directly with `I_crush × (1 ± 0.005)` in the correct direction rather
than comparing rounded display text. This threshold and operation order are a
versioned audit assumption.

### 3. The authority emits a self-contained event

An eligible settlement emits `settled`, then `close-call`, then
`wallet-changed`. The Close Call contains its stable id, position/direction,
threshold, closest authoritative tick and line facts, and the complete
settlement. The social layer formats those facts only. It does not recalculate
the line, multiplier, P&L, settlement or proximity.

Duplicate delivery is normal in a replayable event system. The authority gives
the event a deterministic identity derived from the settlement identity; the
feed renders the first occurrence and ignores later occurrences with that id.
Different ids remain in authoritative arrival order.

### 4. Fake actors use the real engine for outcome facts

Fake names and action choices remain seeded presentation data and cannot affect
the player's game. Each fake position is nevertheless driven through an
isolated `@crush/engine` state. Its ordinary and Close Call messages consume the
same events a future server-backed social stream will carry. The fake layer no
longer owns a second settlement formula.

## Consequences

- Close Call tracking adds metadata and events only; wallet, settlement,
  cooldown, round and source behavior remain unchanged.
- Ascent-period danger qualifies, so the advertised escape includes the Blow's
  full market-risk window.
- Replay speed, wall-clock time, animation timing, DOM state and interpolation
  cannot change the fact or its id.
- The client feed needs deterministic id-based suppression, but no outcome
  arithmetic.
- Changing the threshold, metric, eligibility set or observation window
  requires new acceptance criteria and a superseding ADR before code changes.
