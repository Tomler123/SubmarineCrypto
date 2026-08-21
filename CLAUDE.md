# CLAUDE.md — Crush Depth

Project instructions for Claude Code. Read this fully before touching anything.

## What this project is

**Crush Depth** (working title) is a real-money casino crash game where the outcome is driven by the **real BTC price**, not an RNG. Players ride a shared submarine whose depth is a live index derived from BTC/USDT; they open leveraged long (Surface) or short (Dive) positions at any moment mid-round, and cash out through a deliberate 500 ms "ballast ascent" during which they can still be liquidated.

Authoritative documents (keep them in the repo root, keep them current):

- `crush-depth-game-logic-v0.1.md` — the full game logic spec: index math, oxygen edge, cash-out rules, risk caps, degenerate cases. **This spec wins any conflict with code.**
- `crush-depth-acceptance-criteria-v0.1.md` — testable acceptance criteria for casino/certification readiness. New features must add criteria here before merging.
- `crush-depth-phase1.html` — the Phase 1 single-file prototype (Canvas 2D). Reference implementation of the client architecture and visual direction.

## Current state

Phase 1 complete: single-file HTML prototype with simulated feed, full round loop, positions, cash-out ascent, liquidation, bot feed, responsible-play UI. Phase 1.5 (current work) folds the approved logic spec into the client and migrates to a real repo.

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
TICK 8 Hz · BUFFER 150 ms · ASCENT 500 ms
ROUND 90 s · INTERMISSION 8 s · ENTRY CUTOFF T−5 s
I₀ = 1000 · λ = 0.997 · σ_floor = 1.2 bp/tick · clamp ±3.5σ · v = 0.0042
LEVERAGE {2, 5, 10, 25} · stake×lev ≤ $2,000 · max win 50× and $10k
θ = 0.25 %/s (RTP target 96.5 %, calibrate by simulation)
M_t = 1 + L·d·(I_t/I_e − 1) − θ·τ ;  crush at first tick M_t ≤ 0
```

## Target repo structure (migrate toward this; don't half-migrate)

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

1. Repo scaffold per structure above (Vite + TypeScript strict).
2. Port engine math from the prototype into `/packages/engine` with unit tests against the acceptance criteria (AC ids in test names, e.g. `PL-3`).
3. Add oxygen: `−θτ` in the multiplier, O₂ bar draining on the cash-out button, crush line creeping in the scene.
4. Round 90 s, entry cutoff T−5 s, intermission 8 s.
5. Auto cash-out (take-profit) + stop-loss, set at entry, triggering the same 500 ms ascent.
6. Max-win auto-surface at 50×.
7. `ReplayIndexSource` that replays recorded real BTC 100 ms data files.
8. Monte-Carlo harness in `/packages/sim`: calibrate θ to RTP 96.5 % across behavior models; output a report artifact.
9. Close Calls events in the (still fake) social feed.
10. PixiJS scene port of the Canvas 2D renderer — last, after logic is tested.

## Working conventions

- TypeScript strict everywhere; no `any` in engine or ledger code.
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
