# 0007 — Deterministic Monte-Carlo calibration and evidence tiers

**Status:** accepted · **Date:** 2026-08-31 · **Milestone:** M1.7

## Context

M1.7 must choose the oxygen decay θ against a 96.5% RTP target using the real
engine, the simulator, and recorded BTC replay. The specification named four
player behaviors but did not define their distributions, sample accounting,
confidence estimator, or how deliberately selected replay stress intervals
should be combined with synthetic Monte Carlo.

PL-6 also conflated two evidence tiers: an implementable engineering milestone
and the pre-launch certification run requiring 10⁷ simulator positions plus at
least 90 days of real BTC. M1.6 intentionally committed only 130 seconds of
compact calm/flash-crash fixtures and explicitly says they are not a complete
market archive. Treating repeated actions on those bytes as 90 days of market
evidence would inflate precision without adding a single independent price
observation.

## Decisions

### 1. Engineering calibration and release validation are separate evidence tiers

M1.7 commits a compact `engineering-preliminary` report and the deterministic
runner that produced it. PL-6's 10⁷-position and 90-day release run remains a
mandatory pre-launch artifact. The release run supplies a larger sample and a
representative historical dataset to the same runner; it does not introduce a
second calibration algorithm.

This keeps the roadmap executable without mislabelling two stress fixtures as
certification evidence, and it leaves the stricter release gate intact.

### 2. Simulator selects θ; replay is a separately reported stress stratum

The selected candidate minimizes distance from 96.5% for an equal-weight mean
of the four simulator behavior RTPs. The calm and flash-crash replays are shown
per behavior and in aggregate, but never pooled into the point estimate. They
were selected precisely because they are calm and violent, so any numerical
weight assigned to them would be an undocumented market-regime forecast rather
than evidence.

When 90 or more days of representative data exist, a versioned production
player-mixture weighting and block-aware historical analysis complete PL-6.

### 3. Reference behavior distributions are frozen in MC-3

All four models share balanced directions, uniformly sampled legal entry ticks,
uniform sampling among the paths declared by each source dataset, and a $5
stake. Random-hold and max-leverage models use 5–20 second manual holds;
take-profit and stop-loss users wait for their configured order, crush, or round
end. The exact leverage and threshold distributions are acceptance criteria,
not implementation defaults hidden in source.

A short recorded fixture remains short: its entry window closes five seconds
before its last tick and RL-4 settles there. It is never repeated, padded, or
concatenated to manufacture a 90-second round. This preserves FI-10 and keeps
the report honest about how little independent replay time M1.6 contains.

The fixed stake makes primary RTP an unambiguous mean return and avoids silently
choosing a bankroll distribution. Cap frequency, maximum loss, and notional are
still reported. A later report based on observed stake/player weights is a new
version, not a rewrite of this reference result.

### 4. Random streams are trial-addressed, not consumed globally

Every source round and behavior trial derives its own stream from a master seed
and stable identifiers. Reordering candidates, behaviors, trials, or batches
therefore cannot change which random values belong to a trial. Candidate sweeps
reuse the same paths and actions (common random numbers), reducing comparison
noise without making candidates share mutable state.

The selected-candidate evidence uses the declared master-seed stream. Final
report cells derive a separate `/report` cohort from that seed, so the reported
20,000-position simulator check does not reuse the actions that chose θ.

### 5. Statistics and selection are explicit

RTP is aggregate paid cents divided by aggregate wagered cents. Each cell uses
50 deterministic contiguous batches and reports a two-sided 99% Student-t
interval, variance, standard error, outcome/cause counts, cap binds, extrema,
and peak notional. Candidate ties choose the lower, player-favorable θ.

These intervals quantify Monte-Carlo/action uncertainty conditional on the
declared source dataset. They do not convert 130 seconds of replay into a claim
about long-run BTC regimes; the report states that limitation directly.

### 6. M1.7 engineering result

The deterministic sweep evaluates 81 candidates from 0 through 0.40 %/s in
0.005 percentage-point increments. With seed
`crush-depth-m1.7-reference-v1`, 1,000 positions per behavior/candidate select
**θ = 0.03 %/s** at **96.5437 % RTP**, 0.0437 percentage points from target.
The disjoint 5,000-position-per-behavior simulator cohort reports 96.9492 % RTP
with a two-sided 99 % interval of 96.0046–97.8938 %. The target lies inside that
interval; the point-estimate difference is retained in the artifact rather than
hidden by reusing or searching the report cohort.

The equal-weight replay stress portfolio reports 110.3406 % on the two selected
M1.6 fixtures; the fixtures are equally likely under the declared uniform path
rule. This is evidence that those 130 seconds are not a population RTP sample,
not evidence for a player-favorable production RTP. PL-6 remains the gate for
representative historical weighting and release-scale precision.

## Consequences

- `@crush/sim` depends on `@crush/engine`, `@crush/feed`, and `@crush/ledger`;
  none of those packages imports the harness.
- Engine formulas, tick order, integer-money conversion, feed mapping, client
  source selection, and the 125 ms replay policy remain unchanged.
- Simulator RNG is explicitly injected for calibration. Replay contains no RNG.
- The committed report is reproducible review evidence, not a launch certificate.
- A production data/behavior change updates acceptance criteria, this decision
  (or a superseding ADR), and the report version before θ changes.
