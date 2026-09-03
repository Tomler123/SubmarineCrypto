# CRUSH DEPTH — Acceptance Criteria v0.1 (Casino-Grade)

Companion to `crush-depth-game-logic-v0.1.md`. Every criterion is testable and carries an id; engine unit tests, integration tests, and certification checklists reference these ids. Written with GLI-19-style interactive gaming expectations in mind (event logging, game recall, incomplete-game handling, player protection) — final certification scope depends on the chosen jurisdiction and test lab.

Conventions: "tick" = one 125 ms server sample. "MUST" = release blocker. All money assertions are in integer minor units.

---

## FI — Feed & Index

- **FI-1** The index MUST be computed only by the published transform (λ=0.997, σ_floor=1.2 bp, clamp ±3.5σ, v=0.0042, I₀=1000). Recomputing any settled round from its raw price series reproduces every `I_t` exactly (same float ops order, or fixed-point — pick one and freeze it).
- **FI-2** For every tick, sign(ΔI) = sign(ΔP_median). No configuration may break this.
- **FI-3** A single tick MUST never move the index more than ±(3.5 × v) = ±1.47 %.
- **FI-4** An exchange feed deviating > 0.5 % from the median for a tick is excluded from that tick's median. The order is fixed: take every **live** venue's midpoint (FI-18), compute the median, exclude every venue deviating more than 0.5 % from it, then re-derive the composite from the survivors. Both the full sample set and the surviving set are retained for VR-1.
- **FI-5** SIGNAL LOST is declared when a valid composite tick of at least **3 post-filter surviving venues** cannot be formed; the round MUST then abort per MF-1. The 3-venue floor is a floor on survivors after FI-4's exclusion, not on connected venues: five live venues of which three are excluded as outliers is not a valid tick. A single stale or excluded venue is **excluded, not an outage** — the composite forms from the survivors and the round continues. The 2 s bound is a per-venue liveness test (FI-18), not by itself an abort trigger. No tick may ever be extrapolated, interpolated, or invented server-side.
- **FI-6** The effective amplification v/max(σ,σ_floor) MUST never exceed 35×.
- **FI-7** No component of index computation reads any RNG. Static analysis / code review checklist item.
- **FI-8** Tick timestamps are server-clock, monotonic; a tick with a non-increasing timestamp is rejected and alarmed.
- **FI-9** `ReplayIndexSource` accepts a non-empty recorded-price fixture only
  when every row has exactly one finite timestamp and one finite, strictly
  positive BTC price, and the row timestamps are strictly increasing. Empty,
  malformed, or non-monotonic fixtures fail before the opening tick with a
  deterministic error code and row index; no valid prefix is emitted.
- **FI-10** M1.6's recorded 100 ms fixtures map to the authoritative 125 ms
  game cadence without interpolation. Anchor a 125 ms grid at the fixture's
  first timestamp. At each grid boundary select the latest original row whose
  timestamp is at or before that boundary, emit that original row at most once,
  and skip all other rows. The selected row keeps its original timestamp and
  price. Consequently the selected timestamp gaps are deterministically 100 ms
  or 200 ms for a gap-free 100 ms fixture while the sequence averages 8 Hz;
  neither a 125 ms timestamp nor a price between recorded observations is
  invented. A fixture gap emits no repeated or carried-forward row: the next
  recorded row becomes eligible only at the first grid boundary at or after its
  own timestamp.
- **FI-11** Replay applies FI-1 only to the selected authoritative price rows,
  in their emitted order. The opening row emits `I_0 = 1000` and `ret = 0`;
  the transform starts with `sigmaSquared = sigma_floor^2`, and every later row
  updates raw log return, EWMA variance, clamped z-score, index, then index
  return in exactly that order. Skipped 100 ms rows never enter the transform.
  This initial variance and operation order are part of the versioned replay
  contract and golden-vector tests.
- **FI-12** Replay lifecycle is explicit and deterministic. Construction is
  dormant. `resetRound()` rewinds the fixture, grid, transform, EOF state and
  monotonic high-water mark, then synchronously emits the same opening tick.
  `halt()` prevents further emission. A later `resetRound()` restarts from the
  beginning. EOF makes the source dormant; additional playback advances are
  no-ops until reset. Repeated runs do not retain transform or cursor state,
  while FI-8 rejection counters remain lifetime audit data.
- **FI-13** Replay output is a pure function of fixture bytes and explicit
  replay/index configuration. Tick values, timestamps, ordering, EOF and alarm
  behavior MUST NOT depend on playback speed, scheduler time, `Date.now()`,
  `performance.now()`, timers, RNG, DOM state, or interpolation frames. Any
  paced adapter uses an injected scheduler; the deterministic replay core is
  runnable by explicit synchronous advancement in tests.
- **FI-14** Fixture provenance is committed beside every recorded fixture:
  primary source, venue and symbol, UTC interval, original sampling granularity,
  every transformation and selection step, row count, and SHA-256 checksum of
  the committed bytes. At least one fixture covers a documented real flash
  crash or similarly violent interval. No row described as real market data may
  be hand-authored.
- **FI-15** Feeding the same replay fixture into two fresh engine states with
  the same engine configuration and identical tick-indexed action script
  produces byte-identical accepted ticks, engine events and settlement artifact.
  The violent fixture MUST exercise a meaningful adverse path such as crush
  precedence or exposure during the 500 ms ascent. Changing scheduler pacing
  MUST NOT change the artifact.
- **FI-16** Client replay is opt-in and presentation-clock adaptation is
  explicit. With no `feed` query the simulator remains selected. Under
  `?feed=replay`, `fixture=flash-crash` and `fixture=calm` resolve to the
  documented playable fixtures; an omitted or unknown fixture uses
  `flash-crash`. Every selectable playable fixture spans at least 90,000 ms
  from first to last recorded row. The first replay tick anchors a
  presentation-only copy to the current page clock. Later copies advance on
  the configured 125 ms playback cadence, independent of the selected rows'
  irregular 100/200 ms recorded timestamp gaps. If a sparse fixture leaves the
  renderer beyond its 150 ms interpolation horizon, the adapter inserts a
  presentation-only hold sample at that horizon and eases to the newly arrived
  value over one playback interval; it MUST NOT retroactively jump through the
  unseen gap. Reset re-anchors. Source subscribers, engine, entry, liquidation,
  auto-orders and settlement retain the unchanged original timestamp and index
  value; a hold sample never leaves the interpolation buffer. Scheduler jitter,
  frame cadence, interpolation reads and the epoch-to-page offset cannot alter
  any engine event, balance or settlement artifact. Test both clock domains,
  irregular selected-row gaps, sparse-gap recovery, both fixture selections,
  the default selection and an identical settlement with zero vs. many
  presentation reads.
