# Manual test script — M1.5 (entry controls, cooldown, auto-orders)

**Build under test:** `main` at M1.5 · **Run with:** `npm install`, then
`npm run dev` → http://localhost:5173

**Tester:** ______________ **Date:** ____________ **Browser / device:** ____________________

This checklist complements the automated engine and client suites. It verifies
that the browser carries optional TP/SL values to the authority adapter, shows
the engine's rejection copy, and renders every automatic exit as the ordinary
500 ms Blow. Mark **P**, **F**, or **N/A**.

## Before you start

- Open DevTools and keep the Console visible.
- Hard-reload before each numbered section so the wallet and position state are
  predictable.
- Use a screen recording at 60 fps for ascent timing.
- The simulated feed cannot reasonably produce a 50× win. Section 5 therefore
  injects authoritative ticks through the existing engine adapter; this is a
  deterministic manual probe, not a player flow.

### Constants in force

| Rule | Value |
|---|---|
| Leverage | 2×, 5×, 10×, 25× |
| Minimum stake | $0.50 |
| Maximum notional | $2,000 (`stake × leverage`) |
| TP minimum | strictly above `1 + leverage × 0.0147` |
| SL range | strictly between 0× and 1× |
| Re-entry cooldown | 900 ms between authoritative tick timestamps |
| Ascent | 500 ms; settles on first due authoritative tick |

---

## 1 — AO-1/AO-3: entry controls and immutable snapshots

| # | Step | Expected result | AC | P/F |
|---|---|---|---|---|
| 1.1 | In a running round, enter TP `1.20`, SL `0.80`, choose 10× and open Surface. | Position opens and the stake is debited once. No client-side warning appears. | AO-1, EN-3 | |
| 1.2 | In DevTools run `const {S}=await import('/src/state/store.js'); ({tp:S.pos.takeProfit, sl:S.pos.stopLoss})`. | Exactly `{tp: 1.2, sl: 0.8}`. | AO-1 | |
| 1.3 | Change both input boxes while the position remains open and rerun the expression. | The values on `S.pos` do not change. | AO-1 | |
| 1.4 | During intermission, set TP/SL and arm a bet. Inspect `S.armed`. | The armed request retains both values and opens with them at launch. | AO-1 | |
| 1.5 | Leave both fields blank and open a position. | Position opens normally; both snapshot fields are absent. Existing manual play is unchanged. | AO-1 | |

---

## 2 — EN-4/AO-3: rejection copy and non-debit

Record the balance before each attempt. These checks intentionally use the
normal UI; no browser constraint should silently apply a stricter rule than the
engine.

| # | Step | Expected result | AC | P/F |
|---|---|---|---|---|
| 2.1 | At 10× enter TP `1.147` and submit. | `TAKE-PROFIT TOO CLOSE`; no position and no balance change. | AO-3, EN-4 | |
| 2.2 | At 10× enter TP `1.1471` and submit. | Accepted if all eligibility checks pass; the boundary is strict, not rounded to the input's display precision. | AO-3 | |
| 2.3 | Enter SL `0`, then SL `1`, submitting each. | `STOP-LOSS MUST BE BETWEEN 0× AND 1×`; no debit. | AO-3, EN-4 | |
| 2.4 | Enter SL `0.01`, then `0.99`, on fresh attempts. | Both boundary-near values are accepted. | AO-3 | |
| 2.5 | Select $250 at 10× and submit. | `BALLAST LIMIT — MAX $2,000 NOTIONAL`; no debit. | EN-4 | |
| 2.6 | Select $200 at 10× and submit. | Accepted: equality at the notional cap is valid. | EN-4 | |

---

## 3 — AO-2/AO-4/CR-1: TP, SL and crush ordering

For deterministic probes, halt the simulator and import the adapter/state:

```js
const {source}=await import('/src/feed/index.js'); source.halt();
const {Engine}=await import('/src/core/engine.js');
const {S}=await import('/src/state/store.js');
```

Open at the displayed index `I_e`, then inject the specified `v` relative to
`S.pos.entry`. Use a timestamp 125 ms after `S.lastTick.t`.

