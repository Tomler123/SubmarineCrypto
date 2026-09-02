import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const FEED_INDEX = resolve(process.cwd(), 'apps/client/src/feed/index.js');
const CLIENT_SRC = resolve(process.cwd(), 'apps/client/src');

function sourceFiles(directory){
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.js') ? [full] : [];
  });
}

describe('FI-13 — client source selection stays inside the feed seam', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.resetModules(); });
  afterEach(() => { vi.useRealTimers(); });

  it('keeps SimulatedIndexSource as the normal/default client source', async () => {
    const { createIndexSource } = await import('../src/feed/index.js');
    const { SimulatedIndexSource } = await import('../src/feed/SimulatedIndexSource.js');
    expect(createIndexSource('')).toBeInstanceOf(SimulatedIndexSource);
  });

  it('selects the recorded fixture only through ?feed=replay', async () => {
    const { ReplayIndexSource } = await import('@crush/feed');
    const { createIndexSource } = await import('../src/feed/index.js');
    expect(createIndexSource('?feed=replay')).toBeInstanceOf(ReplayIndexSource);
  });

  it.each([
    ['flash-crash', 1_621_430_420_000],
    ['calm', 1_621_382_400_000],
  ])('resolves fixture=%s to its recorded BTC interval', async (fixture, openingTimestamp) => {
    const { createIndexSource } = await import('../src/feed/index.js');
    const replay = createIndexSource(`?feed=replay&fixture=${fixture}`);
    const ticks = [];
    replay.onTick((tick) => ticks.push(tick));

    replay.resetRound();
    vi.advanceTimersByTime(90_125);

    expect(ticks[0].t).toBe(openingTimestamp);
    expect(ticks.at(-1).t - ticks[0].t).toBeGreaterThanOrEqual(90_000);
  });

  it('uses flash-crash as the documented fallback for an omitted or unknown fixture', async () => {
    const { selectReplayFixtureName } = await import('../src/feed/index.js');
    expect(selectReplayFixtureName('?feed=replay')).toBe('flash-crash');
    expect(selectReplayFixtureName('?feed=replay&fixture=unknown')).toBe('flash-crash');
  });

  it('enables epoch-to-page timestamp mapping only for the replay selection', async () => {
    const { createPresentationBuffer } = await import('../src/feed/index.js');
    const epochTick = { t: 1_621_430_420_000, v: 1_000, ret: 0 };
    const replayBuffer = createPresentationBuffer('?feed=replay&fixture=calm', () => 4_000);
    const simulatedBuffer = createPresentationBuffer('', () => 4_000);

    replayBuffer.push(epochTick);
    simulatedBuffer.push(epochTick);

    expect(replayBuffer.a[0].t).toBe(4_000);
    expect(simulatedBuffer.a[0]).toBe(epochTick);
  });

  it('does not leak a concrete replay source name outside feed modules', () => {
    for (const file of sourceFiles(CLIENT_SRC)){
      if (file.startsWith(resolve(process.cwd(), 'apps/client/src/feed'))) continue;
      expect(readFileSync(file, 'utf8')).not.toContain('ReplayIndexSource');
    }
    expect(readFileSync(FEED_INDEX, 'utf8')).toContain('ReplayIndexSource');
  });
});