- **FI-17** The composite index reads exactly `VENUE_SET_V1` — **Binance,
  Coinbase Exchange, OKX, Bybit, Kraken** — and from each, only its **BTC/USDT
  spot best-bid/ask midpoint**. Derivatives, index products, aggregator feeds and
  cross-quoted pairs MUST NOT be accepted as a sample. The venue set is versioned
  under VR-3: adding, removing or replacing a venue, or changing the instrument
  read from one, is a new `VENUE_SET_Vn`, never an operational edit. Every
  settled round records the venue-set version in force alongside its constants
  version, and VR-1's payload carries it.
- **FI-18** A venue is **live** for a tick only when all five hold: (1) the spot
  instrument is online at the venue — not halted, delisted or in auction; (2) the
  market-data subscription is established and acknowledged; (3) the sequence or
  checksum stream is continuous and valid, a gap or failed checksum invalidating
  the book until rebuilt; (4) the BBO is valid, positive and non-crossed
  (bid > 0, ask > 0, bid ≤ ask); (5) a **real market-data update** was received
  within **2,000 ms** on the **server monotonic clock**. **Transport heartbeats
  (ping/pong) MUST NOT refresh liveness** — a venue whose socket is healthy while
  its book is frozen is not live, and settling money against a frozen price is
  the exact failure this criterion exists to prevent. Exchange-supplied
  timestamps are recorded as data and MUST NOT decide liveness (MF-5). Test each
  of the five conditions failing alone, and assert a heartbeat-only stream goes
  not-live at 2,000 ms.
- **FI-19** A round MUST NOT start until **four venues have been continuously
  live for 10,000 ms**; a round already running continues while at least three
  survive FI-4. The asymmetry is intentional: starting at the bare minimum makes
  the first hiccup abort the round and void every position in it, so round start
  requires one venue of headroom held long enough to prove it is not a momentary
  reconnect, while a round with money at risk holds to the specified 3-survivor
  floor. Test: three live venues never start a round; four live for 9,999 ms
  never start a round; four live for 10,000 ms do; and a running round survives
  the drop to three and aborts only on the drop to two.
- **FI-20** Before M2.2 ships production transport, **written market-data rights
  covering every `VENUE_SET_V1` venue MUST be in force**, held **either** directly
  from each venue **or** through an **authorised commercial data vendor**. Where a
  vendor is used, the **chain of rights MUST be documented end to end** — from the
  venue, through every intermediary, to the party exercising each right. An
  undocumented chain is treated as no rights at all, because that is how a
  regulator or test lab will treat it.
  The rights MUST cover: **commercial outcome determination**; **archival** for
  the LG-4 retention period; **third-party certification/lab access** to that
  archive (M3.2); and **publication of the VR-1 verification data**.
  Because this is a B2B provider model (ADR 0011), the criterion MUST identify
  **which party needs which right**: the **provider** requires outcome
  determination, archival, lab access, and publication **with the right to
  sublicense**; each **operator** requires outcome determination for its licensed
  offering and publication to its own players. **The sublicensing right is the
  clause most likely to be missed and the one that silently blocks the business
  model**: a provider integrated into ten operators must be able to extend
  publication rights to all ten and their players, and a licence permitting the
  provider to publish but not to sublicense looks adequate on paper while making
  the model unshippable. Sublicensing MUST be explicit in the agreement, never
  inferred. A venue or vendor that cannot grant the full set is replaced by a
  versioned spec change (`VENUE_SET_Vn`) with certification evidence regenerated.
  This is a **release blocker**, tracked from the start of Phase 2: discovering it
  after M2.2 leaves an archive that cannot lawfully be published and a
  certification bundle rebuilt from ticks that no longer exist.

- **FI-21** Synthetic client QA replays are explicit, deterministic and never
  represented as recorded market evidence. Under `?feed=replay`,
  `fixture=upper-limit`, `fixture=lower-limit`, and `fixture=constant` resolve
  to generated 125 ms fixtures spanning at least 100,000 ms. The upper fixture
  crosses the renderer's `DEPTH_MIN` numeric clamp and then retreats; the lower
  fixture crosses `DEPTH_MAX` and then recovers for at least four seconds; the
  constant fixture emits `I = 1000` and `ret = 0` throughout. All remain dormant
  during `waiting` and `launching` and begin with `resetRound()` at the start of
  the 90 s `running` phase. They MUST NOT change the simulator default, the
  flash-crash fallback, FI-14 provenance, or any calibration input. Test URL
  selection, full-round span and each transformed trajectory.

## RL — Round Lifecycle

- **RL-1** State machine is exactly `waiting → launching → running → ending → settling → waiting`; no other transitions exist. Every transition is logged with server timestamp and round id. "No other transitions exist" is a property of the **phase setter**, not of its callers: the setter itself MUST reject any transition outside the graph, including a phase to itself. Phase entry carries side effects that are not idempotent — entering `settling` settles every open position (RL-4) — so an illegal or repeated transition is a double settlement, not a cosmetic state error. A machine that is correct only because one caller happens to drive it in order is one call site away from paying a position out twice. Test: from every phase, assert every non-successor target (self included) leaves the phase unchanged and fires no side effect.
- **RL-2** Round length is 90.0 s of `running` ± 1 tick; intermission 8 s.
- **RL-3** At `running` start, I is reset to 1000 and the first tick is emitted immediately.
- **RL-4** At round end, every still-open position auto-surfaces at the final tick at its current multiplier, with no penalty and no fee.
- **RL-5** A round id is globally unique and appears on every tick, bet, settlement, and log line of that round.

## RS — Round State & Multi-Player Fan-Out (M2.0)

> The per-player engine entry points (`open`, `onTick`, `requestAscent`,
> `settleAtRoundEnd`, `clearSettled`, `setLossLocked`) are unchanged by this
> group and keep every criterion already pinned to them. RS constrains only the
> **fan-out around** them: how one authoritative tick reaches N players, in what
> order the resulting facts are emitted, and what a round-level caller — the
> M2.4 round authority — may rely on.

- **RS-1** A `RoundState` holds a round id, the current phase, the authoritative
  tick series applied so far, and a map of **opaque operator-scoped player
  reference** to that player's existing `EngineState`. It holds no clock, no
  timer, no socket and no RNG; the purity guard that covers `@crush/engine`
  covers it unchanged. A player's state inside a round is the *same*
  `EngineState` the single-player entry points produce, not a variant of it —
  so a per-player fact carries into a round with no translation layer.
