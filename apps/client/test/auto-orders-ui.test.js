import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDom } from './support/dom.js';
import { installMocks } from './support/mocks.js';

installDom();
installMocks();

const { tryOpen } = await import('../src/ui/console.js');
const { Engine } = await import('../src/core/engine.js');
const { S } = await import('../src/state/store.js');
const { CFG } = await import('../src/config/constants.js');
const { setAutoEnabled } = await import('../src/ui/auto-orders.ts');

const tpInput = document.querySelector('#takeProfitIn');
const slInput = document.querySelector('#stopLossIn');
const message = document.querySelector('#consoleMsg');

let tickBase = 0;

beforeEach(() => {
  vi.useFakeTimers();
  tickBase += 10_000;
  S.phase = 'running';
  S.roundEnd = 100_000;
  S.lossLocked = false;
  S.pos = null;
  S.armed = null;
  S.stake = 500;
  S.lev = 10;
  S.lastTick = { t: tickBase, v: CFG.IDX0 };
  // The AUTO switch gates submission, so these cases opt in explicitly. Turning
  // it on seeds defaults; the individual cases overwrite them.
  setAutoEnabled(true);
  tpInput.value = '';
  slInput.value = '';
  message.textContent = '';
});

afterEach(() => {
  if (S.pos && S.pos.state !== 'done') Engine.forceSettleAtRoundEnd();
  vi.runAllTimers();
  vi.useRealTimers();
});

async function submit() {
  const pending = tryOpen(1);
  await vi.advanceTimersByTimeAsync(60);
  await pending;
}

describe('M1.5 auto-order entry controls', () => {
  it('passes optional TP/SL through Gateway and snapshots them on the position', async () => {
    tpInput.value = '1.20';
    slInput.value = '0.80';

    await submit();

    expect(S.pos.takeProfit).toBe(1.2);
    expect(S.pos.stopLoss).toBe(0.8);
  });

  it('lets the engine reject an invalid TP and displays its exact copy', async () => {
    tpInput.value = '1.10';

    await submit();

    expect(S.pos).toBe(null);
    expect(message.textContent).toBe('TAKE-PROFIT TOO CLOSE');
  });

  it('preserves TP/SL when a bet is armed for launch', async () => {
    S.phase = 'waiting';
    tpInput.value = '1.20';
    slInput.value = '0.80';

    await tryOpen(-1);

    expect(S.armed).toMatchObject({ dir: -1, stake: 500, lev: 10, takeProfit: 1.2, stopLoss: 0.8 });
  });

  it('sends no auto-orders while the AUTO switch is off, even with values left in the fields', async () => {
    tpInput.value = '1.20';
    slInput.value = '0.80';
    setAutoEnabled(false);

    await submit();

    expect(S.pos.takeProfit).toBeUndefined();
    expect(S.pos.stopLoss).toBeUndefined();
  });
});
