# CRUSH DEPTH — Game Logic Specification v0.1

Working title: **Crush Depth**. Status: recommendation draft for sign-off. Everything here is implementable against the Phase 1 client's existing seams (`IndexSource`, `Gateway`, tick-authoritative settlement, integer-cent ledger).

---

## 1. The underlying asset

**Recommendation: BTC/USDT.**

- Deepest liquidity of any crypto market → most expensive to manipulate, which is the number-one thing a regulator or casino operator will probe.
- Universally recognized. "The sub is Bitcoin" is a one-line pitch.
- 24/7 market — no market-hours dead zones.

**Price source (phase 2, but the logic is fixed now):** the *median mid-price* of BTC/USDT across 5 exchanges (Binance, Coinbase, OKX, Bybit, Kraken), sampled server-side every 125 ms.

- A feed deviating more than 0.5% from the median is excluded for that tick.
- At least 3 live feeds are required; below that, the round aborts (see §8).
- Median-of-5 means an attacker must move *three* major exchanges simultaneously within 125 ms to bias one tick — and §2's clamp caps what even that would achieve.

Later expansion: additional "vessels" per asset (ETH — nimble, SOL — wild), same engine, different room. Not v1.

---

## 2. The Index engine (price → game motion)

Raw BTC moves far too slowly for a casino tempo (often < 0.05%/min). The index amplifies and volatility-normalizes the real price so the game keeps one consistent tempo in quiet and violent markets — while **direction always matches the real market, tick for tick**. Only magnitude is rescaled. That claim must stay literally true forever; it is the product's trust story.

```
P_t   = median BTC/USDT mid-price, sampled every 125 ms (8 Hz)
r_t   = ln(P_t / P_{t-1})                          raw log return
σ²_t  = λ·σ²_{t-1} + (1−λ)·r²_t                    EWMA variance, λ = 0.997 (≈30 s half-life)
z_t   = clamp( r_t / max(σ_t, σ_floor), −3.5, +3.5 )
I_t   = I_{t−1} · (1 + z_t · v)                    v = 0.0042, I_0 = 1000 at round launch
```

Chosen constants and why:

| Constant | Value | Purpose |
|---|---|---|
| Tick rate | 8 Hz (125 ms) | Matches client architecture; fast enough to feel live, slow enough to referee |
| λ | 0.997 | Vol estimate adapts over ~30 s — tempo stays stable within a round, adjusts between regimes |
| σ_floor | 1.2 bp / tick | Caps amplification at v/σ_floor = **35×**. In a dead-flat market the game slows down rather than amplifying microstructure noise into a manipulation surface |
| Clamp ±3.5 | ±3.5σ | Caps any single tick at ±1.47% index move: flash crashes can't atomize every position in one tick, and caps the operator's per-tick exposure |
| v | 0.0042 / tick | ≈1.2%/s index volatility — dramatic but survivable at 10× for tens of seconds |

Properties that matter commercially:

1. **Sign fidelity.** sign(ΔI) = sign(ΔBTC) every tick. Marketing can say "when Bitcoin ticks up, the sub rises — always" without an asterisk.
2. **Deterministic and publishable.** The whole function is 5 lines. Publish it.
3. **Verifiable rounds** (§9): players can recompute any settled round from raw published prices. "Provably market-driven" replaces the crash genre's "provably fair" — a stronger claim, because there's no house-generated randomness at all.

**Rule for the whole product: no RNG ever touches money.** No random bonus drops, no lucky wrecks. The instant one payout depends on house randomness, the "pure market" claim dies and the regulatory classification gets murkier. Randomness is allowed only in cosmetics (terrain, creatures).

---

## 3. Round structure

| Parameter | Value |
|---|---|
| Round length | **90 s** fixed |
| Intermission | 8 s (settle screen + countdown) |
| Entry window | launch → **T−5 s** (no new positions in the last 5 s) |
| Round ends | at 90 s only, in v1 (no random round-ending events — see RNG rule) |

