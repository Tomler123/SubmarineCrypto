# Crush Depth

A real-money casino crash game driven by the **real BTC price**, not an RNG.
Players ride a shared submarine whose depth is a live index derived from
BTC/USDT, open leveraged long (Surface) or short (Dive) positions mid-round,
and cash out through a deliberate 500 ms "ballast ascent" during which they can
still be liquidated.

Working title. Phase 1.5 — see the authoritative documents below.

## Getting started

Requires Node 22+.

```bash
npm install
npm run dev        # Vite dev server → http://localhost:5173
```

| Script | What it does |
|---|---| 
| `npm run dev` | Vite dev server for the client |
| `npm test` | Vitest across `packages/*` |
| `npm run coverage` | Tests with the 80% coverage gate |
| `npm run typecheck` | `tsc --build` over every package, strict |
| `npm run build` | Typecheck, then the client production build |

All four run in CI on every push (`.github/workflows/ci.yml`).

## Layout

```
apps/client/        Phase 1 Canvas 2D client (still JS; PixiJS port is M1.8)
packages/
  engine/           pure game logic — no DOM, runs as the Phase 2 server (M1.3)
  feed/             IndexSource contract, simulated/replay/ws sources (M1.6)
  gateway/          request/ack seam (M2.2)
  ledger/           integer-cent money types + double-entry helpers
  sim/              Monte-Carlo RTP calibration harness (M1.7)
legacy/             untouched Phase 1 single-file prototype (diff reference)
docs/decisions/     decision log
```

## Documents

- `crush-depth-game-logic-v0.1.md` — the game logic spec. **Wins any conflict with code.**
- `crush-depth-acceptance-criteria-v0.1.md` — testable criteria; tests cite these ids.
- `CLAUDE.md` — project instructions and non-negotiable invariants.
- `ARCHITECTURE.md` — folder layout and the load-bearing Phase 2 seams.
