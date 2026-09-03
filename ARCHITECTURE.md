# ARCHITECTURE — Crush Depth (Phase 1.5)

This document describes the folder layout produced by the Phase 1.5 structural
split of `crush-depth-phase1.html`, and which boundaries are load-bearing for
Phase 2.

> **M1.2 moved the client.** `index.html`, `src/` and `styles/` now live under
> `apps/client/`, and the target `packages/*` workspaces exist. Every `src/...`
> path below is relative to `apps/client/`. The move was pure `git mv` — no
> file contents changed — so the split described here is otherwise unaffected.
> See `docs/decisions/0001-monorepo-layout-and-toolchain.md`.

The split was **purely structural**: no logic, naming, formatting, or behaviour
was changed. The original single-file prototype is preserved verbatim at
`legacy/crush-depth-phase1.html` for diffing.

---

## Folder layout

```
apps/client/
  index.html            entry point — body markup + <script type="module" src="./src/main.js">
  vite.config.ts        dev server + production build
  styles/               the original <style> block, split by the authored section comments
legacy/                 untouched Phase 1 single-file prototype (diff reference)
packages/               target workspaces — see "Target packages" below
apps/client/src/
  main.js               module-map header, tick wiring, boot sequence
  config/constants.js   CFG — every tunable and magic number
  util/                 leaf utilities, no project dependencies
    dom.js              $
    math.js             clamp, lerp, now, wait
    random.js           seeded LCG, gauss, value noise, RSEED + setRSEED
    format.js           fmt$, fmtClock
  state/store.js        S — the mutable game state singleton
  feed/                 THE PRICE-FEED SEAM (see below)
    monotonic.js        IndexSourceBase — subscribers + the FI-8 gate
    SimulatedIndexSource.js
    InterpBuffer.js
    presentation-interp-buffer.ts
                        client-only authoritative-time → page-time adapter
    index.js            source/fixture selection + the `source` and `buffer` singletons
  core/                 pure-ish game logic
    engine.js           adapter over @crush/engine: state mirror + event → effect
    close-calls.ts      deterministic event formatting + stable-id feed suppression
    gateway.js          request/ack seam for player actions
    entry-window.js     EN-1 T−5s cutoff predicate (pure read of S + CFG)
    round.js            round state machine
    bots.js             seeded fake actors; outcomes come from isolated @crush/engine states
  audio/audio.js        Au synth + pointerdown unlock listener
  render/               THE RENDERER SEAM (M1.8 — see below)
    index.js            renderer selection + state -> SceneModel + renderFrame
    boot.js             the one layout read; owns the resize listener
    port.ts             RendererPort interface (init/resize/render/destroy)
    scene-model.ts      pure state -> SceneModel projection + shared mappings
    pixi-scene.ts       PixiJS v8 RendererPort
    canvas-port.js      the retained Canvas 2D renderer as a RendererPort
    effects.js          Canvas-backed presentation-effects compatibility facade
    palette.js          depth-zone colour ramp, zone naming
    renderer.js         Canvas 2D renderer (canvas, view, FX, quality, draw, sprites)
  ui/
    dom-refs.js         cached DOM nodes shared by the UI modules
    feed.js             social feed messages
    history.js          round-history chips
    overlay.js          centre overlay, settle card, toast
    console.js          betting console: stake, leverage, direction, cash-out
    sheets.js           bottom sheets + scrim
    responsible.js      loss limits, reality check, session clock, sound toggle
  loop/frame.js         the 60 fps main loop
```

---

## Target packages (created at M1.2, filled through Close Calls)

The workspaces exist with manifests, tsconfigs and project references so that
each milestone fills a package rather than inventing one. Placeholder barrels
carry a package-name constant and a comment naming the milestone that populates
them.

