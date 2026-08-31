import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const feedMsg = vi.fn();
const publishCloseCall = vi.fn();
const randomValues = [
  0,
  0.01, 0, 0, 0.2, 0.6, 0,
  0.11, 0, 0, 0.2, 0.6, 0,
  0.21, 0, 0, 0.2, 0.6, 0,
  0.31, 0, 0, 0.2, 0.6, 0,
  0.41, 0, 0, 0.2, 0.6, 0,
];
let randomIndex = 0;

vi.mock('../src/ui/feed.js', () => ({ feedMsg }));
vi.mock('../src/util/random.js', () => ({ rnd: () => randomValues[randomIndex++] ?? 0 }));
vi.mock('../src/core/close-calls.ts', () => ({
  closeCallFeed: { publish: publishCloseCall },
}));

const botsModule = await import('../src/core/bots.js');
const { botsTick, spawnBots } = botsModule;

beforeEach(() => {
  feedMsg.mockClear();
  publishCloseCall.mockClear();
  randomIndex = 0;
  spawnBots(0);
});

describe('CC-8 — fake actors consume real engine events', () => {
  it('opens an isolated @crush/engine position for every fake actor', () => {
    botsTick({ t: 0, v: 1_000 });
    expect(botsModule.bots).toHaveLength(5);
    for (const bot of botsModule.bots) {
      expect(bot.engineState.position).toMatchObject({
        state: 'open',
        entry: 1_000,
        lev: 10,
      });
    }
  });

  it('publishes engine-emitted Close Calls after ascent exposure', () => {
    botsTick({ t: 0, v: 1_000 });
    botsTick({ t: 125, v: 904.5 });
    botsTick({ t: 2_500, v: 1_000 });
    botsTick({ t: 3_000, v: 1_000 });

    expect(publishCloseCall).toHaveBeenCalledTimes(5);
    for (const call of publishCloseCall.mock.calls) {
      expect(call[0]).toMatchObject({ kind: 'close-call' });
    }
  });

  it('contains no client-side outcome formula or money rounding', () => {
    const source = readFileSync(resolve(process.cwd(), 'apps/client/src/core/bots.js'), 'utf8');
    expect(source).toContain("from '@crush/engine'");
    expect(source).not.toMatch(/Math\.round|const\s+liq\s*=|const\s+mult\s*=|\bstake\s*\*\s*mult/);
  });
});
