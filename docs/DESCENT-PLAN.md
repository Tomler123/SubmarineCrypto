# Crush Depth — The Descent Plan

**Rev. 3 · 2026-08-30 · repository state `12d2819`**

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
| Phase in progress | **1.5** — 5 of 10 tasks done |
| Source files | **36** — 2,875 lines, `packages/*` TypeScript strict |
| Tests | **398 green** across 23 files; 100% coverage on `packages/*` |
| Spec documents | **2 of 2** — 82 acceptance ids across 14 categories |
| Working tree | clean at `12d2819` |

---

## What changed since Rev. 2

Rev. 2 was written at `b3a3699`, when the tree was untested ES modules with no
build. Four milestones have landed since, and **all five gaps Rev. 2 named are
now closed**:

| Rev. 2 gap | Status |
|---|---|
| Oxygen absent — no house edge at all | **Closed (M1.4)** — `M_t` carries `−θ·τ`, θ from `EngineConfig`, snapshotted at entry |
| Round timings wrong (75 s / 5 s, no cutoff) | **Closed (M1.4)** — 90 s round, 8 s intermission, T−5 s cutoff via `OpenRequest.entryOpen` |
| Risk caps unenforced | **Partly closed (M1.5)** — max-win cap clamped in `payoutFor`; `EN-4` range validation still open |
| Engine coupled to DOM (5 imports + `setTimeout`) | **Closed (M1.3)** — pure `packages/engine`, event-list seam, `purity.test.ts` guards it |
| Money not integer-cent-safe (`Math.round` half-up) | **Closed (M1.3)** — `Cents` branded type, round-half-away-from-zero applied once at settlement |

Four architecture decisions are recorded in `docs/decisions/`:

- **0001** — monorepo layout and toolchain
- **0002** — pure engine and the event seam; also settles crush-line authority
  over `M_t ≤ 0`, `EN-8` rejection precedence, `NO_PRICE` vs MF-1, and the rule
  that a client mirror may never be stricter than the engine
- **0003** — oxygen, tick-derived τ, round timings
- **0004** — max-win cap, entry idempotency, RL-1 phase guard

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

**M1.5 (partial) — three enforcement gaps.** A test audit found three criteria
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
already asserts what the empty slot must inherit.

### Open

**θ is not calibrated.** 0.25 %/s is the spec's opening value. M1.7 sets the real
one against RTP 96.5 %. Every RTP number quoted anywhere today is provisional.

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
| M1.5 | Risk caps and auto-orders | **In progress** |
| M1.6 | `ReplayIndexSource` + recorded BTC data | Not started |
| M1.7 | Monte-Carlo harness — calibrate θ | Not started |
| M1.8 | PixiJS v8 scene port | Not started |

**M1.5 — Risk caps and auto-orders** *(in progress)*

Done: the `PL-4` payout cap, `EN-7` entry idempotency, the `RL-1` phase guard.

Remaining:
- Take-profit and stop-loss set at entry, both triggering the same 500 ms ascent —
  the ascent must remain the only exit path so the liquidation-during-ascent risk
  stays symmetric. The τ they are evaluated at is already fixed by `CR-6b`.
- The `AO-5` max-win **auto-surface trigger**. The cap half is done; what remains
  is the trigger that stops a position running once the cap can no longer pay
  more. Per `AO-5` these are deliberately separate mechanisms: a build with the
  trigger but no clamp overpays on a gap; a build with the clamp but no trigger
  pays correctly but lets a capped position keep risking a crush for no upside.
- `EN-4` range validation — `stake×lev ≤ $2,000`, leverage-set and minimum-stake
  checks.
- The re-entry cooldown (`reentryCooldownMs` + `COOLING_OFF`), per ADR 0002.
- The `CR-6` client-line-vs-engine-line assertion.

*Exit criteria:* every cap has an AC id and a test that drives it past the
boundary from both directions.

**M1.6 — `ReplayIndexSource` + recorded BTC data**

A third `IndexSource` implementation replaying recorded 100 ms BTC files. This is
what turns the suite from "the simulator agreed with itself" into "the engine
behaved correctly on a real, adversarial, non-synthetic price series" — including
the flat-market and violent-gap cases the simulator's anti-run pressure will never
produce.

*Exit criteria:* byte-identical settlement across two runs of the same replay
file. At least one recorded flash-crash segment in the fixture set.

**M1.7 — Monte-Carlo harness, calibrate θ to 96.5 % RTP**