| Package | Populated by | Holds |
|---|---|---|
| `@crush/ledger` | **live now** | branded `Cents`, round-half-away-from-zero, arithmetic guards |
| `@crush/engine` | **live through M2.0** | pure position lifecycle, oxygen, crush, settlement, entry validation/cooldown, TP/SL/max-win triggers, payout caps, authoritative Close Call facts, and the multi-player `RoundState` fan-out |
| `@crush/feed` | **live through M1.6** | TypeScript `IndexSource` contract/base gate, published transform, simulated and replay sources, `InterpBuffer`, fixture parser |
| `@crush/gateway` | M2.2 | request/ack seam, optimistic mirror |
| `@crush/sim` | **live through M1.7** | deterministic Monte-Carlo RTP harness, behavior models, source datasets, statistics and canonical report data |

TypeScript project references declare the dependency graph, so `tsc --build`
typechecks in dependency order and `packages/engine` has no path by which it
could import from `apps/client`. `packages/engine/test/purity.test.ts` is the
durable guard on that rule: it fails on any `render/` `ui/` `audio/` import, any
`document`/`window` reference, any timer, any clock read (`Date.now`,
`performance.*`, `new Date`) and any `Math.random`. M1.3 removed the deferred
callback that used to sit inside `Engine.settle`, so the guard now passes on real
engine code rather than describing future work.

Close Call observation stays inside that same purity boundary. The engine uses
`positionCrushIndex` after CR-1 has established survival, retains the minimum
signed authoritative headroom across open/ascent/settlement ticks, and emits a
self-contained stable-id event. No wallet or settlement branch reads the
metadata. The client projector formats the event and suppresses duplicate ids;
it has no outcome formula. Fake social actors run isolated engine states, so
their Close Calls use the same seam instead of the former client-side static
line, multiplier and `Math.round` path.

### The round fan-out seam (M2.0)

`@crush/engine` now holds two layers, and the distinction is load-bearing.
`EngineState` is **one player**; `RoundState` is **one round holding many of
them** — a round id, the phase, the applied tick series, and a
`ReadonlyMap<PlayerRef, EngineState>` of the *existing* per-player state,
embedded verbatim rather than adapted.

`round.ts` is a fan-out **around** the per-player entry points, never a
replacement for them. `open`, `onTick`, `requestAscent`, `settleAtRoundEnd`,
`clearSettled` and `setLossLocked` keep their signatures and their tests, which
is where every M1.3-M1.5 acceptance id stays pinned.

One primitive is the reason RS-2 and RS-3 hold: it reads each player's state,
calls the per-player function, writes the result back under that player's key,
and does nothing else. No accumulator crosses players, no earlier result is an
input to a later one, and the map being built is never read back. Order
therefore cannot matter, and the permutation tests check that the property still
holds rather than establishing it by sampling. The iteration runs in sorted key
order anyway, because the *event log* is a sequence and RS-4 needs it
insertion-order-independent too.

Round-level rules that follow, and are enforced rather than documented:

- **Seating is explicit.** `roundOpen` refuses a player the round does not hold
  with `UNKNOWN_PLAYER` (RS-5). A round never creates a player from an arriving
  request, because a wallet that appears because a request named it is a balance
  from nowhere.
- **`setRoundPhase` enforces RL-1 at round level; `resetRoundPhase` is the one
  bypass.** Entering `settling` settles every open position in the round, so an
  illegal or repeated transition is a population-wide double settlement. The
  final tick comes from the round's own retained series, so a round settles only
  against a tick it actually applied.
- **`directionalExposure` is computed, never maintained** (RS-7). A running
  total is a second source of truth that drifts silently; RK-1 and M2.6 need the
  number re-derivable from the archive. Ascending positions count — they can
  still crush inside the Blow.
- **`UNKNOWN_PLAYER` is not a `RejectCode`.** That union is EN-8-ranked and
  answers a per-player question; round addressing has no rank in it. See
  ADR 0012.

`packages/sim/test/purity.test.ts` applies the same boundary to the calibration
core and also bans ambient randomness. The harness receives or derives every
random stream from its declared master seed and stable trial address; it has no
DOM, clock, timer, scheduler-pacing or client-state dependency. The report
script is the I/O shell: it reads fixture bytes and writes artifacts, while the
package remains deterministic data-in/data-out code.

