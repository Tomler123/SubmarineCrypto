# Manual test script — M1.4 (oxygen, tick-derived τ, round timings, entry cutoff)

**Build under test:** `main` at M1.4 · **Run with:** `npm install` then `npm run dev` → http://localhost:5173

**Tester:** ______________ **Date:** ____________ **Browser / device:** ____________________

This is a hand-executed checklist. Every step has one exact expected result and the
acceptance-criteria id it exercises. Mark **P** (matches the expected result exactly),
**F** (does not), or **N/A**. A step that "roughly looks right" is an **F** — the
numbers below are given so you can check the screen against arithmetic rather than
against an impression.

Automated coverage already asserts the engine-side maths (126 tests, 100 % on
`packages/*`). What this script tests is the half the unit tests structurally
cannot reach: that the *client* shows the engine's numbers, at the right moment,
on a real clock.

## Before you start

- Open DevTools (F12) and keep the **Console** tab visible. Several steps use it.
- Have a **stopwatch** (a phone is fine — you need 0.1 s resolution readable at a glance).
- Have a way to **record the screen** for steps 4.3 and 5.2 (Windows: `Win+Alt+R`).
  Frame-stepping a recording is the only reliable way to time a 500 ms event by hand.
- Reload the page (`Ctrl+Shift+R`) before starting. Several steps depend on a fresh
  session clock and a fresh `$1,000.00` balance.

### Constants in force (mirror of `apps/client/src/config/constants.js`)

| Symbol | Value | Where |
|---|---|---|
| θ (oxygen) | 0.0025 /s = 0.25 %/s | `CFG.THETA_PER_S` |
| tick | 125 ms (8 Hz) | `CFG.TICK_MS` / `CFG.TICK_S = 0.125` |
| round `running` | 90 000 ms | `CFG.ROUND_MS` |
| intermission `waiting` | 8 000 ms | `CFG.WAIT_MS` |
| entry cutoff | T−5 000 ms | `CFG.ENTRY_CUTOFF_MS` |
| ascent | 500 ms | `CFG.ASCENT_MS` |
| interp buffer | 150 ms | `CFG.DELAY_MS` |

---

## 1 — UI-4: the O₂ gauge drains at θ, and the crush line creeps

The gauge is `oxygenFraction = 1 − θτ`, clamped to [0,1], where
**τ = ticksElapsed × 0.125 s** (PL-1). It is the engine's own value for the open
position (`Engine.oxygen(p)`), rendered as the width of `#o2Fill` — the thin bar
along the bottom edge of the CASH OUT button.

### The arithmetic to check against the screen

τ is a tick count, so the exact figures are the tick-boundary ones. The engine
advances τ once per tick at the top of `onTick`, so at wall-clock time *t*
seconds after your entry tick, `ticks = floor(t / 0.125)`.

| Wall-clock since entry | τ (ticks) | τ (s) | O₂ fraction `1 − 0.0025·τ` | Bar width | Drained |
|---|---|---|---|---|---|
| 10 s | 80 | 10.000 | 0.9750 | **97.50 %** | 2.50 % |
| 30 s | 240 | 30.000 | 0.9250 | **92.50 %** | 7.50 % |
| 60 s | 480 | 60.000 | 0.8500 | **85.00 %** | 15.00 % |

Read the bar width numerically, not by eye — a 2.5 % drain is invisible at a
glance, and that is exactly why this step exists. In the DevTools Console:

```js
document.getElementById('o2Fill').style.width
```

That returns the string the client wrote, e.g. `"97.50%"` — the code formats it
with `toFixed(2)`, so you can compare it to the table digit for digit.

**Tolerance:** ±0.25 % absolute (two ticks of τ either side), to absorb the gap
between when you read the stopwatch and when the tick landed. A reading that is
off by more than that — and especially one that drifts *further* off as the round
runs — is a fail: it means the gauge is running on a clock rather than on ticks.

