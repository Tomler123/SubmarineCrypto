# CLAUDE.md — Crush Depth

Project instructions for Claude Code. Read this fully before touching anything.

## What this project is

**Crush Depth** (working title) is a real-money casino crash game where the outcome is driven by the **real BTC price**, not an RNG. Players ride a shared submarine whose depth is a live index derived from BTC/USDT; they open leveraged long (Surface) or short (Dive) positions at any moment mid-round, and cash out through a deliberate 500 ms "ballast ascent" during which they can still be liquidated.

It is a **B2B game provider** product, the same shape Spribe has with Aviator:
licensed casino operators embed the game, and players play it from their
**existing casino balance**. We never hold player funds (ADR 0011).

**Crypto is the price feed and nothing else.** BTC prices drive the submarine's
depth; the money is ordinary casino fiat balance, exactly as on a slot. There is
no crypto deposit, no crypto withdrawal and no custody anywhere in this system.
Treat any suggestion otherwise as a material scope change and confirm before
building. See `docs/BUSINESS-CONTEXT.md`.

Authoritative documents (keep them in the repo root, keep them current):

- `crush-depth-game-logic-v0.1.md` — the full game logic spec: index math, oxygen edge, cash-out rules, risk caps, degenerate cases. **This spec wins any conflict with code.**
- `crush-depth-acceptance-criteria-v0.1.md` — testable acceptance criteria for casino/certification readiness. New features must add criteria here before merging.
- `legacy/crush-depth-phase1.html` — the Phase 1 single-file prototype (Canvas 2D). Reference implementation of the client architecture and visual direction. **Kept verbatim for diffing; do not edit.**
- `ARCHITECTURE.md` — folder layout, the load-bearing Phase 2 seams, and the module-level side-effect order. Read before adding a module with side effects.
- `docs/BUSINESS-CONTEXT.md` — **who this is for and what is not yet known.** The B2B/Spribe-style model, the crypto-is-price-feed-only boundary, open questions for the client, and the agreed engineering/legal sequencing. Read it before planning a milestone so the commercial context never has to be re-explained; update it whenever the owner learns something new.

## Current state

Phase 1 complete: single-file HTML prototype with simulated feed, full round loop, positions, cash-out ascent, liquidation, bot feed, responsible-play UI.

**Phase 1.5 is complete; Phase 2 (server authority) is in progress, and M2.0 is done.** M1.1 (specs), M1.2 (toolchain + monorepo layout), M1.3 (pure engine port) and M1.4 (oxygen, round timings, entry cutoff) are done. The prototype was split into ES modules as a pure structural change, then moved under `apps/client/` by `git mv` with no content change. The repo is now an npm-workspaces monorepo with Vite, TypeScript strict and Vitest; `npm test`, `npm run typecheck` and `npm run build` all run in CI on push.

M1.3 moved position math and settlement into `packages/engine` as pure TypeScript: no DOM, no timers, no clock reads, no RNG. Every entry point takes a state and returns a new one plus an `EngineEvent[]`, so the five direct `FX`/`Au`/`feedMsg`/`toast`/`checkLossLimit` calls are gone. Money is `Cents` end to end with round-half-away-from-zero applied exactly once at settlement, replacing `Math.round`. `apps/client/src/core/engine.js` is now a thin adapter over the package. 87 tests, 100% coverage on `packages/*`.

M1.3 also settled four spec questions the port surfaced — the crush line is authoritative over `M_t ≤ 0` where floats separate them, rejection precedence is fixed by `EN-8`, `NO_PRICE` is distinct from MF-1 SIGNAL LOST, and a client mirror may never be stricter than the engine. The specs were amended (`CR-1`, `CR-3`, `CR-6`, `EN-8`, `EN-9`, `BO-2`, game logic §5); see `docs/decisions/0002-pure-engine-and-event-seam.md`.

