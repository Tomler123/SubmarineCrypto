/**
 * M1.5 entry validation and re-entry cooldown.
 *
 * Acceptance criteria: EN-4, EN-7, EN-8, EN-10, AO-1, AO-3.
 */

import { describe, expect, it } from 'vitest';
import { cents, type Cents } from '@crush/ledger';
import {
  clearSettled,
  initialState,
  onTick,
  open,
  setLossLocked,
  settleAtRoundEnd,
} from '../src/index.js';
import type {
  Direction,
  EngineState,
  OpenRequest,
  RejectCode,
  Tick,
} from '../src/index.js';

type AutoOrderRequest = OpenRequest & {
  readonly takeProfit?: number;
  readonly stopLoss?: number;
};

const I0 = 1000;
const BALANCE = cents(1_000_000);
const ENTRY_TICK: Tick = { t: 0, v: I0 };

function fresh(): EngineState {
  return initialState(BALANCE);
}

function request(overrides: Partial<AutoOrderRequest> = {}): AutoOrderRequest {
  return {
    id: 'entry-1',
    dir: 1,
    stake: cents(5_000),
    lev: 10,
    entryOpen: true,
    ...overrides,
  };
}

function rejectionCode(state: EngineState, req: AutoOrderRequest, tick: Tick | null = ENTRY_TICK) {
  return open(state, req, tick).events.find((event) => event.kind === 'open-rejected')?.code;
}

describe('EN-4/AO-3 — runtime request validation before wallet mutation', () => {
  const invalidCases: readonly [string, Partial<AutoOrderRequest>, RejectCode][] = [
    ['direction', { dir: 0 as Direction }, 'INVALID_DIRECTION'],
    ['leverage', { lev: 3 }, 'INVALID_LEVERAGE'],
    ['stake below the minimum', { stake: cents(49) }, 'INVALID_STAKE'],
    ['fractional stake', { stake: 50.5 as Cents }, 'INVALID_STAKE'],
    ['notional above $2,000', { stake: cents(20_001), lev: 10 }, 'NOTIONAL_LIMIT_EXCEEDED'],
    ['TP at the leverage-adjusted one-tick floor', { takeProfit: 1.147 }, 'INVALID_TAKE_PROFIT'],
    ['non-finite TP', { takeProfit: Number.NaN }, 'INVALID_TAKE_PROFIT'],
    ['SL at zero', { stopLoss: 0 }, 'INVALID_STOP_LOSS'],
    ['SL at one', { stopLoss: 1 }, 'INVALID_STOP_LOSS'],
    ['non-finite SL', { stopLoss: Number.POSITIVE_INFINITY }, 'INVALID_STOP_LOSS'],
  ];

  it.each(invalidCases)('rejects invalid %s with its explicit code and no debit', (_label, overrides, code) => {
    const before = fresh();
    const result = open(before, request(overrides), ENTRY_TICK);

    expect(result.events).toEqual([{ kind: 'open-rejected', code }]);
    expect(result.state).toBe(before);
    expect(result.state.wallet).toBe(before.wallet);
    expect(result.state.position).toBeNull();
  });

  it('accepts both notional and TP exactly beyond their exclusive boundaries', () => {
    const result = open(
      fresh(),
      request({ stake: cents(20_000), lev: 10, takeProfit: 1.147_000_000_1, stopLoss: 0.8 }),
      ENTRY_TICK,
    );

    expect(result.events.some((event) => event.kind === 'position-opened')).toBe(true);
    expect(result.state.position?.takeProfit).toBe(1.147_000_000_1);
    expect(result.state.position?.stopLoss).toBe(0.8);
  });

  it('snapshots omitted auto orders as absent rather than inventing defaults', () => {
    const result = open(fresh(), request(), ENTRY_TICK);
    expect(result.state.position?.takeProfit).toBeUndefined();
    expect(result.state.position?.stopLoss).toBeUndefined();
  });
});

describe('EN-8 — exact validation and eligibility precedence', () => {
  it('idempotency remains above validation and every eligibility rejection', () => {
    const accepted = open(
      fresh(),
      request({ takeProfit: 1.2, stopLoss: 0.8 }),
      ENTRY_TICK,
    ).state;
    const lossLocked = setLossLocked(accepted, true);

    const replay = open(
      lossLocked,
      request({ dir: 0 as Direction, stake: cents(1), takeProfit: 0, stopLoss: 2, entryOpen: false }),
      null,
    );

    expect(replay.state).toBe(lossLocked);
    expect(replay.events).toEqual([{ kind: 'position-opened', position: lossLocked.position }]);
  });

  it('orders validation direction → leverage → stake → notional → TP → SL', () => {
    const defects: readonly [Partial<AutoOrderRequest>, RejectCode][] = [
      [
        { dir: 0 as Direction, lev: 3, stake: cents(1), takeProfit: 0, stopLoss: 2 },
        'INVALID_DIRECTION',
      ],
      [{ lev: 3, stake: cents(1), takeProfit: 0, stopLoss: 2 }, 'INVALID_LEVERAGE'],
      [{ stake: cents(1), takeProfit: 0, stopLoss: 2 }, 'INVALID_STAKE'],
      [
        { stake: cents(20_001), takeProfit: 0, stopLoss: 2 },
        'NOTIONAL_LIMIT_EXCEEDED',
      ],
      [{ takeProfit: 0, stopLoss: 2 }, 'INVALID_TAKE_PROFIT'],
      [{ stopLoss: 2 }, 'INVALID_STOP_LOSS'],
    ];

    for (const [overrides, expected] of defects) {
      expect(rejectionCode(fresh(), request(overrides))).toBe(expected);
    }
  });

  it('runs validation before loss-lock eligibility', () => {
    const locked = setLossLocked(fresh(), true);
    expect(rejectionCode(locked, request({ dir: 0 as Direction }))).toBe('INVALID_DIRECTION');
    expect(rejectionCode(locked, request())).toBe('LOSS_LIMIT_REACHED');
  });
});

describe('EN-10 — authoritative-tick re-entry cooldown', () => {
  function settledAt(t: number): EngineState {
    const accepted = open(fresh(), request(), ENTRY_TICK).state;
    return settleAtRoundEnd(accepted, { t, v: I0 }).state;
  }

  it('rejects before settlement tick + cooldown and accepts at equality', () => {
    const settled = settledAt(1_000);
    const cleared = clearSettled(settled).state;
    const second = request({ id: 'entry-2' });

    const early = open(cleared, second, { t: 1_899, v: I0 });
    expect(early.events).toEqual([{ kind: 'open-rejected', code: 'COOLING_OFF' }]);
    expect(early.state).toBe(cleared);

    const eligible = open(cleared, second, { t: 1_900, v: I0 });
    expect(eligible.events.some((event) => event.kind === 'position-opened')).toBe(true);
  });

  it('applies after every settlement reason, including crush', () => {
    const accepted = open(fresh(), request(), ENTRY_TICK).state;
    const crushed = onTick(accepted, { t: 500, v: 0 }).state;
    const cleared = clearSettled(crushed).state;

    expect(rejectionCode(cleared, request({ id: 'entry-2' }), { t: 1_399, v: I0 })).toBe(
      'COOLING_OFF',
    );
  });

  it('never moves the wallet on COOLING_OFF', () => {
    const cleared = clearSettled(settledAt(1_000)).state;
    const result = open(cleared, request({ id: 'entry-2' }), { t: 1_001, v: I0 });
    expect(result.state).toBe(cleared);
    expect(result.state.wallet).toBe(cleared.wallet);
  });
});
