# CRUSH DEPTH — Acceptance Criteria v0.1 (Casino-Grade)

Companion to `crush-depth-game-logic-v0.1.md`. Every criterion is testable and carries an id; engine unit tests, integration tests, and certification checklists reference these ids. Written with GLI-19-style interactive gaming expectations in mind (event logging, game recall, incomplete-game handling, player protection) — final certification scope depends on the chosen jurisdiction and test lab.

Conventions: "tick" = one 125 ms server sample. "MUST" = release blocker. All money assertions are in integer minor units.

---

## FI — Feed & Index

- **FI-1** The index MUST be computed only by the published transform (λ=0.997, σ_floor=1.2 bp, clamp ±3.5σ, v=0.0042, I₀=1000). Recomputing any settled round from its raw price series reproduces every `I_t` exactly (same float ops order, or fixed-point — pick one and freeze it).
- **FI-2** For every tick, sign(ΔI) = sign(ΔP_median). No configuration may break this.
- **FI-3** A single tick MUST never move the index more than ±(3.5 × v) = ±1.47 %.
- **FI-4** An exchange feed deviating > 0.5 % from the median for a tick is excluded from that tick's median.
- **FI-5** With fewer than 3 live exchange feeds, or any feed gap > 2 s, the round MUST abort per MF-1. No tick may ever be extrapolated, interpolated, or invented server-side.
- **FI-6** The effective amplification v/max(σ,σ_floor) MUST never exceed 35×.
- **FI-7** No component of index computation reads any RNG. Static analysis / code review checklist item.
- **FI-8** Tick timestamps are server-clock, monotonic; a tick with a non-increasing timestamp is rejected and alarmed.

## RL — Round Lifecycle

- **RL-1** State machine is exactly `waiting → launching → running → ending → settling → waiting`; no other transitions exist. Every transition is logged with server timestamp and round id.
- **RL-2** Round length is 90.0 s of `running` ± 1 tick; intermission 8 s.
- **RL-3** At `running` start, I is reset to 1000 and the first tick is emitted immediately.
- **RL-4** At round end, every still-open position auto-surfaces at the final tick at its current multiplier, with no penalty and no fee.
- **RL-5** A round id is globally unique and appears on every tick, bet, settlement, and log line of that round.

## EN — Entry (Buy-In)

- **EN-1** Entries are accepted from `running` start until T−5 s; a request received after cutoff is rejected with a specific error code and full non-debit (stake never leaves the wallet).
- **EN-2** An accepted entry executes at the **first tick after server receipt**; `I_e` = that tick's value. Test: a request received between ticks n and n+1 always gets `I_e = I_{n+1}`, never `I_n`.
- **EN-3** Stake is debited atomically with position creation; if position creation fails, the debit MUST not persist (single transaction).
- **EN-4** Direction ∈ {Surface, Dive}; leverage ∈ {2, 5, 10, 25}; stake ≥ $0.50; stake × leverage ≤ $2,000. Out-of-range requests are rejected before any debit.
- **EN-5** One open position per player per round; a second open request while one is open is rejected. Re-entry after settlement in the same round is allowed within the entry window.
- **EN-6** If the round aborts or ends before an accepted entry executes, the stake is fully refunded and the position never existed in the ledger.
- **EN-7** Every entry request carries a client-generated idempotency id; replaying the same id never creates a second position or a second debit.
- **EN-8** Rejection reasons are reported in a fixed precedence: loss-lock → position-open → balance → no-price. The principle is that a **session-terminal condition is never masked by a transient one** — specifically, a loss-locked player (RP-2) MUST NOT be told "insufficient balance", which implies that depositing more would let them continue. Test: hold every condition from a given rank downward simultaneously and assert the higher-ranked code is returned. Every rejection leaves the wallet untouched regardless of rank.
- **EN-9** A request arriving with no valid entry price is rejected as `NO_PRICE`, distinct from MF-1 SIGNAL LOST: it rejects one request, settles nothing, aborts no round, and is not alarmed as an outage. Player-facing copy MUST NOT present it as a feed failure. `NO_PRICE` rate is a counted metric (BO-2) because a rising rate indicates an entry-window or round-start defect.

## PL — Multiplier, P&L, Oxygen

