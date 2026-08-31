import { describe, expect, it } from 'vitest';
import { cents } from '@crush/ledger';
import {
  CLOSE_CALL_THRESHOLD_BPS,
  DEFAULT_CONFIG,
  crushIndex,
  initialState,
  onTick,
  open,
  requestAscent,
  settleAtRoundEnd,
  type CloseCallEvent,
  type Direction,
  type EngineEvent,
  type EngineState,
  type Tick,
} from '../src/index.js';

const ENTRY = 1_000;
const CONFIG = { ...DEFAULT_CONFIG, thetaPerSecond: 0 };

function tick(t: number, v: number): Tick {
  return { t, v };
}

function nextAfter(value: number, towardPositiveInfinity: boolean): number {
  if (Number.isNaN(value) || value === (towardPositiveInfinity ? Infinity : -Infinity)) {
    return value;
  }
  if (value === 0) return towardPositiveInfinity ? Number.MIN_VALUE : -Number.MIN_VALUE;

  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value, false);
  let bits = view.getBigUint64(0, false);
  const increment = (value > 0) === towardPositiveInfinity;
  bits = increment ? bits + 1n : bits - 1n;
  view.setBigUint64(0, bits, false);
  return view.getFloat64(0, false);
}

function opened(dir: Direction, id = `p-${dir}`): EngineState {
  const result = open(initialState(cents(100_000)), {
    id,
    dir,
    lev: 10,
    stake: cents(5_000),
  }, tick(0, ENTRY), CONFIG);
  expect(result.events.map((event) => event.kind)).toEqual(['position-opened', 'wallet-changed']);
  return result.state;
}

function boundaryValue(dir: Direction): number {
  const line = crushIndex(dir, 10, ENTRY, 0, CONFIG.tickSeconds);
  const fraction = 50 / 10_000;
  return dir > 0 ? line * (1 + fraction) : line * (1 - fraction);
}

function closeCalls(events: readonly EngineEvent[]): readonly CloseCallEvent[] {
  return events.filter((event): event is CloseCallEvent => event.kind === 'close-call');
}

function settleAt(dir: Direction, value: number): readonly EngineEvent[] {
  let state = opened(dir);
  state = onTick(state, tick(125, value), CONFIG).state;
  return settleAtRoundEnd(state, tick(125, value), CONFIG).events;
}

describe('CC-2/CC-3 — authoritative proximity boundary and direction symmetry', () => {
  it('CC-3: the versioned v1 threshold is 50 basis points', () => {
    expect(CLOSE_CALL_THRESHOLD_BPS).toBe(50);
  });

  for (const dir of [1, -1] as const) {
    const name = dir > 0 ? 'Surface' : 'Dive';

    it(`CC-3: ${name} just inside 50 bp qualifies`, () => {
      const boundary = boundaryValue(dir);
      const inside = nextAfter(boundary, dir < 0);
      expect(closeCalls(settleAt(dir, inside))).toHaveLength(1);
    });

    it(`CC-3: ${name} exactly on 50 bp qualifies`, () => {
      const events = settleAt(dir, boundaryValue(dir));
      const [event] = closeCalls(events);
      expect(event).toBeDefined();
      expect(event?.closeCall.thresholdBps).toBe(50);
      expect(event?.closeCall.closest.headroomBps).toBeCloseTo(50, 10);
    });

    it(`CC-3: ${name} just outside 50 bp does not qualify`, () => {
      const boundary = boundaryValue(dir);
      const outside = nextAfter(boundary, dir > 0);
      expect(closeCalls(settleAt(dir, outside))).toEqual([]);
    });
  }
});