| # | Step | Expected result | AC | P/F |
|---|---|---|---|---|
| 1.1 | Wait for a round to reach `running`. Open a Surface position at $5.00 ×10. Start the stopwatch on the same tap. | A position opens; the CASH OUT button appears with a full-width teal bar along its bottom edge. | UI-4 | |
| 1.2 | Immediately (< 1 s in) run `document.getElementById('o2Fill').style.width` in the Console. | Reads `"100.00%"`, or within a tick or two of it (`"99.75%"` / `"99.50%"`). At the entry tick τ = 0 and M = 1 exactly. | UI-4, PL-1 | |
| 1.3 | At stopwatch **10.0 s**, run the same Console command. | **`"97.50%"`** ±0.25. | UI-4 | |
| 1.4 | At stopwatch **30.0 s**, run it again. | **`"92.50%"`** ±0.25. | UI-4 | |
| 1.5 | At stopwatch **60.0 s**, run it again. | **`"85.00%"`** ±0.25. | UI-4 | |
| 1.6 | Compare the three readings to each other: 1.4 minus 1.3, and 1.5 minus 1.4. | Drain is **5.00 %** over 20 s and **7.50 %** over 30 s — a constant 0.25 %/s. The rate must not accelerate or stall. | UI-4, PL-1 | |
| 1.7 | While the position is still open, read the crush figure in the position strip (`entry NNNN.N · crush NNNN.N`). Note it. Wait 30 s and read it again. | The crush number has moved **toward** the entry index — for a Surface position it rises, for a Dive position it falls. It never moves away. | UI-4, CR-3 | |
| 1.8 | Quantify 1.7 for a Surface ×10 position. The line is `I_e·(1 − (1 − θτ)/L)`. With `I_e = 1000` and L = 10 that is `1000 − 100·(1 − 0.0025τ)` = 900 at τ=0, **907.5 at τ=30 s**, **915.0 at τ=60 s**. Scale by your actual `I_e / 1000`. | The displayed crush figure matches that arithmetic to the displayed decimal. It creeps **+0.25 index points per second at ×10 on a 1000 entry** — 7.5 points over 30 s. | CR-3 | |
| 1.9 | Watch the scene (not the console strip) for the same 30 s with a position open. | The drawn crush line visibly closes on the sub over the round — a line moving toward the vessel, not a static one. | UI-4, CR-3 | |
| 1.10 | Rotate to landscape / resize the window narrow (≈360 px) and wide, with a position open. | Entry line, crush line and O₂ bar all remain visible at every size. Nothing is clipped off-screen or overlapped into illegibility. | UI-4 | |

> **Known cosmetic gap, not a bug to file:** the button's `lowO2` amber state
> triggers at O₂ < 0.35, which at θ = 0.25 %/s needs τ = 260 s. A 90 s round can
> never reach it. The threshold is correct for some *possible* future θ but is
> dead code at today's value. Note it and move on — it is a tuning question for
> M1.7, not an M1.4 defect. Record whether you agree it should be re-scaled: ______

---

## 2 — EN-1: the hatch seals at exactly T−5 s

The buttons are gated by `entryOpen()`; the countdown text is
`entrySecondsLeft().toFixed(1)`, shown only in the last 10 s. Both read the same
`S.roundEnd − 5000` boundary, so they cannot disagree — this step proves the
screen agrees with them.

