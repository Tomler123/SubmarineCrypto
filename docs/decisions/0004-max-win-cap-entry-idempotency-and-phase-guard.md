# 0004 — The max-win cap, entry idempotency, and the phase guard

**Status:** accepted
**Date:** 2026-08-30
**Milestone:** M1.5 (risk caps and auto-orders), first tranche

## Context

Three criteria were **declared but unenforced**. Each had passing tests, which is
the part worth noting: the suite was green because it asserted what the code did,
not what the criteria said.

1. **PL-4's max-win cap.** The criterion reads "0 ≤ payout ≤ min(50 × stake,
   $10,000 cap)". Only the lower bound held. `clampCents` existed in
   `@crush/ledger` and was correct, but no settlement path called it. At stake
   $2,500 and M = 60 the engine paid $150,000 — fifteen times the cap. A
   `PL-4 [GAP]` test recorded the uncapped behaviour as an executable assertion,
   designed to fail the moment the cap landed.
2. **EN-7's idempotency key.** `OpenRequest.id` was documented as the key and
   stored on the position, but nothing checked it. A replayed request — the
   ordinary consequence of a dropped ack, which the Phase 2 gateway will retry —
   opened a second position and took a second debit.
3. **RL-1's transition graph.** `setPhase()` had no guard. `setPhase('settling')`
   twice called `forceSettleAtRoundEnd()` twice. A passing test documented this
   as current behaviour.

Additionally, M1.5 fills `onTick`'s empty auto-order slot, and CR-1 fixes that
slot's position between the crush check and the ascent settlement. The τ those
triggers are evaluated at had no criterion.

## Decisions

### 1. The cap is clamped at the single float→money conversion, not at the trigger

`payoutFor` now clamps to `min(maxWinMultiple × stake, maxWinCents)` after the
one rounding. Three properties follow, and each was a reason to put it there:

- **Unconditional across settlement reasons.** AO-5's auto-surface trigger stops
  a position running past 50×, but a trigger cannot catch a gap tick that crosses
  the cap *between* two ticks, and a round-end settlement (RL-4) has no trigger to
  route through at all. Clamping at the conversion covers every reason by
  construction rather than by remembering three call sites.
- **After the rounding, never before.** Clamping the float and then rounding
  would be a second float→money conversion, which PL-4's computed-once rule
  forbids. Clamping the already-rounded integer is exact.
- **The cap bounds the money, not the record.** `Settlement.multiplier` stays
  unclamped, because LG-4 retains `M` as it actually stood.

The bounds live in `EngineConfig` (`maxWinMultiple`, `maxWinCents`) rather than as
literals: RK-3 makes them operator-configurable within house limits, and M1.7 must
be able to sweep them. They are read at the same round boundary as θ.

`livePnl` goes through the same capped path, so the live readout never promises
money the cap will not pay — a figure that climbed past the ceiling and settled at
it would look like the house shaving a win at the last moment.

**The cap binds on longs only, and that is arithmetic, not an oversight.** A
Dive's multiplier is `1 + L·(1 − I_t/I_e)`; since the index cannot go below zero,
a short's `M` is bounded above by `1 + L` — 26 at the top leverage of 25×. No
short position can reach 50× by price. `max-win-cap.test.ts` asserts this
explicitly so the asymmetry is recorded rather than silently avoided.

### 2. A replayed entry id is a no-op returning the existing position

Not a rejection. The replay is the *same* request and its original outcome was
success; a retry after a lost ack is asking "did this land?", and the answer is
"yes, here it is". `POSITION_OPEN` is EN-5's answer to a *different* second
request, and returning it would tell a client to abandon a position it owns.

**The id check therefore ranks above every EN-8 rejection**, including the loss
lock. The ranks answer "why can't you open a position?"; a replay is not asking
that. Each rejection would be actively wrong on a retry:

| Code | What it would wrongly imply on a replay |
|---|---|
| `LOSS_LIMIT_REACHED` | RP-2 blocks *new* entries; it cannot unmake one already open |
| `ENTRY_CLOSED` | the original entry was accepted inside the window |
| `POSITION_OPEN` | the position it names is the caller's own |
| `INSUFFICIENT_BALANCE` | the stake is already debited; the position is paid for |
| `NO_PRICE` | `I_e` was fixed at the original entry tick; no new price is needed |

The replay does not re-derive `I_e` — the position keeps its entry tick (EN-2) —
which is what makes the retry safe to send at all. It repeats the original
`position-opened` event and emits **no** `wallet-changed`, since nothing moved and
a spurious one would re-run the client's responsible-play check.

The window is the position's lifetime in engine state, through `done` until
`clearSettled` drops it. Past that the id has left the engine and EN-5 plus LG-3
govern; a Phase 2 authority keeps a longer-lived id set, which is a server
concern and deliberately not modelled here.

### 3. `setPhase` enforces the graph; `resetPhase` is the one bypass

`setPhase` accepts only the current phase's legal successor — self-transitions
included, since no phase in RL-1's graph is its own successor — and returns
whether it moved. `resetPhase` seeds a phase out of band for the two callers that
legitimately have no predecessor: `main.js` at boot, and tests starting mid-cycle.

Kept as a separate named export rather than a flag, so a bypass is greppable.
`resetPhase` still runs the phase's entry effects — boot needs `waiting`'s overlay
cleared — so it is a seed, not a silent poke at `S.phase`.

The guard exists because **phase entry is not idempotent**. This is a money
defect, not a state-hygiene nicety: a second entry into `settling` settles every
open position twice.

### 4. CR-6b — τ-alignment of auto-order triggers

Written **before** the triggers, deliberately. Writing the criterion after the
code would mean the first implementation chose the τ and the test merely ratified
it — the failure mode that produced the CR-6 drift risk in the first place.

A trigger evaluated against a stale multiplier (τ=n−1 while the crush line is at
τ=n) is the same defect class as CR-6's crush-line drift, at the same magnitude,
so it carries the same severity: a release blocker. Oxygen makes `M` strictly
time-dependent, so one stale tick is one tick of edge landing on the wrong side of
a payout decision — 0.03125 of multiplier at θ = 0.25 %/s, which on a $2,500 stake
is $78.

`auto-order-tau.test.ts` asserts what the empty slot will inherit: the τ visible
at the slot's position in the tick sequence is this tick's τ, and it is the same
τ the crush check above it and the settlement below it use. When M1.5 lands the
triggers, those assertions stay valid unchanged.

## Consequences

- `payoutFor` and `livePnl` take config; `maxPayoutFor` is exported because the
  client shows the cap on the bet sheet and must read the engine's number.
- The `PL-4 [GAP]` test is deleted and its bound folded into the ledger's main
  PL-4 property, as that test's own comment instructed.
- `apps/client` gains `CFG.MAX_WIN_MULT` / `CFG.MAX_WIN_CENTS`, read at the round
  boundary alongside θ.
- 397 tests pass (up from 363); `packages/*` stays at 100 % coverage.

## Which bound actually binds today

Both, and the crossover sits inside the live stake ladder — worth recording,
because a cap that binds nothing is a cap nobody notices is broken.

The two bounds are equal at stake $200 (50 × $200 = $10,000). `CFG.STAKES` runs
$1 … $250, so:

- **below $200** — every ladder step up to $100 — the **50× multiple** binds;
- **at $250**, the top step, the **$10,000 absolute cap** binds: 50 × $250 is
  $12,500, so the cap trims $2,500 off the theoretical maximum.

So the absolute cap is reachable in ordinary play at the top stake, not merely a
Phase 2 provision. Both regimes are exercised by `max-win-cap.test.ts` on either
side of the crossover.

Reachability of a *capped payout* is a separate question from reachability of the
bound: 50× requires a 5 % index move at 10× leverage or 2 % at 25×, inside a 90 s
round. M1.7's Monte-Carlo run will report how often the cap actually binds, which
is the number that matters for RTP.
