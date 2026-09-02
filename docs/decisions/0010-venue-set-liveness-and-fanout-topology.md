# 0010 — VENUE_SET_V1, feed liveness, and the fan-out topology

**Status:** accepted · **Date:** 2026-09-02 · **Milestone:** M2.1 / M2.2 / M2.4

## Context

Planning Rev. 9 raised two questions as blocking before Phase 2 transport work:
which exchange venues the composite index reads, and what concurrent-player load
PF-3's ≤ 25 ms p99 fan-out jitter is measured against.

The first question was **raised in error**. Game logic §1 already fixes the
price source: "the *median mid-price* of BTC/USDT across 5 exchanges (Binance,
Coinbase, OKX, Bybit, Kraken), sampled server-side every 125 ms", with the 0.5 %
exclusion filter and the 3-live-feed floor stated immediately after. The Rev. 9
analysis read the acceptance criteria — where FI-4 and FI-5 are deliberately
venue-agnostic — and did not carry §1 forward. The venue set was specified from
the start; what was genuinely missing was everything *around* it.

That gap is real and is what this ADR closes. §1 names five venues and a median.
It does not define what makes a venue **live**, what a "feed gap" is measured
against, whether a round may *start* on the bare minimum of three feeds, or what
commercial rights the operator must hold in the market data that determines a
real-money outcome. FI-5 says "any feed gap > 2 s" without saying gap in what —
wall clock, exchange timestamp, or server monotonic clock — and that distinction
decides whether a venue's heartbeat can mask a dead data stream.

The second question was genuinely open: PF-3 defers its load target to Phase 2
by design.

## Decisions

### 1. VENUE_SET_V1 is ratified as the five venues in game logic §1

`VENUE_SET_V1` = **Binance, Coinbase Exchange, OKX, Bybit, Kraken**, each read
only as its **BTC/USDT spot best-bid/ask midpoint**. No derivatives, no index
products, no aggregator feeds, and no cross-quoted pairs: a midpoint from a
venue's own spot book is the only accepted sample, because that is the market a
manipulation argument has to be made against.

The venue set is **versioned**. Any change — adding, removing or replacing a
venue, or changing the instrument read from one — is a new `VENUE_SET_Vn` under
VR-3's public constants version, not an operational edit. A settled round names
the venue-set version in force alongside its constants version, so VR-1's
verification payload stays self-describing months later.

### 2. Liveness is a five-part conjunction, and heartbeats do not satisfy it

A venue is **live** for a tick only when *all* of the following hold:

1. the spot instrument is online at the venue (not halted, delisted or in
   auction);
2. the market-data subscription is established and **acknowledged** by the
   venue;
3. the sequence number or checksum stream is **continuous and valid** — a gap or
   failed checksum invalidates the book until it is rebuilt;
4. the current BBO is **valid, positive and non-crossed** (bid > 0, ask > 0,
   bid ≤ ask);
5. a **real market-data update** has been received within **2,000 ms**, measured
   on the **server monotonic clock**.

**Ping/pong and other transport heartbeats do not refresh liveness.** This is the
load-bearing clause. A venue whose socket is healthy but whose book has stopped
updating is *not* live, and a heartbeat-based liveness check would report it as
live while the game settles real money against a frozen price. Condition 5
measures data, not connectivity.

The server monotonic clock is the reference for condition 5 because it is the
only clock in the system that cannot be moved by an upstream venue, an NTP step,
or a client. This is MF-5's rule applied to the feed: exchange-supplied
timestamps are recorded as data and never used to decide liveness.

### 3. Composite formation, and what SIGNAL LOST actually means

Per tick: take the midpoints of every live venue, compute their median, exclude
any venue deviating more than 0.5 % from that median (FI-4), and require **at
least three survivors after filtering**.

The ordering matters and is now explicit: the three-feed floor is a floor on
**post-filter survivors**, not on connected venues. Five live venues of which
three are excluded as outliers is *not* a valid tick.

- **One stale or excluded venue is simply excluded.** It is not an outage; the
  composite forms from the survivors and the round continues.
- **SIGNAL LOST is declared when a valid ≥ 3-venue composite tick cannot be
  formed**, and only then. It is a statement about the composite, not about any
  individual venue's health.

This wording removes an ambiguity in FI-5 as written, where "fewer than 3 live
exchange feeds, **or** any feed gap > 2 s" could be read as "any single venue
going quiet for 2 s aborts the round" — which would abort constantly and for no
good reason. The 2 s bound is a per-venue *liveness* test (condition 5 above);
the abort trigger is the composite failing.

### 4. Rounds start on four venues, and continue on three

A round may **start** only after **four venues have been continuously live for
ten seconds**. A round in flight continues while at least three survive.