| # | Step | Expected result | AC | P/F |
|---|---|---|---|---|
| 2.1 | With no position and nothing armed, watch a `running` round from about T−15 s. | Below the bet buttons, at exactly **10.0 s remaining in the entry window** (round timer 15 s), a line appears: `HATCH SEALS IN 10.0S`. Before that the line is blank. | EN-1 | |
| 2.2 | Watch that countdown against the round timer at the top of the screen. | The hatch countdown always reads **round timer minus 5.0 s**, to one decimal, throughout. Round timer 12 s → hatch ≈ 7.0 s. | EN-1 | |
| 2.3 | Watch the moment it reaches 0. | At the instant the round timer passes 5 s, the text changes to **`HATCH SEALED · NO NEW DIVES`** and both SURFACE and DIVE become disabled (greyed, non-interactive). Both happen on the same frame — the buttons must not stay live for even a moment after the text changes. | EN-1 | |
| 2.4 | Tap SURFACE repeatedly during the final 5 s. | Nothing happens: no position opens, no stake leaves the balance, no error toast. The balance figure is unchanged after the round settles. | EN-1, EN-3 | |
| 2.5 | Verify the countdown against the source of truth. Paste into the Console during the last 10 s: `import('/src/core/entry-window.js').then(m=>console.log(m.entrySecondsLeft().toFixed(1), document.getElementById('hatchMsg').textContent))` | The number returned by `entrySecondsLeft()` matches the number in the on-screen text (±0.1 for the frame gap). The screen is not showing a second, independently-computed countdown. | EN-1 | |
| 2.6 | During the sealed window tap SURFACE; then wait for the next round's `waiting` phase and tap SURFACE again. | The tap during `waiting` **arms** a bet (`▲ $5.00 ×10 — opens at launch`) rather than being rejected. An armed bet is not an entry; it executes at launch, inside the window. | EN-1 | |
| 2.7 | Let that armed bet run into launch. | The position opens at launch with a normal entry price. It is not rejected as `HATCH SEALED`. | EN-1 | |

---

## 3 — RL-2: 90 s running, 8 s intermission, on a stopwatch

`RL-2` allows ±1 tick (125 ms) on the round; treat ±0.4 s as your practical
hand-timing tolerance and record the raw number either way.

| # | Step | Expected result | AC | P/F |
|---|---|---|---|---|
| 3.1 | Start the stopwatch the moment the round timer at the top first shows a counting value (phase enters `running`); stop it when the timer hits 0 / the phase leaves `running`. | **90.0 s** ±0.4 s. Record actual: __________ | RL-2 | |
| 3.2 | Cross-check without the stopwatch: read the round timer at the start of `running`. | It reads **`90s`** and counts down monotonically to `0s`. | RL-2 | |
| 3.3 | Time the `waiting` phase: start the stopwatch when the `NEXT DIVE` countdown appears, stop it when it reaches 0 / `launching` begins. | **8.0 s** ±0.4 s, and the on-screen `NEXT DIVE` number starts at ≈ **8.0** and counts down by tenths. Record actual: __________ | RL-2 | |
| 3.4 | Time one **complete** cycle: `running` start → next `running` start. | ≈ **104.5 s** — 90 s running + 0.9 s `ending` + 4.2 s `settling` + 8.0 s `waiting` + 1.4 s `launching`. Record actual: __________ | RL-2 | |
| 3.5 | Note whether 3.4 surprises you. | *Not pass/fail.* RL-2 specifies the 90 s round and the 8 s intermission; it does not name the ending/settling/launching phases, so the real gap between rounds is ~14.5 s, not 8 s. Record whether that gap feels too long: __________ | RL-2 | |

---

## 4 — CO-1: the Blow takes 500 ms and stays lethal throughout

`CO-1` settles at the first tick ≥ `t_r + 500 ms`, so the observed settlement
lands in **[500, 625) ms** after the tap. That is a range, not a point — a
settlement at 610 ms is a pass, one at 700 ms is a fail.