- **RS-2 (fan-out determinism)** Applying one authoritative tick to a round
  produces per-player settlements, events and wallets that are **independent of
  iteration order**. For any two permutations of the same player set, the
  resulting `RoundState` is deeply equal and the emitted round event sequence is
  identical. A round authority that pays differently depending on `Map`
  insertion order is not auditable. Test: apply an identical tick series to the
  same population under shuffled insertion orders and assert deep equality of
  the final state and of the full event log.
- **RS-3 (player isolation)** One player's outcome cannot influence another's.
  Crush, auto-order triggers, settlement, wallet movement and Close Call facts
  for player A are a function of **A's own state and the shared tick only**.
  Test by interleaving: run A alone through a tick series and action script, then
  run the identical A among at least 500 other players opening, ascending,
  crushing and settling on the same ticks, and assert A's events, position,
  settlement and wallet are identical in both runs. Neither a crush nor a
  max-win nor a rejection anywhere in the population may perturb A.
- **RS-4 (canonical event ordering)** Round-level events are a deterministic
  concatenation of per-player events under one declared stable order: **ascending
  by player reference (code-unit order), then each player's existing per-player
  event order**, which RS-3 leaves unchanged. The archive (VR-1) and the ledger
  (LG-3) therefore have exactly one canonical sequence to write for a tick.
  Every round event carries the player reference it belongs to and the round id
  (RL-5) so the sequence is self-describing. Test: the round event log for a tick
  equals the per-player logs concatenated in that declared order, under any
  insertion order.
- **RS-5 (round-scoped entry)** An entry request is addressed to one player and
  is evaluated by the existing per-player path with its EN-8 precedence
  unchanged. A request naming a player the round does not hold is rejected with
  `UNKNOWN_PLAYER` and changes nothing — it is not an implicit player creation,
  because a round authority creating wallets from arriving requests is how a
  balance appears from nowhere. EN-5's one-open-position rule stays per player,
  never per round.
- **RS-6 (phase authority)** RL-1's graph is enforced by the round state's own
  phase setter, not by its callers, exactly as `setPhase` enforces it in the
  client: only the single legal successor is accepted, self-transitions
  included, and entering `settling` settles **every** still-open position in the
  round exactly once via RL-4's existing per-player path. A repeated or illegal
  transition is a double settlement across the whole population, so it MUST be
  refused rather than tolerated. One sanctioned seed bypass exists for boot and
  tests and is a distinct, named entry point.
- **RS-7 (per-round directional aggregate)** The round exposes, at every tick,
  the **open notional per direction** — the sum of `stake × leverage` over open
  and ascending positions, separately for Surface and Dive — plus the signed net.
  It is derived from round state alone, is integer minor units end to end (LG-2),
  and is the aggregate RK-1's directional cap and M2.6's kill switch act on.
  Exposed at M2.0 as a computed fact only: RS does **not** enforce a cap, because
  the cap is a risk-engine policy and its rejection code belongs with RK-1.
- **RS-8 (population invariance of money)** For an identical tick series and
  action script for player A, A's payout and P&L are **byte-identical**
  regardless of how many other players are in the round — one, or ten thousand.
  Population size is not an input to any money path. This is RS-3 stated as the
  money property a lab will test directly, and it is what makes a single-player
  golden vector still valid evidence under real load.

## EN — Entry (Buy-In)

- **EN-1** Entries are accepted from `running` start until T−5 s; a request received after cutoff is rejected with `ENTRY_CLOSED` and full non-debit (stake never leaves the wallet). "Received" means received by the authority, not sent by the client: the window is evaluated after the network leg, so a tap that races the cutoff is late wherever it is judged. A bet armed during intermission is not an entry — it executes at launch, inside the window.
- **EN-2** An accepted entry executes at the **first tick after server receipt**; `I_e` = that tick's value. Test: a request received between ticks n and n+1 always gets `I_e = I_{n+1}`, never `I_n`.
- **EN-3** Stake is debited atomically with position creation; if position creation fails, the debit MUST not persist (single transaction). Under the seamless wallet (ADR 0011) atomicity is preserved **by ordering**: request the operator debit, and create the position **only on a confirmed debit**. An unconfirmed or failed debit MUST NOT produce a position, and a confirmed debit whose position creation then fails MUST be rolled back (`WL-4`). The forbidden states are a position the player did not pay for and a debit with no position; test both by injecting failure at each step, including a debit that succeeds with a lost response.
- **EN-4** Direction ∈ {Surface, Dive}; leverage ∈ {2, 5, 10, 25}; stake is a finite integer number of minor units and ≥ $0.50; stake × leverage ≤ $2,000. Out-of-range requests are rejected before any debit. Validation is deterministic and reports the first failing code in this order: `INVALID_DIRECTION` → `INVALID_LEVERAGE` → `INVALID_STAKE` → `NOTIONAL_LIMIT_EXCEEDED` → `INVALID_TAKE_PROFIT` → `INVALID_STOP_LOSS`. The auto-order codes are in the same validation stage because TP/SL are immutable entry parameters under AO-1. Test every code both alone and with every lower-ranked validation defect present; every rejection leaves wallet and position unchanged.
- **EN-5** One open position per player per round; a second open request while one is open is rejected. Re-entry after settlement in the same round is allowed within the entry window.
- **EN-6** If the round aborts or ends before an accepted entry executes, the stake is fully refunded and the position never existed in the ledger. The refund is a WL refund keyed to the original debit (`WL-3`), and the provider ledger records the compensating entries (LG-3).
- **EN-7** Every entry request carries a client-generated idempotency id; replaying the same id never creates a second position or a second debit. Enforced in the engine, not merely documented: a request whose id matches the position the engine already holds is a **no-op that returns the existing position** — same state, same `position-opened` event — rather than a rejection, because the replay is the *same* request and its original outcome was success. Ranked above every EN-8 rejection for that reason: a retry after a dropped ack must not be told `POSITION_OPEN` about its own position. The window is the position's lifetime in engine state (through `done`, until `clearSettled`); beyond that the id has left the engine and EN-5/LG-3 govern. Test: replay an accepted request verbatim and assert one position, one debit, and an unchanged wallet on the replay.
- **EN-8** Entry handling has three fixed stages. **Stage 0: idempotency.** An accepted `OpenRequest.id` replay returns its original position before any validation or eligibility check (EN-7). **Stage 1: request validation**, in EN-4's order: `INVALID_DIRECTION` → `INVALID_LEVERAGE` → `INVALID_STAKE` → `NOTIONAL_LIMIT_EXCEEDED` → `INVALID_TAKE_PROFIT` → `INVALID_STOP_LOSS`. **Stage 2: eligibility**, in this order: `LOSS_LIMIT_REACHED` → `ENTRY_CLOSED` → `POSITION_OPEN` → `COOLING_OFF` → `INSUFFICIENT_BALANCE` → `NO_PRICE`. Validation precedes eligibility because malformed parameters must never reach a wallet or position path; within eligibility, a condition the player cannot clear is never masked by one that clears on its own. A loss-locked player (RP-2) with an otherwise valid request MUST NOT be told "insufficient balance", which implies that depositing more would let them continue. Test each rank with every lower-ranked condition simultaneously true. Every rejection leaves wallet, position and last result untouched.
- **EN-9** A request arriving with no valid entry price is rejected as `NO_PRICE`, distinct from MF-1 SIGNAL LOST: it rejects one request, settles nothing, aborts no round, and is not alarmed as an outage. Player-facing copy MUST NOT present it as a feed failure. `NO_PRICE` rate is a counted metric (BO-2) because a rising rate indicates an entry-window or round-start defect.
- **EN-10** Re-entry after any settlement reason has an authority-configured cooldown (`reentryCooldownMs`, 900 ms in Phase 1.5). It is measured only between authoritative tick timestamps: candidate entry tick `t_e` is rejected with `COOLING_OFF` while `t_e < settlementTick.t + reentryCooldownMs`, and is eligible at equality. A wall clock, animation timer or interpolated frame value MUST NOT decide it. The rejection is a full non-debit. EN-7 replay remains above cooldown: retrying the accepted request that created the settled position returns that position rather than `COOLING_OFF`.

