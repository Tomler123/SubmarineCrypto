# Crush Depth — The Descent Plan

**Rev. 11 · 2026-09-02 · B2B provider model · ADR 0011**

> This is the portable, plain-text mirror of the delivery-plan artifact. It is
> the version to paste into any tool that cannot open a `claude.ai` link.
> Artifact (Claude only): <https://claude.ai/code/artifact/2809e5f4-fdbd-4788-b8bb-a14559192018>
>
> Keep the two in sync. When the plan changes, edit this file, then republish
> the artifact from it.

Seven phases from the current TypeScript monorepo to a licensed, real-money
BTC-driven crash game. Ordering is **dependency-driven, not preference-driven**:
each phase exists because the next one is unsafe or unverifiable without it.
Money-handling work sits behind a hard gate that cannot be opened by writing more
client code.

---

## Status at a glance

| | |
|---|---|
| Phase complete | **1.0** — prototype, module split · **1.5** — correctness (10 of 10 tasks + Close Calls) |
| Phase in progress | **2** — server authority; M2.0 is the next commit |
| Commercial model | **B2B game provider** — operator holds funds and player; provider owns index, round, engine, settlement (ADR 0011) |
| Engine | Pure, immutable TypeScript; entry validation, auto-orders, caps and authoritative Close Call facts live. **Single-player shaped** — one wallet, one position (see M2.0) |
| Tests | **628 passed, 4 skipped** across 50 files; package coverage gates pass (Close Call module 100%; sim 96.04% lines, 84.55% branches, 100% functions) |
| Spec documents | **2 of 2** — 127 acceptance ids across 20 categories |
| Carried forward from 1.5 | PF-1 on-device measurement and by-eye Pixi parity review — both gate flipping the renderer default, neither gates M2 |
| Next planned work | **M2.0** (multi-player engine shape) → **M2.1** (feed aggregation) → **M2.2** (tick authority) |

---

## What changed in Rev. 11

**The commercial model is now B2B.** Crush Depth is a **game provider**
integrated into licensed casino operators, not an operator itself. Recorded in
ADR 0011, with the specs amended: `FI-20`, `LG-1`, `LG-4`, `EN-3`, `EN-6`,
`MF-2`, `MF-3`, `RP-2`, `RP-4`, `BO-4` edited; **`LG-5` and a new `WL` group
(`WL-1`…`WL-8`) added**; game logic header and §7 updated.

This is not a deployment detail. It moves the most regulated component in the
system — custody of player funds — out of this codebase entirely, and changes
what the provider is certified for, what it may enforce, and what it is
permitted to know about a player.

- **The operator owns the player; the provider owns the game.** Operator:
  registration, KYC/AML, deposits, withdrawals, **balance authority**,
  geofencing, primary responsible-gambling controls. Provider: index, round,
  engine, settlement, internal ledger, game-level risk. The dividing line is
  **custody, not information** — the provider still receives everything it needs
  to run a compliant round.
- **Seamless wallet is recommended and adopted.** The alternative, transfer
  wallet, parks funds in a provider-held session balance — which is exactly the
  custody the B2B model exists to avoid, and drags fund-safeguarding obligations
  back into scope. The honest cost: **the operator's wallet is now on the
  critical path of every entry** (`WL-8`).
- **The provider keeps a full internal double-entry ledger anyway.** Not in
  tension with "no custody": it records the *game's* view against internal game
  accounts and an operator-receivable, and is **reconciled** against the
  operator's wallet rather than being it (`LG-5`). It survives the loss of
  custody because dispute resolution, reconciliation, certification evidence and
  correctness all still need it. "Ask the operator" is not an evidence bundle.
- **M2.5 is reframed** from "accounts and sessions" to **operator authentication/
  session integration plus server-side enforcement of operator-supplied
  eligibility**. The provider builds no registration, KYC, deposit or withdrawal
  flow. Less code, **identical compliance obligation**: a provider that lets a
  self-excluded player open a position is a compliance incident regardless of
  which system erred.
- **A new required decision gates M2.3 and M2.4**: the internal wallet contract.
  Its shape determines the ledger's account structure, the entry path's failure
  modes and the round server's latency budget — all three expensive to change
  afterwards.
- **`FI-20` widened**: rights may come **direct from each venue or through an
  authorised commercial data vendor**, provided the **chain of rights is
  documented end to end**. The criterion now names **which party needs which
  right** — and flags **sublicensing** as the clause most likely to be missed:
  a licence letting the provider publish but not sublicense looks adequate on
  paper while making the B2B model unshippable.
- **M3.1 expanded** beyond the operator's licence to **provider/software-supplier
  licensing and per-game approval**, which most regulated markets treat
  separately and additively.
- **A laboratory/regulatory pre-assessment is added before production M2.2
  completes** — not full certification, an early paid engagement on the specific
  question of a price-settled outcome. It lands there because M2.2 is where the
  evidence model becomes concrete and expensive: if a lab says the archive needs
  a field we are not capturing, that is cheap while the archive is being designed
  and very expensive after months of ticks in the wrong shape.

**ADR 0010 is unaffected** in its venue, liveness, PF-3 and topology decisions;
only FI-20's rights-sourcing clause is widened. **Nothing in `@crush/engine`
changes** — the engine already treats the wallet as state handed to it, so a
balance mirrored from an operator rather than owned is invisible to it. That is
the payoff of the M1.3 purity rule.

## What changed in Rev. 10

Rev. 9's two open questions are **answered and ratified**, and one Rev. 9 claim
is **retracted as wrong**. All of it is recorded in ADR 0010, with the specs
amended: `FI-4`, `FI-5` and `PF-3` edited, `FI-17`…`FI-20` added, game logic §1
and §8 updated.

**Retraction.** Rev. 9 said the specification named no exchange venues. It does.
Game logic §1 fixes the price source as the median mid-price of BTC/USDT across
Binance, Coinbase, OKX, Bybit and Kraken. The Rev. 9 analysis read the acceptance
criteria — where FI-4 and FI-5 are deliberately venue-agnostic — and failed to
carry §1 forward. The venue set was never open.

What *was* missing, and is now specified, is everything around it: what makes a
venue live, what the 2 s bound is measured against, whether a round may start on
the bare minimum, and what rights the operator must hold in data that determines
a real-money outcome.

- **`VENUE_SET_V1` ratified** — those five venues, spot BBO midpoint only, no
  derivatives or aggregators, versioned under VR-3 (`FI-17`).
- **Liveness is a five-part conjunction and heartbeats do not satisfy it**
  (`FI-18`). A venue is live only with an online instrument, an acknowledged
  subscription, a continuous sequence/checksum, a valid non-crossed positive BBO,
  and a *real market-data update* within 2,000 ms on the server monotonic clock.
  The heartbeat clause is load-bearing: a healthy socket carrying a frozen book
  would otherwise settle money against a stale price.
- **The abort trigger is the composite, not the venue** (`FI-5`). One stale or
  filtered venue is excluded, not an outage; SIGNAL LOST is declared when a valid
  ≥ 3-**survivor** composite cannot be formed. The floor counts post-filter
  survivors, so five live venues with three excluded as outliers is not a tick.
- **Rounds start on four venues live for 10 s, and continue on three**
  (`FI-19`) — headroom at start costs nothing when the feed is healthy and
  avoids voiding every position on the first hiccup.