| # | Step | Expected result | AC | P/F |
|---|---|---|---|---|
| 4.1 | Open a position. Tap CASH OUT once. | The button immediately switches to **`BLOWING BALLAST`** with an ascending style; the O₂ bar turns bright teal. | CO-1 | |
| 4.2 | During that ascent, tap CASH OUT again, several times. | Nothing changes. No second settlement, no error, no double payout. The ascent runs to completion exactly once. | CO-3, CO-2 | |
| 4.3 | Record the screen at ≥ 30 fps. Cash out. Step through the recording from the frame the label changes to `BLOWING BALLAST` to the frame the settled banner/toast appears. | Elapsed **between 500 ms and 625 ms**. At 30 fps that is 15–19 frames; at 60 fps, 30–37 frames. Record actual: __________ ms | CO-1 | |
| 4.4 | Repeat 4.3 twice more and compare. | All three land inside [500, 625) ms, and the spread between them is under ~125 ms — one tick. | CO-1 | |
| 4.5 | **Cash out into a falling index.** Open a **Surface** ×25 position and wait until the index is dropping steadily and the live payout is red and falling. Tap CASH OUT at that moment. | The ascent still runs the full 500 ms, and the payout keeps falling *during* the ascent — the number you settle at is worse than the number you tapped at. It does not freeze at tap time. | CO-1, CO-4, PL-3 | |
| 4.6 | Repeat 4.5 at ×25 as close to the crush line as you dare — tap CASH OUT when the crush figure is within ~1 % of the live index and still closing. | It is possible to be **CRUSHED during the ascent**: the position settles at 0 despite having tapped cash out. This is the correct behaviour — crush takes precedence over ascent settlement on the same tick. If you cannot make it happen in ~10 attempts, record "not reproduced" rather than pass. | CO-1, CR-4 | |
| 4.7 | For any 4.5/4.6 run, compare the payout figure on the button in the last visible frame before settlement to the settled amount in the toast/feed. | They may differ slightly. The **settled** figure is the one that moved the balance; the live figure is presentation only. | CO-4, UI-2 | |

---

## 5 — UI-2: 60 fps live, tick-value settled

| # | Step | Expected result | AC | P/F |
|---|---|---|---|---|
| 5.1 | With a position open, watch the live payout / multiplier on the CASH OUT button. | It moves **smoothly and continuously**, not in visible 8 Hz steps. The index readout at the top likewise. | UI-2, PF-1 | |
| 5.2 | Record the screen. Cash out. Compare the payout figure on the button in the final frames of the ascent against the amount in the settled toast (`SURFACED +$X.XX`) and the feed line. | The settled amount is the **tick** value. It is allowed to differ from the last interpolated frame by up to one tick of index movement; it must equal the amount the balance actually changed by. | UI-2, CO-4 | |
| 5.3 | Note the balance before the tap and after settlement. Subtract. | The difference equals `stake + pnl` from the settled toast **exactly**, to the cent. No rounding drift. | UI-2, UI-3, PL-4 | |
| 5.4 | Open DevTools → Performance (or the FPS meter in the Rendering panel) and record ~10 s of a `running` round with a position open. | Median ≈ 60 fps. Sustained under 45 fps is a fail against PF-1 — record the figure: __________ | PF-1 | |

---

## 6 — UI-1: no lookahead

| # | Step | Expected result | AC | P/F |
|---|---|---|---|---|
| 6.1 | Watch the scene during a `running` round, looking specifically at the terrain and the index curve **to the right of the sub** (ahead of the present moment). | Terrain ahead is cosmetic scenery only. There is no index curve, price line, marker or shading to the right of the current position that turns out to predict the next tick. | UI-1 | |
| 6.2 | Watch a round to its end, then compare what was drawn to the right of the sub 5 s before a large index move against where the index actually went. | No correlation. The scenery ahead does not encode the coming move. | UI-1 | |
| 6.3 | In the Console, run `Object.keys(await import('/src/state/store.js').then(m=>m.S))` and inspect the store. | No field holds a future tick, a scheduled price, or a precomputed outcome. `S.lastTick` is the most recent tick; there is no `nextTick`. | UI-1 | |
| 6.4 | Check the history strip / settle card. | Shows only rounds that have already settled. No pending or upcoming round has any value shown. | UI-1, FA-4 | |
| 6.5 | With a position open, note the index readout and the sub's drawn depth. | The rendered value lags the authoritative tick by the 150 ms buffer — presentation is **behind** the feed, never ahead of it. | UI-1, PF-2 | |

---

## 7 — UI-5: the math sheet within two taps