## PL — Multiplier, P&L, Oxygen

- **PL-1** `M_t = 1 + L·d·(I_t/I_e − 1) − θ·τ`, τ measured from the entry-execution tick in seconds (tick-count × 0.125). Golden-vector test set MUST cover both directions × all leverages.
  - **τ is a tick count, never a clock reading.** The entry-execution tick is tick 0, so `M = 1` there exactly. τ advances once per authoritative tick, before that tick is evaluated against anything, so the crush line, any auto-order trigger and the settlement multiplier on a given tick all see the same τ (CR-6).
  - A jitter gap that §8 treats as one tick costs **one tick** of oxygen, not the wall-clock interval — otherwise a network hiccup charges the player for time the game did not deliver. This is also what makes a replayed round (M1.6) reproduce its oxygen exactly however fast the file is read.
- **PL-2** The M1.7 engineering-calibrated θ is 0.03 %/s from remote config,
  selected by MC-4/MC-5 and explicitly preliminary until PL-6's release-scale
  validation. A config change takes effect only at the next round boundary,
  never mid-round, and is logged. Enforced in two layers rather than by
  convention: the round machine re-reads config only at a round boundary, and
  **each position snapshots the θ in force at its entry tick** and settles under
  that value. A caller that violated the first rule still cannot change the edge
  on a position that is already open. The snapshotted value is the θ that LG-4
  retains.
- **PL-3** Oxygen accrues during ascent exactly as while open.
- **PL-4** Settlement payout = stake × max(0, M) rounded half-away-from-zero to integer cents, computed once, then **clamped to the max-win bound** `min(50 × stake, $10,000)` (AO-5, parameter sheet §12). Property test: for all inputs, 0 ≤ payout ≤ min(50 × stake, $10,000 cap). Both bounds are engine-side and unconditional: the clamp applies to **every** settlement reason, not only to a max-win auto-surface, because a gap tick can carry `M` past 50 between two ticks and a round-end settlement (RL-4) has no trigger to route through. Clamp after the single rounding, never before — rounding a pre-clamped float would be a second conversion and violate the computed-once rule. The bound is a function of the **stake**, so it is per position and needs no state; the aggregate exposure caps are RK-1/RK-3.
- **PL-5** Maximum loss of any position is exactly the stake. No mechanism (gap ticks, clock skew, config change) may produce a negative balance from a position.
- **PL-6** Release-scale RTP validation over the reference behavior-model suite
  MUST report 96.5 % ± 0.5 % for the declared production player-mixture
  weighting, using at least 10⁷ positions from the simulator and a separately
  reported replay analysis spanning ≥ 90 days of recorded real BTC data. The
  historical analysis MUST preserve day/block provenance and MUST NOT multiply
  its apparent sample size by replaying the same short interval. The
  release-scale calibration report is a versioned release artifact. M1.7's
  committed engineering report is explicitly preliminary until this data-volume
  gate is run; MC-8 prevents it from being presented as certification evidence.

## MC — Monte-Carlo Calibration (M1.7)

- **MC-1** `@crush/sim` MUST run the real `@crush/engine` settlement lifecycle
  against authoritative ticks produced through both the existing
  `SimulatedIndexSource` and `ReplayIndexSource`. It MUST NOT copy or simplify
  multiplier, crush, ascent, auto-order, rounding, payout-cap, or settlement
  formulas. Simulator remains the normal client source; calibration source
  selection exists only inside `@crush/sim` and the feed seam.
- **MC-2** Every stochastic input MUST come from an explicitly supplied master
  seed. Source paths and player trials derive independent streams from the
  stable tuple `(master seed, source dataset, behavior id, trial index)`; no
  shared mutable RNG stream may make a result depend on iteration, batching,
  worker, or candidate order. The report records the seed and derivation
  version. Candidate selection and final report cells MUST use distinct,
  deterministically derived stream cohorts so report evidence does not reuse
  the player actions that selected θ.
- **MC-3** The committed engineering reference suite fixes these behavior-model
  assumptions before implementation:
  - common inputs: one $5.00 position per trial, Surface/Dive with equal
    probability, source path uniformly selected from the declared source
    dataset, and entry uniformly selected from authoritative ticks inside the
    85-second entry window;
  - `random-hold`: leverage uniformly selected from `{2, 5, 10, 25}` and a
    manual cash-out requested after a uniform 5–20 second hold;
  - `take-profit`: leverage uniformly selected from `{2, 5, 10, 25}`, TP set to
    `1 + L·0.0147 + U[0.10, 0.90]`, and no manual exit before TP, crush, or
    round end;
  - `stop-loss`: leverage uniformly selected from `{2, 5, 10, 25}`, SL uniformly
    selected from `[0.25, 0.90]`, and no manual exit before SL, crush, or round
    end;
  - `max-leverage`: fixed 25× leverage, no auto orders, and a manual cash-out
    requested after a uniform 5–20 second hold.
  Continuous draws use half-open intervals before conversion to an
  authoritative tick index. A recorded path shorter than 90 seconds uses only
  its available authoritative ticks, closes entry five seconds before its last
  tick, and applies ordinary RL-4 settlement at that last tick; it is never
  looped, padded, or joined to another fixture. These are transparent reference
  assumptions, not claims about observed production players; observed weights
  replace them only through a new versioned calibration report and ADR.