- **PL-1** `M_t = 1 + L·d·(I_t/I_e − 1) − θ·τ`, τ measured from the entry-execution tick in seconds (tick-count × 0.125). Golden-vector test set MUST cover both directions × all leverages.
- **PL-2** θ = 0.25 %/s from remote config; a config change takes effect only at the next round boundary, never mid-round, and is logged.
- **PL-3** Oxygen accrues during ascent exactly as while open.
- **PL-4** Settlement payout = stake × max(0, M) rounded half-away-from-zero to integer cents, computed once. Property test: for all inputs, 0 ≤ payout ≤ min(50 × stake, $10,000 cap).
- **PL-5** Maximum loss of any position is exactly the stake. No mechanism (gap ticks, clock skew, config change) may produce a negative balance from a position.
- **PL-6** Simulated RTP over the reference behavior-model suite is 96.5 % ± 0.5 % (10⁷ position Monte-Carlo on both simulator and ≥ 90 days of replayed real BTC data). The calibration report is a versioned release artifact.

## CR — Crush (Liquidation)

- **CR-1** A position is crushed at the **first tick** where the index has reached or passed the crush line — `I_t ≤ I_crush(τ)` for Surface, `I_t ≥ I_crush(τ)` for Dive. This is equivalent to `M_t ≤ 0` and, where float arithmetic separates them, **the line is authoritative** (game logic §5). Test: for every direction × leverage, a tick exactly at the line MUST crush, and the tick one representable step short of it MUST NOT — the outcome may not vary by leverage. Evaluation order per tick is: crush check → auto-order triggers → pending ascent settlement.
- **CR-2** Crush settles at payout 0; the ledger records the crush tick id and `I_t`.
- **CR-3** The client-displayed crush line equals `I_e·(1 − d·(1 − θτ)/L)` and creeps with τ. Because CR-1 makes the line the operative test, the displayed line and the value the engine crushes against MUST be the same computed number, not merely equal within display precision; the client renders a rounded copy of the engine's value and never recomputes it independently.
- **CR-4** Crush during ascent is possible and takes precedence over ascent settlement on the same tick.
- **CR-5** A gap tick that jumps far beyond the crush line still settles at exactly 0 (never negative): the clamp (FI-3) bounds the gap, and payout floor guarantees it regardless.
- **CR-6** τ-alignment: the crush line tested at tick *n* uses the same τ as the line displayed at tick *n*. A line drawn at τ=n and tested at τ=n−1 (or vice versa) is a release blocker — it reintroduces the CR-1 mismatch at a magnitude players can see. Test: across a full round, assert displayed-line(n) === engine-line(n) for every tick with a position open.

## CO — Cash-Out (The Blow)

- **CO-1** A cash-out request on an open position is stamped at server receipt `t_r` and settles at the **first tick ≥ t_r + 500 ms** at that tick's `M`. Tolerance: settlement tick is within [500, 625) ms after `t_r`.
- **CO-2** Ascent is irrevocable; a cancel request during ascent is rejected.
- **CO-3** A second cash-out request during ascent is idempotent (no effect, no error to the player).
- **CO-4** The live payout figure shown during ascent is presentation only; settled amount derives from the settlement tick alone. Test: induced divergence between interpolated and tick value settles on tick value.
- **CO-5** If the round ends before the ascent's settlement tick, the position settles under RL-4 at the final tick.

## AO — Auto Orders

- **AO-1** Take-profit and stop-loss multipliers may be set only at entry (v1); stored and evaluated server-side.
- **AO-2** A trigger condition met at tick n starts an ascent with `t_r = t(n)`; auto orders receive no latency advantage over manual taps beyond the network leg they skip — identical 500 ms rule.
- **AO-3** TP must be > 1 + one tick of max movement; SL must be in (0, 1); invalid values are rejected at entry.
- **AO-4** If both TP and SL conditions occur on the same tick (possible only via gap), SL wins (house-favorable rule is published).
- **AO-5** Max-win: `M_t ≥ 50` force-triggers an ascent identical to AO-2; final payout is capped at min(50 × stake at settlement M, $10,000).

## RK — Risk Controls