| # | Step | Expected result | AC | P/F |
|---|---|---|---|---|
| 7.1 | From the default playing screen, count the taps to reach the payout math sheet. | **One tap**: the small `i` button beside the index readout opens `HOW PAYOUTS WORK` directly. Within the two-tap budget. | UI-5 | |
| 7.2 | Repeat 7.1 in each phase: `waiting`, `launching`, `running` (no position), `running` (position open), `settling`. | Reachable in ≤ 2 taps in **every** phase — including with a position open and mid-ascent. UI-5 says "at all times". | UI-5 | |
| 7.3 | Read the sheet's content against what the build now does. | **Expected to FAIL — see the gap note below.** The sheet must state the payout formula *including* the θ term, the value of θ, the ascent rule and the crush rule. | UI-5 | |
| 7.4 | Close the sheet (× or tap the scrim). | Closes cleanly, returns to play, no state lost, position unaffected. | UI-5 | |

> **Recorded gap — the math sheet is stale as of M1.4.** `apps/client/index.html`
> still shows the pre-oxygen formula `payout = stake × (1 + lev × Δ% × dir)` with
> no `− θτ` term, describes the crush line as a static `1 / leverage` move with no
> creep, and closes with *"No house edge is applied in this build."* That last
> line is now false: M1.4 added the sole house edge. UI-5 requires the sheet to
> state the formula, θ, the ascent rule and the crush rule — so **7.3 is a genuine
> fail against UI-5, not a documentation nicety.** It is also the one player-facing
> statement in the build that is actively untrue, which makes it the highest-priority
> item coming out of this run. Log it; do not fix it during the test pass.

---

## 8 — RP-1 and RP-3: session clock and the reality check

| # | Step | Expected result | AC | P/F |
|---|---|---|---|---|
| 8.1 | Look at the top bar in every phase, with and without a position open, and with the math and limits sheets open. | The session clock is **always visible** and never covered, hidden or collapsed. It counts up in real time from page load. | RP-1 | |
| 8.2 | Note the session clock, wait 60 s, note it again. | Advanced by exactly 60 s. It tracks wall-clock session time, not rounds played. | RP-1 | |
| 8.3 | Reload the page and check the clock. | Restarts from 00:00. Session-scoped is correct for this build; server-side persistence is a Phase 3 item (RP-4). | RP-1 | |

### Triggering the reality check without waiting 15 minutes

The next reality-check deadline lives in `S.nextRC` (milliseconds since
`S.sessionStart`), checked once per second by the interval in
`apps/client/src/ui/responsible.js`. Set it to zero and the modal fires on the
next tick of that interval:

```js
const { S } = await import('/src/state/store.js');
S.nextRC = 0;
```

The handler then adds 15 minutes to `S.nextRC`, so the *next* one is a real 15
minutes away — re-run the snippet to fire it again. To confirm the real cadence
rather than the shortcut, run `S.nextRC = 60000` instead and leave the tab open
for a minute; it should fire once, unprompted, at the one-minute mark (step 8.10).

| # | Step | Expected result | AC | P/F |
|---|---|---|---|---|
| 8.4 | Run the `S.nextRC = 0` snippet above during `waiting`. | Within ~1 s the **REALITY CHECK** modal appears over the game, showing session time, wagered and net result. | RP-3 | |
| 8.5 | Check the three figures on the modal against the limits sheet and the top bar. | Session time matches the top-bar clock; wagered and net match the session totals. Net is signed and coloured (green positive, red negative). | RP-3 | |
| 8.6 | With the modal up, try to play: tap SURFACE, tap DIVE, tap CASH OUT, tap the stake steppers, tap a leverage option. | **None of them do anything.** Play cannot continue until the modal is acknowledged. If any control responds through the modal, this is a fail — see the note below. | RP-3 | |
| 8.7 | Tap **Continue**. | Modal closes; play resumes normally; the round underneath was unaffected. | RP-3 | |
| 8.8 | Fire it again (`S.nextRC = 0`) and this time tap **Set limits**. | Modal closes and the limits sheet opens with current figures refreshed. The reality check still counts as acknowledged. | RP-3, RP-2 | |
| 8.9 | Fire it mid-round with a **position open**, and let the round run while the modal is up. | *Record what happens.* The position continues to be managed by the engine — ticks keep arriving, oxygen keeps draining, crush still applies. The modal must not freeze the position or advantage it. Note whether being blocked from cashing out while the modal is up feels acceptable: __________ | RP-3, MF-4 | |
| 8.10 | Run `S.nextRC = 60000` and leave the tab focused for 70 s without touching anything. | The modal fires once, on its own, at ~60 s. This proves the interval fires unprompted, i.e. the real 15-minute cadence works. | RP-3 | |