- **MC-4** Engineering RTP is `sum(payout cents) / sum(stake cents)`. The
  selected θ minimizes absolute error from 96.5 % for the equal-weight mean of
  the four simulator behavior RTPs. Candidate evaluation uses common random
  numbers. Replay results are never pooled into that point estimate because the
  committed calm and flash-crash fixtures are deliberately selected stress
  intervals, not a representative market sample. The report MUST show every
  behavior/source cell so this separation is reviewable.
- **MC-5** Candidate selection is deterministic: evaluate the declared ordered
  candidate list, choose the smallest absolute target error, and break an exact
  tie in favor of the lower θ. The report records every candidate RTP and the
  selected candidate. Changing candidates, mixture weights, target, tie-break,
  behavior parameters, or dataset is a versioned calibration change.
- **MC-6** Every reported behavior/source cell MUST include position count,
  wagered and paid cents, RTP, return-ratio sample variance, standard error, and
  a two-sided 99 % Student-t confidence interval computed from 50 deterministic
  contiguous batches. It MUST also include settlement-reason counts,
  auto-order-cause counts, max-win cap-bind count/rate, maximum payout, maximum
  loss, and peak notional. Empty or non-finite statistics fail report creation.
- **MC-7** For identical configuration and fixture bytes, canonical report data
  MUST be byte-identical across fresh runs and invariant to candidate order,
  behavior order, trial execution order, batching, playback speed, scheduler
  pacing, wall-clock time, timers, DOM state, and interpolation. The deterministic
  core MUST contain no `Date`, `performance`, timer, DOM, or ambient RNG read.
- **MC-8** The committed M1.7 engineering artifact MUST record the master seed,
  per-cell sample count, exact behavior parameters, simulator configuration,
  replay fixture names and SHA-256 checksums, candidate and selected θ, all MC-6
  statistics, methodology, and limitations. It MUST be labelled
  `engineering-preliminary`, name PL-6's outstanding 10⁷-position/≥90-day
  release run, and MUST NOT claim certification readiness. The package MUST
  expose the same deterministic runner with configurable sample counts and
  replay datasets so the release-scale report changes inputs, not algorithms.

## CR — Crush (Liquidation)

- **CR-1** A position is crushed at the **first tick** where the index has reached or passed the crush line — `I_t ≤ I_crush(τ)` for Surface, `I_t ≥ I_crush(τ)` for Dive. This is equivalent to `M_t ≤ 0` and, where float arithmetic separates them, **the line is authoritative** (game logic §5). Test: for every direction × leverage, a tick exactly at the line MUST crush, and the tick one representable step short of it MUST NOT — the outcome may not vary by leverage. Evaluation order per tick is: crush check → auto-order triggers → pending ascent settlement.
- **CR-2** Crush settles at payout 0; the ledger records the crush tick id and `I_t`.
- **CR-3** The client-displayed crush line equals `I_e·(1 − d·(1 − θτ)/L)` and creeps with τ. Because CR-1 makes the line the operative test, the displayed line and the value the engine crushes against MUST be the same computed number, not merely equal within display precision; the client renders a rounded copy of the engine's value and never recomputes it independently.
- **CR-4** Crush during ascent is possible and takes precedence over ascent settlement on the same tick.
- **CR-5** A gap tick that jumps far beyond the crush line still settles at exactly 0 (never negative): the clamp (FI-3) bounds the gap, and payout floor guarantees it regardless.
- **CR-6** τ-alignment: the crush line tested at tick *n* uses the same τ as the line displayed at tick *n*. A line drawn at τ=n and tested at τ=n−1 (or vice versa) is a release blocker — it reintroduces the CR-1 mismatch at a magnitude players can see. Test: across a full round, assert displayed-line(n) === engine-line(n) for every tick with a position open.
- **CR-6b** τ-alignment of auto-order triggers: the **current endpoint** `M_n` of a TP/SL crossing, and the `M_n` tested by the max-win trigger, MUST be `positionMultiplier` at the same τ the crush line at tick *n* is tested against and the multiplier displayed at tick *n* is drawn from. The previous endpoint is the exact `M_{n−1}` retained from the preceding authoritative tick; it is never recomputed from a clock or interpolated frame. CR-1 fixes the per-tick order as crush → auto-order triggers → ascent settlement; the single τ advance at the top of the tick makes the crush line and current trigger endpoint share one τ. A current endpoint evaluated at stale τ=n−1 is a **release blocker**. Test every tick across a full round: retained previous endpoint equals the prior tick's displayed multiplier, current endpoint equals this tick's `positionMultiplier`, and no trigger fires on a multiplier the authoritative sequence never crossed. A trigger at tick *n* starts ascent at `t_r = t(n)` (AO-2) and settles at a later tick's `M`; CR-6b constrains the trigger decision, not settlement.

## CO — Cash-Out (The Blow)

- **CO-1** A cash-out request on an open position is stamped at server receipt `t_r` and settles at the **first tick ≥ t_r + 500 ms** at that tick's `M`. Tolerance: settlement tick is within [500, 625) ms after `t_r`.
- **CO-2** Ascent is irrevocable; a cancel request during ascent is rejected.
- **CO-3** A second cash-out request during ascent is idempotent (no effect, no error to the player).
- **CO-4** The live payout figure shown during ascent is presentation only; settled amount derives from the settlement tick alone. Test: induced divergence between interpolated and tick value settles on tick value.
- **CO-5** If the round ends before the ascent's settlement tick, the position settles under RL-4 at the final tick.

## AO — Auto Orders

