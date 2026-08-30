import { afterEach, describe, expect, it, vi } from 'vitest';
import { installDom } from './support/dom.js';
import { installMocks } from './support/mocks.js';

installDom();
installMocks();
vi.useFakeTimers();

const { Gateway } = await import('../src/core/gateway.js');
const { Engine } = await import('../src/core/engine.js');
const { S } = await import('../src/state/store.js');
const { CFG } = await import('../src/config/constants.js');

afterEach(() => {
  if (S.pos && S.pos.state !== 'done') Engine.forceSettleAtRoundEnd();
  vi.runAllTimers();
});

describe('AO-1 — Gateway carries immutable entry auto orders', () => {
  it('snapshots TP/SL on the position after the request latency', async () => {
    S.phase = 'running';
    S.roundEnd = 100_000;
    S.lossLocked = false;
    S.lastTick = { t: 0, v: CFG.IDX0 };
    Engine.beginRound();

    const pending = Gateway.openPosition({
      dir: 1,
      stake: 500,
      lev: 10,
      takeProfit: 1.2,
      stopLoss: 0.8,
    });
    await vi.advanceTimersByTimeAsync(60);
    const result = await pending;

    expect(result).toEqual({ ok: true });
    expect(S.pos.takeProfit).toBe(1.2);
    expect(S.pos.stopLoss).toBe(0.8);
  });
});