M1.4 added the house edge. `M_t` carries the `−θ·τ` term, the crush line creeps
per `CR-3`, an O₂ gauge drains on the cash-out button, and the round moved to
90 s / 8 s with a T−5 s entry cutoff. **τ is a tick count, never a clock
reading** — `Position.ticksElapsed × config.tickSeconds` — and it advances in
`onTick` *before* anything is evaluated against it, which is what makes the line
the engine tests and the line the client draws the same number on the same tick
(`CR-6`). θ is read from `EngineConfig` and **snapshotted onto each position at
entry**, so `PL-2`'s round-boundary rule holds even against a caller that swapped
config mid-round. The entry cutoff is handed to the engine as
`OpenRequest.entryOpen` rather than computed from a clock the engine must not
own, and `ENTRY_CLOSED` ranks second in `EN-8`. Specs amended (`EN-1`, `EN-8`,
`PL-1`, `PL-2`, game logic §5 and §13); see
`docs/decisions/0003-oxygen-tick-derived-tau-and-round-timings.md`.
126 tests, 100% coverage on `packages/*`; test files are now typechecked too.

M1.5 is complete. It began with three enforcement gaps a test audit found —
criteria that were **declared but unenforced**, with green suites because the
tests asserted what the code did rather than what the criteria said:

- **PL-4's max-win cap** is now clamped at the single float→money conversion in
  `payoutFor`, so it applies to *every* settlement reason rather than only to an
  AO-5 auto-surface — a gap tick can cross the cap between two ticks, and RL-4's
  round-end settlement has no trigger to route through. The bounds
  (`maxWinMultiple`, `maxWinCents`) live in `EngineConfig` per RK-3. The cap
  binds on longs only: a short's `M` is bounded above by `1 + L`, so 26 at 25×.
- **EN-7's idempotency key** is now checked. A replayed `OpenRequest.id` is a
  no-op returning the existing position, ranked **above every EN-8 rejection** —
  a retry after a dropped ack is asking "did this land?", not "why can't I open
  a position?".
- **RL-1's graph** is now enforced by `setPhase` itself, which accepts only the
  legal successor; `resetPhase` is the one sanctioned bypass, for boot and tests.
  Phase entry is not idempotent — entering `settling` twice settled twice.

The completion tranche adds immutable optional TP/SL entry parameters, runtime
`EN-4`/`AO-3` validation, the authoritative-tick 900 ms re-entry cooldown, and
the three auto-order causes. TP/SL use bidirectional threshold crossings between
consecutive authoritative multipliers; SL wins a same-tick tie. Max-win is a
level check. All three start the normal 500 ms ascent in the existing tick slot:
advance τ once → crush → auto-order → due ascent settlement. The unconditional
`PL-4` payout cap remains a separate final protection.

Entry precedence is now fully explicit: accepted-id replay first; validation
(`INVALID_DIRECTION` → `INVALID_LEVERAGE` → `INVALID_STAKE` →
`NOTIONAL_LIMIT_EXCEEDED` → `INVALID_TAKE_PROFIT` → `INVALID_STOP_LOSS`);
then eligibility (`LOSS_LIMIT_REACHED` → `ENTRY_CLOSED` → `POSITION_OPEN` →
`COOLING_OFF` → `INSUFFICIENT_BALANCE` → `NO_PRICE`). See ADRs 0004 and 0005.
438 tests pass across 27 files; `packages/*` remains at 100% line, function and
branch coverage.

M1.6 is complete: `@crush/feed` owns the shared TypeScript feed base, published
index transform, simulator, interpolation buffer, replay source and fixture
parser. Three compact Binance BTCUSDT fixtures are committed with provenance;
the original 29.9 s calm control remains checksum-locked calibration input,
while the flash-crash and added calm-playable fixtures are the two full-round
recorded client selections. Three generated 100 s synthetic QA fixtures are
also available only through the same replay seam: `fixture=upper-limit`,
`fixture=lower-limit`, and `fixture=constant`. They exercise the renderer depth
clamps and time-only oxygen/cash-out behavior and are explicitly not real-market
or calibration evidence. The client still defaults to the simulator and opts
into replay only through `feed/index.js`; flash-crash remains the replay
fallback. Replay's epoch timestamps remain unchanged
for tick/engine consumers; `presentation-interp-buffer.ts` paces only
interpolation copies on the page clock at 125 ms and smooths recovery after a
sparse fixture gap, so Canvas, Pixi and HUD do not alternate velocity or jump.
The approved 100 ms → 125 ms policy and the explicit
`sigma_floor²` transform initial state are acceptance criteria FI-10 and FI-11,
with the presentation boundary specified by FI-16 and the replay decision
recorded in ADR 0006.

