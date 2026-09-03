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

describe('FI-13/FI-21 — client source selection stays inside the feed seam', () => {
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
    ['upper-limit', 1_700_000_000_000],
    ['lower-limit', 1_700_000_101_000],
    ['constant', 1_700_000_202_000],
  ])('resolves fixture=%s to its documented replay interval', async (fixture, openingTimestamp) => {
    const { createIndexSource } = await import('../src/feed/index.js');
    const replay = createIndexSource(`?feed=replay&fixture=${fixture}`);
    const ticks = [];
    replay.onTick((tick) => ticks.push(tick));

    replay.resetRound();
    vi.advanceTimersByTime(90_125);

    expect(ticks[0].t).toBe(openingTimestamp);
    expect(ticks.at(-1).t - ticks[0].t).toBeGreaterThanOrEqual(90_000);
  });

  it('provides an upper-limit QA trajectory that breaches the top clamp then retreats', async () => {
    const { createIndexSource } = await import('../src/feed/index.js');
    const { CFG } = await import('../src/config/constants.js');
    const replay = createIndexSource('?feed=replay&fixture=upper-limit');
    const ticks = [];
    replay.onTick((tick) => ticks.push(tick));

    replay.resetRound();
    vi.advanceTimersByTime(90_125);

    const upperClampIndex = CFG.IDX0 * Math.exp(
      (CFG.BASE_DEPTH - CFG.DEPTH_MIN) / CFG.DEPTH_K,
    );
    const peakIndex = Math.max(...ticks.map(({ v }) => v));
    expect(peakIndex).toBeGreaterThan(upperClampIndex);
    expect(ticks.at(-1).v).toBeLessThan(peakIndex * 0.6);
    expect(ticks.filter(({ ret }) => ret > 0)).toHaveLength(56);
    expect(ticks.filter(({ ret }) => ret < 0)).toHaveLength(56);
  });

  it('provides a lower-limit QA trajectory that breaches the bottom clamp then recovers', async () => {
    const { createIndexSource } = await import('../src/feed/index.js');
    const { CFG } = await import('../src/config/constants.js');
    const replay = createIndexSource('?feed=replay&fixture=lower-limit');
    const ticks = [];
    replay.onTick((tick) => ticks.push(tick));

    replay.resetRound();
    vi.advanceTimersByTime(90_125);

    const lowerClampIndex = CFG.IDX0 * Math.exp(
      (CFG.BASE_DEPTH - CFG.DEPTH_MAX) / CFG.DEPTH_K,
    );
    const values = ticks.map(({ v }) => v);
    const troughIndex = Math.min(...values);
    expect(troughIndex).toBeLessThan(lowerClampIndex);
    expect(ticks.at(-1).v).toBeGreaterThan(troughIndex * 1.5);
    expect(ticks.filter(({ ret }) => ret > 0)).toHaveLength(32);
  });

  it('provides a constant-price QA trajectory for timing oxygen and cash-out', async () => {
    const { createIndexSource } = await import('../src/feed/index.js');
    const replay = createIndexSource('?feed=replay&fixture=constant');
    const ticks = [];
    replay.onTick((tick) => ticks.push(tick));

    replay.resetRound();
    vi.advanceTimersByTime(90_125);

    expect(ticks.length).toBeGreaterThanOrEqual(721);
    expect(ticks.every(({ v, ret }) => v === 1_000 && ret === 0)).toBe(true);
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
