import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_CONFIG,
  initialState,
  onTick,
  open,
  requestAscent,
  settleAtRoundEnd,
  type EngineEvent,
  type EngineState,
} from '@crush/engine';
import { cents } from '@crush/ledger';
import { describe, expect, it } from 'vitest';
import {
  ReplayIndexSource,
  parseReplayCsv,
  type IndexTick,
  type ReplayScheduler,
} from '../src/index.js';

const FLASH_FIXTURE = resolve(
  process.cwd(),
  'packages/feed/fixtures/btcusdt-binance-2021-05-19-flash-crash-100ms.csv',
);

class ManualScheduler implements ReplayScheduler {
  private task: (() => void) | null = null;
  every(_intervalMs: number, task: () => void): void { this.task = task; }
  advance(count: number): void {
    for (let index = 0; index < count; index += 1) this.task?.();
  }
}

interface ReplayArtifact {
  readonly ticks: readonly IndexTick[];
  readonly events: readonly EngineEvent[];
  readonly state: EngineState;
}

function runFlashCrash(boundaryBatches: readonly number[]): ReplayArtifact {
  const fixture = parseReplayCsv(readFileSync(FLASH_FIXTURE, 'utf8'));
  const scheduler = new ManualScheduler();
  const source = new ReplayIndexSource(fixture, { scheduler });
  const ticks: IndexTick[] = [];
  const events: EngineEvent[] = [];
  let state = initialState(cents(100_000));

  source.onTick((tick) => {
    const tickIndex = ticks.length;
    ticks.push(tick);

    if (tickIndex === 192) {
      const opened = open(state, {
        id: 'flash-crash-long',
        dir: 1,
        lev: 25,
        stake: cents(5_000),
      }, tick, DEFAULT_CONFIG);
      state = opened.state;
      events.push(...opened.events);
      return;
    }

    if (tickIndex === 193) {
      const ascending = requestAscent(state, tick.t, DEFAULT_CONFIG);
      state = ascending.state;
      events.push(...ascending.events);
    }

    const advanced = onTick(state, tick, DEFAULT_CONFIG);
    state = advanced.state;
    events.push(...advanced.events);
  });

  source.resetRound();
  for (const count of boundaryBatches) scheduler.advance(count);
  source.halt();

  const finalTick = ticks.at(-1);
  if (finalTick !== undefined && state.position?.state !== 'done') {
    const settled = settleAtRoundEnd(state, finalTick, DEFAULT_CONFIG);
    state = settled.state;
    events.push(...settled.events);
  }

  return { ticks, events, state };
}

describe('FI-15 — deterministic settlement on recorded real BTC', () => {
  it('produces byte-identical ticks, events and settlement across fresh runs', () => {
    const first = JSON.stringify(runFlashCrash([2_000]));
    const second = JSON.stringify(runFlashCrash([2_000]));
    expect(first).toBe(second);
  });

  it('is byte-identical under different scheduler pacing', () => {
    const fast = JSON.stringify(runFlashCrash([2_000]));
    const chunked = JSON.stringify(runFlashCrash(Array.from({ length: 200 }, () => 10)));
    expect(fast).toBe(chunked);
  });

  it('exercises material adverse exposure during the real 500 ms ascent', () => {
    const artifact = runFlashCrash([2_000]);
    const ascentIndex = artifact.events.findIndex((event) => event.kind === 'ascent-started');
    const settlementIndex = artifact.events.findIndex((event) => event.kind === 'settled');
    const ascentEvent = artifact.events[ascentIndex];

    expect(ascentIndex).toBeGreaterThanOrEqual(0);
    expect(settlementIndex).toBeGreaterThan(ascentIndex);
    expect(ascentEvent).toMatchObject({
      kind: 'ascent-started',
      position: { lastMultiplier: 1, ascentCause: 'manual' },
    });
    expect(artifact.state.lastResult).toMatchObject({
      positionId: 'flash-crash-long',
      reason: 'ascent',
      crushed: false,
      payout: 2_739,
      pnl: -2_261,
    });
  });
});
