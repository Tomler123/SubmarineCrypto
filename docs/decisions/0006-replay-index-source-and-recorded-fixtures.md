# 0006 — ReplayIndexSource and recorded BTC fixtures

**Status:** accepted · **Date:** 2026-08-31 · **Milestone:** M1.6

**Amended:** 2026-09-02 — replay presentation pacing and sparse-gap recovery (FI-16)

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

### 4. Playable fixtures and the presentation clock

The original 29.9 s calm control remains unchanged because its checksum is
part of the reviewed M1.7 calibration artifact. A new 99.9 s calm-playable
fixture extends the same official Binance interval and derivation, so it and
the 99.9 s flash-crash fixture each cover the fixed 90 s client round.

The simulator remains the default. Replay is selected only through the feed
seam with `?feed=replay`; `fixture=flash-crash` and `fixture=calm` select the
two playable files, while an omitted or unknown fixture falls back to
flash-crash.

Replay output retains original Unix epoch timestamps under FI-10/FI-13. The
client renderer uses page-relative `performance.now()` values, so the feed seam
maps only interpolation-buffer copies onto that clock. The first copy anchors
at page time and later copies advance at the configured 125 ms playback
interval. This is deliberately the delivery cadence rather than the selected
rows' original 100/200 ms timestamp deltas: the old mapping made an evenly
paced scheduler alternate visual velocity every few ticks.

If a sparse recorded interval leaves the renderer holding the latest value
beyond its 150 ms look-back, arrival of the next tick adds a presentation-only
copy of that held value at the current render horizon and places the new value
one playback interval later. The visible curve therefore resumes from what was
actually on screen instead of jumping retroactively through a gap that could
not have been rendered before the new tick arrived. Reset establishes a new
page anchor. Every index value is unchanged, and the original tick object with
its original timestamp continues to the engine and bots. Neither pacing nor
the hold copy has a path into entry, liquidation, auto-orders, settlement, or
money.

## Consequences

- `@crush/feed` now owns the shared TypeScript `IndexSourceBase`, published
  index transform, simulator, replay source, interpolation buffer, and fixture
  parser. The Phase 1 client keeps a thin simulator/config compatibility
  adapter and defaults to simulation.
- Replay errors for empty, malformed, invalid, or non-monotonic fixtures are
  deterministic and occur before any opening tick. EOF, halt, restart, and
  lifetime FI-8 counters are explicit.
- The client may opt into either full-round fixture only through the documented
  replay query parameters; no engine, renderer, UI, or gateway module names a
  concrete source or fixture.
- Two fresh engine runs over the flash fixture, with the same tick-indexed
  actions, produce byte-identical ticks, events, and settlement. The fixture's
  test action demonstrates material adverse exposure during the 500 ms ascent.

## Deliberately not done

M1.6 does not calibrate θ, add Monte Carlo behavior models, add Close Calls, or
port the renderer to PixiJS. Those remain M1.7 and later roadmap work.