### Calibration evidence boundary

`@crush/sim` depends inward on `@crush/engine`, `@crush/feed`, and
`@crush/ledger`; none depends back on it. Simulator evidence is generated via
the existing `SimulatedIndexSource` with injected scheduling and RNG. Replay
evidence is generated via `ReplayIndexSource` using FI-10 unchanged: a
fixture-start 125 ms grid selects the latest original row at or before each
boundary and emits only its original timestamp and price.

Theta selection uses only an equal-weight simulator portfolio. The two M1.6
fixtures are selected calm/flash-crash strata, so their results are reported as
stress evidence and are never assigned an invented population weight. This
calibration-only source choice does not touch the client seam: the simulator
remains the normal client source and replay remains an explicit feed-seam opt-in.

---

## Load-bearing boundaries for Phase 2

These seams are the reason the split exists. Treat them as contracts. The
first four came out of the Phase 1.5 split; the fifth was added by M1.8.

### 1. `feed/` — the price-feed boundary (most important)

`SimulatedIndexSource` and `ReplayIndexSource` implement the `IndexSource` contract:
`onTick(fn) → {t, v, ret}`, `resetRound()`, `halt()`, `onAlarm(fn)`.

There is deliberately **no `start()`/`stop()`** (FEED-F5). A source self-starts
whatever machinery it needs in its constructor and stays dormant until
`resetRound()` opens a round; `halt()` closes one. `core/round.js` is the only
caller of either. The pair was named in one stale comment, never implemented and
never called; it was removed rather than added so that M1.6's second
implementation is not written against a surface nothing uses.

In Phase 2 a `WsIndexSource` implements the same contract and replaces it in
`feed/index.js`. **Nothing outside `feed/` may know which source is running.**
The client feed seam keeps the simulator as the default and accepts
`?feed=replay` as an explicit replay opt-in. `fixture=flash-crash` and
`fixture=calm` select the two playable recorded intervals. Three clearly
synthetic, full-round QA selections exercise presentation extremes without
claiming market provenance: `fixture=upper-limit`, `fixture=lower-limit`, and
`fixture=constant`. An omitted or unrecognised replay fixture still falls back
to `flash-crash`. No other client module imports a concrete source or resolves
a fixture name.

**Every source extends `IndexSourceBase` (`packages/feed/src/index-source-base.ts`)**, which owns the
subscriber list and the single emit path, `_publish`. That path is the FI-8
gate: a tick whose timestamp is non-finite or not strictly greater than the last
accepted one is dropped before any subscriber sees it, counted in
`rejectedTicks`, and reported through `onAlarm`. The gate lives at the seam
rather than in each implementation on purpose — the simulator's injected clock
and replay's file timestamps both pass through the same gate. Because `_publish`
is the only way out, an implementation cannot opt out of the rule. Replay's
explicit `resetRound()` rewind is the named finite-fixture exception: it resets
the high-water mark and preserves original fixture timestamps, so cross-round
rewind is tested separately from live-source FEED-F3 continuity.

`ReplayIndexSource` is scheduler-independent at its core. Its injected
`ReplayScheduler` advances only the fixture-start-anchored 125 ms selection
boundaries; it never supplies a price or timestamp. FI-10 selects the latest
recorded 100 ms row at or before each boundary, emits that original row once,
and never fills gaps. The published FI-1 transform and its explicit initial
variance live in the package alongside the source.

The executable definition of all of this is
`apps/client/test/support/index-source-contract.js`, which every source runs
through unchanged. Add an implementation, call `describeIndexSourceContract`,
and it inherits the whole contract.

### 2. `feed/InterpBuffer.js` — tick layer vs. 60 fps renderer

The interpolation buffer is deliberately **not** inside `render/`. Ticks are
authoritative for money; the interpolated 60 fps value is presentation only.
Keeping these in separate modules makes the rule structurally visible: the
renderer calls `buffer.valueAt(rt)` and cannot reach tick state any other way.