| # | Step | Expected result | AC | P/F |
|---|---|---|---|---|
| 3.1 | Surface 10× with TP `1.20`; inject `Engine.onTick({t:S.lastTick.t+125,v:S.pos.entry*1.021})`. | Position becomes `ascending`, cause is `take-profit`, and no settlement/balance credit occurs on this tick. | AO-2, AO-4 | |
| 3.2 | Record the result of 3.1 and inject ordinary ticks through the ascent. | Blow lasts at least 500 ms of authoritative timestamps and remains exposed to price/oxygen until its due tick. | AO-2, CO-1 | |
| 3.3 | Fresh Surface 10× with SL `0.80`; inject `v=entry*0.019` below the crush line. | It settles as `crush`, payout 0; no SL ascent starts. | CR-1, AO-4 | |
| 3.4 | Fresh Surface 10× with SL `0.80`; inject `v=entry*0.979`. | Position starts a stop-loss ascent, not an immediate settlement. | AO-2, AO-4 | |
| 3.5 | While any auto-triggered ascent is active, inject a tick beyond the live crush line before the due time. | Crush wins and settles payout 0. | CR-1, CR-4 | |

---

## 4 — EN-7/EN-8/EN-10: cooldown and deterministic authority

| # | Step | Expected result | AC | P/F |
|---|---|---|---|---|
| 4.1 | Settle a position, then immediately attempt another valid entry before 900 ms of authoritative tick time has passed. | `POD CYCLING — STAND BY`; no debit. | EN-10 | |
| 4.2 | At an authoritative entry tick exactly `settlementTick.t + 900`, retry. | Accepted if no higher-ranked eligibility condition holds. | EN-10 | |
| 4.3 | During cooldown submit an invalid TP as well. | `TAKE-PROFIT TOO CLOSE`, proving request validation precedes `COOLING_OFF`; wallet unchanged. | EN-4, EN-8 | |
| 4.4 | Replay an already accepted engine request id after settlement/cooldown state changes (automated test is the practical harness). | Original position/result is returned with no second debit; no validation or cooldown rejection replaces it. | EN-7, EN-8 | |

---

## 5 — AO-5/PL-4: max-win trigger and separate cap

Open a Surface 10× position, halt the simulator, then inject an authoritative
tick whose index is `entry × 6` (multiplier is above 50× before oxygen).

| # | Step | Expected result | AC | P/F |
|---|---|---|---|---|
| 5.1 | Inject the >50× tick. | One ascent starts with cause `max-win`; the position is not settled on this tick. | AO-5, AO-2 | |
| 5.2 | Inject the first tick at least 500 ms later while keeping the position above its crush line. | Position settles once through the normal ascent path. | AO-5, CO-1 | |
| 5.3 | Compare payout with `min(50 × stake, $10,000)`. | Payout does not exceed either bound even if the settlement multiplier remains above 50. | PL-4, AO-5 | |

---

## 6 — UI and regression pass

| # | Step | Expected result | AC | P/F |
|---|---|---|---|---|
| 6.1 | Resize to ~360 px portrait and a wide desktop viewport. | TP/SL row stays legible and does not cover stake, leverage, action buttons or responsible-play controls. | AO-1, RP-1 | |
| 6.2 | Play one position with blank auto-orders and cash out manually. | Manual 500 ms ascent and settlement remain unchanged. | CO-1, AO-1 | |
| 6.3 | Trigger the reality-check modal with `S.nextRC=0`. | Auto-order controls cannot be operated through the modal; an existing position continues to receive authoritative ticks. | RP-3, MF-4 | |
| 6.4 | Open the payout-math sheet. | Record whether it explains oxygen, ascent and max-win correctly: __________. Any stale statement is a UI-5 failure, not an engine failure. | UI-5 | |

## Result summary

| Section | AC ids | Pass | Fail | Notes |
|---|---|---|---|---|
| Entry snapshots | AO-1, AO-3 | | | |
| Validation | EN-3, EN-4, AO-3 | | | |
| Trigger ordering | AO-2, AO-4, CR-1, CR-4 | | | |
| Cooldown/precedence | EN-7, EN-8, EN-10 | | | |
| Max-win | AO-5, PL-4 | | | |
| UI/regression | CO-1, RP-1, RP-3, UI-5 | | | |

**Blocking issues found:** _________________________________________________

**Tester sign-off:** ____________________ **Date:** ____________
