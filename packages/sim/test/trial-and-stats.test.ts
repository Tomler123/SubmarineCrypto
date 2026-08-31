import { cents } from '@crush/ledger';
import { describe, expect, it } from 'vitest';
import {
  runEngineTrial,
  summarizeOutcomes,
  type TrialPlan,
} from '../src/index.js';

const flatTicks = Array.from({ length: 9 }, (_, index) => ({
  t: index * 125,
  v: 1_000,
  ret: 0,
}));

const plan: TrialPlan = {
  behaviorId: 'random-hold',
  direction: 1,
  leverage: 2,
  stake: cents(500),
  entryIndex: 0,
  manualHoldTicks: 4,
};

describe('MC-1 — trials use the real engine lifecycle', () => {
  it('includes the ordinary 500 ms ascent and tick-derived oxygen', () => {
    const outcome = runEngineTrial({ ticks: flatTicks, plan, theta: 0.0025 });

    expect(outcome.reason).toBe('ascent');
    expect(outcome.ascentCause).toBe('manual');
    expect(outcome.settlementTick).toBe(8);
    expect(outcome.tau).toBe(1);
    expect(outcome.payout).toBe(499);
    expect(outcome.pnl).toBe(-1);
  });

  it('uses RL-4 on a short path without padding or invented ticks', () => {
    const outcome = runEngineTrial({
      ticks: flatTicks.slice(0, 4),
      plan: { ...plan, manualHoldTicks: 100 },
      theta: 0.0025,
    });
    expect(outcome.reason).toBe('round-end');
    expect(outcome.settlementTick).toBe(3);
  });
});

describe('MC-6 — report statistics', () => {
  it('reports RTP, sample error, batches, outcomes, caps and exposure', () => {
    const outcomes = Array.from({ length: 100 }, (_, index) => ({
      ...runEngineTrial({ ticks: flatTicks, plan, theta: index % 2 === 0 ? 0 : 0.0025 }),
      capped: index === 0,
    }));
    const summary = summarizeOutcomes(outcomes, 50);

    expect(summary.positionCount).toBe(100);
    expect(summary.wageredCents).toBe(50_000);
    expect(summary.paidCents).toBe(49_950);
    expect(summary.rtp).toBe(0.999);
    expect(summary.batchCount).toBe(50);
    expect(summary.variance).toBeGreaterThan(0);
    expect(summary.standardError).toBeGreaterThan(0);
    expect(summary.confidence99.low).toBeLessThan(summary.rtp);
    expect(summary.confidence99.high).toBeGreaterThan(summary.rtp);
    expect(summary.settlementReasons.ascent).toBe(100);
    expect(summary.ascentCauses.manual).toBe(100);
    expect(summary.capBinds).toBe(1);
    expect(summary.peakNotionalCents).toBe(1_000);
  });

  it('rejects samples that cannot form the declared deterministic batches', () => {
    const outcome = runEngineTrial({ ticks: flatTicks, plan, theta: 0.0025 });
    expect(() => summarizeOutcomes([outcome], 50)).toThrowError(/batch/i);
  });
});