describe('CC-1/CC-4 — eligibility and full-exposure closest approach', () => {
  it('CC-4: a close approach during ascent qualifies even when settlement is safe', () => {
    let state = opened(1, 'ascent-close-call');
    state = onTick(state, tick(125, ENTRY), CONFIG).state;
    state = requestAscent(state, 125, CONFIG).state;

    const near = nextAfter(boundaryValue(1), false);
    state = onTick(state, tick(250, near), CONFIG).state;
    state = onTick(state, tick(500, ENTRY), CONFIG).state;
    const result = onTick(state, tick(625, ENTRY), CONFIG);
    const [event] = closeCalls(result.events);

    expect(event?.closeCall.closest.tick).toEqual(tick(250, near));
    expect(event?.closeCall.settlement).toMatchObject({
      reason: 'ascent',
      ascentCause: 'manual',
      tick: tick(625, ENTRY),
      crushed: false,
    });
  });

  it('CC-4: an exact closest-approach tie retains the earliest tick', () => {
    let state = opened(1, 'earliest-tie');
    const near = boundaryValue(1);
    state = onTick(state, tick(125, near), CONFIG).state;
    state = onTick(state, tick(250, near), CONFIG).state;
    const events = settleAtRoundEnd(state, tick(250, near), CONFIG).events;
    expect(closeCalls(events)[0]?.closeCall.closest.tick.t).toBe(125);
  });

  it('CC-1: a crush is never reported as a successful Close Call', () => {
    const state = opened(1, 'crushed-close-call');
    const line = crushIndex(1, 10, ENTRY, 0, CONFIG.tickSeconds);
    const result = onTick(state, tick(125, line), CONFIG);

    expect(result.events.map((event) => event.kind)).toEqual(['settled', 'wallet-changed']);
    expect(result.state.lastResult).toMatchObject({ reason: 'crush', payout: 0 });
    expect(closeCalls(result.events)).toEqual([]);
  });
});

describe('CC-5/CC-7 — event contract, ordering and determinism', () => {
  function replayCloseCall(): readonly CloseCallEvent[] {
    let state = opened(1, 'replayed-close-call');
    const events: EngineEvent[] = [];

    for (const sample of [tick(125, ENTRY), tick(250, boundaryValue(1)), tick(375, ENTRY)]) {
      const result = onTick(state, sample, CONFIG);
      state = result.state;
      events.push(...result.events);
    }
    const settled = settleAtRoundEnd(state, tick(375, ENTRY), CONFIG);
    events.push(...settled.events);
    return closeCalls(events);
  }

  it('CC-5: event order is settled → close-call → wallet-changed', () => {
    expect(settleAt(1, boundaryValue(1)).map((event) => event.kind)).toEqual([
      'settled',
      'close-call',
      'wallet-changed',
    ]);
  });

  it('CC-5: the Close Call is self-contained and carries the authoritative settlement', () => {
    const events = settleAt(1, boundaryValue(1));
    const settled = events.find((event) => event.kind === 'settled');
    const [closeCall] = closeCalls(events);

    expect(closeCall?.closeCall).toMatchObject({
      id: 'close-call:p-1:125:round-end',
      positionId: 'p-1',
      dir: 1,
      thresholdBps: 50,
      closest: {
        tick: { t: 125, v: boundaryValue(1) },
      },
    });
    if (settled?.kind !== 'settled') throw new Error('missing settlement');
    expect(closeCall?.closeCall.settlement).toEqual(settled.settlement);
  });

  it('CC-7: replaying identical ticks and actions produces byte-identical output and id', () => {
    expect(JSON.stringify(replayCloseCall())).toBe(JSON.stringify(replayCloseCall()));
    expect(replayCloseCall()).toHaveLength(1);
  });

  it('CC-7: Close Call metadata cannot alter wallet or settlement money', () => {
    const events = settleAt(1, boundaryValue(1));
    const settled = events.find((event) => event.kind === 'settled');
    const [closeCall] = closeCalls(events);
    if (settled?.kind !== 'settled') throw new Error('missing settlement');

    expect(closeCall?.closeCall.settlement.payout).toBe(settled.settlement.payout);
    expect(closeCall?.closeCall.settlement.pnl).toBe(settled.settlement.pnl);
    expect(closeCall?.closeCall.settlement.multiplier).toBe(settled.settlement.multiplier);
  });
});