M1.7 is complete. `@crush/sim` runs the real engine against seeded simulator
rounds and the unchanged M1.6 replay mapping, models the four MC-3 player
behaviors, and emits canonical JSON plus a compact Markdown report. The
engineering calibration selects **θ = 0.03 %/s**: its 4,000-position selection
portfolio estimates 96.5437 % RTP, while a disjoint 20,000-position simulator
cohort estimates 96.9492 % with a 99 % interval containing the 96.5 % target.
The report is deliberately `engineering-preliminary`; PL-6 still requires at
least 10⁷ positions and 90 days of representative BTC before launch. See ADR
0007.

The Phase 1.5 Close Calls task is complete. `@crush/engine` retains the minimum
surviving authoritative index headroom from the live crush line over every
post-entry tick, including ascent and settlement, and emits one stable-id
`close-call` event for eligible successful settlements at or inside the
inclusive 50 bp threshold. The client formats and deduplicates that fact but
owns no proximity rule. Fake social actors now run isolated real engine states;
only their seeded names and action schedules remain synthetic. See CC-1…CC-8
and ADR 0008.

M1.8 is complete in its approved scope. The renderer now sits behind one
`RendererPort` (`init`/`resize`/`render`/`destroy`), fed by a pure
`SceneModel` projection. A renderer reads the model and nothing else — no `S`,
no engine, no `buffer`, no DOM, no clock — and `render(model): void` has no
return channel, so a scene cannot inform a gameplay decision by construction.
`crushIndex` and `livePnlCents` pass through from `Engine.liqIdx` / `Engine.pnl`
untouched (CR-6, UI-2); the shared geometry lives in `render/scene-model.ts` so
both renderers place the sub and both lines identically.

**Canvas remains the default**; `?renderer=pixi` is the explicit opt-in, exactly
as `?feed=replay` is for the feed. The Canvas renderer is *unmodified* — wrapped
by `render/canvas-port.js` — because it is the visual reference the port is
diffed against, and a retained renderer nobody runs is not a baseline.

The port covers the gameplay-critical layers (depth-lit water, the wake chart,
sub, pod, entry/crush lines per UI-4). Creatures, god rays, marine snow, sonar,
murk and debris are deliberately deferred; they carry no information a player
acts on, and adding them later touches `pixi-scene.ts` only. **PF-1's 60 fps on
a mid-range phone is not demonstrated** — it needs a real device and a real
WebGL context, so that exit criterion stands open. See SC-1…SC-8 and ADR 0009.

M2.0 is complete — the first Phase 2 milestone, and the multi-player engine
shape. `@crush/engine` gains a `RoundState`: a round id, the phase, the applied
tick series, and a `ReadonlyMap<PlayerRef, EngineState>` holding the **existing**
per-player state verbatim. It is a fan-out *around* the per-player entry points,
not a rewrite of them — `open`, `onTick`, `requestAscent`, `settleAtRoundEnd`,
`clearSettled` and `setLossLocked` keep their signatures and every existing test
passes unmodified, which is where every M1.3–M1.5 acceptance id stays pinned.

Three properties are the milestone, each a test rather than a claim. **Fan-out
determinism** (RS-2): a 500-player round is deeply equal, event log included,
under shuffled insertion orders. **Player isolation** (RS-3): A run alone and A
run among 500 others produce identical events, position, wallet and settlement.
**Canonical event ordering** (RS-4): round events are the per-player events
concatenated ascending by player reference in **code-unit** order — never
`localeCompare`, which is ICU-version-dependent and would let two servers order
the same round differently. All three follow from one property of the fan-out
primitive: it reads a player's state, calls the per-player function, writes the
result back, and shares nothing between players.

