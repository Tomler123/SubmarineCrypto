# 0002 — Pure engine, event seam, and the crush boundary (M1.3)

Status: accepted · Date: 2026-08-23 · Milestone: M1.3

## Context

`apps/client/src/core/engine.js` held the position math and settlement, and
called `FX`, `Au`, `feedMsg`, `toast` and `checkLossLimit` directly from inside
`settle()`, plus a deferred callback to clear the settled position. That is six
dependencies that cannot move to a Phase 2 server. Money also ran through
`Math.round` on a float product, which is half-up and therefore asymmetric
across zero — the `PL-4` / `LG-2` defect recorded in the roadmap gap list.

## Decisions

**The engine returns events; it does not call anything.** Every entry point has
the shape `(state, …args) => { state, events }`. The client subscribes and
decides what an event looks and sounds like. This is what lets the identical
package run as the Phase 2 server authority, where the same events become log
lines instead of animations.

**The engine is a pure function of its inputs.** No DOM, no timers, no clock
reads, no RNG. Every timestamp arrives on a tick, so a settlement is
reproducible from its tick series alone — the property `M1.6` replay
determinism and `VR-1` round recomputation both depend on.
`packages/engine/test/purity.test.ts` enforces all of it textually, including
`Date.now`, `performance.*` and `Math.random`, which were added at M1.3.

**State is immutable; the client keeps a mirror.** The engine owns its state and
returns new objects. `apps/client/src/core/engine.js` mirrors it into the
mutable `S` singleton after every transition, so `renderer.js`, `console.js`,
`round.js` and `frame.js` read exactly what they read before and none of them
needed changing. The mirror is a Phase 1.5 convenience; in Phase 2 it becomes
the optimistic client mirror behind `Gateway` acks, which is the same shape.

**Crush is decided on the index, not on the float multiplier.** `CR-1` states
the condition as `M_t ≤ 0` and `CR-3` states the line as
`I_e·(1 − d·(1 − θτ)/L)`. In exact arithmetic these are inverse; in IEEE-754
they are not. Round-tripping through both puts `M` at ±2.2e-16 at the line, with
the sign depending on leverage — so testing the multiplier would crush a
position sitting exactly on its displayed line at 10× and 25× while sparing it
at 5×.

`isCrushed` therefore compares the tick against the crush line, which is exact
and inclusive at every leverage, and makes the crushed set exactly the set at or
beyond the line the player was shown. M1.4 preserves the property by moving τ
into `crushIndex` rather than into the comparison.

This was a spec gap rather than a spec violation — the documents did not say
which side to evaluate when floats separate them. **Resolved in the spec** (game
logic §5 v0.2 amendment, `CR-1`, `CR-3`, new `CR-6`): the line is the operative
test, the multiplier is its consequence, and the displayed line and the tested
line must be the same computed number for the same tick. We state the rule to
the lab rather than asking them to choose it.

**`Settlement` is self-contained.** It carries direction, stake, leverage and
`I_e` alongside the tick, multiplier, payout and pnl. `LG-4` requires the ledger
to retain all of them, and it means a settled record can be rendered or audited
without reaching back into a position the client has already dropped.

**Rejection precedence is a rule, not reading order (`EN-8`).** Order is
loss-lock → position-open → balance → no-price. The principle: report the
condition the player must resolve first, and never let a transient condition mask
a persistent one. The prototype checked balance before loss-lock, so a
loss-locked player with a small balance was told "INSUFFICIENT BALANCE" — which
implies "deposit more and continue" to someone the session has already cut off.
That is an `RP-2` defect, not a copy preference, so the order is asserted by test
at every rank rather than left to reading order.

**`NO_PRICE` is not `SIGNAL LOST` (`EN-9`).** MF-1 is a round-level abort:
positions auto-surface, the round dies, it is alarmed. `NO_PRICE` rejects one
request, settles nothing, aborts no round. Collapsing them would cost the back
office the ability to distinguish "the feed died" from "one entry raced the round
start" — and a rising `NO_PRICE` rate is precisely the early warning worth
keeping, so it is a counted `BO-2` metric. Player copy is
"STANDBY — NO ENTRY PRICE YET": honest, non-alarming, and it does not promise an
incident that is not happening. `ROUND_ABORTED` is reserved in `RejectCode` now
so M2.1 does not overload `NO_PRICE` for the MF-1 case.

**The client mirror may not be stricter than the authority.** `tryOpen` guarded
on `S.pos` existing, which is true for ~900 ms after settlement while the wreck
is drawn — so the client silently enforced a re-entry rule the engine does not
have (`EN-5` permits re-entry once a position settles). In Phase 2 that shape of
divergence is an optimistic mirror refusing an entry the server would accept,
with nothing to reconcile to. The guard now tests `state !== 'done'`.

That leaves a real product question the bug was masking: re-entry probably
*should* carry a beat, both because instant re-entry cheapens the Blow and
because it is the loss-chasing loop `RP-5` bounds. **M1.5 adds it as an engine
rule** — `reentryCooldownMs` in `EngineConfig` with a `COOLING_OFF` rejection —
so the animation and the cooldown are the same number because they are the same
rule, not because they coincide.

**Packages get conditional exports.** `development` and `types` resolve to
`src/*.ts` for Vite, Vitest and `tsc`; `default` resolves to `dist/*.js` so the
compiled package is runnable under plain Node with no bundler and no loader
flags. Verified by running a settlement end to end under bare `node`. Without
this the `dist` output re-imported `@crush/ledger` as raw TypeScript and failed,
which would have surfaced as a Phase 2 problem rather than an M1.3 one.

## Consequences

- 87 tests, 100% coverage on `packages/*`; `packages/engine/src/index.ts` came
  off the coverage exclusion list. The `CR-1` boundary is asserted at every
  direction × leverage, both exactly at the line and one representable double
  short of it, plus a test that pins the leverage-dependence of the rejected
  multiplier formulation so a refactor back to it fails loudly.
- `renderer.js` and `console.js` each dropped an inline copy of the P&L formula
  in favour of `Engine.pnl`, so a live readout cannot drift from the settled
  figure (`UI-2`) once M1.4 adds `−θτ`.
- The known import cycles are unchanged in shape: the adapter still imports the
  renderer, audio and UI in order to *render* events. They resolve when the
  client takes a subscriber list instead of direct calls — natural alongside the
  M1.8 Pixi port.
- Spec amended, not merely annotated: game logic §5 (line authoritative),
  `CR-1`, `CR-3`, new `CR-6` (τ-alignment), new `EN-8` (precedence) and `EN-9`
  (`NO_PRICE` ≠ SIGNAL LOST), `BO-2` (rejection counts). The specs remain
  authoritative over the code, so the code followed them.
- Still absent by design, and owned by later milestones: oxygen and the `−θτ`
  term, 90 s / 8 s / T−5 s timings (M1.4); `EN-4` range validation, auto-orders,
  the 50× / $10k caps and the `CR-6` client-line assertion (M1.5). **The build
  has no house edge.**
