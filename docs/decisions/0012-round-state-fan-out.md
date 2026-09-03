# 0012 — RoundState, the fan-out seam, and canonical event ordering

**Status:** accepted · **Date:** 2026-09-03 · **Milestone:** M2.0

## Context

`@crush/engine` is pure, immutable and correct, and it models **one player**.
`EngineState` holds one `Wallet`, one `position`, one `lastResult`, one
`lossLocked` flag. Every M1.3–M1.5 acceptance id is pinned to that shape.

A round authority does something the package has never been asked to do: it
applies **one authoritative tick to N player states** and settles each against
the same `I_t`. The Phase 2 plan originally described M2.2 as "running the
Phase 1.5 engine unmodified", which was not achievable as written — not because
the engine is wrong, but because nothing in it fans out.

Discovering that inside M2.4, where the same commit would also be binding money
to a network and to a ledger, is the expensive version of finding it. So the
fan-out is M2.0: first in the phase, in the package, with no sockets and no
database, verifiable at the standard Phase 1.5 held.

Three questions had to be answered before any of it was code.

## Decisions

### 1. The fan-out wraps the per-player functions; it does not replace them

`open`, `onTick`, `requestAscent`, `settleAtRoundEnd`, `clearSettled` and
`setLossLocked` keep their signatures, their semantics and their tests. The new
`RoundState` holds a `ReadonlyMap<PlayerRef, EngineState>` — the **existing**
per-player state, embedded verbatim rather than adapted into a round-flavoured
variant.

The reason is the test suite, and it is not sentimentality about a green bar.
Those functions are where CR-1's evaluation order, EN-8's precedence, PL-4's
single rounding, AO-4's same-tick tie-break and CC-4's strict-improvement rule
are pinned. A rewrite would put 400-odd passing tests up for renegotiation and
buy nothing: the per-player math is not what multi-player changes. What changes
is *who it runs for* and *in what order the facts come out*.

The practical consequence is that a single-player golden vector remains valid
evidence under load — RS-8 states that as a criterion and tests it directly at
2,000 players.

### 2. Order-independence is structural, and the tests prove rather than establish it

RS-2 requires that applying a tick to `{A, B, C}` produce the same settlements
in any iteration order. That could have been pursued by testing permutations
until they passed. Instead it follows from one property of the fan-out
primitive, which is the only place a tick reaches more than one player:

> read each player's state, call the per-player function, write the result back
> under that player's key — and do nothing else.

No accumulator crosses players. No earlier player's result is an input to a
later one. The map being built is never read back while it is being built. Given
that, order *cannot* matter, and the permutation tests are checking that the
property still holds rather than establishing it by sampling.

The iteration itself is nonetheless run in sorted order rather than `Map`
order. That is not needed for the resulting state — which would be equal either
way — but it is needed for the **event log**, which is a sequence and therefore
sensitive to the order it was appended in. Sorting the iteration makes the log
insertion-order-independent too, which is what RS-4 needs.

### 3. Canonical order is code-unit ascending by player reference

Round events are the per-player events concatenated in ascending `PlayerRef`
order, each player's own event order preserved inside its block. Every event
carries its player reference and the round id, so the sequence is
self-describing (RL-5).

`localeCompare` is explicitly rejected. It is locale- and ICU-version-dependent,
so two servers on different runtimes could order the same round's events
differently — which defeats the entire purpose of declaring a canonical order.
Code-unit comparison is fixed by the language specification and cannot drift
between deployments. The visible consequence is that `p10` sorts before `p9`;
that is correct and is asserted directly, because a future maintainer's instinct
to "fix" it into numeric ordering would silently change the archive's canonical
sequence.

### 4. `UNKNOWN_PLAYER` is a round-level code, not a new `RejectCode`

RS-5 refuses an entry naming a player the round does not hold. That rejection is
deliberately **not** added to `RejectCode`.

`RejectCode` is the per-player engine's answer to "why can't this player open a
position?", and every code in it carries an EN-8 rank against the others.
"This player is not in this round" is a different question, asked one layer up,
with no rank in that list. Folding it in would put a round-addressing failure
inside a precedence order that never contemplated one, and would force every
existing EN-8 exhaustiveness test to reason about a code that cannot occur at
that layer.

The related decision: seating is **explicit**. A round never creates a player
from an arriving request, because a wallet that appears because a request named
it is a balance from nowhere. Seating is the operator-session step (M2.5) and
happens before the entry, never as part of it.

### 5. RL-1 is enforced by the round's own phase setter

The client's `round.js` already learned this: phase entry is not idempotent, so
"no other transitions exist" must be a property of the **setter**, not of its
callers. At round level the stakes are multiplied by the population — entering
`settling` twice settles every open position in the round twice.

`setRoundPhase` accepts only the single legal successor, self-transitions
included, and returns `changed` so an authority logging every transition (RL-1)
can tell a refusal from a success. `resetRoundPhase` is the one sanctioned
bypass, a separate named export so every place the graph is skipped is greppable.

`settling` reads the final tick from the round's **own retained series** rather
than taking one as a parameter, so the tick a round settles against is
necessarily one the round actually applied. A `settling` transition on a round
with no ticks settles nothing rather than inventing an `I_t` no player ever saw.

### 6. Directional exposure is computed, not maintained

RS-7 exposes open notional per direction — the number RK-1's cap and M2.6's kill
switch act on. It is derived on demand from round state rather than kept as a
running total, because a running total is a second source of truth that can
drift from the positions it claims to describe, and the drift would be silent.
RK-1 and M2.6 both need this number re-derivable from the archive.

Ascending positions **count**. A position inside its 500 ms Blow can still crush
(CO-2), so its notional is still live risk; excluding it would understate the
aggregate for exactly the half-second in which a fast move resolves it.

M2.0 computes the aggregate and enforces nothing. The cap is risk-engine policy
and its rejection code belongs with RK-1, at M2.6.

## Consequences

- New acceptance criteria `RS-1`…`RS-8` cover round state, fan-out determinism,
  player isolation, canonical event ordering, round-scoped entry, phase
  authority, the directional aggregate and population invariance of money.
- `@crush/engine` gains `round.ts` and `round-types.ts`. The purity guard covers
  them unchanged, and gains a round-level replay determinism test alongside the
  per-player one.
- Every existing per-player test passes **unmodified**. The suite goes from 637
  to 680 passing; `round.ts` is at 100 % lines, branches and functions.
- M2.4 consumes this shape rather than inventing one. The single-writer round
  authority of ADR 0010 applies one tick through `roundTick` and writes the
  canonical event sequence to the archive and the ledger.
- `PlayerRef` is a plain string — the opaque operator-scoped reference of
  ADR 0011 and LG-4, never identity. It is also the sort key, so it must stay
  comparable without consulting anything outside the round.

## Open

- **Fan-out cost at PF-3 scale is unmeasured.** The fan-out is O(n log n) per
  tick from the sort, and structurally shares unchanged player objects so a tick
  allocates only for players something happened to. Whether that meets the
  ≤ 25 ms p99 budget at 10,000 players is a question for a real process under
  real load, not for this package. If the sort ever becomes the bottleneck, the
  order is a *declared* order, not a derived one — a maintained sorted key list
  would preserve RS-4 exactly.
- **Refunds and voids (EN-6, MF-1) have no round-level path yet.** A round that
  aborts must refund accepted entries that never executed. That is M2.1's
  SIGNAL LOST decision and M2.3's ledger, and it needs the wallet contract
  settled first.
