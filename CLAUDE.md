# CLAUDE.md — Crush Depth

Project instructions for Claude Code. Read this fully before touching anything.

## What this project is

**Crush Depth** (working title) is a real-money casino crash game where the outcome is driven by the **real BTC price**, not an RNG. Players ride a shared submarine whose depth is a live index derived from BTC/USDT; they open leveraged long (Surface) or short (Dive) positions at any moment mid-round, and cash out through a deliberate 500 ms "ballast ascent" during which they can still be liquidated.

Authoritative documents (keep them in the repo root, keep them current):

- `crush-depth-game-logic-v0.1.md` — the full game logic spec: index math, oxygen edge, cash-out rules, risk caps, degenerate cases. **This spec wins any conflict with code.**
- `crush-depth-acceptance-criteria-v0.1.md` — testable acceptance criteria for casino/certification readiness. New features must add criteria here before merging.
- `legacy/crush-depth-phase1.html` — the Phase 1 single-file prototype (Canvas 2D). Reference implementation of the client architecture and visual direction. **Kept verbatim for diffing; do not edit.**
- `ARCHITECTURE.md` — folder layout, the load-bearing Phase 2 seams, and the module-level side-effect order. Read before adding a module with side effects.

## Current state

Phase 1 complete: single-file HTML prototype with simulated feed, full round loop, positions, cash-out ascent, liquidation, bot feed, responsible-play UI.

Phase 1.5 in progress. **M1.1 (specs), M1.2 (toolchain + monorepo layout), M1.3 (pure engine port) and M1.4 (oxygen, round timings, entry cutoff) are done.** The prototype was split into ES modules as a pure structural change, then moved under `apps/client/` by `git mv` with no content change. The repo is now an npm-workspaces monorepo with Vite, TypeScript strict and Vitest; `npm test`, `npm run typecheck` and `npm run build` all run in CI on push.

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

M1.5 has begun with the three enforcement gaps a test audit found — criteria
that were **declared but unenforced**, with green suites because the tests
asserted what the code did rather than what the criteria said:

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

**CR-6b** was added to the acceptance criteria *before* the auto-order code, so
the trigger τ is fixed by the criterion rather than by whatever the first
implementation happened to do. See
`docs/decisions/0004-max-win-cap-entry-idempotency-and-phase-guard.md`.
397 tests, 100 % coverage on `packages/*`.

The rest of M1.5 (the auto cash-out / stop-loss triggers themselves, EN-4 range
validation, the re-entry cooldown) plus M1.6 replay source, M1.7 Monte-Carlo
harness and M1.8 PixiJS port are unstarted. **θ is not yet calibrated** —
0.25 %/s is the spec's opening value and M1.7 sets the real one against RTP
96.5 %.

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
  feed/                 SimulatedIndexSource, InterpBuffer, and the source/buffer singletons
  core/                 engine (adapter), gateway, entry-window (EN-1 cutoff), round (state machine), bots
  audio/audio.js        Au synth + pointerdown unlock
  render/               palette (depth colour ramp), renderer (Canvas 2D — one file, see ARCHITECTURE.md)
  ui/                   dom-refs, feed, history, overlay, console, sheets, responsible
  loop/frame.js         60 fps main loop
```

Run it with `npm install` then `npm run dev` (Vite, http://localhost:5173). ES modules require HTTP — opening the file directly with `file://` will still fail on CORS.

### Structural rules for this tree

- **Nothing outside `src/feed/` may know which `IndexSource` is running.** Import the `source` singleton from `feed/index.js`, never `SimulatedIndexSource` directly.
- **`InterpBuffer` stays out of `render/`.** Ticks are authoritative; the interpolated value is presentation. Keeping them in separate modules makes invariant 3 structurally visible.
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
- **`setPhase` enforces RL-1; `resetPhase` is the only bypass.** Phase entry runs
  side effects that are not idempotent (entering `settling` settles every open
  position), so a new phase-entry effect goes inside `enterPhase` and a new caller
  uses `setPhase`. Reach for `resetPhase` only where there is genuinely no
  predecessor phase — boot, and tests that start mid-cycle.