The asymmetry is deliberate and is a risk decision rather than a technical one.
Starting at the bare minimum means the very first venue hiccup aborts the round
and voids every position in it — an abort is cheap for the house and expensive
for player trust, and a game that aborts visibly and often is a game players stop
believing in. Requiring one venue of headroom at the start, held for long enough
to prove it is not a momentary reconnect, buys a margin that costs nothing when
the feed is healthy. Once players have money at risk the calculus inverts: three
survivors is the specified safety floor, and holding to four mid-round would
abort rounds that are still perfectly determinable.

### 5. Written market-data rights are an M2.2 release blocker

Before M2.2 ships production transport, written agreements with every
`VENUE_SET_V1` venue must permit all four of:

1. **commercial outcome determination** — using the feed to settle real-money
   wagers;
2. **archival** — retaining raw per-venue samples for the LG-4 retention period
   (default ≥ 5 years);
3. **certification access** — a third-party test lab reading the archive under
   M3.2;
4. **publication of VR-1 verification data** — serving raw per-exchange samples
   and medians to players so they can recompute a settled round.

Point 4 is the one most likely to be refused, and it is not optional: VR-1 and
VR-2 are the product's entire trust story. A feed the operator may consume but
may not *publish* cannot support "provably market-driven", which is the claim the
design is built on.

If a venue cannot grant these rights, it is **replaced through a versioned spec
change** (`VENUE_SET_V2`) and the certification evidence is regenerated against
the new set. This is treated as a release blocker rather than a procurement task
because discovering it after M2.2 means an archive of data the operator cannot
lawfully publish, and a certification bundle that has to be rebuilt from ticks
that no longer exist.

### 6. PF-3's target: 10,000 concurrent players in one shared round

- **Sustained:** 10,000 concurrent players in a **single shared round**, all
  holding active positions, at 8 Hz, with **≤ 25 ms p99 internal fan-out
  jitter**, over a **one-hour soak**.
- **Burst:** a **20,000-connection, five-minute resilience burst**.

"In one shared round" is the demanding part and the correct framing: this game
has no sharding escape hatch. Every player in a round watches the same index and
is settled against the same tick, so the fan-out is genuinely 10,000 recipients
of one message every 125 ms, not 10,000 players spread across independent tables.

### 7. M2.4 is a single-writer round authority behind stateless gateways

The round authority — round state, tick application, settlement and ledger
writes — is a **deterministic single-writer** process. **Connection handling and
fan-out only** are horizontally scalable stateless WebSocket gateways.

Ledger and settlement authority stay single-writer. That is what makes M2.0's
order-independence property meaningful in production: a single writer applying
one tick to N player states in a declared order is reproducible from the archive,
and a settlement that can be re-derived is the difference between an auditable
game and an argument. Distributing settlement across writers would buy throughput
the game does not need and cost the determinism the certification depends on.

Splitting fan-out out is what makes the PF-3 number reachable without touching
that: 10,000 sockets is a connection-count problem, and connection-count problems
scale sideways. This is the same seam discipline the codebase already uses —
gateways are to the round authority what `RendererPort` is to the engine: they
carry state outward and cannot decide anything.

### 8. Legal work starts now, before M2.2 production transport

The gaming-versus-derivative classification opinion and the venue rights
negotiations both start **immediately**, not after Phase 2.

Both can invalidate the intended implementation, and they invalidate it in
different ways: the classification question can void the licensing route
entirely, and the rights question can void the specific venue set the index is
built on. Neither moves faster because the code is ready, and both have outputs
that Phase 2 milestones consume — M2.2 cannot responsibly archive data under
rights it does not hold.

## Consequences

- FI-4, FI-5 and PF-3 are amended, and new criteria `FI-17`…`FI-20` cover the
  venue set, liveness conjunction, round-start precondition and market-data
  rights. Game logic §1 and §8 are amended to match.
- M2.1's aggregator takes a venue-set version and a set of per-venue quote
  records carrying their own liveness facts; it remains pure, and it returns
  either a composite with both the raw and surviving sample sets or a typed
  `SignalLostReason`. Liveness is *evaluated* by the caller and *asserted* in the
  record, so the aggregator stays clock-free.
- M2.2 gains a release blocker that is not a code task, and it should be tracked
  from today rather than at the milestone.
- M2.4's topology is fixed before the milestone starts, which was the point of
  asking: the gateway/authority split changes the shape of the work, and
  discovering it during implementation would mean rewriting the transport layer.
- The Rev. 9 claim that "the spec names no venues" is retracted in Rev. 10 of the
  delivery plan and in this ADR. It was wrong.

## What this does not establish

The one-hour soak and the burst have **not been run**; they are targets, and
PF-3 stays open until measured on real infrastructure. Nothing here demonstrates
that 10,000 recipients at 8 Hz is achievable with the chosen stack — it sets the
number the architecture must hit and the topology chosen to hit it.

No venue agreement is in place. Decision 5 is a requirement, not a status.