Replay adds a second clock domain at this boundary: source ticks carry original
Unix epoch milliseconds (FI-10/FI-13), while frame timestamps come from
`performance.now()`. `presentation-interp-buffer.ts` anchors the first replay
tick to the current page time, then paces presentation copies at the same
125 ms interval that delivers replay boundaries. This prevents FI-10's
irregular 100/200 ms source timestamps from turning a steady playback timer
into alternating visual velocities. If a sparse fixture stalls beyond the
150 ms render horizon, the adapter adds a previous-value hold copy at the
current horizon and eases to the newly known value over one tick instead of
retroactively jumping across the gap. Both are presentation-only copies. The
original object still flows unchanged to the engine and bot consumers, and
`reset()` clears the page timeline so each round re-anchors. This is FI-16's
presentation-only adapter and does not change deterministic replay output.

### 3. `core/gateway.js` — the request/ack seam

Every player action routes through `Gateway`. Today it resolves locally after a
fake 60 ms latency. In Phase 2 these methods await real server acks. The seam
already exists at every call site, so the change is contained to this file.

### 4. `core/engine.js` + `core/round.js` — server-bound logic

The engine (position math, liquidation, settlement) and the round state machine
are the code that moves to the Phase 2 server. They are separated from all
rendering and DOM code so that migration is a move, not a rewrite.

> **Note on `engine.js` purity — resolved at M1.3.** The position math and
> settlement now live in `@crush/engine`, which is pure: every entry point takes
> a state and returns a new one plus an `EngineEvent[]`. What remains in
> `apps/client/src/core/engine.js` is an *adapter*: it holds the engine state,
> mirrors it into `S` so the renderer and console read it unchanged, translates
> events into the `FX` / `Au` / `feedMsg` / `toast` / `checkLossLimit` calls the
> prototype made inline, and owns the 900 ms presentation delay before a settled
> position leaves the screen. M1.5 extended the adapter and `gateway.js` only to
> carry optional TP/SL parameters and rejection copy; all validation, cooldown,
> trigger and money decisions remain in `@crush/engine`.
>
> **Close Calls keep the same event seam.** An eligible settlement returns
> `settled → close-call → wallet-changed`. `core/close-calls.ts` consumes the
> self-contained fact, preserves arrival order and suppresses repeated ids.
> It never reads a render frame, clock or DOM value to decide qualification.
>
> `renderer.js` and `console.js` each carried a second inline copy of the P&L
> formula for their live readouts; both now call `Engine.pnl`, so a displayed
> figure cannot drift from the settled one (UI-2) when M1.4 adds `−θτ`.

> **Note on `round.js`'s phase guard — added at M1.5.** `setPhase` now accepts
> only the current phase's legal successor and returns whether it moved;
> `resetPhase` is the one sanctioned bypass, for boot and for tests that need to
> start mid-cycle. The split exists because **phase entry is not idempotent**:
> entering `settling` calls `Engine.forceSettleAtRoundEnd()`, so an illegal or
> repeated transition is a double settlement, not a cosmetic state error. Before
> the guard, RL-1 held only because `roundUpdate` was the sole caller and drove
> the graph in order — a property of the caller, not of the machine, and one new
> call site away from paying a position out twice.
>
> A new phase-entry side effect therefore goes inside `enterPhase`, and any new
> caller uses `setPhase`; reach for `resetPhase` only where there genuinely is no
> predecessor phase.
>
> **Note on the M1.5 tick slot.** `@crush/engine.onTick` advances τ once, checks
> crush, evaluates auto-orders, then settles a due ascent. TP/SL compare retained
> consecutive authoritative multipliers, max-win checks the current multiplier,
> and every trigger starts the ordinary 500 ms ascent. The client never evaluates
> a trigger or cooldown and therefore cannot become stricter than the authority.

### 5. `render/` — the renderer boundary (added at M1.8)

