/**
 * M1.5 tick-authoritative auto orders.
 *
 * Acceptance criteria: CR-1, CR-4, CR-6b, AO-1…AO-5, PL-3, PL-4.
 */

import { describe, expect, it } from 'vitest';
import { cents } from '@crush/ledger';
import {
  DEFAULT_CONFIG,
  initialState,
  maxPayoutFor,
  onTick,
  open,
  positionCrushIndex,
  requestAscent,
} from '../src/index.js';
import type { EngineState, OpenRequest, Position, Tick } from '../src/index.js';

type AutoOrderRequest = OpenRequest & {
  readonly takeProfit?: number;
  readonly stopLoss?: number;
};

const I0 = 1000;
const STAKE = cents(5_000);

function tick(t: number, v: number): Tick {
  return { t, v };
}

function opened(overrides: Partial<AutoOrderRequest> = {}): EngineState {
  const req: AutoOrderRequest = {
    id: 'auto-1',
    dir: 1,
    stake: STAKE,
    lev: 10,
    entryOpen: true,
    ...overrides,
  };
  return open(initialState(cents(1_000_000)), req, tick(0, I0)).state;
}

/** Index value that produces `targetM` on the position's next delivered tick. */
function valueForNextMultiplier(position: Position, targetM: number): number {
  const nextTau = (position.ticksElapsed + 1) * DEFAULT_CONFIG.tickSeconds;
  return position.entry * (
    1 + (targetM - 1 + position.theta * nextTau) / (position.lev * position.dir)
  );
}

function nextAt(state: EngineState, t: number, targetM: number) {
  const position = state.position;
  if (position === null) throw new Error('position missing');
  return onTick(state, tick(t, valueForNextMultiplier(position, targetM)));
}

describe('AO-1/AO-4 — TP and SL are immutable authoritative-tick crossings', () => {
  it('starts a TP ascent only when consecutive tick multipliers cross the threshold', () => {
    let state = opened({ takeProfit: 1.2 });

    const below = nextAt(state, 125, 1.1);
    expect(below.state.position?.state).toBe('open');
    expect(below.state.position?.lastMultiplier).toBeCloseTo(1.1, 12);

    state = below.state;
    const crossed = nextAt(state, 250, 1.25);
    expect(crossed.state.position?.state).toBe('ascending');
    expect(crossed.state.position?.ascentCause).toBe('take-profit');
    expect(crossed.state.position?.resolveT).toBe(750);
    expect(crossed.events.map((event) => event.kind)).toEqual(['ascent-started']);
    expect(crossed.state.lastResult).toBeNull();
  });

  it('starts an SL ascent on a downward crossing', () => {
    let state = opened({ stopLoss: 0.8 });
    state = nextAt(state, 125, 0.9).state;

    const crossed = nextAt(state, 250, 0.75);
    expect(crossed.state.position?.state).toBe('ascending');
    expect(crossed.state.position?.ascentCause).toBe('stop-loss');
  });

  it('uses the specified bidirectional crossing predicate for TP', () => {
    const state = opened({ takeProfit: 1.2 });
    const position = state.position;
    if (position === null) throw new Error('position missing');
    const above: EngineState = { ...state, position: { ...position, lastMultiplier: 1.3 } };

    const crossedDownward = nextAt(above, 125, 1.1);
    expect(crossedDownward.state.position?.ascentCause).toBe('take-profit');
  });

  it('does not trigger when the retained endpoint starts exactly on the threshold', () => {
    const state = opened({ takeProfit: 1.2 });
    const position = state.position;
    if (position === null) throw new Error('position missing');
    const exact: EngineState = { ...state, position: { ...position, lastMultiplier: 1.2 } };

    const result = nextAt(exact, 125, 1.3);
    expect(result.state.position?.state).toBe('open');
    expect(result.events).toEqual([]);
  });

  it('gives stop-loss precedence when one gap crosses both thresholds', () => {
    const state = opened({ takeProfit: 1.2, stopLoss: 0.8 });
    const position = state.position;
    if (position === null) throw new Error('position missing');
    const pathological: EngineState = {
      ...state,
      position: { ...position, lastMultiplier: 0.7 },
    };

    const result = nextAt(pathological, 125, 1.3);
    expect(result.state.position?.ascentCause).toBe('stop-loss');
    expect(result.events).toHaveLength(1);
  });

  it('does not retrigger an order once ascent has started', () => {
    let state = opened({ takeProfit: 1.2, stopLoss: 0.8 });
    state = requestAscent(state, 0).state;

    const result = nextAt(state, 125, 1.3);
    expect(result.state.position?.state).toBe('ascending');
    expect(result.state.position?.ascentCause).toBe('manual');
    expect(result.events).toEqual([]);
  });
});

describe('CR-1/CR-6b — one tau advance, then crush → triggers → settlement', () => {
  it('uses this tick multiplier as the crossing endpoint and retains it for the next tick', () => {
    let state = opened({ takeProfit: 1.3 });
    const first = nextAt(state, 125, 1.1);
    expect(first.state.position?.ticksElapsed).toBe(1);
    expect(first.state.position?.lastMultiplier).toBeCloseTo(1.1, 12);

    state = first.state;
    const second = nextAt(state, 250, 1.2);
    expect(second.state.position?.ticksElapsed).toBe(2);
    expect(second.state.position?.lastMultiplier).toBeCloseTo(1.2, 12);
    expect(second.state.position?.state).toBe('open');
  });

  it('crushes before consulting a crossing on the same tick', () => {
    const state = opened({ takeProfit: 1.2, stopLoss: 0.8 });
    const position = state.position;
    if (position === null) throw new Error('position missing');
    const line = positionCrushIndex(
      { ...position, ticksElapsed: position.ticksElapsed + 1 },
      DEFAULT_CONFIG.tickSeconds,
    );

    const result = onTick(state, tick(125, line));
    expect(result.state.lastResult?.reason).toBe('crush');
    expect(result.state.lastResult?.payout).toBe(0);
    expect(result.events.some((event) => event.kind === 'ascent-started')).toBe(false);
  });
});

describe('AO-2/AO-5 — forced ascents use the normal 500 ms Blow', () => {
  it('force-starts max-win ascent without settling immediately', () => {
    const state = opened({ lev: 25 });
    const result = nextAt(state, 125, 51);

    expect(result.state.position?.state).toBe('ascending');
    expect(result.state.position?.ascentCause).toBe('max-win');
    expect(result.state.position?.resolveT).toBe(625);
    expect(result.state.lastResult).toBeNull();
    expect(result.events.map((event) => event.kind)).toEqual(['ascent-started']);
  });

  it('settles on the first tick at or after trigger tick + 500 ms', () => {
    let state = nextAt(opened({ takeProfit: 1.2 }), 125, 1.25).state;

    const early = nextAt(state, 624, 1.25);
    expect(early.state.position?.state).toBe('ascending');
    expect(early.state.lastResult).toBeNull();

    state = early.state;
    const due = nextAt(state, 625, 1.25);
    expect(due.state.position?.state).toBe('done');
    expect(due.state.lastResult?.reason).toBe('ascent');
    expect(due.state.lastResult?.ascentCause).toBe('take-profit');
  });

  it('keeps the unconditional payout cap as a separate final protection', () => {
    let state = nextAt(opened({ lev: 25 }), 125, 51).state;
    state = nextAt(state, 625, 60).state;

    const result = state.lastResult;
    expect(result?.multiplier).toBeCloseTo(60, 12);
    expect(result?.payout).toBe(maxPayoutFor(STAKE, DEFAULT_CONFIG));
  });
});
