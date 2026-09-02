import {
  initialState,
  onTick,
  open,
  requestAscent,
} from '@crush/engine';
import { cents } from '@crush/ledger';
import { describe, expect, it } from 'vitest';
import { PresentationInterpBuffer } from '../src/feed/presentation-interp-buffer.ts';

const EPOCH = 1_621_430_420_000;

const replayTicks = [
  { t: EPOCH, v: 1_000, ret: 0 },
  { t: EPOCH + 100, v: 1_006, ret: 0.006 },
  { t: EPOCH + 200, v: 1_002, ret: -0.004 },
  { t: EPOCH + 300, v: 1_008, ret: 0.006 },
  { t: EPOCH + 500, v: 1_004, ret: -0.004 },
  { t: EPOCH + 600, v: 1_010, ret: 0.006 },
];

describe('FI-16 - replay presentation clock adaptation', () => {
  it('paces historical ticks by their page arrival cadence instead of irregular recorded gaps', () => {
    let pageNow = 5_000;
    const buffer = new PresentationInterpBuffer({
      clock: () => pageNow,
      historicalTimestamps: true,
      playbackIntervalMs: 125,
      interpolationDelayMs: 150,
    });

    const copies = replayTicks.map((tick) => ({ ...tick }));
    for (const tick of copies) {
      buffer.push(tick);
      pageNow += 125;
    }

    expect(buffer.a.map((tick) => tick.t)).toEqual([
      5_000, 5_125, 5_250, 5_375, 5_500, 5_625,
    ]);
    expect(buffer.valueAt(5_187.5)).toBeCloseTo(1_004, 9);
    expect(copies).toEqual(replayTicks);
  });

  it('starts a smooth catch-up from the held value when a sparse replay tick arrives', () => {
    let pageNow = 5_000;
    const buffer = new PresentationInterpBuffer({
      clock: () => pageNow,
      historicalTimestamps: true,
      playbackIntervalMs: 125,
      interpolationDelayMs: 150,
    });

    buffer.push({ t: EPOCH, v: 1_000, ret: 0 });
    pageNow = 5_500;
    const renderTimestamp = pageNow - 150;
    const heldBeforeArrival = buffer.valueAt(renderTimestamp);

    buffer.push({ t: EPOCH + 500, v: 1_100, ret: 0.1 });

    expect(heldBeforeArrival).toBe(1_000);
    expect(buffer.valueAt(renderTimestamp)).toBe(1_000);
    expect(buffer.valueAt(renderTimestamp + 75)).toBeGreaterThan(1_000);
    expect(buffer.valueAt(renderTimestamp + 75)).toBeLessThan(1_100);
    expect(buffer.valueAt(pageNow)).toBe(1_100);
  });

  it('re-anchors the historical timeline when the presentation buffer resets', () => {
    let pageNow = 2_000;
    const buffer = new PresentationInterpBuffer({
      clock: () => pageNow,
      historicalTimestamps: true,
      playbackIntervalMs: 125,
      interpolationDelayMs: 150,
    });

    buffer.push(replayTicks[0]);
    expect(buffer.a[0].t).toBe(2_000);

    buffer.reset();
    pageNow = 20_000;
    buffer.push(replayTicks[0]);
    expect(buffer.a[0].t).toBe(20_000);
  });

  it('leaves page-relative simulator timestamps unchanged', () => {
    const buffer = new PresentationInterpBuffer({
      clock: () => 99_999,
      historicalTimestamps: false,
      playbackIntervalMs: 125,
      interpolationDelayMs: 150,
    });
    const simulatedTick = { t: 3_125, v: 1_005, ret: 0.005 };

    buffer.push(simulatedTick);

    expect(buffer.a[0]).toBe(simulatedTick);
  });
});

describe('CO-4/SC-4 - replay presentation cannot affect settlement authority', () => {
  function settleWithPresentationFrames(frameTimes) {
    const buffer = new PresentationInterpBuffer({
      clock: () => 7_000,
      historicalTimestamps: true,
      playbackIntervalMs: 125,
      interpolationDelayMs: 150,
    });
    let state = initialState(cents(100_000));
    state = open(state, {
      id: 'replay-presentation-authority',
      dir: 1,
      lev: 5,
      stake: cents(5_000),
    }, replayTicks[0]).state;
    state = requestAscent(state, replayTicks[0].t).state;

    buffer.push(replayTicks[0]);
    for (const tick of replayTicks.slice(1)) {
      buffer.push(tick);
      for (const frameTime of frameTimes) buffer.valueAt(frameTime);
      state = onTick(state, tick).state;
    }

    return state;
  }

  it('settles on the original epoch tick with or without interpolated frame reads', () => {
    const withoutFrames = settleWithPresentationFrames([]);
    const withFrames = settleWithPresentationFrames([
      7_000, 7_025, 7_050, 7_075, 7_100, 7_150, 7_225, 7_300, 7_450,
    ]);

    expect(withFrames.lastResult).toEqual(withoutFrames.lastResult);
    expect(withFrames.balance).toBe(withoutFrames.balance);
    expect(withFrames.lastResult.tick.t).toBe(EPOCH + 500);
  });
});