Also landed: explicit seating with `UNKNOWN_PLAYER` for an unaddressed player
(RS-5, kept out of `RejectCode` because that union is EN-8-ranked), round-level
RL-1 enforcement in `setRoundPhase` with `resetRoundPhase` as the one bypass
(RS-6), and the computed per-round directional aggregate M2.6 will cap against
(RS-7). See RS-1…RS-8 and ADR 0012.

680 tests pass with 4 skipped across 51 files. Package coverage gates remain
green; the Close Call engine module is at 100 % lines/statements, branches and
functions, while `@crush/sim` remains at 96.04 % lines/statements, 84.55 %
branches and 100 % functions without excluding its populated barrel. Client
`.ts` modules are now measured too — a reporting gap that had hidden
`core/close-calls.ts` since Close Calls — putting `scene-model.ts` at 100 %
lines and `pixi-scene.ts` at 82.89 % lines / 100 % functions. `apps/client`
remains ungated. M2.0's `round.ts` is at 100 % lines, branches and functions;
`round-types.ts` reports 0 % exactly as `types.ts` does, both being type-only
files with no runtime code.

### Where things live

```
apps/client/            the Phase 1 client (Vite root)
  index.html            entry point — markup + <script type="module" src="./src/main.js">
  styles/               tokens, topbar, scene, history, console, sheets
packages/               engine · feed · gateway · ledger · sim  (see ARCHITECTURE.md)
legacy/                 untouched Phase 1 prototype (diff reference)
apps/client/src/
  main.js               module-map header, tick wiring, boot sequence
  config/constants.js   CFG — every tunable and magic number
  util/                 dom ($), math (clamp/lerp/now/wait), random (LCG/gauss/noise/RSEED), format (fmt$/fmtClock)
  state/store.js        S — mutable game state singleton
  feed/                 source/fixture selection, InterpBuffer, and the replay presentation-clock adapter
  core/                 engine adapter, Close Call projector, gateway, entry-window, round, engine-backed bots
  audio/audio.js        Au synth + pointerdown unlock
  render/               the renderer seam: port.ts, scene-model.ts (pure projection),
                        pixi-scene.ts, canvas-port.js, effects.js, index.js (selection), boot.js,
                        palette, renderer.js (Canvas 2D reference — unmodified)
  ui/                   dom-refs, feed, history, overlay, console, sheets, responsible,
                        auto-orders.ts (AUTO switch + clamped TP/SL steppers)
  loop/frame.js         60 fps main loop
```

