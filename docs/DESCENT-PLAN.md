# Crush Depth — The Descent Plan

**Rev. 8 · 2026-08-31 · M1.8 renderer-port completion state**

> This is the portable, plain-text mirror of the delivery-plan artifact. It is
> the version to paste into any tool that cannot open a `claude.ai` link.
> Artifact (Claude only): <https://claude.ai/code/artifact/9a54b802-3af9-4bb4-8e5f-c3e12aa3b605>
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
| Phase complete | **1.0** — prototype, module split |
| Phase in progress | **1.5** — 10 of 10 tasks done; M1.8 delivered in its approved scope |
| Engine | Pure, immutable TypeScript; entry validation, auto-orders, caps and authoritative Close Call facts live |
| Tests | **583 passed, 4 skipped** across 48 files; package coverage gates pass (Close Call module 100%; sim 96.04% lines, 84.55% branches, 100% functions) |
| Spec documents | **2 of 2** — 113 acceptance ids across 19 categories |
| Next planned work | Phase 2 (M2.1 server-side feed); on-device PF-1 measurement before the Pixi default flips |

---

## What changed in Rev. 8

M1.8 adds ADR 0009 and SC-1…SC-8, written before implementation:

- every renderer implements one `RendererPort`
  (`init`/`resize`/`render`/`destroy`), and nothing outside `render/` knows
  which one is live — the rule the feed seam already had, enforced the same way;
- a renderer consumes a pure `SceneModel` projection and reads nothing else:
  no `S`, no engine, no `buffer`, no DOM, no clock. `render(model): void` has no
  return channel, so a scene cannot inform a gameplay decision by construction;
- the crush line and live P&L pass through from `@crush/engine` untouched, and
  the parity-critical geometry has one implementation both renderers share;
- renderer frame rate cannot reach the money: the real engine settles
  byte-identically at zero, one and nine projections per authoritative tick;
- Canvas remains the default and is **unmodified**, retained as the visual
  reference; `?renderer=pixi` is the explicit opt-in.

Two things this milestone does **not** establish, stated plainly: PF-1's 60 fps
on a mid-range phone is unmeasured (it needs a real device and a real WebGL
context), and full visual parity is a human judgement that has not yet been
made. Both gate flipping the default.

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

Eight architecture decisions are recorded in `docs/decisions/`:

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
`checkJs` off because M1.8 replaces `render/` wholesale; **new code is `.ts`**.

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

### Open

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

### Phase 1.5 — Correctness · 200 m · **You are here** · 2–4 weeks remaining

Turn a convincing toy into a **verified, deterministic, testable engine** with a
real house edge. Nothing here ships to a player; everything here is what makes
shipping legal later.

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

### Phase 2 — Server authority · 800 m · 6–10 weeks

Move the truth off the client. Until this exists, **every player is trivially able
to rewrite their own balance**, so no real money can touch the game.

- **M2.1 — Real BTC feed with a published, auditable index.** `WsIndexSource`
  against BTC/USDT, applying the specified λ, σ_floor and ±3.5σ clamp server-side.
  Every tick persisted before broadcast, so any settlement can be re-derived
  months later. Implement the Signal Lost outage abort per spec §8, including what
  happens to open positions. *Exit:* tick archive with integrity hashes; outage
  abort tested by killing the upstream mid-round.
- **M2.2 — Authoritative round server running the Phase 1.5 engine unmodified.**
  Entry executes on the first tick after server receipt — never a tick the player
  has already seen. Clients become optimistic mirrors that reconcile on ack.
  *Exit:* a tampered client cannot change any outcome; reconciliation tested under
  300 ms+ latency and packet loss.
- **M2.3 — Double-entry ledger in integer cents.** Every payout a balanced
  transaction against a house account, idempotent on retry, append-only audit log.
  The component regulators scrutinise hardest and the most painful to retrofit.
  *Exit:* ledger balances to zero across a full simulated day; replaying the log
  reproduces every balance exactly.
- **M2.4 — Accounts, sessions, house risk engine.** Auth, per-player and aggregate
  exposure limits, and a kill switch that suspends new entries without disturbing
  open positions. One correlated feed move can crush or pay every player at once —
  aggregate exposure, not per-player, is the number that can bankrupt the house.
  *Exit:* aggregate exposure capped and alerting; kill switch exercised under load.