Every renderer implements one `RendererPort` (`render/port.ts`): `init`,
`resize`, `render`, `destroy`. **Nothing outside `render/` may know which
implementation is running** — the same rule the feed seam has, enforced the same
way, by a test that scans the client source tree
(`apps/client/test/renderer-selection.test.js`).

The Pixi scene is a **sink**. `render(model): void` has no return channel, so
there is no path by which it could inform a gameplay decision; SC-3 is a
property of the signature rather than a convention. It receives a `SceneModel`:
a plain, serialisable snapshot projected by `render/scene-model.ts` from
authoritative client state, and reads nothing else — not `S`, not the engine,
not `buffer`, not the DOM, not a clock. The unmodified Canvas reference is the
documented temporary compatibility exception while it remains the baseline.

**The projection is pure**, and that purity is load-bearing rather than
stylistic. `t` and `dt` are parameters because the caller owns the clock; there
is no RNG. `apps/client/test/renderer-authority.test.js` runs the real
`@crush/engine` over one tick series three times — zero frames per tick, one,
and nine — projecting between authoritative ticks, and asserts byte-identical
settlements and balances. That is SC-4: renderer timing cannot reach the money.

**Authority facts pass through; they are never recomputed.** `crushIndex` and
`livePnlCents` arrive from `Engine.liqIdx` and `Engine.pnl` and are copied
through untouched. CR-6 gives the crush line exactly one implementation, and a
second renderer must not become a second place it is derived. The geometry the
projection *does* compute — depth-of-index, index-to-y, time-to-x, the sub
anchor — lives in `scene-model.ts` so both renderers share one implementation
(SC-7), pinned to the Canvas formulas by `renderer-parity.test.js`.

**Layout is read once, by `render/boot.js`,** and handed down as data. Two
renderers measuring independently would be two sources of truth for one number,
and a renderer that reads the DOM cannot run headless in a test.

**Canvas remains the default**; `?renderer=pixi` is the explicit opt-in, exactly
as `?feed=replay` is for the feed. Retaining a renderer nobody runs is not a
diffing baseline — keeping the one that ships means the port is compared against
live behaviour.

Two asymmetries are deliberate and temporary, and both end when Canvas is
retired after visual-parity review:

- `render/canvas-port.js` wraps `renderer.js` **unmodified**, so the Canvas
  renderer still reads `S` / `Engine` / `buffer` directly and still owns its own
  `window` resize listener. The two renderers are not yet symmetric in how they
  *source* state.
- `FX` and `trail` remain Canvas-backed while Canvas is the reference, but
  `core/engine.js` and `core/round.js` receive them through
  `render/effects.js`. The facade keeps the concrete Canvas module inside
  `render/`, so no gameplay-adjacent module names an implementation. The
  documented import cycles are otherwise unchanged in shape.

See `docs/decisions/0009-renderer-port-and-scene-model.md`.

### `economy/` — intentionally absent

There is no client `economy/` folder. Integer-minor-unit primitives live in
`@crush/ledger`; wallet mutation, payout arithmetic and caps live in the pure
`@crush/engine`. `syncConsole` only renders those results, while `fmt$` /
`fmtClock` remain presentation helpers in `util/format.js`. A durable Phase 2
double-entry ledger is still future work, but it extends this package boundary
rather than extracting money math from the client.

---

## Module-level side-effect order

The original script ran its side effects top-to-bottom in a single scope. The
new tree reproduces that order via ES module evaluation (depth-first,
dependencies before dependents) plus the explicit import order in `main.js`.

Actual evaluation order:

```
 1. config/constants.js          12. render/renderer.js      23. core/engine.js
 2. util/math.js                 13. ui/dom-refs.js          24. core/bots.js
 3. state/store.js               14. ui/feed.js              25. ui/history.js
 4. util/random.js               15. ui/overlay.js           26. core/round.js
 5. feed/SimulatedIndexSource.js 16. core/entry-window.js    27. render/scene-model.ts
 6. feed/InterpBuffer.js         17. core/gateway.js         28. render/port.ts
 7. feed/index.js                18. ui/auto-orders.ts       29. render/pixi-scene.ts
 8. util/format.js               19. ui/console.js           30. render/canvas-port.js
 9. util/dom.js                  20. ui/sheets.js            31. render/index.js
10. audio/audio.js               21. ui/responsible.js       32. render/boot.js
11. render/palette.js            22. core/close-calls.ts     33. loop/frame.js
                                                             34. main.js
```

> **M1.4 note.** `core/entry-window.js` was inserted at step 16, ahead of
> `core/gateway.js` which imports it, shifting every later step by one. It
> carries **no module-level side effects** — it is a pure read of `S` and `CFG` —
> so it adds no row to the table below. It is its own module rather than part of
> `round.js` because both `gateway.js` and `ui/console.js` need the predicate,
> and importing `round.js` from `gateway.js` would close a
> `round → gateway → round` cycle for one function.

> **Close Calls note.** `core/close-calls.ts` evaluates at step 21 because both
> the engine adapter and fake actors import its shared projector. Constructing
> its in-memory id set performs no external side effect, so it adds no row to
> the table below; later evaluation steps shift by one.

> **M1.8 note.** The renderer seam evaluates at steps 26–31, between
> `core/round.js` and `loop/frame.js`. **Steps 1–25 are unchanged**, which is
> the property that matters: the port was added after the game modules had
> already evaluated, so nothing about feed, engine, round or UI initialisation
> moved. `render/index.js` (step 30) constructs the selected port at module
> scope — a new row in the table below — and `render/boot.js` (step 31)
> registers the resize listener that replaces `main.js`'s direct `resize()`
> call. `scene-model.ts`, `port.ts`, `pixi-scene.ts`, `canvas-port.js` and
> `effects.js` carry no module-level side effects.
>
> `render/renderer.js` still evaluates at step 12, ahead of all of these,
> through the side-effect-free `render/effects.js` compatibility facade used by
> `core/engine.js` and `core/round.js`. The facade keeps the Canvas-specific
> buffers inside `render/`; it does not change the inherited runtime cycle.