`packages/sim` runs the real engine across behaviour models (instant-cashout,
greedy, stop-loss-disciplined, panic) and outputs an RTP report artifact. θ is
chosen by this harness, not by intuition; the report is also the first document a
regulator will ask for. It should also report **how often the max-win cap actually
binds**, which is the number that matters for RTP.

*Exit criteria:* reproducible report committed as an artifact. RTP within ±0.2 %
of 96.5 % across all models. Variance and max-exposure figures included.

**M1.8 — PixiJS v8 scene port**

Deliberately last. The Canvas 2D renderer is the visual reference; port it only
once the logic underneath has stopped moving.

*Exit criteria:* renderer behind one interface. 60 fps on a mid-range phone in
portrait. Canvas 2D version retained for visual diffing.

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

Additional markets, real social features replacing the simulated bot feed, Close
Calls events, tournaments, horizontal scaling of the round server. Everything here
is optional; nothing here should ever be traded ahead of a Phase 1.5 or Phase 2
milestone.

---

## Next four steps

1. **Finish M1.5's auto-orders — TP and SL set at entry.** The tick loop already
   has the slot, `CR-6b` already fixes the τ, and `auto-order-tau.test.ts` already
   asserts what the slot must inherit. *Why first:* it is the only remaining work
   whose contract is fully written; everything needed to do it correctly is
   already in the repo.

2. **Land the `AO-5` auto-surface trigger and `EN-4` range validation.** The cap
   clamps the payout but nothing yet stops a capped position from riding into a
   crush for no upside, and `stake×lev ≤ $2,000` is still unchecked. *Why second:*
   these are the last two declared-but-unenforced criteria; closing them empties
   the category that the M1.5 audit exists to prevent refilling.

3. **Build `ReplayIndexSource` (M1.6).** *Why third:* every determinism claim in
   the certification bundle rests on replaying a real series, and M1.7's RTP
   numbers are only as trustworthy as the price data behind them.

4. **Run the Monte-Carlo harness and calibrate θ (M1.7).** *Why fourth:* θ is the
   single business dial and is currently a placeholder. It needs M1.6's data and
   M1.5's complete rule set to produce a number worth committing to.

Alongside all four, and not blocked by any of them: **open the licensing
conversation** (M3.1). It is the longest lead time in the plan and the only item
that can invalidate the design.

---

## Risks worth naming now

Ordered by how expensive they become if discovered late.

| Risk | Severity | Mitigation and timing |
|---|---|---|
| Legal classification: gaming or derivative? | **Existential** | A BTC-price-driven payout may be regulated as a financial product rather than gaming in some jurisdictions, invalidating the licensing route entirely. Get a written legal opinion during Phase 1.5 — before Phase 2 is built on the assumption. |
| Correlated exposure across all players | **High** | Unlike RNG crash games, one real price move resolves every position in the same direction simultaneously. Aggregate exposure caps and a kill switch are Phase 2 requirements, not Phase 5 polish. |
| θ uncalibrated — RTP is currently unknown | **High** | 0.25 %/s is a placeholder. RTP is the number a regulator checks first. Let M1.7 set θ and keep the report as a committed artifact. Quote no RTP figure until then. |
| Declared-but-unenforced criteria | **Medium** | The M1.5 audit found three criteria whose tests asserted the code rather than the criterion. `EN-4` and the `AO-5` trigger are the known remainder. Write the criterion before the code, as `CR-6b` was. |
| Simulator-shaped assumptions leaking into design | **Medium** | `SIM-ONLY` fencing is good discipline, but anti-run pressure and squalls make rounds dramatic in ways real BTC will not reliably reproduce. Validate feel against `ReplayIndexSource` (M1.6) before tuning further. |
| Responsible-play controls enforced client-side | **Medium** | Fine for a prototype, not compliant for real money. Budget the server-side move into Phase 2 rather than treating it as a Phase 3 surprise. |
| `apps/client` is unchecked JavaScript | **Low** | Deliberate — M1.8 replaces `render/` wholesale, so typing it now is work thrown away. The risk is scope creep putting game logic in the adapter. Keep new logic in `packages/`. |
| Stop-loss above 1× is unreachable | **Low** | `AO-3` confines SL to (0,1) and `AO-4` calls SL-wins-ties house-favourable — which only holds while SL sits below 1. A player wanting a trailing stop above 1× has no way to express it. Confirm the restriction is intended while building M1.5's SL. |
| PixiJS port attempted too early | **Low** | Already correctly sequenced last. Keep it there. |

---

*Crush Depth · delivery plan · Rev. 3 — M1.2 through M1.5 landed, 398 tests green
· repository state `12d2819`*
