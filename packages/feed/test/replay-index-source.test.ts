import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INDEX_TRANSFORM_CONFIG,
  IndexSourceBase,
  ReplayFixtureError,
  ReplayIndexSource,
  parseReplayCsv,
  type IndexTick,
  type ReplayScheduler,
} from '../src/index.js';

class ManualScheduler implements ReplayScheduler {
  private task: (() => void) | null = null;

  every(_intervalMs: number, task: () => void): void {
    this.task = task;
  }

  advance(boundaries = 1): void {
    for (let index = 0; index < boundaries; index += 1) {
      this.task?.();
    }
  }
}

const rows = (timestamps: readonly number[]) => timestamps.map((t, index) => ({
  t,
  price: 40_000 + index * 10,
}));

function collect(source: ReplayIndexSource): IndexTick[] {
  const ticks: IndexTick[] = [];
  source.onTick((tick) => ticks.push(tick));
  return ticks;
}

describe('FI-10 — 100 ms fixture to 125 ms authoritative selection', () => {
  it('anchors at fixture start, keeps the latest row at-or-before each boundary, and retains original timestamps', () => {
    const scheduler = new ManualScheduler();
    const source = new ReplayIndexSource(rows([0, 100, 200, 300, 400, 500, 600, 700, 800, 900]), {
      scheduler,
    });
    const ticks = collect(source);

    source.resetRound();
    scheduler.advance(8);

    expect(ticks.map((tick) => tick.t)).toEqual([0, 100, 200, 300, 500, 600, 700, 800, 900]);
    expect(ticks.map((tick) => tick.t).slice(1).map((t, index) => t - ticks[index]!.t))
      .toEqual([100, 100, 100, 200, 100, 100, 100, 100]);
  });

  it('does not carry a row forward across empty grid boundaries or invent a gap tick', () => {
    const scheduler = new ManualScheduler();
    const source = new ReplayIndexSource(rows([1_000, 1_100, 1_600, 1_700]), { scheduler });
    const ticks = collect(source);

    source.resetRound();
    scheduler.advance(7);

    expect(ticks.map((tick) => tick.t)).toEqual([1_000, 1_100, 1_600, 1_700]);
  });

  it('never emits one recorded row twice', () => {
    const scheduler = new ManualScheduler();
    const source = new ReplayIndexSource(rows([0, 100, 600]), { scheduler });
    const ticks = collect(source);

    source.resetRound();
    scheduler.advance(20);

    expect(ticks.map((tick) => tick.t)).toEqual([0, 100, 600]);
    expect(new Set(ticks.map((tick) => tick.t)).size).toBe(ticks.length);
  });
});

describe('FI-11 — published index transform', () => {
  it('opens at I0 with ret zero and freezes the transform operation order', () => {
    const scheduler = new ManualScheduler();
    const source = new ReplayIndexSource([
      { t: 0, price: 40_000 },
      { t: 100, price: 40_040 },
      { t: 200, price: 39_960 },
    ], { scheduler });
    const ticks = collect(source);

    source.resetRound();
    scheduler.advance(2);

    expect(ticks[0]).toEqual({ t: 0, v: 1_000, ret: 0 });
    const clampedUp = 1_000 * (1 + 3.5 * 0.0042);
    const clampedDown = clampedUp * (1 - 3.5 * 0.0042);
    expect(ticks[1]).toEqual({
      t: 100,
      v: clampedUp,
      ret: 0.0147,
    });
    expect(ticks[2]).toEqual({
      t: 200,
      v: clampedDown,
      ret: -0.0147,
    });
  });

  it('exports the audit-locked FI-1 constants, including the explicit initial variance', () => {
    expect(DEFAULT_INDEX_TRANSFORM_CONFIG).toEqual({
      lambda: 0.997,
      sigmaFloor: 0.00012,
      clampZ: 3.5,
      tickVolatility: 0.0042,
      initialIndex: 1_000,
      initialSigmaSquared: 0.00012 ** 2,
    });
  });

  it('fits relative BTC movement onto I0=1000 independently of the absolute BTC price', () => {
    const replay = (prices: readonly number[]): readonly number[] => {
      const scheduler = new ManualScheduler();
      const source = new ReplayIndexSource(
        prices.map((price, index) => ({ t: index * 100, price })),
        { scheduler },
      );
      const ticks = collect(source);
      source.resetRound();
      scheduler.advance(prices.length);
      return ticks.map((tick) => tick.v);
    };

    const atFortyThousand = replay([40_000, 40_020, 39_980, 40_040]);
    const atEightyThousand = replay([80_000, 80_040, 79_960, 80_080]);

    expect(atFortyThousand[0]).toBe(1_000);
    expect(atEightyThousand).toEqual(atFortyThousand);
  });
});