- **Market-data rights are an M2.2 release blocker** (`FI-20`): commercial
  outcome determination, archival, certification access, and **publication of the
  VR-1 data**. Publication is not severable — a feed the operator may consume but
  not publish cannot support "provably market-driven". A venue that cannot grant
  all four is replaced by a versioned spec change and the certification evidence
  regenerated.
- **`PF-3` is now a number**: 10,000 concurrent players in **one shared round**,
  all with active positions, at 8 Hz, ≤ 25 ms p99 internal fan-out jitter over a
  one-hour soak, plus a 20,000-connection five-minute resilience burst. There is
  no sharding escape hatch — every player in a round settles against the same
  tick.
- **M2.4's topology is fixed**: a deterministic single-writer round authority
  behind horizontally scalable stateless WebSocket gateways. Ledger and
  settlement authority stay single-writer; only connection handling and fan-out
  scale out.
- **Legal work starts now**, before M2.2 production transport — both the
  gaming-versus-derivative opinion and the venue rights negotiations, because
  each can invalidate the intended implementation in a different way.

## What changed in Rev. 9

Phase 1.5 is declared **complete**. Its two open items — PF-1's on-device 60 fps
measurement and the by-eye Canvas/Pixi parity review — are real, but they gate
*flipping the renderer default*, not starting server work. Holding a phase open
on two errands that need a phone and a pair of eyes, while the critical path is
server authority, mis-states where the project actually is. They move to a
standing **carried-forward** list.

**Phase 2 has been re-planned from four milestones to seven**, after auditing the
code against what the old plan assumed. Three findings drove the restructure:

1. **The engine is single-player shaped.** `EngineState` holds one `Wallet`, one
   `position`, one `lastResult`, one `lossLocked` flag. M2.2's old wording —
   "running the Phase 1.5 engine unmodified" — was not achievable as written: a
   round server applies one authoritative tick to *N* player states and must
   settle them all. That is a real, testable, purely-in-package milestone, and it
   is now **M2.0**, sequenced first because everything else in Phase 2 consumes
   its shape. It is deliberately scoped as a *fan-out around* the existing
   per-player functions, not a rewrite of them.
2. **Multi-exchange aggregation does not exist and is not the transform.**
   `IndexTransform.next(price)` takes a single price. FI-4 (exclude any feed
   deviating > 0.5 % from the median) and FI-5 (abort below 3 live feeds, or on
   any gap > 2 s) describe a *separate component upstream of the transform* that
   turns N venue quotes into one `P_t` — or into a SIGNAL LOST decision. The old
   M2.1 bundled aggregation, transport, persistence and outage handling into one
   bullet. It is now split: **M2.1** is the pure aggregator (testable offline,
   no sockets), **M2.2** is live transport and the tick archive.
3. **The ledger sat too late.** The old order built the round server (M2.2) before
   the double-entry ledger (M2.3), which means the first version of settlement
   writes to something that is not yet a ledger, and gets retrofitted. LG-1/LG-3
   are the components regulators scrutinise hardest and the most painful to
   retrofit — the old plan said so itself, then scheduled them third. The ledger
   now lands **before** the round server binds settlement to it.

Also corrected in this revision: the Rev. 8 status table reported 583 tests
across 48 files. The suite is **628 across 50**.

---

## What changed in Rev. 8

M1.8 added ADR 0009 and SC-1…SC-8: one `RendererPort`, a pure `SceneModel`
projection a renderer may read and nothing else, parity-critical geometry with a
single shared implementation, and a frame-cadence determinism proof against the
real engine. Canvas remained the default and unmodified as the visual reference;
`?renderer=pixi` is the explicit opt-in. PF-1’s on-device 60 fps and full visual
parity were explicitly **not** claimed.

## What changed in Rev. 7

Close Calls add ADR 0008 and CC-1…CC-8 before implementation:

- eligible successful ascent/round-end settlements use the minimum surviving
  signed index headroom from the authoritative creeping crush line;
- the inclusive v1 threshold is 50 bp, symmetric for Surface and Dive, and the
  complete 500 ms ascent plus settlement tick remains exposed;
- the engine emits `settled → close-call → wallet-changed` with a stable id and
  self-contained closest-tick/settlement facts;
- the client preserves event order, suppresses duplicate ids and formats only
  emitted facts; DOM, timers, execution speed and playback pacing cannot decide
  the result;
- fake social actors retain seeded names/actions but now run isolated real
  engine states instead of recomputing a static line, multiplier and P&L.

Rev. 6 added ADR 0007 and the deterministic calibration evidence bundle:

- `@crush/sim` drives the real engine through both the existing simulator and
  unchanged M1.6 replay source;
- four frozen reference behavior models use trial-addressed seeded randomness;
- simulator evidence selects θ while selected calm/flash-crash replays remain a
  separately reported stress stratum;
- the canonical report includes candidate/error data, per-cell and portfolio
  RTP, 99 % intervals, cap frequency, extrema, exposure, exact seed/config, and
  replay provenance;
- θ is now 0.03 %/s for engineering builds. PL-6's 10⁷-position and ≥90-day
  release evidence remains a hard pre-launch gate.

Earlier revisions closed M1.5's remaining declared-but-unenforced behavior:

- optional TP/SL are validated and snapshotted at entry;
- TP/SL use consecutive-authoritative-tick crossings, with stop-loss winning a
  same-tick tie;
- TP, SL and the 50× max-win level trigger all start the normal 500 ms ascent in
  the fixed crush-first tick slot;
- entry validation and eligibility have explicit rejection codes and a fully
  documented order, with EN-7 accepted-id replay above both;
- re-entry cooldown is 900 ms of authoritative tick timestamps, with equality
  accepted;
- the Gateway/UI carries the values and engine rejection copy without duplicating
  stricter client-side rules.

Eleven architecture decisions are recorded in `docs/decisions/`:

- **0001** — monorepo layout and toolchain
- **0002** — pure engine and the event seam; also settles crush-line authority
  over `M_t ≤ 0`, `EN-8` rejection precedence, `NO_PRICE` vs MF-1, and the rule
  that a client mirror may never be stricter than the engine
- **0003** — oxygen, tick-derived τ, round timings
- **0004** — max-win cap, entry idempotency, RL-1 phase guard
- **0005** — auto-order crossings, entry validation precedence and cooldown
- **0006** — deterministic replay selection, published transform initialization,
  and recorded BTC fixture provenance
- **0007** — deterministic Monte-Carlo streams, reference behaviors, statistics,
  simulator selection versus replay stress evidence, and release evidence tiers
- **0008** — Close Call eligibility, minimum authoritative headroom, inclusive
  50 bp boundary, ascent exposure, event ordering and duplicate identity
- **0009** — the renderer port and the pure scene-model projection
- **0010** — `VENUE_SET_V1`, the five-part liveness conjunction, composite-based
  SIGNAL LOST, the 4-venue round-start precondition, market-data rights as a
  release blocker, PF-3's load target, and the single-writer/stateless-gateway
  topology
- **0011** — the B2B provider model, seamless wallet over transfer wallet, the
  internal ledger without custody, the operator/provider responsibility split,
  vendor-sourced market-data rights with sublicensing, and provider licensing
  plus early lab pre-assessment

M1.6 adds the sixth decision and the feed evidence bundle: `@crush/feed` now
owns the TypeScript feed base, simulator, replay source, interpolation buffer,
published index transform, and fixture parser. The replay uses the approved
fixture-start 125 ms grid, latest-at-or-before selection, original timestamps,
and no gap filling. Binance BTCUSDT aggregate trades provide compact derived
100 ms fixtures, including a rapid 8.05% violent interval.

