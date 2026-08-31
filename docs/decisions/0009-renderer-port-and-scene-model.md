# 0009 — The renderer port and the scene model

**Status:** accepted · **Date:** 2026-08-31 · **Milestone:** M1.8

## Context

The roadmap's M1.8 entry is three lines: "renderer behind one interface. 60 fps
on a mid-range phone in portrait. Canvas 2D version retained for visual
diffing." Neither specification document mentions a renderer, a scene, or
PixiJS at all — the acceptance criteria had 105 ids across 18 categories and not
one of them constrained the client's drawing layer.

That is a thin brief for replacing a 552-line renderer with roughly twenty
distinct visual subsystems, four inbound couplings (`S`, `Engine`, `Au`,
`buffer`) and two documented import cycles. Four things were genuinely
undetermined, and each changed the shape of the work: how much of the visual
scene M1.8 must reach, how the two renderers coexist while Canvas is retained,
whether PixiJS becomes a dependency now, and where the new code lives.

The prior art in this repo is unambiguous about the *kind* of answer wanted.
`feed/index.js` is the model: one seam, one contract, a default implementation,
an explicit query-string opt-in for the second, and a test that scans the source
tree to prove no other module names a concrete implementation.

## Decisions

### 1. A `SceneModel` is the only thing a renderer may read

`render/scene-model.ts` projects authoritative client state into a plain,
serialisable snapshot. A renderer receives that and nothing else — no `S`, no
`Engine`, no `buffer`, no DOM, no clock.

The projection is pure: `t` and `dt` are parameters because the caller owns the
clock, there is no RNG, and identical input yields a deeply equal model. That
purity is not decoration; it is what makes SC-4 assertable. `renderer-authority.test.js`
runs the **real** `@crush/engine` through one tick series three times — at zero
frames per tick, one, and nine — projecting the scene between authoritative
ticks where a real client would, and asserts byte-identical settlements and
balances. A projection that mutated a position or leaked a value forward would
fail it rather than be caught by review.

The interface has no return channel: `render(model): void`. "The scene cannot
decide a gameplay outcome" is therefore a property of the type signature, not a
convention someone has to remember.

### 2. Authority facts pass through; they are never recomputed

`crushIndex` and `livePnlCents` arrive already computed, from `Engine.liqIdx`
and `Engine.pnl`, and the projection copies them through untouched. This is
CR-6 applied to the new boundary: the crush line has exactly one implementation,
and a second renderer must not become a second place it is derived.

The one thing the projection *does* compute is geometry — depth-of-index,
index-to-y, time-to-x, the sub anchor. Those live in `scene-model.ts` so both
renderers consume one implementation (SC-7), and
`renderer-parity.test.js` pins them to the Canvas renderer's own formulas,
transcribed as the reference, with exact `toBe` equality across four viewports,
three cameras and three zoom levels.

### 3. Canvas stays the default; PixiJS is an explicit opt-in

`?renderer=pixi` selects the port, exactly as `?feed=replay` selects the replay
source, and an unrecognised value falls back to Canvas rather than failing — a
typo in a query string must not blank the scene.

Keeping Canvas as the default is the substantive half of "retained for visual
diffing". Retaining a renderer nobody runs is not a diffing baseline; retaining
the one that ships means the port is compared against live behaviour, and a
parity regression is visible rather than theoretical. The default flips when
visual parity has been reviewed by eye, which is a human judgement this
milestone does not claim to have made.

### 4. M1.8 ports the gameplay-critical layers, not all twenty

The port covers what a player reads a decision from: the depth-lit water
column, the wake that is the chart, the sub, the pod, and the entry/crush lines
UI-4 requires. Deliberately deferred: creatures, god rays, marine snow, sonar
sweep, murk, debris, shock rings, breach spray.

The deferred layers carry no information a player acts on. Porting them under
the same interface later touches `pixi-scene.ts` only — which is the point of
putting the interface in first. Stating the scope here means a reviewer can see
that the gap is a decision rather than an oversight.

### 5. Layout is read once, by the seam, and handed down as data

`render/boot.js` measures `#sceneWrap` and passes dimensions to the port;
`resize(width, height, dpr)` never measures. Two renderers measuring
independently would be two sources of truth for one number, and a renderer that
reads the DOM cannot run headless in a test.

## Consequences

- `pixi.js` 8.20.1 is a runtime dependency of `@crush/client`. It code-splits
  into its own chunks; the Canvas default path does not execute it.
- Renderer tests mock `pixi.js` at the module boundary, per the standing rule in
  `test/support/mocks.js`. Because that would hide an upstream API change,
  `pixi-api-contract.test.js` runs against the **real** library and asserts every
  call the port makes, with the argument shapes it makes them with.
- **The Canvas renderer is unmodified.** `render/canvas-port.js` wraps it as a
  conforming port. It therefore still reads `S`, `Engine` and `buffer` directly
  and still owns its own `window` resize listener, so the two renderers are not
  yet symmetric in how they *source* state. That asymmetry is deliberate and
  temporary; it ends when Canvas is retired.
- `FX` and `trail` are still imported from `render/renderer.js` by
  `core/engine.js` and `core/round.js`. Those are Canvas-specific effect
  buffers, and decoupling them is a change to gameplay-adjacent modules that
  M1.8 does not need and should not make. The documented import cycles are
  therefore unchanged in shape.
- No engine, ledger, feed, gateway or settlement code was touched. Package
  coverage gates and their thresholds are unchanged.
- `allowImportingTsExtensions` is enabled for `apps/client`. Client `.ts`
  modules already imported each other by real `.ts` path (`./close-calls.ts`),
  but only from `.js` callers, where `checkJs: false` hid it from tsc. A
  `.ts → .ts` import is checked, so the flag had to become explicit. `noEmit` is
  already on, so no unresolvable output path can result.

## What this does not establish

PF-1's "60 fps on a mid-range phone in portrait" is **not** demonstrated. It
needs a real device and a real WebGL context; the jsdom suite has neither, and
no headless browser is available in this environment. The exit criterion stands
open, and the Pixi path should be measured on device before the default flips.