### Phase 3 — Compliance gate · 1600 m · **Hard gate** · 3–12 months, calendar-bound

A licence, a certified RNG-free fairness argument, KYC/AML, geofencing, payment
rails. **This gate does not open faster because the code is ready.** Start the
licensing conversation during Phase 1.5, not after Phase 2 — the lead time is
regulatory, not technical.

- **M3.1 — Choose jurisdiction, open the licensing conversation early.** The
  licence determines RTP disclosure rules, responsible-gambling minimums, data
  retention, and which markets you may geofence into. It also determines whether a
  BTC-price-driven outcome is classified as gaming or as a financial derivative —
  a distinction that can invalidate the entire design in some jurisdictions.
  *Exit:* written legal opinion on the gaming-vs-derivative classification in your
  target market.
- **M3.2 — Third-party certification of the fairness model.** A lab certifies that
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

---

## Next steps after M1.8

1. **Measure the Pixi scene on a real mid-range phone in portrait (PF-1),** and
   review visual parity against the retained Canvas renderer by eye. Both gate
   flipping the default away from Canvas; neither can be done in CI.
2. **Begin Phase 2 with M2.1** — the real BTC feed with a published, auditable
   index. Phase 1.5 is otherwise complete.

Alongside those, and not blocked by them: **open the licensing
conversation** (M3.1). It is the longest lead time in the plan and the only item
that can invalidate the design.

---

## Risks worth naming now

Ordered by how expensive they become if discovered late.

| Risk | Severity | Mitigation and timing |
|---|---|---|
| Legal classification: gaming or derivative? | **Existential** | A BTC-price-driven payout may be regulated as a financial product rather than gaming in some jurisdictions, invalidating the licensing route entirely. Get a written legal opinion during Phase 1.5 — before Phase 2 is built on the assumption. |
| Correlated exposure across all players | **High** | Unlike RNG crash games, one real price move resolves every position in the same direction simultaneously. Aggregate exposure caps and a kill switch are Phase 2 requirements, not Phase 5 polish. |
| Release-scale θ evidence pending | **High** | M1.7 selects 0.03 %/s and commits engineering evidence, but PL-6 still requires 10⁷ positions plus ≥90 representative BTC days. Do not market the preliminary report as certified RTP. |
| Declared-but-unenforced criteria | **Medium** | The known M1.5 gaps are closed. Preserve the tests-first rule and audit future tests for assertions that merely ratify current behavior. |
| Simulator-shaped assumptions leaking into design | **Medium** | `SIM-ONLY` fencing is good discipline, but anti-run pressure and squalls make rounds dramatic in ways real BTC will not reliably reproduce. M1.6 now provides the replay comparison; keep it in the M1.7 calibration evidence. |
| Responsible-play controls enforced client-side | **Medium** | Fine for a prototype, not compliant for real money. Budget the server-side move into Phase 2 rather than treating it as a Phase 3 surprise. |
| `apps/client` is unchecked JavaScript | **Low** | Narrowing rather than growing: M1.8's render seam is `.ts` and typechecked, as `core/close-calls.ts` already was, and client `.ts` is now covered by the coverage report. What remains unchecked is the retained Canvas renderer and the prototype UI. The risk is still scope creep putting game logic in the adapter — keep new logic in `packages/`. |
| No trailing stop above 1× | **Low** | Intentional v1 scope: `AO-3` confines SL to (0,1). A profit-protecting trailing stop needs a separately specified order type rather than silently widening stop-loss semantics. |
| Pixi default flipped before parity is proven | **Low** | M1.8 ships behind `?renderer=pixi` with Canvas as the default precisely so this cannot happen by accident. PF-1 on device and a by-eye parity review are the two gates; neither runs in CI, so both need scheduling rather than assuming. |

---

*Crush Depth · delivery plan · Rev. 8 — M1.1 through M1.8 and Close Calls
complete; Phase 1.5 closes once PF-1 is measured on device and visual parity is
reviewed.*
