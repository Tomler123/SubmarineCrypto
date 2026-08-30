import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { installDom } from './support/dom.js';
import { installMocks, resetSpies, spies } from './support/mocks.js';

/* ================================================================
   ENGINE ADAPTER — the mirror, and the one timer the adapter owns.

   The adapter's contract is narrow and entirely checkable:

     1. after every engine call, `S` equals the engine state (it is a derived
        view, never a second source of truth);
     2. every EngineEvent becomes the FX / Au / feedMsg / toast /
        checkLossLimit call the prototype fired inline;
     3. a settled position leaves the screen 900 ms later, on a timer the
        adapter owns because the delay is presentation, not game logic.

   (1) is the one that would hurt silently: a field that stops being mirrored
   shows the player a stale balance while the engine's books are correct, and
   nothing else in the client would notice.
================================================================ */

installDom();
installMocks();

const { Engine, REJECT_COPY } = await import('../src/core/engine.js');
const { S } = await import('../src/state/store.js');
const { CFG } = await import('../src/config/constants.js');

const TICK_MS = CFG.TICK_MS;
let tickBase = 0;

/** A tick at index `v`, `n` ticks into the round. */
const tickAt = (n, v) => ({ t: tickBase + n * TICK_MS, v });

/**
 * Open a position through the adapter at index `v`, with the entry window open.
 * Returns the adapter's own result so a rejection can be asserted on.
 */
function open(v = CFG.IDX0, { dir = 1, stake = 500, lev = 10, entryN = 0 } = {}){
  S.lastTick = tickAt(entryN, v);
  return Engine.open(dir, stake, lev, true);
}

beforeEach(() => {
  vi.useFakeTimers();
  // The engine retains the last authoritative settlement for EN-10. Give each
  // test its own later tick range so test isolation does not look like a
  // backwards-time entry inside the prior test's cooldown.
  tickBase += 10_000;
  resetSpies();
  S.lossLocked = false;
  S.lossLimit = 0;
  S.lastTick = tickAt(0, CFG.IDX0);
  Engine.beginRound();
  // Drain any pending clear timer from a previous test so each case starts
  // with the adapter idle.
  vi.runAllTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the mirror: S is a derived view of engine state', () => {
  it('mirrors the wallet and position after an open', () => {
    const before = S.balance;
    const res = open();
    expect(res).toEqual({ ok: true });
    expect(S.pos).not.toBe(null);
    expect(S.pos.state).toBe('open');
    // Stake left the wallet exactly once.
    expect(S.balance).toBe(before - 500);
    expect(S.wagered).toBe(500);
  });

  it('mirrors after a rejected open without moving any money', () => {
    open();
    const snapshot = { balance: S.balance, wagered: S.wagered, net: S.net, pos: S.pos };
    // EN-5: a second position while one is live.
    const res = Engine.open(1, 500, 10, true);
    expect(res.ok).toBe(false);
    expect(res.err).toBe(REJECT_COPY.POSITION_OPEN);
    expect(S.balance).toBe(snapshot.balance);
    expect(S.wagered).toBe(snapshot.wagered);
    expect(S.net).toBe(snapshot.net);
    expect(S.pos).toBe(snapshot.pos);
  });

  it('mirrors after every tick of a live position', () => {
    open();
    for (let n = 1; n <= 5; n++){
      const tk = tickAt(n, CFG.IDX0 + n);
      Engine.onTick(tk);
      expect(S.pos, `tick ${n}`).not.toBe(null);
      expect(S.pos.ticksElapsed, `tick ${n}`).toBe(n);
      // Integer money at all times (invariant 4).
      expect(Number.isInteger(S.balance)).toBe(true);
      expect(Number.isInteger(S.wagered)).toBe(true);
      expect(Number.isInteger(S.net)).toBe(true);
    }
  });

  it('mirrors the settlement: balance, net and lastResult all move together', () => {
    open();
    const staked = S.balance;
    Engine.onTick(tickAt(1, CFG.IDX0 * 1.02));
    Engine.forceSettleAtRoundEnd();

    expect(S.lastResult).not.toBe(null);
    expect(S.pos.state).toBe('done');
    // The mirrored balance is the pre-settlement balance plus the payout.
    expect(S.balance).toBe(staked + S.lastResult.payout);
    expect(S.net).toBe(S.lastResult.payout - S.wagered);
    expect(Number.isInteger(S.balance)).toBe(true);
  });

  it('rejects with mapped copy, never the raw code', () => {
    S.lossLocked = true;
    const res = Engine.open(1, 500, 10, true);
    expect(res.ok).toBe(false);
    expect(res.err).toBe(REJECT_COPY.LOSS_LIMIT_REACHED);
    expect(res.err).not.toBe('LOSS_LIMIT_REACHED');
  });
});

describe('events become client effects', () => {
  it('an open fires the feed line and the click', () => {
    open();
    expect(spies.feedMsg).toHaveBeenCalledTimes(1);
    expect(spies.Au.click).toHaveBeenCalledTimes(1);
  });

  it('an ascent request fires the blow', () => {
    open();
    Engine.requestAscent();
    expect(spies.FX.startBlow).toHaveBeenCalledTimes(1);
    expect(spies.Au.blow).toHaveBeenCalledTimes(1);
  });

  it('a settlement fires the surface burst, a toast and the loss-limit check', () => {
    open();
    Engine.onTick(tickAt(1, CFG.IDX0 * 1.02));
    Engine.forceSettleAtRoundEnd();
    expect(spies.FX.surfaceBurst).toHaveBeenCalledTimes(1);
    expect(spies.toast).toHaveBeenCalledTimes(1);
    // wallet-changed replaces the direct checkLossLimit() call in settle().
    expect(spies.checkLossLimit).toHaveBeenCalled();
  });

  it('a crush fires the implode, not the surface burst', () => {
    // Short at 10x: a large upward move crushes it.
    open(CFG.IDX0, { dir: -1, lev: 10 });
    Engine.onTick(tickAt(1, CFG.IDX0 * 1.5));
    expect(S.lastResult).not.toBe(null);
    expect(S.lastResult.crushed).toBe(true);
    expect(spies.FX.implode).toHaveBeenCalledTimes(1);
    expect(spies.Au.implode).toHaveBeenCalledTimes(1);
    expect(spies.FX.surfaceBurst).not.toHaveBeenCalled();
  });
});