- **AO-1** Take-profit and stop-loss multipliers are optional and may be set only at entry (v1). Accepted values are snapshotted immutably onto the position and evaluated by the authority even if the client disconnects.
- **AO-2** A trigger condition met at tick n starts an ascent with `t_r = t(n)`; auto orders receive no latency advantage over manual taps beyond the network leg they skip — identical 500 ms rule.
- **AO-3** TP must be finite and `> 1 + L·0.0147`, where 0.0147 is FI-3's maximum one-tick index move translated through the entry leverage; SL must be finite and in `(0, 1)`. Oxygen is deliberately not subtracted from the TP floor: the published maximum favorable price move is the conservative bound. Invalid values are rejected at entry with `INVALID_TAKE_PROFIT` or `INVALID_STOP_LOSS` before any debit.
- **AO-4** TP and SL are **threshold crossings between consecutive authoritative tick multipliers**, never level checks on a rendered frame. Threshold `x` qualifies between `M_{n−1}` and `M_n` iff `(M_{n−1} < x && M_n >= x) || (M_{n−1} > x && M_n <= x)`; starting exactly on a threshold does not fire it again. This bidirectional definition handles a gap that traverses a threshold between samples. If both TP and SL qualify on one tick, stop-loss wins. A qualifying order starts one ascent only; ascending and done positions never retrigger.
- **AO-5** Max-win: current authoritative `M_t ≥ maxWinMultiple` (50 in v1) force-triggers an ascent identical to AO-2; final payout is capped at min(50 × stake at settlement M, $10,000). The max-win trigger is a level check, not TP/SL crossing logic, so a gap landing beyond 50 cannot miss it. The cap and trigger are **separate mechanisms**: PL-4 clamps every settlement, while the trigger stops a position running further once the cap cannot pay more. A build with the trigger but no clamp overpays on a gap; a build with the clamp but no trigger pays correctly but leaves capped money at crush risk for no upside.

## RK — Risk Controls

- **RK-1** Directional exposure cap: when players' net open notional in one direction exceeds the configured cap, new entries in that direction are rejected with the "ballast full" code; the other direction remains available. Config change logged, next-round effective.
- **RK-2** Per-player rate limits (entries/min, requests/s) enforced server-side; limits configurable per operator.
- **RK-3** All caps (stake, notional, max win, exposure) are operator-configurable within house limits and appear in the audit log on change.

## LG — Ledger & Wallet

> **Model note (ADR 0011).** Crush Depth is a **B2B game provider**. The casino
> operator holds player funds and is the **balance authority**; the provider
> **does not custody player funds**. The ledger below is the provider's
> **internal game ledger** — internal game accounts and an operator-receivable,
> not custody accounts. It exists for dispute resolution, reconciliation,
> certification evidence and correctness, all of which survive the loss of
> custody. Movement of real money happens through the WL wallet seam.

- **LG-1** Double-entry: every debit has a matching credit account; the sum over all accounts is invariant. Continuous invariant check in tests; nightly reconciliation job in production. The invariant is checked **continuously in tests**, not only nightly, because it is how settlement defects surface at all. Provider accounts are internal game accounts plus an operator-receivable; **no ledger account represents custody of player funds**.
- **LG-2** All amounts are integer minor units end-to-end; a float in any money-typed field fails the type system (branded types) and CI.
- **LG-3** Every ledger operation is idempotent by operation id and immutable once written; corrections are new compensating entries, never edits.
- **LG-4** Bet, settlement, refund, and void records retain: player id, round id, position id, direction, stake, leverage, `I_e`, entry tick id, settlement tick id, `M`, payout, θ in force, timestamps. Retention per jurisdiction (default ≥ 5 years). Under ADR 0011 "player id" is the **opaque operator-scoped player reference**, never identity documents or PII: the provider stores what it needs to reconstruct a round and nothing that duplicates the operator's regulated identity systems. Every record additionally retains the **operator id** and the **wallet idempotency key(s)** of the WL operations it corresponds to, so a provider record and an operator wallet transaction can be matched during reconciliation (`WL-6`).
- **LG-5** The provider's internal ledger MUST reconcile against the operator's wallet. Every provider settlement, refund and void maps to WL operations by idempotency key, and a **reconciliation run reports every divergence** — provider record with no operator transaction, operator transaction with no provider record, or matched pair with differing amounts. Divergence is an **exception to be resolved, never auto-corrected by trusting either side**: a provider that silently adopts the operator's number destroys its own audit position, and one that silently overrides it is claiming custody it does not have.

## WL — Operator Wallet Integration (B2B seam)

> Applies to the seamless-wallet model adopted in ADR 0011: the operator is the
> balance authority and the provider calls it per transaction. The internal
> contract below is provider-side; per-operator adapters map it onto each
> operator's actual API.

- **WL-1** The provider exposes exactly four wallet operations — **debit**
  (stake at entry execution), **credit** (settlement payout > 0), **refund**
  (EN-6 unexecuted entry, MF-2 void), and **rollback** (a debit whose outcome is
  unknown or whose round was voided). Refund and rollback are **keyed to the
  original debit**, never free-standing money movements.
- **WL-2** Every operation carries a **provider-generated idempotency key** and
  the full LG-4 context. Every operation is **idempotent by that key**: a retry
  returns the original result and MUST NOT move money twice. This is a MUST
  because a timeout is indistinguishable from a lost response — without
  idempotency the only safe behaviour after a failed debit is to leave the
  player's money in an unknown state. Test: replay every operation type
  verbatim, and assert one money movement and an unchanged operator balance.
- **WL-3** A refund fully reverses its debit — no partial refunds, no
  refunds exceeding the original stake, no refund of an already-refunded or
  rolled-back debit.
- **WL-4** **Rollback is the recovery path for unknown outcomes.** Where a debit's
  result cannot be determined, the provider retries with the same key and then
  rolls back; it MUST NOT synthesise a balance, assume success, or assume
  failure. Test the three-way split — confirmed success, confirmed failure,
  unknown — and assert the player's money ends in a defined state in all three.
- **WL-5** **The provider never treats its mirrored balance as authoritative.**
  Any displayed or engine-held balance is a mirror of the operator's; a
  divergence is reconciled to the operator (`LG-5`), never resolved by the
  provider overwriting it. `INSUFFICIENT_BALANCE` (EN-8) is decided by the
  operator's debit response, not by the mirror.
- **WL-6** Every WL operation is recorded in the provider ledger with its
  idempotency key and operator id, so provider records and operator wallet
  transactions match one-to-one during reconciliation (`LG-5`).
- **WL-7** Operator-supplied **eligibility and responsible-play state** —
  self-exclusion, cooling-off, jurisdictional block, operator loss/deposit
  limits, session validity — is enforced server-side before any entry is
  accepted, and ranks in EN-8's eligibility stage. The provider **enforces and
  never overrides**; where an operator restriction and a session restriction
  conflict, the stricter binds (RP-2).
- **WL-8** Wallet latency and failure are on the entry critical path and MUST be
  bounded: a wallet call exceeding the configured timeout rejects the entry
  cleanly with no position and no orphaned debit, and the failure is counted as
  a BO-2 metric. A wallet outage MUST NOT abort the round for players already
  holding positions — settlement of open positions retries and escalates to a
  reconciliation exception rather than voiding a determinable outcome.