Run it with `npm install` then `npm run dev` (Vite, http://localhost:5173). ES modules require HTTP — opening the file directly with `file://` will still fail on CORS.

### Structural rules for this tree

- **Nothing outside `src/feed/` may know which `IndexSource` is running.** Import the `source` singleton from `feed/index.js`, never `SimulatedIndexSource` directly.
- **`InterpBuffer` stays out of `render/`.** Ticks are authoritative; the interpolated value is presentation. Replay epoch timestamps are copied and paced at 125 ms on the page clock only as they enter the presentation buffer; sparse-gap hold copies also stay inside that buffer. The source tick passed to the engine remains untouched. Keeping these operations inside `feed/` makes invariant 3 structurally visible.
- **The Pixi scene reads the `SceneModel` and nothing else.** No `S`, no engine,
  no `buffer`, no DOM, no clock inside `pixi-scene.ts` — the projection in
  `render/scene-model.ts` is the only place the Pixi path reads client state,
  and `render(model): void` has no return channel, so a scene cannot feed a
  gameplay decision. Authority facts (`crushIndex`, `livePnlCents`) pass through
  from `@crush/engine`; never recompute either in `render/`. The unmodified
  Canvas reference remains a documented temporary exception until parity review.
- **Renderer selection lives only in `render/index.js`.** Nothing outside
  `render/` may name a concrete implementation or import `pixi.js`, exactly as
  nothing outside `feed/` may name a concrete source. Canvas stays the default
  until visual parity is reviewed; `?renderer=pixi` is the opt-in.
- **`render/renderer.js` is the visual reference — do not edit it.** It is
  wrapped by `canvas-port.js`. Changing it changes the baseline the Pixi port
  is being diffed against.
- **Layout is read once, in `render/boot.js`,** and handed to a port as data. A
  renderer that measures the DOM cannot run headless in a test, and two
  renderers measuring independently is two sources of truth for one number.
- **New module with side effects?** Add its import to `main.js` at the position matching the documented order, and update the side-effect table in `ARCHITECTURE.md`.
- **`engine.js` is a client adapter now, not the engine.** The math lives in `@crush/engine`; `apps/client/src/core/engine.js` holds the engine state, mirrors it into `S`, turns `EngineEvent`s into `FX`/`Au`/`feedMsg`/`toast`/`checkLossLimit` calls, and owns the 900 ms delay before a settled position clears. Keep new game logic in the package, not the adapter.
- **τ never comes from a clock, and θ never from a literal.** Oxygen is
  `Position.ticksElapsed × config.tickSeconds`, advanced once per tick at the top
  of `onTick`; θ is read from `EngineConfig` and frozen onto the position at
  entry. Both rules exist so a replayed round settles identically (M1.6) and so
  M1.7 can sweep θ. `packages/engine/test/purity.test.ts` bans the clock reads.
- **The crush line has exactly one implementation.** `positionCrushIndex` is what
  the engine tests against *and* what the renderer draws; never recompute it
  client-side. `CR-6` makes a one-tick drift between the two a release blocker.
- **The AUTO row's bounds are a stepper mirror, not a gate.** `ui/auto-orders.ts`
  restates AO-3's leverage-dependent take-profit floor and the stop-loss
  interval so the − / + buttons and the on-blur clamp cannot offer a value the
  engine refuses. It must never reject a submission: `tryOpen` still sends the
  field's contents and lets the engine answer, because the mirror may not be
  stricter than the authority (ADR 0002). The engine bounds are *exclusive*, so
  the usable grid sits one 0.01 step inside each. The switch is the single
  source of truth for whether TP/SL are attached at all — off sends
  `undefined`, never a stale field value.
- **Close Calls are authority facts, not client classifications.** The engine
  observes signed headroom from its own `positionCrushIndex` on surviving ticks,
  including the full ascent, and emits the stable-id event after settlement.
  `core/close-calls.ts` may format and suppress duplicate ids only. Fake actors
  must consume isolated `@crush/engine` events; never restore their former local
  multiplier, crush, payout or P&L formulas.
- **`RoundState` fans out; it never reimplements.** `round.ts` wraps the
  per-player entry points and shares nothing between players — no accumulator
  crosses them, and the map being rebuilt is never read back. That is what makes
  RS-2's order-independence and RS-3's isolation structural rather than lucky.
  New round-level behaviour goes in the fan-out or in a per-player function,
  never in a special case that reads two players at once. The canonical event
  order is **code-unit** ascending by `PlayerRef` (so `p10` precedes `p9`);
  never "fix" it to numeric or `localeCompare` ordering — RS-4 exists so the
  archive and the ledger have one sequence, and ICU versions differ between
  deployments. Seating is explicit: a round never creates a player from an
  arriving request (RS-5).
- **`setRoundPhase` enforces RL-1 at round level; `resetRoundPhase` is the one
  bypass.** Entering `settling` settles every open position in the round, so a
  repeated transition is a population-wide double settlement. The final tick
  comes from the round's own retained series — a round settles only against a
  tick it actually applied.
- **`setPhase` enforces RL-1; `resetPhase` is the only bypass.** Phase entry runs
  side effects that are not idempotent (entering `settling` settles every open
  position), so a new phase-entry effect goes inside `enterPhase` and a new caller
  uses `setPhase`. Reach for `resetPhase` only where there is genuinely no
  predecessor phase — boot, and tests that start mid-cycle.
- **The max-win cap lives at the money conversion, not at the trigger.**
  `payoutFor` clamps after the single rounding, so every settlement reason is
  covered by construction. AO-5's auto-surface trigger stops a
  position running past 50× — it is not what enforces the bound.
- **Tick order is an engine contract.** `onTick` advances τ exactly once, then
  checks crush, then auto-orders, then due ascent settlement. TP/SL compare the
  retained previous authoritative multiplier with this tick's multiplier;
  rendered/interpolated values never participate. Do not reorder these stages.
- There is deliberately **no `economy/` folder** in Phase 1. It is the intended home for ledger and payout arithmetic when that logic is extracted from `Engine` in Phase 2.

## Non-negotiable invariants

Violating any of these is a bug regardless of what any task says:

1. **No RNG ever touches money.** Randomness is allowed only in cosmetics (terrain, creatures, audio). Every payout must be a deterministic function of the published price series and player actions.
2. **The feed boundary is sacred.** All price data enters through the `IndexSource` contract (`start/stop`, `resetRound`, `onTick(fn) → {t, v, ret}`). The simulator and the future WebSocket source are drop-in swaps. Nothing outside the feed module may know which one is running.
3. **Money moves on ticks only.** Liquidation, cash-out settlement, and entry execution use tick values. The 60 fps interpolated value (150 ms buffer) is presentation only — it may drive visuals and live readouts, never a balance change.
4. **All money is integer minor units (cents).** No floats in any balance, stake, or payout path. Multiplier math may use floats but converts to cents exactly once, at settlement, with a defined rounding rule (round half away from zero).
5. **Player actions are requests.** Everything routes through the `Gateway` (open, cash-out, auto-order set). Today it resolves locally with fake latency; Phase 2 awaits server acks. Optimistic UI is fine; the seam is not.
6. **Entry executes on the first tick after server receipt.** Never a tick the player has already seen.
7. **Audit-locked constants** (λ, σ_floor, clamp, v, I₀, ascent 500 ms) must not change without versioning the change in the spec. `θ` (oxygen) is the one business-tunable dial and lives in remote config.
8. **The player must never see the future.** No lookahead of any kind may leak into rendering or UI.
9. **Responsible-play UI ships in every build**: session clock, loss limit, 15-minute reality check. Never remove or hide it to simplify a task.

## Game constants (v1 — mirror of the spec's parameter sheet)

```
TICK 8 Hz (0.125 s) · BUFFER 150 ms · ASCENT 500 ms
ROUND 90 s · INTERMISSION 8 s · ENTRY CUTOFF T−5 s   (all live in CFG)
I₀ = 1000 · λ = 0.997 · σ_floor = 1.2 bp/tick · clamp ±3.5σ · v = 0.0042
LEVERAGE {2, 5, 10, 25} · stake×lev ≤ $2,000 · max win 50× and $10k
θ = 0.03 %/s (M1.7 engineering value; RTP target 96.5 %; PL-6 pending)
M_t = 1 + L·d·(I_t/I_e − 1) − θ·τ ;  τ = ticks-since-entry × 0.125 (entry = tick 0)
crush at the first tick the index reaches the line I_e·(1 − d·(1 − θτ)/L)
  — the LINE is authoritative where floats separate it from M_t ≤ 0
Close Call at minimum surviving d·(I_t−I_crush)/I_crush ≤ 0.5 %, inclusive
```

## Target repo structure (migrate toward this; don't half-migrate)

> **Current vs. target.** The npm-workspaces monorepo and TypeScript build are
> live. `@crush/ledger` and the pure `@crush/engine` are populated through the
> authoritative Close Call event seam. The client is still ES modules under
> `apps/client`: M1.8 put the PixiJS scene behind a `RendererPort` there rather
> than moving it to a package, because the target structure puts the renderer in
> `apps/client`. React/Zustand adoption remains future work. `packages/gateway`
> remains a milestone-shaped placeholder; `packages/feed` is populated through
> M1.6 and `packages/sim` through M1.7.

```
/apps/client          React + PixiJS v8 + Zustand + Framer Motion (mobile-first, portrait)
/packages/feed        IndexSource contract, SimulatedIndexSource, ReplayIndexSource, InterpBuffer
/packages/engine      round state + multi-player fan-out, position math, oxygen, crush, settlement, Close Call facts (pure, no I/O)
/packages/gateway     request/ack seam, optimistic mirror
/packages/ledger      integer-cent wallet types + double-entry helpers (client mock in Phase 1.5)
/packages/sim         Monte-Carlo RTP calibration harness + behavior models
/docs                 the two spec documents + decision log
```

- `engine` must be pure TypeScript with zero DOM/Pixi imports so the same package runs in the Phase 2 server. This is the most important structural rule of the migration.
- Renderer stays behind one interface; the Canvas 2D prototype code is the visual reference, PixiJS v8 is the target.
- Stack is fixed: React + PixiJS v8 + Zustand. Not Unity WebGL, not Phaser. Argue alternatives with the owner before deviating.

## Phase 1.5 task list (complete)

1. ~~Repo scaffold~~ — **done**. The ES-module split (see "Where things live") plus M1.2: npm workspaces, Vite, TypeScript strict, Vitest with an 80% coverage gate over `packages/*`, and CI on push. `apps/client` is still JavaScript (`allowJs`, `checkJs` off); **new code should be `.ts`.** M1.8 added the render seam as `.ts` beside the untouched Canvas renderer rather than replacing `render/` wholesale, so the prototype JavaScript there is retained deliberately as the visual reference.
2. ~~Port engine math into `/packages/engine` with unit tests against the acceptance criteria~~ — **done (M1.3)**. Tests are named by AC id; `packages/engine/test/purity.test.ts` is the durable guard on the no-DOM/no-timer/no-clock/no-RNG rule.
3. ~~Add oxygen: `−θτ` in the multiplier, O₂ bar draining on the cash-out button, crush line creeping in the scene.~~ — **done (M1.4)**.
4. ~~Round 90 s, entry cutoff T−5 s, intermission 8 s.~~ — **done (M1.4)**.
5. ~~Auto cash-out (take-profit) + stop-loss, runtime entry validation and authoritative-tick re-entry cooldown.~~ — **done (M1.5)**. TP/SL are snapshotted at entry, use consecutive-tick crossings, and share the normal 500 ms ascent; `CR-6b` fixes their τ alignment.
6. ~~Max-win auto-surface at 50×, with the unconditional payout cap kept separate.~~ — **done (M1.5)** (PL-4/AO-5, ADRs 0004 and 0005).
7. ~~`ReplayIndexSource` that replays recorded real BTC 100 ms data files.~~
   **done (M1.6)** — deterministic 125 ms-grid selection, published transform,
   primary-source fixtures, provenance, and engine settlement evidence.
8. ~~Monte-Carlo harness in `/packages/sim`: calibrate θ to RTP 96.5 % across behavior models; output a report artifact.~~ **done (M1.7)** — seeded trial-addressed streams, simulator selection, separately reported replay stress evidence, 99 % intervals, and canonical JSON/Markdown artifacts; θ is 0.03 %/s pending PL-6.
9. ~~Close Calls events in the (still fake) social feed.~~ **done** — CC-1…CC-8, ADR 0008; inclusive 50 bp minimum authoritative headroom, full ascent exposure, stable-id duplicate suppression, and engine-backed fake actors.
10. ~~PixiJS scene port of the Canvas 2D renderer — last, after logic is
    tested.~~ **done (M1.8)** — SC-1…SC-8, ADR 0009. One `RendererPort`, a pure
    `SceneModel` projection, shared parity-critical mappings, and a
    `?renderer=pixi` opt-in with Canvas retained unmodified as the default and
    the visual reference. Gameplay-critical layers only; PF-1's on-device
    60 fps measurement remains open.

## Phase 2 task list (current)

Server authority. Sequencing rule: **each milestone is verifiable before the one
after it exists.** M2.0, M2.1 and M2.3 are pure packages with no sockets and no
database; M2.2 introduces I/O; only M2.4 binds money to a network. Full detail in
`docs/DESCENT-PLAN.md`.

| id | Milestone | Shape | Depends on | Status |
|---|---|---|---|---|
| M2.0 | Multi-player engine shape | pure package | — | **done** |
| M2.1 | Index aggregation + Signal Lost decision | pure package | — | next |
| M2.2 | Live feed transport + tick archive | service | M2.1 | |
| M2.3 | Internal double-entry ledger + reconciliation | pure package + store | wallet contract | |
| M2.4 | Authoritative round server + wallet seam | service | M2.0–M2.3, wallet contract | |
| M2.5 | Operator session integration + eligibility enforcement | service | M2.4 | |
| M2.6 | House risk engine + kill switch | service | M2.4, M2.5 | |

1. ~~Multi-player engine shape: `RoundState` fan-out around the per-player entry
   points, with order-independence, player isolation and canonical event
   ordering property-tested across 500+ simultaneous positions.~~ **done (M2.0)**
   — RS-1…RS-8, ADR 0012. Every existing per-player test passes unmodified.
2. **M2.1 — index aggregation and the Signal Lost decision.** FI-4's 0.5 %
   median-deviation exclusion and FI-5's 3-live-feed floor are a component
   *upstream* of `IndexTransform`, which takes a single price and must keep
   doing so. Pure package, no sockets. Venue set and liveness are fixed by
   ADR 0010.
3. M2.2 — live feed transport and the tick archive. Market-data rights (FI-20)
   are a release blocker for this milestone, not a procurement task.
4. M2.3 — internal double-entry ledger and reconciliation. **Blocked on the
   wallet contract decision** (WL-1…WL-8).
5. M2.4 — authoritative round server and the wallet seam. Consumes M2.0's
   fan-out; single-writer authority behind stateless gateways per ADR 0010.
6. M2.5 — operator session integration and eligibility enforcement.
7. M2.6 — house risk engine and kill switch. Caps the RS-7 aggregate.

**Required decision before M2.3 and M2.4 are finalised: the internal wallet
contract.** Idempotent debit / credit / refund / rollback with per-operator
adapters. Its shape determines the ledger's account structure, the entry path's
failure modes and the round server's latency budget.

**Carried forward from Phase 1.5:** PF-1's on-device 60 fps measurement and the
by-eye Canvas/Pixi parity review. Both gate flipping the renderer default;
neither gates Phase 2.

## Working conventions

- TypeScript strict everywhere; no `any` in engine or ledger code. Enforced by `npm run typecheck` (`tsc --build`, strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`), which since M1.4 also typechecks `packages/*/test` via `tsconfig.tests.json` — a hand-built fixture that no longer matches its type must fail the build, not surface as a runtime `NaN`. The exception is `apps/client`, where the Phase 1 prototype remains unchecked JavaScript until it migrates into packages.
- Money is `Cents` from `@crush/ledger` — a branded integer type, so a float in a money field is a compile error (`LG-2`). Convert float multipliers to money exactly once, at settlement, via `scaleCents` / `roundHalfAwayFromZero` (`PL-4`).
- Every engine change: unit tests first, referencing acceptance-criteria ids.
- Conventional commits (`feat(engine): …`, `fix(feed): …`).
- Label every assumption in code comments as `// ASSUMPTION:` and surface new open questions at the end of your reply, numbered, ordered by impact — that is how the owner works.
- Do not build Phase 2/3 features (server, real feed, real ledger, risk engine) — but never paint the code into a corner that makes them painful.
- When a task conflicts with the spec, stop and ask; do not silently reinterpret the spec.

## Domain glossary

- **Index (I)** — the game's price curve, derived from BTC; sub's depth is a linear map of it.
- **Surface / Dive** — long / short.
- **The Blow** — the 500 ms cash-out ascent; the game's signature moment.
- **Crush** — liquidation (multiplier ≤ 0); loss always capped at stake.
- **Oxygen (θ)** — per-second multiplier decay; the sole house edge.
- **Pod** — the player's position visualized as a capsule clamped to the shared sub.
- **Armed** — a bet queued during intermission that opens at launch.
- **Signal Lost** — feed-outage abort per spec §8.
