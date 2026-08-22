# 0003 — Oxygen, tick-derived τ, and the round timings

Status: accepted · M1.4 · supersedes nothing · builds on [0002](0002-pure-engine-and-event-seam.md)

## Context

After M1.3 the engine was pure and tested but had **no house edge**: `M_t` was
`1 + L·d·(I_t/I_e − 1)` with the `−θτ` term deliberately absent, so RTP was
100 % minus rounding. Round timings were the prototype's 75 s / 5 s rather than
the spec's 90 s / 8 s, and there was no entry cutoff at all.

M1.4 adds the edge and the timings. Four things had to be decided to do it.

## Decision

### 1. τ is a tick count, never a clock reading

`Position.ticksElapsed` is incremented once per authoritative tick, and
`τ = ticksElapsed × config.tickSeconds`. Nothing in the oxygen path reads a
clock; `packages/engine/test/purity.test.ts` already bans `Date.now`,
`performance.*` and `new Date` in engine source, so this is structurally
enforced rather than merely intended.

The entry-execution tick is **tick 0**, so `M = 1` exactly at entry for every
θ — a position never pays for the instant it opened.

Two consequences worth stating, because they are the reason for the rule:

- **A replayed round reproduces its oxygen exactly** (M1.6, VR-2). A wall-clock
  τ would make the settlement depend on how fast the fixture file was read.
- **A jitter gap costs one tick, not the interval.** Game logic §8 treats a
  125–2000 ms gap as one tick. Under a wall-clock τ a network hiccup would
  charge the player 2 s of oxygen for time the game did not deliver. Under a
  tick count it costs exactly what every other tick costs. `PL-1` now says so.

### 2. τ advances *before* the tick is evaluated, not after

`onTick` increments `ticksElapsed` in slot 0, ahead of the crush check. Every
check in the tick therefore sees that tick's own τ.

This is `CR-6` written as code rather than as a test-only assertion. Had the
increment come last, the engine would test the τ=n−1 line on tick n while the
client — reading the position it was just handed — drew the τ=n line. That is
precisely the one-tick-wide mismatch `CR-6` calls a release blocker, and at
θ=0.25 %/s the two lines differ by a visible amount, not by an ulp.

The `CR-6` test is the durable guard: across 720 ticks × both directions × all
four leverages it asserts that a tick exactly at the engine's own displayed line
crushes, and that one representable double on the survival side does not. If the
drawn line and the tested line ever drift by a single ulp, one of those flips.

### 3. θ is snapshotted onto the position at entry

`PL-2` requires a θ change to take effect only at a round boundary. Enforcing
that purely in the round machine — "only re-read config in `launching`" — is a
convention, and conventions do not survive a Phase 2 server that has several
paths into the same state.

So it is enforced twice. `Engine.beginRound()` re-reads config at the
`launching` boundary and nowhere else, **and** `open` copies
`config.thetaPerSecond` onto `Position.theta`, which is what every later
computation for that position reads. A caller that broke the first rule and
swapped config mid-round still cannot change the edge on a position that is
already open — asserted directly by
`PL-2: theta is snapshotted at entry — a mid-round config change cannot reach in`.

This also produces `LG-4`'s "θ in force" for free: the settlement retains the
value the position actually settled under, not whatever config happens to hold
when the record is read.

### 4. The entry cutoff is a fact handed to the engine, not computed by it

`EN-1`'s T−5 s window depends on the round clock, and the engine deliberately
owns no clock. Rather than smuggle one in, `OpenRequest` carries
`entryOpen?: boolean`: the round machine evaluates it against the authority's
clock and the engine owns only the consequence — the `ENTRY_CLOSED` rejection
and its `EN-8` rank. At M2.2 the round server answers the same question and
nothing else on the entry path changes.

It is evaluated **after** the Gateway's latency leg, because `EN-1` is about
when a request is *received*. A tap at T−4.98 s that lands at T−4.92 s is late,
and must be late on the client exactly as it would be on the server — otherwise
the optimistic mirror accepts entries the authority will reject and has nothing
to reconcile to (the same failure mode ADR 0002 recorded for `tryOpen`).

The predicate lives in its own module, `apps/client/src/core/entry-window.js`,
because both the Gateway and the console need it and routing it through
`round.js` would close a `round → gateway → round` cycle for one function.

**`ENTRY_CLOSED` ranks second in `EN-8`, above `POSITION_OPEN`.** The existing
principle was "a session-terminal condition is never masked by a transient one";
this milestone generalises it to "a condition the player cannot clear is never
masked by one that clears on its own". A closed window is round-terminal —
nothing reopens it — whereas an open position settles by itself. Telling a
player `POSITION_OPEN` when the window has also shut implies that waiting for
the settle would let them in. `EN-8` was amended to say this.

## Consequences

- **The build has a house edge.** A 90 s hold at a flat index now returns
  `M = 0.775` — 38 750 ¢ on a 50 000 ¢ stake — where M1.3 returned the stake
  exactly. θ = 0.25 %/s is the spec's opening value and is explicitly *not*
  calibrated; M1.7's Monte-Carlo harness sets the real one against RTP 96.5 %.
  It is read from `EngineConfig`, never a literal, so that harness can sweep it.
- **The crush line creeps.** Over a 90 s round a 10× Surface line walks from
  900 to 922.5 with the index motionless. `crushIndex` gained θ and τ; the
  renderer needed no change beyond a degenerate-case guard, because it already
  read `Engine.liqIdx` — the `CR-6` "one computed number" property paying off.
- **Oxygen alone can crush a position.** At τ = 1/θ the line reaches `I_e`. That
  is 400 s at θ = 0.25 %/s, far outside a 90 s round, so in v1 it is a property
  of the math rather than a reachable state — but it is tested, because M1.7 may
  raise θ and M1.5's auto-orders change how long positions live.
- **126 tests, 100 % coverage on `packages/*`.** New suites: PL-1 (τ from ticks,
  the oxygen term), PL-2 (config-sourced and entry-snapshotted θ), PL-3 (oxygen
  during ascent), CR-1 (evaluation order, τ-before-check), CR-3 (the creeping
  line), CR-6 (τ-alignment across a full round), EN-1/EN-8 (the cutoff and its
  rank), UI-4 (the O₂ gauge).
- **Tests are now typechecked.** `tsconfig.tests.json` was added to
  `npm run typecheck`. The M1.3 test files built `Position` literals by hand;
  when the type gained two required fields those literals became invalid, and
  the failure surfaced as a runtime `NaN` inside `roundHalfAwayFromZero` rather
  than as a compile error. `LG-2` wants a float in a money field to fail CI, and
  it very nearly did not. `@types/node` was added as the dependency this needs —
  `purity.test.ts` had been importing `node:fs` untyped.
- **The auto-order slot is still empty**, and there is now a test asserting that
  nothing settles from it. M1.5 fills it rather than rewriting the loop.

## Deliberately not done

- **θ is not calibrated.** 0.25 %/s is the spec's starting figure. `PL-6` is
  M1.7's exit criterion, not this milestone's.
- **No `50×` auto-surface and no `$10k` cap.** `PL-4`'s property test bound
  (`0 ≤ payout ≤ min(50 × stake, $10,000)`) is not yet enforced in code — that
  is `AO-5` and `M1.5`.
- **No `EN-4` range validation.** Leverage-set membership, the $0.50 minimum and
  `stake × lev ≤ $2,000` remain M1.5.
- **No re-entry cooldown.** Still M1.5, as ADR 0002 recorded.