describe('FI-9 — fixture validation', () => {
  it.each([
    { fixture: [], code: 'EMPTY_FIXTURE', rowIndex: 0 },
    { fixture: [{ t: Number.NaN, price: 1 }], code: 'INVALID_TIMESTAMP', rowIndex: 0 },
    { fixture: [{ t: 0, price: 0 }], code: 'INVALID_PRICE', rowIndex: 0 },
    {
      fixture: [{ t: 100, price: 1 }, { t: 100, price: 2 }],
      code: 'NON_MONOTONIC_TIMESTAMP',
      rowIndex: 1,
    },
    {
      fixture: [{ t: 100, price: 1 }, { t: 99, price: 2 }],
      code: 'NON_MONOTONIC_TIMESTAMP',
      rowIndex: 1,
    },
  ])('rejects $code before scheduling or emitting', ({ fixture, code, rowIndex }) => {
    const scheduler = new ManualScheduler();
    let caught: unknown;

    try {
      new ReplayIndexSource(fixture, { scheduler });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ReplayFixtureError);
    expect(caught).toMatchObject({ code, rowIndex });
  });

  it('parses the committed two-column fixture format without coercing extra columns', () => {
    expect(parseReplayCsv('timestamp_ms,price\n100,40000.50\n200,39999.25\n')).toEqual([
      { t: 100, price: 40_000.5 },
      { t: 200, price: 39_999.25 },
    ]);
    expect(() => parseReplayCsv('timestamp_ms,price\n100,40000,extra\n')).toThrowError(
      expect.objectContaining({ code: 'MALFORMED_ROW', rowIndex: 1 }),
    );
  });
});

describe('FI-12/FI-13 — lifecycle and scheduler-independent playback', () => {
  it('is dormant before reset, halts, restarts synchronously, and becomes dormant at EOF', () => {
    const scheduler = new ManualScheduler();
    const source = new ReplayIndexSource(rows([0, 100, 200]), { scheduler });
    const ticks = collect(source);

    scheduler.advance(10);
    expect(ticks).toEqual([]);

    source.resetRound();
    expect(ticks.map((tick) => tick.t)).toEqual([0]);
    scheduler.advance(1);
    source.halt();
    scheduler.advance(10);
    expect(ticks.map((tick) => tick.t)).toEqual([0, 100]);

    source.resetRound();
    expect(ticks.map((tick) => tick.t)).toEqual([0, 100, 0]);
    scheduler.advance(20);
    const atEof = ticks.length;
    scheduler.advance(20);
    expect(ticks).toHaveLength(atEof);
    expect(ticks.slice(-3).map((tick) => tick.t)).toEqual([0, 100, 200]);
  });

  it('produces byte-identical output when boundaries are advanced singly or in batches', () => {
    const run = (batches: readonly number[]): string => {
      const scheduler = new ManualScheduler();
      const source = new ReplayIndexSource(rows([0, 100, 200, 300, 400, 500, 600]), {
        scheduler,
        playbackIntervalMs: 1,
      });
      const ticks = collect(source);
      source.resetRound();
      for (const batch of batches) scheduler.advance(batch);
      return JSON.stringify(ticks);
    };

    expect(run([20])).toBe(run(Array.from({ length: 20 }, () => 1)));
  });

  it('rewinds the FI-8 gate without clearing its lifetime rejection count', () => {
    class GateProbe extends IndexSourceBase {
      publish(tick: IndexTick): boolean { return this._publish(tick); }
      rewind(): void { this._resetMonotonicity(); }
    }
    const probe = new GateProbe();
    expect(probe.publish({ t: 100, v: 1_000, ret: 0 })).toBe(true);
    expect(probe.publish({ t: 100, v: 1_000, ret: 0 })).toBe(false);
    probe.rewind();
    expect(probe.publish({ t: 0, v: 1_000, ret: 0 })).toBe(true);
    expect(probe.rejectedTicks).toBe(1);
  });

  it('contains no clock, timer, RNG, DOM, or interpolation dependency in replay core files', () => {
    for (const file of ['replay-index-source.ts', 'index-transform.ts']) {
      const source = readFileSync(resolve(process.cwd(), 'packages/feed/src', file), 'utf8');
      for (const forbidden of [
        /Date\.now/, /new\s+Date/, /performance\./, /setTimeout/, /setInterval/,
        /Math\.random/, /document\b/, /window\b/, /InterpBuffer/,
      ]) {
        expect(forbidden.test(source), `${file} matches ${forbidden}`).toBe(false);
      }
    }
  });
});