## MF — Malfunctions & Degenerate Cases

- **MF-1** SIGNAL LOST (per FI-5): all open positions auto-surface at the last valid tick, the round aborts, clients display the abort state. Positions already crushed stay crushed; ascents in flight settle at the last valid tick.
- **MF-2** Server crash recovery: any position lacking a settlement record is voided and refunded at stake; the affected round is marked void; no round is ever resumed. Recovery drill is a release test. Under ADR 0011 recovery also **rolls back the position's debit at the operator** (`WL-4`), keyed to the original debit id, and any debit whose outcome is unknown after recovery is resolved by rollback rather than by assuming either result. A recovery path that guesses whether a debit landed is a release blocker.
- **MF-3** "Malfunction voids pays": a settlement produced in violation of this spec is voidable per the published terms; the void path exists in the ledger (LG-3 compensating entries) and back office, and reverses at the operator through WL refund/rollback keyed to the original operations.
- **MF-4** Client disconnect changes nothing server-side: auto orders still fire; worst case RL-4 applies. Test: kill the client post-entry, verify identical settlement.
- **MF-5** Clock skew: all timing derives from the server clock; client timestamps are never trusted for money.

## FA — Fairness & Latency

- **FA-1** No code path allows any party (including the operator) to act on a tick before it is published to players — enforced by EN-2/CO-1 next-tick semantics.
- **FA-2** The 150 ms client buffer and 500 ms ascent are identical for all players and not configurable per player.
- **FA-3** The operator has no mechanism to influence the index (FI-7 plus deployment review: feed servers isolated from game-config servers).
- **FA-4** Round history shown to players matches ledger records exactly (game recall: last 100 rounds retrievable in-client with per-round detail).

## VR — Verifiability

- **VR-1** For every settled round, the API serves: round id, all raw per-exchange samples and medians, constants in force, and a server signature over the payload.
- **VR-2** The client "Verify" feature recomputes `I_t` from the raw series and displays match/mismatch; a mismatch is alarmed as a severity-1 incident.
- **VR-3** Any change to audit-locked constants bumps a public version number visible in-client and in VR-1 payloads.

## RP — Responsible Play

> **Model note (ADR 0011).** The **operator** owns the primary
> responsible-gambling account controls — self-exclusion, deposit limits,
> cooling-off, age verification — and is authoritative on whether a player may
> play. The **provider enforces** what the operator supplies and never overrides
> it, plus the in-session controls below. Where an operator restriction and a
> provider/session restriction conflict, **the stricter binds**.

- **RP-1** Session clock is always visible in every client build.
- **RP-2** Player-set loss limit blocks new entries at the threshold for the session; cannot be raised mid-session (lowering is immediate; raising takes effect after a cool-down per jurisdiction, default 24 h). The limit is **dual-sourced**: an operator-supplied restriction the provider MUST honour, plus an optional in-session limit the provider may offer where operator policy permits. **The stricter of the two binds**, and enforcement is server-side and un-bypassable by a modified client regardless of source. Test an operator limit alone, a session limit alone, and both with each in turn the stricter.
- **RP-3** Reality check every 15 min: modal with session time, wagered, net; play cannot continue until acknowledged.
- **RP-4** Jurisdictional hooks exist for: deposit limits, self-exclusion, mandatory breaks, age verification gate. v1 ships the interfaces even where a market doesn't require them. Under ADR 0011 these are **operator-owned and provider-enforced**: the provider builds no registration, KYC, deposit or withdrawal flow, and instead consumes operator-supplied eligibility state (`WL-7`) and blocks entry accordingly. A provider that lets a self-excluded or ineligible player open a position is a compliance incident **regardless of which system made the mistake**, so enforcement is server-side and tested against a hostile client.
- **RP-5** Auto re-entry (if ever enabled) is bounded (max consecutive rounds) and disabled by default.

## UI — Client Behavior

- **UI-1** The client never displays future terrain, future ticks, or any lookahead artifact.
- **UI-2** Displayed live multiplier vs engine tick multiplier diverges only by interpolation within one tick interval; settlement banner always shows the tick-settled amount.
- **UI-3** All money renders from integer cents through one formatting function; no client arithmetic on displayed floats feeds back into requests.
- **UI-4** Entry/crush lines, O₂ gauge, and creeping crush line are visible whenever a position is open, on every supported viewport.
- **UI-5** The payout math sheet (formula, θ, ascent rule, crush rule) is reachable within two taps at all times.

## CC — Close Calls

- **CC-1** A Close Call is informational evidence attached only to a successful
  authoritative settlement. Eligible settlements have `reason ∈ {ascent,
  round-end}`, `crushed = false`, and `payout > 0`. Manual, take-profit,
  stop-loss and max-win ascents are treated identically. A crush is never a
  successful Close Call, even when an earlier tick was inside the proximity
  threshold.
- **CC-2** Proximity is the position's signed index headroom from its
  authoritative creeping crush line on an authoritative tick:
  `headroom = d × (I_t − I_crush(τ)) / I_crush(τ)`, reported in basis points as
  `headroomBps = 10,000 × headroom`. A surviving Surface and Dive position use
  the same positive scale because `d` reverses both the comparison and sign.
  The client and social-feed layer MUST NOT recompute the crush line,
  multiplier, settlement, P&L, or this proximity rule.
- **CC-3** The v1 threshold is **50 basis points (0.5%)**, inclusive, measured
  against the crush line: a surviving tick just inside and exactly on 50 bp
  qualifies; one representable value outside does not. Qualification uses the
  authoritative directional index comparison against
  `I_crush × (1 ± 0.005)`, so equality behavior does not depend on formatting or
  a rounded displayed percentage. Changing this threshold is a versioned game
  and audit assumption.
- **CC-4** The authoritative closest approach is the minimum positive CC-2
  headroom observed over every authoritative tick after entry while the
  position remains exposed, including open ticks, every tick of the 500 ms
  ascent, and the settlement tick. The entry-execution tick is not sampled. If
  two ticks have exactly equal minimum headroom, retain the earliest tick.
  Render frames, interpolation and client clocks never enter the observation.
- **CC-5** An eligible qualifying settlement emits exactly one `close-call`
  engine event immediately after its `settled` event and before
  `wallet-changed`. The event contains a stable id, position id, direction,
  threshold, authoritative closest tick/index/crush line/headroom, and the
  complete authoritative settlement (reason, ascent cause, settlement tick,
  multiplier, stake, payout and P&L). Social-feed copy may format these facts
  but may not derive new outcome facts from them.