- 90 s (up from the prototype's 75 s) gives mid-round entry real meaning — the defining feature needs room to breathe. ~37 rounds/hour.
- The T−5 s cutoff prevents free scalps into settlement and guarantees every position lives through at least one full ascent-length of risk.
- At round end, all open positions **auto-surface**: settled at the final tick at their current multiplier (no penalty). Simple, fair, easy to explain.
- Round seed for cosmetic terrain = hash(roundId ‖ first tick price). Even the scenery is derived from the market.

---

## 4. Positions (buy-in logic)

A position = (direction, stake, leverage), opened at any time in the entry window.

- **Direction:** Surface (long) or Dive (short). **Ship Dive in v1.** Bidirectionality is half the "new category" claim; cutting it makes this a slower Aviator.
- **One open position per player per round**, re-entry allowed after it settles. Keeps the console readable and the risk engine simple. "Dual torpedo" (two concurrent positions, enables hedging) is a v2 feature flag.
- **Leverage:** discrete **{2, 5, 10, 25}**. Discrete because crush lines stay legible, risk bucketing is clean, and the UI is two taps. A 50× "Hadal mode" is a v2 unlock, not v1.
- **Stakes:** min $0.50, default $5, per-position max set by notional cap: `stake × leverage ≤ $2,000` in v1 (so $200 max at 10×, $80 at 25×). Raise with bankroll.
- **Execution rule (fairness-critical):** an entry executes at the **first server tick after the server receives the request** — never a tick the player already saw. Entry index `I_e` = that tick. Combined with the 150 ms client buffer, nobody can trade against known prices.
- If the round ends before the entry executes: full refund.
- **Runtime validation (v0.4 amendment):** after an accepted-id replay check and
  before any wallet mutation, validate in this exact order:
  `INVALID_DIRECTION` → `INVALID_LEVERAGE` → `INVALID_STAKE` →
  `NOTIONAL_LIMIT_EXCEEDED` → `INVALID_TAKE_PROFIT` →
  `INVALID_STOP_LOSS`. Eligibility then runs in this order:
  `LOSS_LIMIT_REACHED` → `ENTRY_CLOSED` → `POSITION_OPEN` → `COOLING_OFF` →
  `INSUFFICIENT_BALANCE` → `NO_PRICE`. An accepted id replay returns its
  original position before either stage; it is not revalidated or re-debited.
- **Re-entry cooldown:** after any settlement, reject a new entry as
  `COOLING_OFF` until 900 ms have elapsed between the settlement tick timestamp
  and the candidate entry tick timestamp. Equality is accepted. No wall clock,
  render frame or client timer participates.

---

## 5. P&L, liquidation, and the house edge

### The edge: Oxygen (funding decay) — the one house edge, and it's diegetic

Options considered: (a) spread on entry — invisible until players compute it, then it reads as rigged; (b) fee on cash-out — punishes the game's best moment; (c) **per-second decay while a position is open** — chosen.

The position consumes **oxygen**: a constant `θ` per second is deducted from the multiplier while open. It is the *only* edge — no spread, no cash-out fee, no payout haircut.

Why it's the right edge for this game:

- **Thematically native.** An O₂ gauge draining on the cash-out button, and the crush line *creeping toward the sub* over time, aren't UI for a fee — they're the game.
- **Creates the behavior the game wants:** urgency. You can't camp a position; time itself is pressure. Every second held is a decision.
- **Fully visible and honest.** θ is printed in the payout formula in the Math sheet. Players can see exactly what the house takes and when.

### The math

```
d      = +1 Surface, −1 Dive
Δ_t    = I_t / I_e − 1
τ      = seconds since entry executed, as ticks-since-entry × 0.125
         (the entry tick is tick 0, so τ = 0 and M = 1 there)
M_t    = 1 + L·d·Δ_t − θ·τ                multiplier (live on the button)
payout = stake · max(0, M_settle)          settled in integer cents

Crush line: I_crush(τ) = I_e · (1 − d·(1 − θτ)/L)
            → the line creeps toward the price as τ grows. Draw it creeping.
Crush:      position dies at the first tick where the index has reached or
            passed the crush line —
              d = +1 (Surface):  I_t ≤ I_crush(τ)
              d = −1 (Dive):     I_t ≥ I_crush(τ)
            (loss capped at stake — always)
            Equivalently M_t ≤ 0. Where float arithmetic separates the two,
            THE LINE IS AUTHORITATIVE — see below.
Max win:    forced auto-surface (normal 500 ms ascent) when M_t ≥ 50.
            Cap payout 50× stake, and a per-position absolute cap ($10k v1).
            payout = clamp(round(stake × max(0, M)), 0, min(50×stake, $10k))
```

**The cap and the trigger are two mechanisms (v0.3 amendment).** The forced
auto-surface and the payout clamp are implemented and tested separately, because
each without the other is a defect:

- The **clamp is unconditional** — it applies at the single float→money
  conversion, on every settlement reason. A trigger alone cannot hold the bound:
  a gap tick can carry `M` past 50 *between* two ticks, and a round-end
  settlement (§ RL-4) has no trigger to route through at all.
- The **trigger** stops a position running once the cap can no longer pay more.
  Without it a capped position keeps risking a crush for no upside — correct
  arithmetic, indefensible play.

The clamp lands **after** the single rounding, never before: clamping the float
and then rounding would be a second float→money conversion, which PL-4's
computed-once rule forbids. The cap bounds the money only — the recorded `M`
stays unclamped, because LG-4 retains what the position actually reached.

**The cap binds on longs only, by arithmetic.** A Dive's multiplier is
`1 + L·(1 − I_t/I_e)`, and the index cannot go below zero, so a short's `M` is
bounded above by `1 + L` — 26 at the top leverage of 25×. No short position can
reach 50× by price. The 50× auto-surface is therefore a long-side mechanism;
the short side is bounded by its own arithmetic and needs no trigger.

**Why the line, not the multiplier (v0.2 amendment).** `M_t ≤ 0` and
`I_t` vs `I_crush(τ)` are inverse in exact arithmetic and *not* inverse in
IEEE-754: round-tripping through both lands `M` at ±2.2e-16 at the line, with
the sign depending on the leverage. Testing the multiplier would therefore crush
a position sitting exactly on its displayed line at 10× and 25× while sparing it
at 5× — an arbitrary difference between leverages that no player or auditor can
be told a straight story about.

The two formulations also answer different questions. `M_t ≤ 0` asks "has this
position's value reached zero?", an internal quantity nobody can see.
`I_t` vs the line asks "has the price reached the line drawn on screen?" — the
thing the player watched creep toward the sub and made decisions against. Only
the second reconstructs into a defensible answer at dispute time (BO-4), so the
line is the operative test and the multiplier is its consequence.

**Consequence for implementation:** the value the engine tests against and the
value the client draws must be *the same computed number for the same tick*.
Once τ enters the line, a line drawn at τ=n and tested at τ=n−1 reintroduces the
same class of mismatch at a scale players can see. See `CR-6`.

### RTP target and calibration

- Target **RTP 96.5%** (Aviator ≈ 97%, slots 94–96% — this range is what operators accept).
- With a near-martingale index, E[payout] is approximately
  stake·(1 − θ·E[τ]) plus boundary and optional-stopping effects. M1.7 replaces
  the opening estimate with an **engineering value θ = 0.03%/s**: the declared
  equal-weight simulator selection portfolio estimates 96.5437% RTP. A disjoint
  simulator cohort estimates 96.9492% with a 99% interval containing 96.5%.
- The committed M1.7 result is `engineering-preliminary`, not launch
  certification. Before launch, PL-6 still requires at least 10⁷ simulator
  positions and at least 90 days of representative historical BTC through the
  same deterministic runner. The selected M1.6 replay fixtures are separate
  stress evidence and are not pooled into the RTP point estimate.
- θ is the single tuning knob; ship it as remote config with a published current
  value. Behavior distributions, mixture weights, datasets, or candidate changes
  require versioned acceptance criteria and an ADR before recalibration.
- Never tune RTP by touching the index transform. The transform is the trust story; θ is the business dial. Keep them separated in code and in the audit trail.

---

## 6. Cash-out logic (the Blow)

1. Player taps CASH OUT → request hits the server, stamped `t_r` on receipt.
2. Position enters **ascending**; it settles at the **first tick t ≥ t_r + 500 ms**, at that tick's `M_t`.
3. During the ascent: oxygen keeps draining, the index keeps moving, and **crush still applies**. You can die mid-escape.
4. Ascent is irrevocable (no cancel — anti-abuse).
5. Auto cash-out: player may set a take-profit multiplier and/or stop-loss
   multiplier at entry. They are immutable snapshots on the position and are
   validated before debit: `TP > 1 + L·0.0147`; `0 < SL < 1`; both finite.
6. TP/SL are **threshold crossings between consecutive authoritative tick
   multipliers**, not rendered-frame level checks. Threshold `x` qualifies iff
   `(M_prev < x && M_now >= x) || (M_prev > x && M_now <= x)`. Starting exactly
   at a threshold does not retrigger it. If TP and SL both qualify on one tick,
   stop-loss has precedence.
7. The 50× max-win trigger is a current authoritative multiplier level check,
   so a gap landing beyond 50× cannot miss it. It remains separate from the
   unconditional payout clamp in §5.
8. Every automatic trigger enters the same 500 ms ascent as a human request;
   none settles immediately. Per authoritative tick the fixed order is:
   advance τ once → crush → auto-order triggers → due ascent settlement. Crush
   therefore wins every same-tick conflict, and ascending/done positions never
   retrigger.

Why the delay survives every review: it deletes the entire latency-arbitrage class. A player with a 10 ms colo feed and a player on hotel Wi-Fi face the same 500 ms of open market risk. Publish this rationale; it converts a "weird lag" complaint into a fairness feature.

---

## 7. Risk engine (v1 minimal)

- Per-position notional cap (§4) and payout cap (§5).
- **Directional exposure cap:** if players' net open notional in one direction exceeds a bankroll-derived cap, new entries in that direction are rejected with "BALLAST FULL — try the other direction." Crude but sufficient for v1; dynamic pricing is v3.
- Per-player rate limits (entries/min, requests/s), server-side.
- All money integer minor units, double-entry ledger, idempotent operation ids on every request (the `Gateway` seam already assumes this).

---

## 8. Degenerate cases (spec these now — auditors ask first)

| Event | Rule |
|---|---|
| Feed stale > 2 s or < 3 live exchanges | **SIGNAL LOST**: all open positions auto-surface at the last valid tick, round aborts, intermission begins. No position is ever held through blind time |
| Single-exchange outlier | Excluded per tick by the 0.5%-from-median filter |
| Server crash mid-round | On recovery: any position without a settlement record is voided and refunded at stake. Never resurrect a round |
| Tick gap 125–2000 ms (jitter) | Engine treats it as one tick; the clamp bounds the jump; client buffer hides it |
| Player disconnects | Position lives on the server; auto cash-out/stop-loss still fire; worst case auto-surface at round end. Nothing depends on the client being alive |

---

## 9. Verifiability ("provably market-driven")

Per settled round, publish: round id, the full 720-sample raw price series with per-exchange values, the constants (λ, σ_floor, clamp, v, θ), and a server signature over the lot. A **Verify** button on any history chip recomputes `I_t` client-side from the raw prices and shows the match.

This is a genuine step past the genre's "provably fair" hash-reveal, because there is nothing house-generated to reveal — the house cannot know the future of BTC. Make it a headline feature, not a footnote.

---

## 10. Honest market positioning (read before pitching "completely new")

Nearest neighbors, and what's actually new:

- **Aviator / JetX / Spaceman:** RNG outcome, one direction, entry only pre-round. We differ on all three axes.
- **Rollbit "x1000 Futures", BC.Game trading games:** these already offer leveraged bets on real BTC price — the *mechanic* of leveraged price betting is not new, and the investor pitch should not claim it is. What they are: a solitary chart, unbounded session, trading-terminal presentation.
- **What is genuinely new here:** the *round-based, shared-world, game-shaped* format — everyone on one vessel, one 90-second story, mid-round entry both ways, a physical escape mechanic with real risk in it, an environment that *is* the chart, and a verifiable no-RNG money path. New category = crash-game social energy + real-market outcome, which no shipped product combines.

Position it as "the first market-driven crash game," not "the first crypto price bet."

**Regulatory flag (not legal advice — get a gaming lawyer before phase 2 money):** wagers settled on real financial prices can be classified as financial derivatives rather than gaming in some jurisdictions (UK/EU retail rules are hostile to exactly this shape). Crypto-casino jurisdictions (Curaçao, Anjouan) currently host the neighbor products above. Jurisdiction choice is therefore a *product* decision — it decides whether this can exist — and should be made before the ledger is built.

---

## 11. Retention & attraction ideas (all RNG-free, ranked)

1. **Close Calls ticker** — "K4raken escaped 0.4% from crush" broadcast to the room. The near-death of others is the cheapest drama in the game. A Close Call is an informational fact emitted only for a successful ascent or round-end settlement with positive payout. The authority retains the minimum surviving post-entry index headroom from the live creeping crush line over the full exposure, including every ascent and settlement tick: `d·(I_t − I_crush(τ))/I_crush(τ)`. At or below **0.5% (50 bp), inclusive**, it emits one stable-id event after `settled` and before `wallet-changed`; exact ties retain the earliest tick. Crushes never qualify. Fake social actors use isolated real engine states, while their seeded names/actions remain presentation-only. See CC-1…CC-8 and ADR 0008.
2. **Auto cash-out + stop-loss** (§6) — expected by every crash player; enables one-thumb sessions.
3. **Depth records** — daily/weekly boards: highest multiplier surfaced, deepest survived, longest hold at 25×. Pure telemetry, strong bragging.
4. **Escape replays** — 10-second shareable clip of your pod's ascent with the payout counter. The Blow is the signature moment; let people post it.
5. **Convoy streak** — cosmetic hull upgrades for consecutive rounds played (visual only, no odds impact — keep it modest for responsible-play optics).
6. **Multi-asset vessels** (v2) — ETH/SOL rooms, same engine.
7. **Tournaments** (v2) — fixed-bankroll races, casino-standard retention.

---

## 12. Parameter sheet (single source of truth)

| Parameter | v1 value | Owner note |
|---|---|---|
| Asset | BTC/USDT, median of 5 | §1 |
| Tick rate | 8 Hz | locked |
| Interp buffer | 150 ms | locked |
| λ (EWMA) | 0.997 | audit-locked |
| σ_floor | 1.2 bp/tick (A_max 35×) | audit-locked |
| Tick clamp | ±3.5σ | audit-locked |
| v (target vol) | 0.0042/tick | audit-locked |
| I₀ | 1000 | locked |
| Round / intermission | 90 s / 8 s | tunable |
| Entry cutoff | T−5 s | tunable |
| Leverage set | {2, 5, 10, 25} | tunable |
| Notional cap | stake×lev ≤ $2,000 | bankroll-derived |
| θ (oxygen) | 0.03%/s; M1.7 engineering RTP 96.5437% | **business dial**, PL-6 validation pending |
| Ascent | 500 ms | locked (fairness) |
| Max win | 50× and $10k/position | bankroll-derived |
| Stakes | $0.50 min, $5 default | tunable |
| Close Call | minimum surviving headroom ≤ 0.5% from live crush line | versioned audit assumption |

"Audit-locked" = changing it invalidates the published verifiability story; version any change publicly.

---

## 13. What this means for the prototype (small diffs)

1. ~~Add oxygen: `M_t` gains the `−θτ` term; O₂ bar drains on the cash-out button; crush line creeps.~~ **Done (M1.4).**
2. ~~Round length 90 s, entry cutoff T−5 s, intermission 8 s.~~ **Done (M1.4).**
3. ~~Auto cash-out / stop-loss inputs (collapsed row under leverage), runtime
   validation, cooldown and max-win auto-surface.~~ **Done (M1.5).**
4. ~~Close Calls in the fake feed.~~ **Done** — authoritative minimum-headroom facts, inclusive 50 bp threshold, ascent exposure, stable-id duplicate suppression, and engine-backed fake actors (CC-1…CC-8, ADR 0008).
5. **Done in M1.6:** the feed seam gains a deterministic replay mode fed by
   documented recorded real BTC 100 ms data (best possible pre-phase-2 test
   harness). The client keeps simulated play as the default and exposes the
   two full-round fixtures as `?feed=replay&fixture=flash-crash` and
   `?feed=replay&fixture=calm`. Original fixture timestamps remain authoritative;
   a client-only offset maps interpolation copies onto the page-relative render
   clock and cannot reach entry, liquidation, auto-orders or settlement (FI-16).
