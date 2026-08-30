import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { installDom } from './support/dom.js';
import { installMocks, resetSpies } from './support/mocks.js';

/* ================================================================
   GATEWAY — EN-1 is evaluated AFTER the latency leg.

   gateway.js carries a comment claiming this. The claim is load-bearing: if
   the client evaluated the window at send time it would accept entries the
   M2.2 server rejects, and the optimistic mirror would have nothing to
   reconcile to. This file turns the comment into an assertion.

   The mechanism: `now()` is mocked so the test controls the clock, and the
   60 ms `wait()` is driven with fake timers. Between the send and the arrival
   the clock is advanced across the cutoff — so the request is legal when sent
   and late when received, which is exactly the race the criterion is about.
================================================================ */

installDom();
installMocks();

let clock = 0;
vi.mock('../src/util/math.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, now: () => clock };
});

const { Gateway } = await import('../src/core/gateway.js');
const { Engine } = await import('../src/core/engine.js');
const { S } = await import('../src/state/store.js');
const { CFG } = await import('../src/config/constants.js');
const { entryOpen } = await import('../src/core/entry-window.js');

const ROUND_END = 1_000_000;
const CUTOFF = ROUND_END - CFG.ENTRY_CUTOFF_MS;
/** The gateway's simulated one-way latency, from `wait(60)` in gateway.js. */
const LATENCY_MS = 60;

beforeEach(() => {
  vi.useFakeTimers();
  resetSpies();
  S.phase = 'running';
  S.roundEnd = ROUND_END;
  S.lossLocked = false;
  S.lastTick = { t: 0, v: CFG.IDX0 };
  Engine.beginRound();
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Send an open request at `sentAt`, let the clock reach `sentAt + LATENCY_MS`
 * while the latency leg runs, and resolve.
 */
async function sendAt(sentAt, req){
  clock = sentAt;
  const p = Gateway.openPosition(req);
  clock = sentAt + LATENCY_MS;
  await vi.advanceTimersByTimeAsync(LATENCY_MS);
  return p;
}

const REQ = { dir: 1, stake: 500, lev: 10 };

describe('EN-1 is judged at receipt, not at send', () => {
  it('rejects a request sent inside the window that lands after the cutoff', async () => {
    // Sent 10 ms before the hatch seals — legal at the moment of the tap.
    const sentAt = CUTOFF - 10;
    clock = sentAt;
    expect(entryOpen(), 'window must be open at send time').toBe(true);

    const res = await sendAt(sentAt, REQ);

    // Arrived 50 ms after the hatch sealed.
    expect(clock).toBeGreaterThan(CUTOFF);
    expect(res).toEqual({ ok: false, err: 'HATCH SEALED — TOO LATE TO DIVE' });
  });

  it('does not debit the wallet for the late request (EN-1 full non-debit)', async () => {
    const before = S.balance;
    await sendAt(CUTOFF - 10, REQ);
    expect(S.balance).toBe(before);
    expect(S.pos).toBe(null);
  });

  it('accepts a request that both leaves and lands inside the window', async () => {
    const res = await sendAt(CUTOFF - LATENCY_MS - 10, REQ);
    expect(clock).toBeLessThan(CUTOFF);
    expect(res).toEqual({ ok: true });
    expect(S.pos).not.toBe(null);
  });

  it('rejects a request that was already late when sent', async () => {
    const res = await sendAt(CUTOFF + 1000, REQ);
    expect(res.ok).toBe(false);
    expect(res.err).toBe('HATCH SEALED — TOO LATE TO DIVE');
  });

  it('the send-time verdict alone would have accepted it — proving the leg matters', async () => {
    // This is the negative control for the whole file. If the gateway ever
    // moves `entryOpen()` above `await wait(60)`, this expectation still holds
    // but the first test in this block starts failing — which is the point.
    const sentAt = CUTOFF - 10;
    clock = sentAt;
    const verdictAtSend = entryOpen();
    clock = sentAt + LATENCY_MS;
    const verdictAtReceipt = entryOpen();
    expect(verdictAtSend).toBe(true);
    expect(verdictAtReceipt).toBe(false);
  });
});

describe('gateway routes every action through the seam', () => {
  it('cashOut waits the latency leg before asking the engine to ascend', async () => {
    await sendAt(CUTOFF - LATENCY_MS - 10, REQ);
    expect(S.pos.state).toBe('open');

    const p = Gateway.cashOut();
    // Still open: the request has not landed yet.
    expect(S.pos.state).toBe('open');
    await vi.advanceTimersByTimeAsync(LATENCY_MS);
    await p;
    expect(S.pos.state).toBe('ascending');
  });
});