- **RK-1** Directional exposure cap: when players' net open notional in one direction exceeds the configured cap, new entries in that direction are rejected with the "ballast full" code; the other direction remains available. Config change logged, next-round effective.
- **RK-2** Per-player rate limits (entries/min, requests/s) enforced server-side; limits configurable per operator.
- **RK-3** All caps (stake, notional, max win, exposure) are operator-configurable within house limits and appear in the audit log on change.

## LG — Ledger & Wallet

- **LG-1** Double-entry: every debit has a matching credit account; the sum over all accounts is invariant. Continuous invariant check in tests; nightly reconciliation job in production.
- **LG-2** All amounts are integer minor units end-to-end; a float in any money-typed field fails the type system (branded types) and CI.
- **LG-3** Every ledger operation is idempotent by operation id and immutable once written; corrections are new compensating entries, never edits.
- **LG-4** Bet, settlement, refund, and void records retain: player id, round id, position id, direction, stake, leverage, `I_e`, entry tick id, settlement tick id, `M`, payout, θ in force, timestamps. Retention per jurisdiction (default ≥ 5 years).

## MF — Malfunctions & Degenerate Cases

- **MF-1** SIGNAL LOST (per FI-5): all open positions auto-surface at the last valid tick, the round aborts, clients display the abort state. Positions already crushed stay crushed; ascents in flight settle at the last valid tick.
- **MF-2** Server crash recovery: any position lacking a settlement record is voided and refunded at stake; the affected round is marked void; no round is ever resumed. Recovery drill is a release test.
- **MF-3** "Malfunction voids pays": a settlement produced in violation of this spec is voidable per the published terms; the void path exists in the ledger (LG-3 compensating entries) and back office.
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

- **RP-1** Session clock is always visible in every client build.
- **RP-2** Player-set loss limit blocks new entries at the threshold for the session; cannot be raised mid-session (lowering is immediate; raising takes effect after a cool-down per jurisdiction, default 24 h).
- **RP-3** Reality check every 15 min: modal with session time, wagered, net; play cannot continue until acknowledged.
- **RP-4** Jurisdictional hooks exist for: deposit limits, self-exclusion, mandatory breaks, age verification gate. v1 ships the interfaces even where a market doesn't require them.
- **RP-5** Auto re-entry (if ever enabled) is bounded (max consecutive rounds) and disabled by default.

## UI — Client Behavior

- **UI-1** The client never displays future terrain, future ticks, or any lookahead artifact.
- **UI-2** Displayed live multiplier vs engine tick multiplier diverges only by interpolation within one tick interval; settlement banner always shows the tick-settled amount.
- **UI-3** All money renders from integer cents through one formatting function; no client arithmetic on displayed floats feeds back into requests.
- **UI-4** Entry/crush lines, O₂ gauge, and creeping crush line are visible whenever a position is open, on every supported viewport.
- **UI-5** The payout math sheet (formula, θ, ascent rule, crush rule) is reachable within two taps at all times.

## PF — Performance

- **PF-1** 60 fps median / ≥ 45 fps p5 on the reference mid-range device set during a volatile round with a position open; auto-degradation tiers engage below threshold without gameplay change.
- **PF-2** Client tick-to-glass latency (tick publish → rendered, including the 150 ms buffer) ≤ 250 ms p95 on reference network profiles.
- **PF-3** Server sustains the target concurrent-player load with tick fan-out jitter ≤ 25 ms p99 (load target set before Phase 2 exit).

## BO — Back Office & Audit (operator acceptance)

- **BO-1** Round recall: any round reconstructable (price series, every position, every event) from the back office by round id or player id.
- **BO-2** Live dashboards: actual RTP (rolling 24 h / 30 d) vs target, exposure per direction, feed health, abort counts, and rejection counts broken out by EN-8 code (`NO_PRICE` in particular — see EN-9). RTP deviation alarm at ±1.5 % over 24 h at volume.
- **BO-3** Immutable audit log of every config change (θ, caps, limits) with actor identity.
- **BO-4** Player-level statement export (bets, results, timestamps) for dispute resolution.

---

## Release gate summary

A build is casino-submittable when: every MUST above has a passing automated or documented manual test; PL-6's calibration report is attached; MF-2's recovery drill is documented; and a legal opinion on the target jurisdiction's classification of price-settled wagers is on file. Track these four as the certification checklist.