- **The max-win cap lives at the money conversion, not at the trigger.**
  `payoutFor` clamps after the single rounding, so every settlement reason is
  covered by construction. AO-5's auto-surface trigger, when M1.5 adds it, stops a
  position running past 50× — it is not what enforces the bound.
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
θ = 0.25 %/s (RTP target 96.5 %, calibrate by simulation)
M_t = 1 + L·d·(I_t/I_e − 1) − θ·τ ;  τ = ticks-since-entry × 0.125 (entry = tick 0)
crush at the first tick the index reaches the line I_e·(1 − d·(1 − θτ)/L)
  — the LINE is authoritative where floats separate it from M_t ≤ 0
```

## Target repo structure (migrate toward this; don't half-migrate)

> **Current vs. target.** The tree under "Where things live" is the *current*
> Phase 1.5 layout: plain ES modules, no build step. The monorepo below remains
> the destination. The current folders map onto it directly —
> `src/feed → packages/feed`, `src/core/{engine,round} → packages/engine`,
> `src/core/gateway → packages/gateway`, `src/render + src/ui → apps/client` —
> so the migration is a move plus a TypeScript conversion, not a redesign.

```
/apps/client          React + PixiJS v8 + Zustand + Framer Motion (mobile-first, portrait)
/packages/feed        IndexSource contract, SimulatedIndexSource, ReplayIndexSource, InterpBuffer
/packages/engine      round state machine, position math, oxygen, crush, settlement (pure, no I/O)
/packages/gateway     request/ack seam, optimistic mirror
/packages/ledger      integer-cent wallet types + double-entry helpers (client mock in Phase 1.5)
/packages/sim         Monte-Carlo RTP calibration harness + behavior models
/docs                 the two spec documents + decision log
```

- `engine` must be pure TypeScript with zero DOM/Pixi imports so the same package runs in the Phase 2 server. This is the most important structural rule of the migration.
- Renderer stays behind one interface; the Canvas 2D prototype code is the visual reference, PixiJS v8 is the target.
- Stack is fixed: React + PixiJS v8 + Zustand. Not Unity WebGL, not Phaser. Argue alternatives with the owner before deviating.

## Phase 1.5 task list (current)

1. ~~Repo scaffold~~ — **done**. The ES-module split (see "Where things live") plus M1.2: npm workspaces, Vite, TypeScript strict, Vitest with an 80% coverage gate over `packages/*`, and CI on push. `apps/client` is still JavaScript (`allowJs`, `checkJs` off) because M1.8 replaces `render/` wholesale; **new code should be `.ts`.**
2. ~~Port engine math into `/packages/engine` with unit tests against the acceptance criteria~~ — **done (M1.3)**. Tests are named by AC id; `packages/engine/test/purity.test.ts` is the durable guard on the no-DOM/no-timer/no-clock/no-RNG rule.
3. ~~Add oxygen: `−θτ` in the multiplier, O₂ bar draining on the cash-out button, crush line creeping in the scene.~~ — **done (M1.4)**.
4. ~~Round 90 s, entry cutoff T−5 s, intermission 8 s.~~ — **done (M1.4)**. The tick loop is written in `CR-1` order with the auto-order slot empty and a test asserting nothing settles from it, so M1.5 fills the slot rather than rewriting the loop.
5. Auto cash-out (take-profit) + stop-loss, set at entry, triggering the same 500 ms ascent. Also the re-entry cooldown (`reentryCooldownMs` + `COOLING_OFF`) — see ADR 0002 — and the `CR-6` client-line-vs-engine-line assertion. **The τ the triggers are evaluated at is fixed by `CR-6b`, written before the code**; `packages/engine/test/auto-order-tau.test.ts` already asserts what the empty slot must inherit.
6. Max-win auto-surface at 50×. **The payout cap half is done** (PL-4/AO-5, ADR 0004) — what remains is the *trigger*: the auto-surface that stops a position running once the cap can no longer pay more.
7. `ReplayIndexSource` that replays recorded real BTC 100 ms data files.
8. Monte-Carlo harness in `/packages/sim`: calibrate θ to RTP 96.5 % across behavior models; output a report artifact.
9. Close Calls events in the (still fake) social feed.
10. PixiJS scene port of the Canvas 2D renderer — last, after logic is tested.

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