---

## Current position

### Done

**M1.1 — both specification documents.** Game logic v0.1 and acceptance criteria
v0.1 in the repo root, committed at `1364fcb`. 82 stable ids across 14 categories:
feed, round lifecycle, entry, P&L, crush, cash-out, auto-orders, risk, ledger,
malfunctions, fairness, verifiability, responsible play, back office.

**M1.2 — toolchain and monorepo.** npm workspaces, Vite, TypeScript strict
(`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Vitest with an 80%
coverage gate over `packages/*`, CI on push. `apps/client` stays `allowJs` with
`checkJs` off while the Canvas reference and prototype UI remain JavaScript;
**new code is `.ts`**.

**M1.3 — pure engine.** Position math and settlement moved into
`packages/engine` as pure TypeScript: no DOM, no timers, no clock reads, no RNG.
Every entry point takes a state and returns a new one plus an `EngineEvent[]`, so
the five direct `FX`/`Au`/`feedMsg`/`toast`/`checkLossLimit` calls are gone. Money
is `Cents` end to end with round-half-away-from-zero applied exactly once at
settlement. `apps/client/src/core/engine.js` is now a thin adapter.

**M1.4 — the house edge.** `M_t` carries the `−θ·τ` term, the crush line creeps
per `CR-3`, an O₂ gauge drains on the cash-out button, round moved to 90 s / 8 s
with a T−5 s entry cutoff.

Two rules make this reproducible, and both are load-bearing:

- **τ is a tick count, never a clock reading** — `Position.ticksElapsed ×
  config.tickSeconds`, advanced in `onTick` *before* anything is evaluated
  against it. That is what makes the line the engine tests and the line the
  client draws the same number on the same tick (`CR-6`).
- **θ is read from `EngineConfig` and snapshotted onto each position at entry**,
  so `PL-2`'s round-boundary rule holds even against a caller that swapped config
  mid-round.

The entry cutoff is handed to the engine as `OpenRequest.entryOpen` rather than
computed from a clock the engine must not own. `ENTRY_CLOSED` ranks second in
`EN-8`.

**M1.5 — risk caps and auto-orders.** A test audit found three criteria
that were *declared but unenforced*, with green suites because the tests asserted
what the code did rather than what the criteria said:

- **`PL-4`'s max-win cap** is now clamped at the single float→money conversion in
  `payoutFor`, so it applies to *every* settlement reason rather than only to an
  `AO-5` auto-surface. A gap tick can cross the cap between two ticks, and
  `RL-4`'s round-end settlement has no trigger to route through. The bounds
  (`maxWinMultiple`, `maxWinCents`) live in `EngineConfig` per `RK-3`. The cap
  binds on longs only: a short's `M` is bounded above by `1 + L`, so 26 at 25×.
- **`EN-7`'s idempotency key** is now checked. A replayed `OpenRequest.id` is a
  no-op returning the existing position, ranked **above every `EN-8` rejection** —
  a retry after a dropped ack is asking "did this land?", not "why can't I open a
  position?".
- **`RL-1`'s graph** is now enforced by `setPhase` itself, which accepts only the
  legal successor; `resetPhase` is the one sanctioned bypass, for boot and tests.
  Phase entry is not idempotent — entering `settling` twice settled twice.

**`CR-6b` was added to the acceptance criteria *before* the auto-order code**, so
the trigger τ is fixed by the criterion rather than by whatever the first
implementation happened to do. `packages/engine/test/auto-order-tau.test.ts`
asserts the slot's τ alignment.

The completion tranche adds EN-4/AO-3 runtime validation, immutable TP/SL entry
snapshots, EN-10's 900 ms authoritative-tick cooldown, and TP/SL/max-win runtime
triggers. The tick contract is exactly:

```text
advance τ once → crush → auto-order triggers → due ascent settlement
```

TP/SL compare consecutive authoritative multiplier endpoints; max-win checks the
current authoritative level. Stop-loss wins if both TP and SL somehow qualify,
while crush wins all same-tick conflicts. Every trigger starts the ordinary
500 ms ascent, and PL-4's unconditional payout clamp remains separate.

**M1.7 — deterministic Monte-Carlo calibration.** The package uses the real
settlement lifecycle, explicitly seeded simulator rounds and unchanged recorded
replay ticks. Its four MC-3 behavior models are random hold, take-profit,
stop-loss and max-leverage. Candidate selection uses an equal-weight simulator
portfolio; replay results are stress evidence because the M1.6 calm/flash-crash
fixtures are selected regimes rather than a representative market sample.

Seed `crush-depth-m1.7-reference-v1` selects **θ = 0.03 %/s** at 96.5437 % RTP
over 4,000 selection positions (0.0437 percentage points from target). A
disjoint 20,000-position simulator cohort reports 96.9492 %, with a two-sided
99 % interval of 96.0046–97.8938 %. The canonical JSON retains every candidate
and statistic; the compact Markdown report presents the review surface.

**Close Calls — authoritative fake-social events.** `@crush/engine` observes
every surviving post-entry tick after CR-1, including open, ascent and
settlement ticks, and retains the minimum
`d·(I_t−I_crush(τ))/I_crush(τ)`. Eligible positive-payout ascent and round-end
settlements at or inside 0.5% emit one self-contained stable-id event. Crushes
never qualify. Exact proximity ties retain the earliest tick.

The client projector formats emitted direction, closest tick/headroom,
settlement cause, multiplier and P&L, and suppresses later deliveries of the
same id without sorting. Fake actors use isolated engine states, so no client
module owns a second outcome formula. A Binance-derived recorded replay case
produces the same non-empty Close Call event under fast and chunked pacing.

### Still open (not Phase 1.5 blockers)

**Release-scale θ validation remains open.** M1.7's 0.03 %/s value and RTP are
engineering-preliminary. PL-6 still requires at least 10⁷ simulator positions
and at least 90 days of representative BTC. A production player mixture and
representative historical weighting must be versioned inputs, never inferred
from the two M1.6 stress fixtures.

**Which max-win bound binds is a live question, not a Phase 2 provision.** The
two bounds are equal at stake $200. `CFG.STAKES` runs $1…$250, so below $200 the
50× multiple binds and at $250 the $10,000 absolute cap binds, trimming $2,500 off
the theoretical maximum. Both regimes are exercised by `max-win-cap.test.ts`.

---

## The route down

Depth markers are labels, not estimates. Durations assume one focused developer
and are ranges, not commitments — the licensing phase in particular is
calendar-bound by regulators, not by you.

### Phase 1 — Prototype · 0 m · **Complete**

Prove the game is fun before proving it is correct. Done.

### Phase 1.5 — Correctness · 200 m · **Complete**

Turn a convincing toy into a **verified, deterministic, testable engine** with a
real house edge. Nothing here ships to a player; everything here is what makes
shipping legal later.

All ten tasks and Close Calls are delivered. The two remaining errands — PF-1 on
device and the by-eye Pixi parity review — gate the renderer default, not the
phase, and are tracked under **Carried forward from Phase 1.5**.

| id | Milestone | Status |
|---|---|---|
| M1.1 | Both specification documents | **Done** |
| M1.2 | Vite + TypeScript strict + Vitest + CI | **Done** |
| M1.3 | Pure engine, zero DOM, integer cents | **Done** |
| M1.4 | Oxygen, round timings, entry cutoff | **Done** |
| M1.5 | Risk caps and auto-orders | **Done** |
| M1.6 | `ReplayIndexSource` + recorded BTC data | **Done** |
| M1.7 | Monte-Carlo harness — calibrate θ | **Done** |
| CC | Authoritative Close Calls in the fake social feed | **Done** |
| M1.8 | PixiJS v8 scene port | **Done** (approved scope) |

**M1.5 — Risk caps and auto-orders** *(done)*

Delivered: the unconditional `PL-4` payout cap; `EN-7` entry idempotency; the
`RL-1` phase guard; runtime direction/leverage/stake/notional/TP/SL validation;
immutable TP/SL snapshots; the authoritative-tick cooldown; TP/SL crossing
triggers; the 50× max-win level trigger; Gateway/UI wiring and rejection copy.

The auto-order slot keeps crush precedence and the existing 500 ms market-risk
window. Boundary, gap, tie, no-retrigger, immutability, idempotency, precedence
and client-wiring cases are automated, with a browser checklist in
`docs/test-plans/manual-m1.5.md`.

*Exit criteria satisfied:* every M1.5 cap and entry rule has an AC id; tests drive
both sides of each boundary; the engine remains pure and deterministic; the full
test/coverage/typecheck/build gate passes before the milestone commit.

**M1.6 — `ReplayIndexSource` + recorded BTC data**

A third `IndexSource` implementation replaying recorded 100 ms BTC files. This is
what turns the suite from "the simulator agreed with itself" into "the engine
behaved correctly on a real, adversarial, non-synthetic price series" — including
the flat-market and violent-gap cases the simulator's anti-run pressure will never
produce.

*Exit criteria:* byte-identical settlement across two runs of the same replay
file. At least one recorded flash-crash segment in the fixture set.

*Delivered:* FI-9–FI-15 acceptance criteria, deterministic lifecycle/EOF/gap
behavior, explicit injected-scheduler pacing, Binance-derived calm and violent
fixtures with SHA-256 provenance, and a scripted 25× Surface ascent that
settles after material adverse exposure. The client remains simulator-default;
`?feed=replay` is handled only inside the feed seam.

*Exit criteria satisfied:* replay source exists behind the shared contract;
fixture provenance and checksum are committed; fresh runs and different pacing
produce byte-identical tick/event/settlement artifacts; the full test,
coverage, typecheck, and build gates pass.

**M1.7 — Monte-Carlo harness, calibrate θ to 96.5 % RTP** *(done)*

`packages/sim` runs the real engine across the MC-3 random-hold, take-profit,
stop-loss and max-leverage models. The frozen equal-weight simulator portfolio
is the calibration population; behavior cells remain visible because optional
stopping makes their conditional RTPs legitimately different. The selected
M1.6 replay regimes are reported separately and cannot be weighted into a
population RTP without representative historical data.

*Delivered:* MC-1–MC-8 acceptance criteria; ADR 0007; seeded and injected
simulator randomness; unchanged ReplayIndexSource mapping; deterministic
candidate selection and lower-theta tie-break; 50-batch Student-t statistics;
cap-bind, extrema and exposure evidence; canonical JSON and compact Markdown
artifacts; engineering θ = 0.03 %/s.

*Exit criteria satisfied:* the selected portfolio estimate is 96.5437 %, within
0.2 percentage points of 96.5 %; the disjoint report cohort's 99 % interval
contains the target; all behavior/source cells report variance, uncertainty and
max exposure; identical inputs reproduce byte-identical canonical data and are
invariant to iteration/execution order. PL-6's larger release run remains a
separate pre-launch criterion, not unfinished M1.7 implementation.

**Close Calls — authoritative fake-social events** *(done)*

*Delivered:* CC-1…CC-8; ADR 0008; inclusive 50 bp minimum surviving
headroom; Surface/Dive and inside/equal/outside boundaries; complete ascent
exposure; crush exclusion; self-contained stable-id engine events; ordered,
idempotent client projection; and engine-backed seeded fake actors.

*Exit criteria satisfied:* no Close Call fact is computed from a renderer,
clock, DOM, interpolated value or fake-bot formula; replayed recorded ticks are
byte-identical across scheduler pacing; duplicate delivery renders once; Close
Calls do not alter wallet, settlement, eligibility, round or source behavior;
the full test, coverage, typecheck and build gates pass before completion.

**M1.8 — PixiJS v8 scene port** *(done, approved scope)*

Deliberately last. The Canvas 2D renderer is the visual reference; port it only
once the logic underneath has stopped moving.

*Exit criteria:* renderer behind one interface. 60 fps on a mid-range phone in
portrait. Canvas 2D version retained for visual diffing.

The brief was three lines and the specifications named no renderer at all, so
four questions were settled with the owner before implementation and recorded in
ADR 0009: how much of the visual scene to reach, how the two renderers coexist,
whether PixiJS becomes a dependency now, and where the code lives.

*Delivered:* SC-1…SC-8; ADR 0009; `RendererPort` with an idempotent
`init`/`destroy` pair that survives a destroy racing a pending init; a pure
`SceneModel` projection; shared depth/position mappings pinned bit-for-bit to
the Canvas formulas across four viewports; a frame-cadence determinism proof
against the real engine; a source-tree scan proving no module outside `render/`
names a renderer; and a contract test against the real PixiJS v8 API, since
every other renderer test mocks it.

Scope: the gameplay-critical layers — depth-lit water, the wake chart, sub, pod,
and the UI-4 entry/crush lines. Creatures, god rays, marine snow, sonar, murk
and debris are deferred; they carry no information a player acts on, and adding
them touches `pixi-scene.ts` only.

*Exit criteria status:* the renderer **is** behind one interface, and the
Canvas version **is** retained for diffing — unmodified, and still the default,
which is what makes it a live baseline rather than dead code. **The 60 fps
criterion is not satisfied and is not claimed**: it needs a real device and a
real WebGL context, and neither the jsdom suite nor this environment has one.
Measure it on device, alongside a by-eye parity review, before the default
flips to Pixi.

### Phase 2 — Server authority · 800 m · **You are here** · 14–22 weeks

Move the truth off the client. Until this exists, **every player is trivially able
to rewrite their own balance**, so no real money can touch the game.

The sequencing rule for this phase: **each milestone is verifiable before the one
after it exists.** M2.0, M2.1 and M2.3 are pure packages with no sockets and no
database — they are unit-testable at the same standard Phase 1.5 held. M2.2
introduces I/O. Only M2.4 binds money to a network, and it binds it to a ledger
that was already proven in isolation.

**Model note (ADR 0011).** Crush Depth is a **B2B game provider**. The operator
holds player funds and is the balance authority; the provider never custodies
funds. That does not remove work from this phase so much as re-aim it: M2.3 is an
internal audit-and-reconciliation ledger rather than a custody ledger, M2.4 gains
the operator wallet on its entry critical path, and M2.5 becomes integration and
enforcement rather than account ownership.

> **Required decision before M2.3 and M2.4 are finalised: the internal wallet
> contract.** Idempotent debit / credit / refund / rollback, with per-operator
> adapters mapping onto each operator's actual API (`WL-1`…`WL-8`). Its shape
> determines the ledger's account structure, the entry path's failure modes and
> the round server's latency budget. This is listed as a decision rather than an
> implementation detail because all three are expensive to change afterwards.

| id | Milestone | Shape | Depends on |
|---|---|---|---|
| M2.0 | Multi-player engine shape | pure package | — |
| M2.1 | Index aggregation + Signal Lost decision | pure package | — |
| M2.2 | Live feed transport + tick archive | service | M2.1 |
| M2.3 | Internal double-entry ledger + reconciliation | pure package + store | wallet contract |
| M2.4 | Authoritative round server + wallet seam | service | M2.0–M2.3, wallet contract |
| M2.5 | Operator session integration + eligibility enforcement | service | M2.4 |
| M2.6 | House risk engine + kill switch | service | M2.4, M2.5 |

M2.0, M2.1 and M2.3 have no dependency on each other and can be built in any
order, or in parallel if there is ever more than one developer.

---

**M2.0 — Multi-player engine shape** · pure package · 1–2 weeks

The engine is pure and correct, and it models **one player**. A round server
applies one authoritative tick to every open position in the round and settles
each against the same `I_t`. Establish that shape *before* a server needs it, in
the package, under the existing coverage gate.

Scope is a fan-out layer around the existing per-player entry points, not a
rewrite of them: `onTick` / `open` / `requestAscent` / `settleAtRoundEnd` keep
their signatures and their tests. Add a `RoundState` holding a map of player id
to the existing per-player state, plus round id, phase and the tick series. This
matters because the per-player functions are where every M1.3–M1.5 acceptance id
is pinned; a rewrite would put 400-odd passing tests up for renegotiation to buy
nothing.

Three properties are the milestone, and each is a test rather than a claim:

- **Tick application is order-independent.** Applying tick `t` to players
  `{A, B, C}` produces the same per-player settlements in any iteration order.
  A round server that pays differently depending on `Map` insertion order is not
  auditable, and this is exactly the class of bug that only appears under real
  concurrent load.
- **One player's outcome cannot influence another's.** Crush, auto-order and
  settlement for A are a function of A's position and the shared tick only.
  Test by interleaving: run A alone, run A among 500 others, assert identical
  events and payout.
- **The round-level events are a deterministic concatenation** of per-player
  events under a declared stable ordering (by player id, then the existing
  per-player order), so the archive and the ledger both have one canonical
  sequence to write.

*Exit:* `RoundState` fan-out lands in `@crush/engine` with new AC ids; every
existing per-player test passes unmodified; order-independence and isolation are
property-tested across at least 500 simultaneous positions; engine purity tests
still pass; coverage gate holds.

*New acceptance ids needed:* an `RS` (round state) group — fan-out determinism,
player isolation, canonical event ordering, and the per-round directional
aggregate that M2.6 caps against.

---

**M2.1 — Index aggregation and the Signal Lost decision** · pure package · 1–2 weeks

FI-4 and FI-5 are not implemented and are not part of the transform.
`IndexTransform.next(price)` consumes a single `P_t`; nothing yet produces one
from several venues, and nothing yet decides that a round must abort. Build that
as a pure function first — it is fully testable with a table of quotes and a
supplied evaluation time, and it is the most audit-exposed logic in the feed.

The component takes a set of timestamped per-venue quotes and returns either an
accepted `P_t` with the sample set that produced it, or a typed
`SignalLostReason`. It reads no socket and no clock; the caller supplies both the
quotes and the evaluation time, exactly as `entryOpen` is handed to the engine
rather than computed inside it.

Rules to implement, all already specified:

- median across live venues, per tick (FI-1's `P_t` definition);
- exclude any venue deviating > 0.5 % from that median, then re-derive from the
  survivors (FI-4) — and retain both sets, because VR-1 must serve the raw
  per-exchange samples *and* the median;
- fewer than 3 live venues, or any venue gap > 2 s, is SIGNAL LOST (FI-5);
- **never extrapolate, interpolate or invent a tick** (FI-5, explicit);
- reject a non-increasing timestamp and count it for the alarm path (FI-8);
- keep sign fidelity intact: FI-2's `sign(ΔI) = sign(ΔP_median)` becomes a
  property test over generated quote series, not a code-review note.

*Exit:* pure aggregator in `@crush/feed` with golden vectors; FI-2, FI-3, FI-4,
FI-5, FI-6, FI-8, FI-17, FI-18 and FI-19 each have an automated test — including
each of FI-18's five liveness conditions failing alone, and a heartbeat-only
stream going not-live at 2,000 ms; the amplification bound
`v/max(σ,σ_floor) ≤ 35×` is asserted rather than argued; SIGNAL LOST is a typed
result the caller cannot silently ignore.

*Ratified (ADR 0010).* `VENUE_SET_V1` is **Binance, Coinbase Exchange, OKX,
Bybit, Kraken**, spot BBO midpoint only — the five venues game logic §1 named
all along. The aggregator therefore takes a **venue-set version** and per-venue
quote records that carry their own liveness facts, so it stays pure and
clock-free: liveness is *evaluated* by the caller and *asserted* in the record.

Liveness itself (`FI-18`) is a five-part conjunction — instrument online,
subscription acknowledged, sequence/checksum continuous, BBO valid non-crossed
and positive, and a real market-data update within 2,000 ms on the server
monotonic clock. **Heartbeats do not refresh it.** Round start needs four venues
live for 10 s; a running round continues on three survivors (`FI-19`).

---

**M2.2 — Live feed transport and the tick archive** · service · 2–3 weeks

Now add I/O around a component that is already proven. `WsIndexSource` maintains
venue connections, feeds quotes to the M2.1 aggregator on the 125 ms grid, and
publishes ticks — but **every tick is persisted before it is broadcast**, so any
settlement can be re-derived months later. That ordering is the milestone: a tick
that reached a player but not the archive is an unauditable settlement.

The archive stores, per tick: round id, tick id, server timestamp, every raw
per-venue sample, the excluded set and why, the median, the resulting `I_t`, and
the constants version in force (VR-3). That is precisely VR-1's payload, so build
the archive **as** the VR-1 record rather than as a log to be reshaped later.

Also here: implement MF-1 SIGNAL LOST end to end — all open positions
auto-surface at the last valid tick, the round aborts, positions already crushed
stay crushed, ascents in flight settle at the last valid tick. The engine already
has the settlement paths; this milestone gives them the outage trigger.

*Exit:* tick archive with integrity hashes and a re-derivation tool that replays
an archived round's raw samples and reproduces every `I_t` bit-for-bit (FI-1);
outage abort tested by **killing the upstream mid-round** with positions open,
including one mid-ascent; a tick is never published before it is durable, proven
by a crash injected between the two.

*Carry from Phase 1.5:* the M1.6 replay fixtures become this source's regression
corpus — the same recorded flash crash must produce the same archive.

*Release blocker that is not a code task (`FI-20`).* Written market-data rights
covering every `VENUE_SET_V1` venue must be in force — held **either direct from
each venue or through an authorised commercial data vendor**, provided the
**chain of rights is documented end to end**. An undocumented chain is no rights
at all, because that is how a regulator or lab will treat it. The rights must
cover **commercial outcome determination, archival for the LG-4 period,
certification/lab access, and publication of the VR-1 verification data**.

Under the B2B model the parties need different rights, and the split must be
explicit: the **provider** needs outcome determination, archival, lab access and
publication **with the right to sublicense**; each **operator** needs outcome
determination for its licensed offering and publication to its own players.
**Sublicensing is the clause most likely to be missed and the one that silently
blocks the business model** — a provider integrated into ten operators must be
able to extend publication rights to all ten and their players, and a licence
permitting publication but not sublicensing looks adequate on paper while making
the model unshippable. **Track this from the start of Phase 2, not at the
milestone**: discovering it after M2.2 leaves an archive that cannot lawfully be
published and a certification bundle rebuilt from ticks that no longer exist.

*Second non-code blocker: the **laboratory / regulatory pre-assessment** (ADR
0011).* Not full certification — an early paid engagement with a recognised test
lab, and where possible an informal regulator view, on the specific question of a
real-market-price-settled outcome and the evidence model supporting it. It sits
**before production M2.2 completes** because M2.2 is where the evidence model
becomes concrete and expensive: the archive's contents, the VR-1 payload shape,
the re-derivation tooling. If a lab says the archive needs a field we are not
capturing, or that the verification model does not carry the fairness argument,
that is cheap to hear while the archive is being designed and very expensive to
hear after months of ticks written in the wrong shape. A pre-assessment converts
the largest unknown in the plan into a design input.

---

**M2.3 — Internal double-entry ledger and reconciliation** · pure package + store · 2–3 weeks

`@crush/ledger` currently holds money *primitives* — the branded `Cents` type and
its arithmetic (LG-2, already satisfied and enforced by CI). It holds no
accounts, no entries and no double-entry invariant. That is the actual milestone.

Under ADR 0011 this is the provider's **internal game ledger**, not a custody
ledger: internal game accounts and an operator-receivable, reconciled against the
operator's wallet rather than being it. The scope barely shrinks, because the
reasons for it survive the loss of custody — **dispute resolution**
(the provider must answer from its own records; "ask the operator" is not a
dispute path), **reconciliation**, **certification evidence**, and plain
**correctness**, since LG-1's invariant is how settlement bugs surface at all.

Every payout is a balanced transaction: debits equal credits, and the sum over
all accounts is invariant (LG-1). Every operation is idempotent by operation id
and immutable once written; corrections are new compensating entries, never edits
(LG-3) — which is also what makes MF-3's "malfunction voids pays" path
implementable rather than aspirational.

**Reconciliation is a first-class output, not a nightly footnote** (`LG-5`).
Every provider record maps to operator wallet operations by idempotency key, and
a run reports every divergence: provider record with no operator transaction,
operator transaction with no provider record, matched pair with differing
amounts. Divergence is an **exception to resolve, never auto-corrected by
trusting either side** — a provider that silently adopts the operator's number
destroys its own audit position, and one that silently overrides it is claiming
custody it does not have.

Records retain everything LG-4 lists: player id, round id, position id,
direction, stake, leverage, `I_e`, entry tick id, settlement tick id, `M`,
payout, **θ in force**, timestamps. θ-in-force is easy to omit and impossible to
reconstruct later; it is the number that explains the payout.

Build the invariant as a continuously-checked property, not a nightly job that
discovers yesterday's break: every test that writes entries asserts the global
sum is unchanged.

*Exit:* the ledger balances to zero across a full simulated day driven by
`@crush/sim`'s existing behavior models; replaying the append-only log reproduces
every balance exactly; a replayed operation id is provably a no-op; EN-3's atomic
stake debit and EN-6's full refund are ledger-level tests; and a reconciliation
run against a simulated operator wallet detects each of the three divergence
classes rather than silently absorbing them.

*Note on sequencing:* this lands **before** M2.4 so the round server binds
settlement to a proven ledger rather than to a placeholder it must later unpick.
That is the one ordering change in this phase that is not merely cosmetic. The
**wallet contract must be agreed before this milestone is finalised** — the
account structure follows from it.

---

**M2.4 — Authoritative round server and the wallet seam** · service · 3–4 weeks

The convergence milestone: M2.0's fan-out, M2.2's ticks and M2.3's ledger behind
one process that owns the round. Clients become optimistic mirrors that reconcile
on ack; `@crush/gateway` — today a one-line stub — becomes the real request/ack
seam behind the call sites the client already uses.

**The operator wallet is now on the entry critical path** (ADR 0011). The stake
debit resolves *before* the position exists, which is how EN-3's atomicity
survives a network hop: request the debit, create the position only on a
confirmed debit. The two forbidden states are a position the player did not pay
for and a debit with no position, and both are tested by injecting failure at
each step — **including a debit that succeeds with a lost response**, which is
indistinguishable from a timeout and is why every operation is idempotent by key
(`WL-2`). A debit whose outcome cannot be determined is resolved by **rollback,
never by guessing** (`WL-4`); `INSUFFICIENT_BALANCE` is decided by the operator's
debit response, not by the provider's mirrored balance (`WL-5`).

A wallet outage MUST NOT abort the round for players already holding positions
(`WL-8`) — their outcome is determinable from the tick series, so settlement
retries and escalates to a reconciliation exception rather than voiding a result
the engine already knows.

The non-negotiables, all already specified and all now enforceable server-side:

- **EN-2**: entry executes on the first tick after *server* receipt — never a
  tick the player has already seen. The client's `Gateway` already evaluates the
  entry window after its fake latency leg precisely so this does not change shape
  here.
- **MF-5**: all timing derives from the server clock; client timestamps are never
  trusted for money.
- **MF-4**: client disconnect changes nothing — auto-orders still fire, worst
  case RL-4 applies.
- **MF-2**: on crash recovery, any position lacking a settlement record is voided
  and refunded at stake, the round is marked void, and **no round is ever
  resumed**.
- **FA-1**: no path lets any party, operator included, act on a tick before
  players see it.

*Exit:* a tampered client cannot change any outcome — demonstrated by driving a
modified client against the server and diffing the ledger, not asserted;
reconciliation tested under 300 ms+ latency and packet loss; MF-2's recovery
drill documented and run (a release-gate item, so it needs a written procedure,
not only a passing test), **including rollback of debits whose outcome is unknown
after recovery**; every `WL` operation proven idempotent under verbatim replay;
PF-3's fan-out jitter measured against the chosen load target.

*Ratified (ADR 0010).* **PF-3 is 10,000 concurrent players in one shared
round**, all holding active positions, at 8 Hz, with ≤ 25 ms p99 internal
fan-out jitter over a **one-hour soak**, plus a **20,000-connection five-minute
resilience burst**. The single-round framing is the demanding part and the
honest one: this game has no sharding escape hatch, because every player in a
round is settled against the same tick.

**Topology is fixed before the milestone starts.** A **deterministic
single-writer round authority** — round state, tick application, settlement and
ledger writes — sits behind **horizontally scalable stateless WebSocket
gateways** that handle connections and fan-out only. Ledger and settlement
authority stay single-writer, which is what makes M2.0's order-independence
property meaningful in production: one writer applying one tick to N player
states in a declared order is reproducible from the archive, and a settlement
that can be re-derived is the difference between an auditable game and an
argument. Distributing settlement would buy throughput this game does not need
at the cost of the determinism certification depends on. Splitting fan-out out is
what makes 10,000 sockets reachable without touching any of that — the same seam
discipline the codebase already uses: a gateway is to the round authority what
`RendererPort` is to the engine, carrying state outward with no way to decide
anything.

---

**M2.5 — Operator session integration and eligibility enforcement** · service · 2–3 weeks

Reframed by ADR 0011. This was "accounts, sessions, house risk". Under the B2B
model the provider builds **no registration, no KYC, no deposits, no
withdrawals, no password reset** — every one of those would duplicate the
operator's already-regulated systems and pull identity data into a codebase that
has no business holding it.

What it becomes:

- **Operator authentication and session integration.** The operator launches the
  game with a session token; the provider validates it against the operator,
  resolves it to an **opaque operator-scoped player reference**, and binds the
  session. The provider stores no identity documents and no PII beyond that
  reference.
- **Server-side enforcement of operator-supplied eligibility** (`WL-7`). The
  operator is authoritative on whether a player may play — self-exclusion,
  cooling-off, jurisdictional blocks, deposit-limit-derived states, any
  operator-set restriction. The provider **enforces what it is told and never
  overrides it**. The engine already accepts `lossLocked` as state, which is the
  seam this arrives through.
- **Game-session responsible play.** RP-1's session clock and RP-3's 15-minute
  reality check remain the provider's to display and enforce *within a session*,
  configured by operator policy rather than invented by the provider. RP-2's
  loss limit is now dual-sourced — an operator restriction plus an optional
  in-session limit where policy permits — and **the stricter binds**.

**The build shrinks; the compliance obligation does not.** Today
`checkLossLimit` lives in `apps/client/src/ui/responsible.js` and sets a flag the
client owns; a modified client ignores it entirely. That has to become
server-side and un-bypassable regardless of who supplies the limit, because a
provider that lets a self-excluded player open a position is a compliance
incident **regardless of which system made the mistake**. Only the source of
truth moved.

Keep the always-visible session clock and the existing client UI. The rule in
CLAUDE.md stands: responsible-play UI ships in every build.

*Exit:* an operator session token is validated, bound and expired correctly, and
an invalid or replayed token never yields a playable session; every
operator-supplied restriction is enforced server-side and un-bypassable by a
modified client, tested the way M2.4's tamper case is; RP-2's dual-source
stricter-binds rule is tested with each source in turn the stricter; RP-2's
cool-down asymmetry is tested in both directions; RK-2's per-player rate limits
are live; no PII beyond the opaque player reference is persisted anywhere in the
provider's stores.

---

**M2.6 — House risk engine and kill switch** · service · 2–3 weeks

The milestone that protects the operator rather than the player, and the one that
distinguishes this game from an RNG crash game. **One correlated feed move
resolves every open position in the same direction at once.** Per-player caps do
not bound that; aggregate directional exposure does.

RK-1's directional cap: when net open notional in one direction exceeds the
configured cap, new entries in that direction are rejected with the "ballast
full" code while the other direction stays open. RK-3: every cap is
operator-configurable within house limits and every change hits the audit log
with actor identity (BO-3). The kill switch suspends **new entries without
disturbing open positions** — a switch that also closes open positions is a
settlement event, and an operator-triggered settlement event is exactly what a
regulator will ask about.

BO-2's dashboards belong here too, because this is the first milestone where the
numbers exist: rolling 24 h / 30 d actual RTP against target with the ±1.5 %
deviation alarm, exposure per direction, feed health, abort counts, and rejection
counts broken out by EN-8 code — `NO_PRICE` in particular, since a rising rate
signals an entry-window or round-start defect (EN-9).

*Exit:* aggregate exposure capped and alerting under a simulated correlated move
that would otherwise pay every player at once; kill switch exercised under load
with open positions verified undisturbed; every config change appears in the
immutable audit log with an actor.

---

**Phase 2 exit — the gate to real money.** All of: a tampered client cannot alter
an outcome; the internal ledger balances, replays exactly and reconciles against
the operator wallet; every `WL` operation is idempotent under replay and every
unknown debit outcome resolves by rollback; every tick is archived before
broadcast and re-derives bit-for-bit; SIGNAL LOST and crash recovery are
drilled; operator-supplied eligibility and responsible-play restrictions are
server-enforced; aggregate exposure is capped with a working kill switch. Phase 3 cannot be entered on partial credit
here — the compliance evidence bundle is assembled *from* these artifacts.

### Phase 3 — Compliance gate · 1600 m · **Hard gate** · 3–12 months, calendar-bound

A licence, a certified RNG-free fairness argument, KYC/AML, geofencing, payment
rails. **This gate does not open faster because the code is ready.** Start the
licensing conversation during Phase 1.5, not after Phase 2 — the lead time is
regulatory, not technical.

- **M3.1 — Jurisdiction, *provider* licensing, and per-game approval.** Per ADRs
  0010 and 0011 the classification opinion, the licensing conversation and the
  lab pre-assessment all start in Phase 2, before M2.2 production transport —
  what lands *here* is the jurisdiction decision and the applications it gates.
  Under the B2B model there are **three distinct regulatory obligations, and they
  are additive rather than alternative**:
  - **The operator's licence**, which determines RTP disclosure rules,
    responsible-gambling minimums, data retention and geofencing — the operator's
    to hold, but its terms constrain what the provider must supply.
  - **Provider / software-supplier licensing.** Most regulated markets license
    the *supplier* of gaming software separately from the operator. Crush Depth
    needs its own licence or registration in each target market — an obligation
    the pre-Rev. 11 plan did not carry at all.
  - **Per-game approval.** Beyond licensing the company, individual games are
    typically submitted and approved market by market. Crush Depth is one game
    requiring approval in each jurisdiction it is offered, and a second game
    later repeats the exercise.

  The **classification question is unchanged and still existential**: whether a
  BTC-price-driven outcome is gaming or a financial derivative determines whether
  any of this is licensable at all.
  *Exit:* written legal opinion on the gaming-vs-derivative classification in the
  target market; provider licensing route identified with its evidence
  requirements; per-game approval path documented.
- **M3.2 — Third-party certification of the fairness model.** The Phase 2
  pre-assessment (ADR 0011) is the cheap early read; this is the binding one. A lab certifies that
  outcomes derive deterministically from a published price series. The
  Monte-Carlo report, tick archive and replay determinism from Phase 1.5 are the
  evidence bundle — which is why those milestones sit so early. *Exit:*
  certification issued against a tagged, frozen engine version.
- **M3.3 — KYC/AML, geofencing, payments, hardened responsible play.** The current
  client-side loss limit is a good prototype and is not a compliant control — it
  must move behind the server with the rest of the money. *Exit:* all
  responsible-play limits enforced server-side and un-bypassable by a modified
  client.

### Phase 4 — Soft launch · 3400 m · 4–8 weeks

Real money, one market, low limits, watching the numbers. The goal is
**discovering the gap between simulated and actual player behaviour** while that
gap is still cheap.

- **M4.1 — Limited release with capped stakes and full observability.** Live RTP
  tracking against the 96.5 % target, exposure dashboards, settlement-latency
  monitoring, per-round reconciliation between the ledger and the engine's own
  view. Recalibrate θ against observed behaviour — real players will not match any
  simulated model. *Exit:* observed RTP within tolerance over a statistically
  meaningful sample; zero unreconciled rounds.

### Phase 5 — Scale and depth · 6000 m · Ongoing

Additional markets, real social delivery replacing the simulated bot identities,
production Close Call fan-out, tournaments, horizontal scaling of the round server. Everything here
is optional; nothing here should ever be traded ahead of a Phase 1.5 or Phase 2
milestone.

------

## Carried forward from Phase 1.5

Neither item blocks Phase 2. Both block flipping the renderer default away from
Canvas, and neither can run in CI — so both need scheduling rather than assuming.

1. **Measure the Pixi scene on a real mid-range phone in portrait (PF-1)** —
   60 fps median, ≥ 45 fps p5 during a volatile round with a position open.
2. **Review visual parity against the retained Canvas renderer by eye.** A human
   judgement that has not been made.

Until both are done, `?renderer=pixi` stays the opt-in and Canvas stays the
default and the reference.

---

## Next steps

Rev. 9's two blocking questions are answered (ADR 0010), so the engineering path
is unblocked and the two longest-lead items are now the ones that run in
parallel with it.

1. **Start the regulatory and rights work today — three tracks, all before M2.2
   production transport.** They fail differently, so they are three efforts, not
   one:
   - the **gaming-versus-derivative classification opinion**, which can void the
     licensing route entirely;
   - the **`VENUE_SET_V1` market-data rights**, direct or via an authorised
     vendor with a documented chain — including **provider sublicensing** for
     VR-1 publication (`FI-20`), the clause that silently blocks the B2B model
     if missed;
   - the **laboratory / regulatory pre-assessment** of the price-settled outcome
     model, which turns the plan's largest unknown into an M2.2 design input
     instead of a post-hoc discovery.

   Alongside these, scope **provider/supplier licensing and per-game approval**
   in the target market (M3.1) — obligations the B2B model adds and the earlier
   plan did not carry.
2. **Start M2.0** — the multi-player engine shape. No external dependencies, no
   infrastructure decisions, no sockets, so it starts today, and every later
   Phase 2 milestone consumes its shape.
3. **Agree the internal wallet contract**, then M2.1 and M2.3. M2.1 is unblocked
   today — ratified venue set, fully specified liveness rule — and has no
   dependency on M2.0 or M2.3. **M2.3 and M2.4 cannot be finalised until the
   wallet contract is settled**, because the ledger's account structure, the
   entry path's failure modes and the round server's latency budget all follow
   from it. Draft it against the internal contract in ADR 0011 and expect the
   first real operator integration to test it.

---

## Risks worth naming now

Ordered by how expensive they become if discovered late.

| Risk | Severity | Mitigation and timing |
|---|---|---|
| Legal classification: gaming or derivative? | **Existential** | A BTC-price-driven payout may be regulated as a financial product rather than gaming in some jurisdictions, invalidating the licensing route entirely. **Started now, before M2.2 production transport** — with a **lab/regulator pre-assessment** (ADR 0011) as the cheap early read rather than waiting for binding certification in Phase 3. |
| Provider licensing and per-game approval | **High** | The B2B model adds obligations the earlier plan did not carry: most regulated markets license the software *supplier* separately from the operator, and approve games individually per market. Scope both during Phase 2 (M3.1); a market that licenses operators readily may still be slow or closed to a new supplier. |
| Operator wallet on the entry critical path | **High** | Seamless wallet is the right call (it avoids custody) but puts a third-party network call inside every entry. Bounded timeouts, idempotent keys and rollback-on-unknown are `WL-2`/`WL-4`/`WL-8` rather than hardening added later; a wallet outage must never void positions whose outcome the engine already knows. |
| Wallet contract agreed too late | **Medium** | It determines the ledger's account structure, the entry failure modes and M2.4's latency budget. Listed as a **required decision before M2.3/M2.4 are finalised** precisely so it is not discovered during implementation. Per-operator adapters exist because the first real integration will test the internal contract. |
| Reconciliation divergence handled by trusting one side | **Medium** | A provider that silently adopts the operator's number destroys its own audit position; one that silently overrides it claims custody it does not have. `LG-5` makes divergence an exception to resolve, never an auto-correction. |
| Correlated exposure across all players | **High** | Unlike RNG crash games, one real price move resolves every position in the same direction simultaneously. Aggregate exposure caps and a kill switch are **M2.6**, not Phase 5 polish. M2.0's per-round directional aggregate is the number M2.6 caps. |
| Release-scale θ evidence pending | **High** | M1.7 selects 0.03 %/s and commits engineering evidence, but PL-6 still requires 10⁷ positions plus ≥ 90 representative BTC days. Do not market the preliminary report as certified RTP. The M2.2 tick archive is what eventually supplies the representative days. |
| Market-data rights — and **sublicensing** | **Existential for the index** | The venue set is ratified (`FI-17`), so selection is closed — the *rights* are not. Rights may now come direct or via an authorised vendor with a documented chain (`FI-20`). The sharpest edge under B2B is **sublicensing**: a licence letting the provider publish VR-1 data but not extend that right to its operators and their players looks adequate on paper and makes the model unshippable. An M2.2 release blocker; a refusal forces a versioned venue-set change and regenerated certification evidence. |
| Venue independence within the ratified set | **Medium** | Five venues satisfy FI-5 by count; they are not five independent price discoveries when they track the same dominant book. The 0.5 % filter and §2's clamp bound what correlated drift can do to one tick, and FI-18's liveness rule stops a frozen book counting as a vote. Revisit if a venue's share of true price discovery changes materially. |
| Engine is single-player shaped | **Medium** | Known and scheduled as M2.0, first in the phase, rather than discovered during M2.4. The fan-out is additive; the per-player functions and their tests do not change. |
| Ledger retrofit under a live round server | **Medium** | Addressed by ordering: M2.3 lands before M2.4, so settlement is bound to a proven double-entry ledger rather than to a placeholder. Retrofitting LG-1/LG-3 under a running server is the most painful sequencing error available in this phase. |
| Declared-but-unenforced criteria | **Medium** | The known M1.5 gaps are closed. Preserve the tests-first rule and audit future tests for assertions that merely ratify current behavior — the Phase 2 equivalent is a server test that asserts what the handler does rather than what the criterion says. |
| Responsible-play controls enforced client-side | **Medium** | Fine for a prototype, not compliant for real money. Now explicitly **M2.5** rather than a Phase 3 surprise. |
| Simulator-shaped assumptions leaking into design | **Medium** | `SIM-ONLY` fencing is good discipline, but anti-run pressure and squalls make rounds dramatic in ways real BTC will not reliably reproduce. M1.6 provides the replay comparison; M2.2's archive eventually replaces both with observed reality. |
| `apps/client` is unchecked JavaScript | **Low** | Narrowing rather than growing: the render seam and `core/close-calls.ts` are `.ts` and typechecked, and client `.ts` is covered by the coverage report. What remains unchecked is the retained Canvas renderer and the prototype UI. The risk is scope creep putting game logic in the adapter — keep new logic in `packages/`. |
| No trailing stop above 1× | **Low** | Intentional v1 scope: `AO-3` confines SL to (0,1). A profit-protecting trailing stop needs a separately specified order type rather than silently widening stop-loss semantics. |
| Pixi default flipped before parity is proven | **Low** | Ships behind `?renderer=pixi` with Canvas as the default precisely so this cannot happen by accident. Both gates are on the carried-forward list. |

---

*Crush Depth · delivery plan · Rev. 11 — Phase 1.5 complete; Phase 2 re-planned
as seven dependency-ordered milestones, pure packages first, money bound to the
network last. `VENUE_SET_V1`, feed liveness, PF-3 and the round-authority
topology ratified in ADR 0010; the B2B provider model, seamless wallet and
operator/provider split in ADR 0011.*
