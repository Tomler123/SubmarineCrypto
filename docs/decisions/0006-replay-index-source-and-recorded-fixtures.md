# 0006 — ReplayIndexSource and recorded BTC fixtures

**Status:** accepted · **Date:** 2026-08-31 · **Milestone:** M1.6

## Context

The game authority consumes 125 ms ticks, while the roadmap called for compact
recorded BTC data at 100 ms. No earlier specification, ADR, or implementation
had fixed the conversion. A replay that silently interpolated or carried prices
would violate FI-5 and make settlement evidence impossible to audit.

## Decisions

### 1. Deterministic 100 ms → 125 ms selection

The replay grid is anchored at the first fixture timestamp. At each 125 ms
boundary, the source selects the latest original row whose timestamp is at or
before that boundary, emits that row at most once, and retains its original
timestamp and price. Rows skipped between boundaries never enter the index
transform. If no new row is eligible, the source emits nothing; it never
repeats, forward-fills, interpolates, or invents a row. Gap-free 100 ms data
therefore produces deterministic 100/200 ms timestamp gaps while averaging the
authoritative 8 Hz cadence.

The source's playback scheduler is injected and only advances boundaries. It
cannot provide timestamps or values, so changing playback speed cannot change
the replay output. `resetRound()` explicitly rewinds the finite fixture and the
monotonic high-water mark; this is the existing, named exception to the
per-source FI-8 lifetime gate and is tested separately from live-source
cross-round monotonicity.

### 2. Published transform initialization

The game-logic formula did not state the initial EWMA variance. M1.6 freezes
`sigmaSquared_0 = sigma_floor²` as part of the replay configuration. The first
selected row emits `I_0 = 1000, ret = 0`; subsequent rows apply raw log return,
EWMA variance, sigma floor, z clamp, index update, and index return in that exact
order. This is an explicit assumption made reproducible in FI-11, not a hidden
runtime default.

### 3. Primary fixtures

Fixtures are derived from Binance's official public BTCUSDT aggregate-trade
archive. The derivation floors event-time rows into UTC 100 ms buckets and keeps
the last source trade price per non-empty bucket. The archive and generated
fixture checksums, intervals, row counts, and all transformations are recorded
in `packages/feed/fixtures/README.md`; the 83.5 MiB source archive remains
ignored and is never shipped.

## Consequences

- `@crush/feed` now owns the shared TypeScript `IndexSourceBase`, published
  index transform, simulator, replay source, interpolation buffer, and fixture
  parser. The Phase 1 client keeps a thin simulator/config compatibility
  adapter and defaults to simulation.
- Replay errors for empty, malformed, invalid, or non-monotonic fixtures are
  deterministic and occur before any opening tick. EOF, halt, restart, and
  lifetime FI-8 counters are explicit.
- The client may opt into the flash fixture only through the feed seam with
  `?feed=replay`; no engine, renderer, UI, or gateway module names a concrete
  source.
- Two fresh engine runs over the flash fixture, with the same tick-indexed
  actions, produce byte-identical ticks, events, and settlement. The fixture's
  test action demonstrates material adverse exposure during the 500 ms ascent.

## Deliberately not done

M1.6 does not calibrate θ, add Monte Carlo behavior models, add Close Calls, or
port the renderer to PixiJS. Those remain M1.7 and later roadmap work.