> **AUTO orders note.** `ui/auto-orders.ts` evaluates at step 18, immediately
> before `ui/console.js`, which imports it for the `autoEnabled()` gate and the
> leverage re-clamp. It registers its own listeners (the AUTO switch, the TP/SL
> steppers, and each field's input/blur handlers) and calls
> `setAutoEnabled(false)` at module scope to put the row into its off state, so
> it is a new row in the table below. Later steps shift by one.

The side effects that must fire in this relative order, and where they live:

| # | Side effect | Module | Eval step |
|---|---|---|---|
| 1 | `new SimulatedIndexSource()` starts the 125 ms feed timer | `feed/index.js` | 7 |
| 2 | `document.addEventListener('pointerdown', …)` audio unlock | `audio/audio.js` | 10 |
| 3 | `window.addEventListener('resize', resize)` | `render/renderer.js` | 12 |
| 3b | `createRenderer()` builds the selected `RendererPort` | `render/index.js` | 31 |
| 3c | `window.addEventListener('resize', …)` scene sizing | `render/boot.js` | 32 |
| 4 | DOM node caching (`$('#…')` lookups) | `ui/dom-refs.js` | 13 |
| 4b | AUTO switch + TP/SL stepper listeners, `setAutoEnabled(false)` | `ui/auto-orders.ts` | 18 |
| 5 | Console listeners (stake, presets, leverage, dir, cash-out) | `ui/console.js` | 19 |
| 6 | Sheet + scrim listeners | `ui/sheets.js` | 20 |
| 7 | Limits / reality-check / sound listeners, 1 s session `setInterval` | `ui/responsible.js` | 21 |
| 8 | `source.onTick(...)` tick wiring | `main.js` | 34 |
| 9 | Boot: `bootScene()`, `setStake()`, `resetPhase('waiting')`, `rAF(frame)` | `main.js` | 34 |

**Why the feed timer starting (step 7) before the tick subscription (step 34)
is safe:** `SimulatedIndexSource`'s constructor sets `this.live = false`, and
`_tick()` is gated on `if (this.live)`. The timer emits nothing until
`resetRound()` is called from `setPhase('running')` — roughly 9.4 s after boot
since M1.4 (8 s intermission + 1.4 s launching; it was 6.4 s at the prototype's
5 s intermission). No tick can be missed. The same gap existed in
the prototype (line 387 → line 510); it is merely wider in wall-clock terms now
and still entirely synchronous.

**If you add a new module with side effects,** add its import to `main.js` at
the position matching the order above, and update this table.

---

## Two deliberate deviations from "move code, do not rewrite it"

Both were approved before implementation. They are the only identifier-level
changes in the entire split.

1. **`setRSEED(v)` in `util/random.js`.** `RSEED` is declared in `util/random.js`
   but written by `setPhase` in `core/round.js`. ES module live bindings are
   read-only at the importer, so a cross-module write is impossible. The setter
   is the minimal fix: **one write site changed**
   (`core/round.js` — `RSEED = …` became `setRSEED(…)`), every read site
   (`hash1`) unchanged.

2. **`getLastSubDepth()` in `render/renderer.js`.** `lastSubDepth` remains
   Canvas-private for the retained reference renderer. The HUD now reads the
   `SceneModel` readout returned by `render/index.js`, so no module outside
   `render/` imports this accessor.

### Why `render/renderer.js` is one 460-line file

The renderer holds several `let` bindings (`W`, `H`, `DPRq`, `TIER`,
`lastSubY`, `lastSubDepth`, `lastV`, `prevCam`) that are written by one
function and read by others — `W` and `H` alone are read hundreds of times per
frame inside `draw()`. Splitting the renderer into `canvas` / `view` / `fx` /
`quality` / `draw` / `sprites` modules would have required either accessor
functions in the hot path (a rewrite plus a per-frame cost) or renaming ~60
identifiers to properties on a shared holder object.

Keeping the renderer whole means **zero identifiers changed inside the 300-line
`draw()` function**, which is where an accidental typo would be both most
likely and hardest to detect. This trades the 200–400 line file guideline for a
stronger behaviour-preservation guarantee.

This was also the lowest-cost choice long-term, and M1.8 bore that out. Rather
than splitting `renderer.js` internally, the PixiJS port went in **beside** it
behind `RendererPort`, and `renderer.js` itself was not modified at all — it is
wrapped by `render/canvas-port.js` and remains the verbatim visual reference the
port is diffed against. Its internal seams never needed to exist; the seam that
mattered was the one *around* it.

It keeps its own `window` resize listener, its own quality tiers and its own
direct reads of `S` / `Engine` / `buffer` for exactly that reason. Those go away
when Canvas is retired after visual-parity review, not before.

---

## Known import cycles

`engine ↔ renderer`, `engine ↔ ui/console`, `ui/sheets ↔ ui/responsible` and
related paths are cyclic. These are inherited from the prototype's coupling,
not introduced by the split.

They are safe because **every cyclic reference is dereferenced at call time,
never at module-evaluation time** — the imported bindings are only touched
inside function bodies and event-listener callbacks. This was verified
mechanically during the split.

M1.3 removed the arithmetic from that tangle but not the cycles themselves: the
adapter in `core/engine.js` still imports presentation effects, audio and UI in
order to render engine events. The effects arrive through `render/effects.js`,
so the adapter does not import a concrete renderer. The cycles otherwise remain
safe for the same reason.

**M1.8 keeps the Canvas-backed effect buffers deliberately**, but exposes them
to `core/engine.js` and `core/round.js` through `render/effects.js`. This
removes the concrete-renderer leak without changing how the presentation effects
behave or moving renderer work into the round machine or engine adapter.
Replacing the effect implementation remains the natural next step when Canvas
is retired.
