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
    index.js            the `source` and `buffer` singletons
  core/                 pure-ish game logic
    engine.js           adapter over @crush/engine: state mirror + event → effect
    gateway.js          request/ack seam for player actions
    entry-window.js     EN-1 T−5s cutoff predicate (pure read of S + CFG)
    round.js            round state machine
    bots.js             fake social layer
  audio/audio.js        Au synth + pointerdown unlock listener
  render/
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

## Target packages (created at M1.2, filled in later)

The workspaces exist with manifests, tsconfigs and project references so that
each milestone fills a package rather than inventing one. Placeholder barrels
carry a package-name constant and a comment naming the milestone that populates
them.

| Package | Populated by | Holds |
|---|---|---|
| `@crush/ledger` | **live now** | branded `Cents`, round-half-away-from-zero, arithmetic guards |
| `@crush/engine` | **live through M1.5** | pure position lifecycle, oxygen, crush, settlement, entry validation/cooldown, TP/SL/max-win triggers and payout caps |
| `@crush/feed` | M1.6 | `IndexSource` contract, simulated / replay / ws sources, `InterpBuffer` |
| `@crush/gateway` | M2.2 | request/ack seam, optimistic mirror |
| `@crush/sim` | M1.7 | Monte-Carlo RTP harness, behaviour models |

TypeScript project references declare the dependency graph, so `tsc --build`
typechecks in dependency order and `packages/engine` has no path by which it
could import from `apps/client`. `packages/engine/test/purity.test.ts` is the
durable guard on that rule: it fails on any `render/` `ui/` `audio/` import, any
`document`/`window` reference, any timer, any clock read (`Date.now`,
`performance.*`, `new Date`) and any `Math.random`. M1.3 removed the deferred
callback that used to sit inside `Engine.settle`, so the guard now passes on real
engine code rather than describing future work.

---

## Load-bearing boundaries for Phase 2

These four seams are the reason the split exists. Treat them as contracts.

### 1. `feed/` — the price-feed boundary (most important)

`SimulatedIndexSource` implements the `IndexSource` contract:
`onTick(fn) → {t, v, ret}`, `resetRound()`, `halt()`, `onAlarm(fn)`.

There is deliberately **no `start()`/`stop()`** (FEED-F5). A source self-starts
whatever machinery it needs in its constructor and stays dormant until
`resetRound()` opens a round; `halt()` closes one. `core/round.js` is the only
caller of either. The pair was named in one stale comment, never implemented and
never called; it was removed rather than added so that M1.6's second
implementation is not written against a surface nothing uses.

In Phase 2 a `WsIndexSource` implements the same contract and replaces it in
`feed/index.js`. **Nothing outside `feed/` may know which source is running.**
No other module imports `SimulatedIndexSource` directly — they import the
`source` singleton from `feed/index.js`.

**Every source extends `IndexSourceBase` (`feed/monotonic.js`)**, which owns the
subscriber list and the single emit path, `_publish`. That path is the FI-8
gate: a tick whose timestamp is non-finite or not strictly greater than the last
accepted one is dropped before any subscriber sees it, counted in
`rejectedTicks`, and reported through `onAlarm`. The gate lives at the seam
rather than in each implementation on purpose — the simulator is monotonic
only by accident of `performance.now()`, whereas `ReplayIndexSource` reads
timestamps out of a file and a `WsIndexSource` reads them off the wire. Because
`_publish` is the only way out, an implementation cannot opt out of the rule.

The executable definition of all of this is
`apps/client/test/support/index-source-contract.js`, which every source runs
through unchanged. Add an implementation, call `describeIndexSourceContract`,
and it inherits the whole contract.

### 2. `feed/InterpBuffer.js` — tick layer vs. 60 fps renderer

The interpolation buffer is deliberately **not** inside `render/`. Ticks are
authoritative for money; the interpolated 60 fps value is presentation only.
Keeping these in separate modules makes the rule structurally visible: the
renderer calls `buffer.valueAt(rt)` and cannot reach tick state any other way.

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
 1. config/constants.js          11. render/palette.js       21. core/engine.js
 2. util/math.js                 12. render/renderer.js      22. core/bots.js
 3. state/store.js               13. ui/dom-refs.js          23. ui/history.js
 4. util/random.js               14. ui/feed.js              24. core/round.js
 5. feed/SimulatedIndexSource.js 15. ui/overlay.js           25. loop/frame.js
 6. feed/InterpBuffer.js         16. core/entry-window.js    26. main.js
 7. feed/index.js                17. core/gateway.js
 8. util/format.js               18. ui/console.js
 9. util/dom.js                  19. ui/sheets.js
10. audio/audio.js               20. ui/responsible.js
```

> **M1.4 note.** `core/entry-window.js` was inserted at step 16, ahead of
> `core/gateway.js` which imports it, shifting every later step by one. It
> carries **no module-level side effects** — it is a pure read of `S` and `CFG` —
> so it adds no row to the table below. It is its own module rather than part of
> `round.js` because both `gateway.js` and `ui/console.js` need the predicate,
> and importing `round.js` from `gateway.js` would close a
> `round → gateway → round` cycle for one function.

The side effects that must fire in this relative order, and where they live:

| # | Side effect | Module | Eval step |
|---|---|---|---|
| 1 | `new SimulatedIndexSource()` starts the 125 ms feed timer | `feed/index.js` | 7 |
| 2 | `document.addEventListener('pointerdown', …)` audio unlock | `audio/audio.js` | 10 |
| 3 | `window.addEventListener('resize', resize)` | `render/renderer.js` | 12 |
| 4 | DOM node caching (`$('#…')` lookups) | `ui/dom-refs.js` | 13 |
| 5 | Console listeners (stake, presets, leverage, dir, cash-out) | `ui/console.js` | 18 |
| 6 | Sheet + scrim listeners | `ui/sheets.js` | 19 |
| 7 | Limits / reality-check / sound listeners, 1 s session `setInterval` | `ui/responsible.js` | 20 |
| 8 | `source.onTick(...)` tick wiring | `main.js` | 26 |
| 9 | Boot: `resize()`, `setStake()`, `resetPhase('waiting')`, `rAF(frame)` | `main.js` | 26 |

**Why the feed timer starting (step 7) before the tick subscription (step 26)
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

2. **`getLastSubDepth()` in `render/renderer.js`.** `lastSubDepth` is written by
   `draw()` and read once per frame by `frame()` for the HUD depth/zone
   readout. The accessor keeps the write site renderer-private. Read once per
   frame, not in a hot loop.

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

This is also the lowest-cost choice long-term: `render/` is slated for wholesale
replacement by a PixiJS v8 scene (Phase 1.5 task 10), so internal seams there
have the least durable value. The seams that matter for Phase 2 — `feed`,
`engine`, `gateway`, `round` — are split and stay split.

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
adapter in `core/engine.js` still imports the renderer, audio and UI in order to
*render* engine events. The cycles are therefore unchanged in shape and remain
safe for the same reason. They disappear when the client adopts a subscriber
list instead of direct calls — natural to do alongside the M1.8 Pixi port.