> **Watch 8.6 closely.** The modal blocks play by covering the screen — it is a
> `.show` overlay, not a disabled-input state. If that overlay does not actually
> capture pointer events across the whole viewport, a tap could reach a control
> underneath it and RP-3's "play cannot continue until acknowledged" would be
> satisfied only visually. Test every control listed, not just one.

---

## 9 — MF-1: what actually happens if the feed stops (known gap)

**MF-1 is specified and unimplemented.** The engine declares the `ROUND_ABORTED`
reject code and the copy `DIVE ABORTED — SIGNAL LOST`, but nothing can emit it
yet: the simulated source never stops on its own, and there is no staleness
watchdog. MF-1 proper is M2.1 work (real feed plus outage abort).

This section is therefore **not pass/fail**. Its job is to record the *actual*
observed behaviour of today's build, so the M2.1 implementation has a documented
baseline to change and so a reviewer of this file is not left guessing whether
MF-1 was tested and passed.

To stop the feed by hand:

```js
const { source } = await import('/src/feed/index.js');
source.halt();
```

| # | Step | Record the observed behaviour (not P/F) | AC |
|---|---|---|---|
| 9.1 | With a position open mid-round, run `source.halt()`. Observe for 15 s. | Index readout: ______________ · Sub motion: ______________ · O₂ bar: ______________ · Live payout: ______________ | MF-1 |
| 9.2 | Does any "SIGNAL LOST" / abort state appear anywhere on screen? | Expected: **no**. Record actual: ______________________ | MF-1 |
| 9.3 | Does the round timer keep counting down, and does the round end normally? | Expected: **yes** — the round machine runs on the clock, not on ticks. Record actual: ______________________ | MF-1, RL-1 |
| 9.4 | What settles the open position, and at what value? | Expected: it auto-surfaces at round end (RL-4) at the last value it saw, since no ticks arrived to advance τ or crush it. Record actual: ______________________ | MF-1, RL-4 |
| 9.5 | Does τ / the O₂ bar keep draining while no ticks arrive? | Expected: **no** — τ is a tick count, so a dead feed costs the player no oxygen. This is correct behaviour and worth confirming explicitly: it is the visible consequence of the tick-derived-τ rule. Record actual: ______________________ | MF-1, PL-1 |
| 9.6 | Try to open a new position while halted. | Record the rejection copy, if any: ______________________ (`STANDBY — NO ENTRY PRICE YET` would indicate `NO_PRICE`, which per EN-9 is correctly *not* an outage.) | EN-9 |

**Conclusion to record:** the client currently has **no feed-outage detection at
all**. A stopped feed presents as a frozen scene with a normally-running round
clock. Nothing is alarmed, nothing aborts, and no player-facing state
distinguishes it from a perfectly flat market. That is the gap M2.1 closes. It
is *not* a bug to file against M1.4.

---

## 10 — Does 90 s feel right?

The roadmap flagged this as an open decision: the code ran **75 s** through
Phase 1; the spec argues **90 s** because mid-round entry needs room to breathe.
M1.4 moved the code to 90 s. **Playing it is how this gets settled** — and if
75 s turns out to feel better, we change *the spec*, not the code, and version
the change (game logic §3 and §12, and `RL-2`).

Play at least **six full rounds** before answering, and play them properly: real
decisions, varied leverage, some rounds where you deliberately hold too long.

### What to pay attention to