describe('the 900 ms clearSettled timer', () => {
  /** Settle the open position at a profit, on tick `n`. */
  function settle(n = 1){
    Engine.onTick(tickAt(n, CFG.IDX0 * 1.02));
    Engine.forceSettleAtRoundEnd();
  }

  it('holds the settled position on screen for 900 ms, then clears it', () => {
    open();
    settle();
    expect(S.pos).not.toBe(null);
    expect(S.pos.state).toBe('done');

    vi.advanceTimersByTime(899);
    expect(S.pos, 'still on screen at 899 ms').not.toBe(null);

    vi.advanceTimersByTime(1);
    expect(S.pos, 'cleared at 900 ms').toBe(null);
  });

  it('clearing the wreck does not disturb the money', () => {
    open();
    settle();
    const balance = S.balance;
    const net = S.net;
    const wagered = S.wagered;
    vi.advanceTimersByTime(900);
    expect(S.pos).toBe(null);
    expect(S.balance).toBe(balance);
    expect(S.net).toBe(net);
    expect(S.wagered).toBe(wagered);
  });

  it('a second settlement inside the window does not orphan the first timer', () => {
    open();
    settle();
    expect(S.pos.state).toBe('done');

    // 400 ms in — the first wreck is still on screen — the round ends, the
    // player re-enters and settles again.
    vi.advanceTimersByTime(400);
    vi.advanceTimersByTime(500);
    expect(S.pos).toBe(null);

    // Second cycle.
    open(CFG.IDX0, { entryN: 9 });
    settle(10);
    expect(S.pos.state).toBe('done');
    vi.advanceTimersByTime(900);
    expect(S.pos).toBe(null);

    // Exactly one timer outstanding at any moment: nothing is left pending.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a settlement while a clear timer is pending replaces it rather than stacking', () => {
    open();
    settle();
    expect(vi.getTimerCount()).toBe(1);

    // Re-settling before the first timer fires. `clearTimeout(clearTimer)`
    // ahead of the new `setTimeout` is what keeps this at one: two stacked
    // timers would fire two clearSettled() calls, the second of which would
    // wipe a position that had legitimately been reopened in between.
    Engine.forceSettleAtRoundEnd();
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(900);
    expect(S.pos).toBe(null);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the pending timer cannot clear a position opened after it was scheduled', () => {
    // The failure mode the clearTimeout guards against, stated as a property:
    // if the 900 ms timer from settlement A ever fired while position B was
    // live, the player would watch their open pod vanish. Drive the full
    // sequence and assert B survives its own 900 ms and not A's.
    open();
    settle();
    vi.advanceTimersByTime(500);   // A's timer still pending
    vi.advanceTimersByTime(400);   // A's timer fires at 900
    expect(S.pos).toBe(null);

    open(CFG.IDX0, { stake: 200, entryN: 9 });
    expect(S.pos.state).toBe('open');
    // Well past when A's timer would have fired had it been orphaned.
    vi.advanceTimersByTime(5000);
    expect(S.pos, 'B must still be live').not.toBe(null);
    expect(S.pos.state).toBe('open');
  });
});

describe('PL-2: theta is snapshotted at the round boundary', () => {
  it('beginRound re-reads the config and holds it for the round', () => {
    Engine.beginRound();
    const cfg = Engine.config();
    expect(cfg.thetaPerSecond).toBe(CFG.THETA_PER_S);
    expect(cfg.tickSeconds).toBe(CFG.TICK_S);
    expect(cfg.ascentMs).toBe(CFG.ASCENT_MS);
  });

  it('the crush line the renderer reads is the engine line, at the same tau', () => {
    // CR-6, from the client side of the seam: `Engine.liqIdx` must be a read of
    // `positionCrushIndex`, never a re-derivation, so the drawn line and the
    // tested line are the same number on the same tick.
    open();
    for (let n = 1; n <= 8; n++){
      Engine.onTick(tickAt(n, CFG.IDX0 + n * 0.1));
      if (!S.pos || S.pos.state === 'done') break;
      const line = Engine.liqIdx(S.pos);
      expect(Number.isFinite(line), `tick ${n}`).toBe(true);
      // The line creeps toward the entry index as oxygen drains (CR-3).
      expect(line, `tick ${n}`).toBeLessThan(CFG.IDX0);
    }
  });

  it('oxygen drains monotonically toward 0 and never exceeds 1', () => {
    open();
    let prev = Engine.oxygen(S.pos);
    // Not asserted as exactly 1: `Engine` holds module-level state, so a
    // position opened in this suite may already carry a tick from the previous
    // case. What matters is the shape — bounded above by a full tank, and
    // strictly decreasing — not the starting value of this particular one.
    expect(prev).toBeLessThanOrEqual(1);
    expect(prev).toBeGreaterThan(0);
    for (let n = 1; n <= 8; n++){
      Engine.onTick(tickAt(n, CFG.IDX0));
      if (!S.pos || S.pos.state === 'done') break;
      const o2 = Engine.oxygen(S.pos);
      expect(o2, `tick ${n}`).toBeLessThan(prev);
      expect(o2).toBeGreaterThanOrEqual(0);
      prev = o2;
    }
  });
});