- **CC-6** Duplicate suppression is by the authority-supplied Close Call event
  id. The first occurrence is rendered and later occurrences of the same id
  are ignored. Distinct events retain authoritative arrival order; DOM state,
  animation completion, presentation timers and feed playback speed cannot
  reorder them or change qualification.
- **CC-7** Close Calls MUST NOT change wallet fields, settlement, position or
  round state, player eligibility, cooldown, feed selection, source ticks, or
  any other engine outcome. For identical ticks, actions and configuration,
  enabling or consuming Close Call events produces byte-identical money and
  settlement facts. Replaying the same settlement produces byte-identical
  Close Call facts and id.
- **CC-8** Fake social actors may use seeded presentation-only choices for
  name, direction, stake, leverage and exit timing, but any Close Call they
  publish MUST come from an isolated real `@crush/engine` state and its emitted
  settlement/Close Call events. The fake layer MUST NOT synthesize or
  recompute multiplier, crush, payout, P&L, settlement, or proximity. Ambient
  randomness, execution speed, wall-clock time and DOM state cannot affect the
  result for a fixed seed and authoritative tick/action script.

## SC — Scene & Renderer Boundary (M1.8)

- **SC-1** The client selects a renderer through one `RendererPort` interface
  (`init`, `resize`, `render`, `destroy`). Every renderer implementation MUST
  satisfy that interface, and nothing outside `render/` may know which
  implementation is running — exactly what `FI` requires of `IndexSource`. The
  Canvas 2D renderer remains a conforming implementation and stays the default
  until visual parity has been reviewed; `?renderer=pixi` is the explicit
  opt-in and is handled only inside the renderer seam.
- **SC-2** The PixiJS scene consumes a `SceneModel` — a plain, serialisable
  snapshot projected from authoritative client state — and MUST NOT read `S`,
  the engine, the interpolation buffer, the DOM or a clock on its own. The
  retained, unmodified Canvas reference is a temporary compatibility adapter
  and is explicitly exempt while it remains the live parity baseline. The
  projection is a pure function `(input) => SceneModel` with no timers, no
  RNG, no DOM and no clock reads; identical input produces a deeply equal model
  on every call and in any execution order.
- **SC-3** The scene MUST NOT make or influence a gameplay decision. No
  renderer, projection or scene module may compute or alter a multiplier,
  crush line, payout, P&L, settlement, eligibility, cooldown, wallet field,
  round phase, feed selection or tick. The crush line and P&L that reach the
  scene come from `@crush/engine` accessors (CR-6, UI-2); the scene MUST NOT
  recompute either.
- **SC-4** Renderer frame rate, frame timing, dropped frames, resize events,
  device pixel ratio, quality tier and choice of implementation cannot change
  any money or settlement fact. For an identical tick series and action
  script, settlement output is byte-identical across differing frame cadences,
  including no frames at all.
- **SC-5** `init` is idempotent per port instance and acquires every resource
  it needs; `destroy` releases them — canvas/WebGL context, display objects,
  tickers and every listener the port registered — and leaves the port safe to
  re-`init`. `render` after `destroy` is a no-op rather than a throw, so a
  teardown race cannot crash the client.
- **SC-6** `resize(width, height)` updates the projection viewport for the next
  frame without reading layout inside the renderer, clamps device pixel ratio
  to the quality tier in force, and MUST NOT alter game state. A zero or
  negative dimension is ignored rather than propagated.
- **SC-7** Parity-critical mappings are shared, not reimplemented per renderer:
  depth-of-index, index-to-y, time-to-x, the depth colour ramp and the
  entry/crush line positions come from one module that both implementations
  consume. A parity test asserts both renderers place the sub, the entry line
  and the crush line at the same coordinates for the same `SceneModel`.
- **SC-8** UI-4 holds in every renderer implementation: whenever a position is
  open, the projection emits the entry line, the creeping crush line and the
  index/depth readout, and the model records them regardless of which renderer
  draws it.

## PF — Performance

- **PF-1** 60 fps median / ≥ 45 fps p5 on the reference mid-range device set during a volatile round with a position open; auto-degradation tiers engage below threshold without gameplay change.
- **PF-2** Client tick-to-glass latency (tick publish → rendered, including the 150 ms buffer) ≤ 250 ms p95 on reference network profiles.
- **PF-3** Server sustains **10,000 concurrent players in one shared round**, all holding active positions, at 8 Hz, with internal tick fan-out jitter ≤ 25 ms p99 measured over a **one-hour soak**. A **20,000-connection, five-minute resilience burst** MUST additionally be survived without data loss or settlement error. The single-round framing is deliberate: every player in a round is settled against the same tick, so there is no sharding escape hatch — this is 10,000 recipients of one message every 125 ms. Topology per ADR 0010: a deterministic single-writer round authority behind horizontally scalable stateless WebSocket gateways; only connection handling and fan-out scale out.

## BO — Back Office & Audit (operator acceptance)

- **BO-1** Round recall: any round reconstructable (price series, every position, every event) from the back office by round id or player id.
- **BO-2** Live dashboards: actual RTP (rolling 24 h / 30 d) vs target, exposure per direction, feed health, abort counts, and rejection counts broken out by EN-8 code (`NO_PRICE` in particular — see EN-9). RTP deviation alarm at ±1.5 % over 24 h at volume.
- **BO-3** Immutable audit log of every config change (θ, caps, limits) with actor identity.
- **BO-4** Player-level statement export (bets, results, timestamps) for dispute resolution, keyed by the opaque operator-scoped player reference and filterable by operator. The provider MUST be able to answer a dispute from **its own records** — "ask the operator" is not a dispute-resolution path, and is not an evidence bundle a lab will accept.

---

## Release gate summary

A build is casino-submittable when: every MUST above has a passing automated or documented manual test; PL-6's calibration report is attached; MF-2's recovery drill is documented; and a legal opinion on the target jurisdiction's classification of price-settled wagers is on file.

Under the B2B provider model (ADR 0011) four further items join the checklist: **FI-20's market-data rights** are in force with a documented chain and explicit **sublicensing** for publication; the **WL wallet contract** is agreed with the integrating operator and its idempotency/rollback behaviour tested against that operator's API; **provider (supplier) licensing and per-game approval** are obtained in the target market alongside the operator's licence; and the **laboratory pre-assessment** of the price-settled outcome model has been obtained before production M2.2 completion. Track these eight as the certification checklist.