1. **The dead middle.** Around T+30 s to T+55 s, is there a stretch where nothing
   is being decided — where you are waiting rather than playing? A dead middle is
   the specific failure mode 90 s risks, and it is what 75 s would cut. If you
   catch yourself checking the round timer during that window, that is the signal.
2. **Whether mid-round entry actually gets used.** 90 s exists to make mid-round
   entry meaningful. Count it: of your six rounds, how many did you enter *after*
   launch rather than arming at intermission? If the answer is near zero, the
   extra 15 s is not buying the thing it was bought for.
3. **How a full-length hold feels.** Hold one position from an early entry all the
   way to auto-surface at round end. Is 80+ seconds of continuous tension
   sustaining, or exhausting? The oxygen drain over that span is only 20 % of the
   multiplier — the pressure has to come from the index, not from θ.
4. **Re-entry rhythm.** After a crush at T+20 s, how does the remaining 70 s feel?
   Long enough for a considered second entry, or a punishment for dying early?
   (Note: the re-entry cooldown is M1.5 and is not in this build, so what you feel
   here is the unconstrained case.)
5. **The whole cycle, not just the round.** From step 3.4, the actual gap between
   rounds is ~14.5 s, not 8 s. A 90 s round in a ~104 s cycle is ~35 rounds/hour
   against the spec's stated ~37. If 90 s feels slightly long, check whether the
   real complaint is the 14.5 s of downtime rather than the round itself — those
   are two different fixes and only one of them is this decision.
6. **The cutoff's placement.** At 90 s, T−5 s is the last 5.6 % of the round; at
   75 s it would be 6.7 %. Does the sealed window feel like a meaningful final
   phase or an afterthought?

### Verdict

| Question | Answer |
|---|---|
| Rounds played for this assessment | __________ |
| Of those, entries made *after* launch | __________ |
| Is there a dead middle? | Yes / No — where: __________ |
| **90 s, 75 s, or something else?** | __________ |
| If not 90 s: what number, and what specifically does it fix? | __________ |
| Is the complaint actually the ~14.5 s inter-round gap? | Yes / No |

**If the answer is not 90 s:** do not change `CFG.ROUND_MS` first. Open an ADR
under `docs/decisions/`, amend game logic §3 and §12 and `RL-2` to the new value
with the reasoning above as evidence, bump the spec version, and *then* change
the constant. The constant follows the spec; it does not lead it.

---

## Result summary

| Section | AC ids | Steps | Pass | Fail | Notes |
|---|---|---|---|---|---|
| 1 — Oxygen gauge & creeping line | UI-4, CR-3, PL-1 | 10 | | | |
| 2 — Entry cutoff | EN-1 | 7 | | | |
| 3 — Round timings | RL-2 | 5 | | | |
| 4 — The Blow | CO-1, CO-2, CO-3, CO-4, CR-4 | 7 | | | |
| 5 — Live vs settled | UI-2, UI-3, PF-1 | 4 | | | |
| 6 — No lookahead | UI-1 | 5 | | | |
| 7 — Math sheet | UI-5 | 4 | | | 7.3 expected fail |
| 8 — Responsible play | RP-1, RP-3 | 10 | | | |
| 9 — Feed stop | MF-1 | 6 | n/a | n/a | recorded as known gap |
| 10 — Round-length feel | RL-2 (spec decision) | — | — | — | verdict: __________ |

**Known gaps going in (do not file as M1.4 bugs):**

1. **Math sheet is stale (UI-5)** — no θ term, and it states "No house edge is
   applied in this build", which M1.4 made false. A genuine UI-5 fail; fix next.
2. **MF-1 unimplemented** — no feed-outage detection; M2.1 scope.
3. **`lowO2` threshold unreachable** — the amber state needs τ = 260 s at
   θ = 0.25 %/s; a 90 s round cannot reach it. Re-scale alongside M1.7's θ
   calibration.

**Blocking issues found this run:** ______________________________________________

**Tester sign-off:** ____________________ **Date:** ____________
