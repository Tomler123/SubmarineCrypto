# 0005 — Auto-order crossings, entry validation, and cooldown

**Status:** accepted

**Date:** 2026-08-30

**Milestone:** M1.5 (risk caps and auto-orders), completion tranche

## Context

M1.5 still needed four authority-side behaviors: immutable TP/SL parameters,
runtime entry validation, a re-entry cooldown, and TP/SL/max-win triggers in the
reserved `onTick` slot. Two details were not yet fixed by the specification:
whether TP/SL were levels or crossings, and how new validation/cooldown failures
ranked against EN-7 idempotency and the existing EN-8 eligibility codes.

## Decisions

### 1. TP/SL use consecutive authoritative multiplier crossings

Each position retains the multiplier from its most recently processed
authoritative tick. After τ advances for tick `n`, threshold `x` qualifies iff:

```text
(M[n-1] < x && M[n] >= x) || (M[n-1] > x && M[n] <= x)
```

This catches a sampled gap that traverses a threshold in either direction and
does not retrigger when a position starts exactly on the threshold. If TP and SL
both qualify on one tick, stop-loss wins. Ascending and done positions are never
evaluated again.

Max-win deliberately differs: it is a current-level check, `M[n] >= 50`, so a
gap that lands beyond the cap cannot miss the forced ascent.

### 2. Every automatic exit uses the normal ascent

TP, SL and max-win call the same transition as manual cash-out. They stamp the
authoritative trigger tick and settle on the first later tick at least 500 ms
after it. They never settle on the trigger tick.

The fixed tick order is:

```text
advance τ once → crush → auto-order triggers → due ascent settlement
```

Crush therefore wins every same-tick conflict, including a threshold crossing
or a due ascent. The unconditional payout cap remains in `payoutFor`; the
max-win trigger is not a substitute for that final protection.

### 3. Entry handling has three deterministic stages

1. Accepted-id replay: return the original position and do not debit again.
2. Request validation:
   `INVALID_DIRECTION` → `INVALID_LEVERAGE` → `INVALID_STAKE` →
   `NOTIONAL_LIMIT_EXCEEDED` → `INVALID_TAKE_PROFIT` →
   `INVALID_STOP_LOSS`.
3. Eligibility:
   `LOSS_LIMIT_REACHED` → `ENTRY_CLOSED` → `POSITION_OPEN` → `COOLING_OFF` →
   `INSUFFICIENT_BALANCE` → `NO_PRICE`.

Validation is wholly before wallet construction. EN-7 remains first because a
retry asks for the result of an already accepted operation; changing account or
round state cannot retroactively invalidate it.

### 4. Cooldown uses authoritative tick timestamps

After any settlement, a candidate entry tick at `t_e` is cooling off while:

```text
t_e < settlementTick.t + reentryCooldownMs
```

The Phase 1.5 value is 900 ms and equality is accepted. `lastResult.tick` is the
authority record, so the engine needs no clock or timer and the client's 900 ms
settle-card display delay cannot decide eligibility.

## Consequences

- `OpenRequest` and `Position` carry optional TP/SL; a position also retains
  `lastMultiplier` and its nullable `ascentCause` for deterministic replay and
  audit attribution.
- `EngineConfig` owns leverage, stake, notional, FI-3 and cooldown bounds.
- The Gateway/UI only carry inputs and render engine rejection codes; they do
  not duplicate validation or cooldown logic.
- Tests cover both crossing directions, same-tick SL/crush precedence, no
  immediate settlement, max-win level triggering, every rejection rank,
  idempotent replay, cooldown boundaries, immutability and client wiring.
