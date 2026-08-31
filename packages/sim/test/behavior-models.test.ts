import { describe, expect, it } from 'vitest';
import {
  BEHAVIOR_IDS,
  REFERENCE_BEHAVIOR_PARAMETERS,
  createTrialPlan,
} from '../src/index.js';

describe('MC-3 — documented reference behavior models', () => {
  it('exports exactly the four specification models and their report parameters', () => {
    expect(BEHAVIOR_IDS).toEqual([
      'random-hold',
      'take-profit',
      'stop-loss',
      'max-leverage',
    ]);
    expect(REFERENCE_BEHAVIOR_PARAMETERS).toMatchObject({
      stakeCents: 500,
      entryWindowSeconds: 85,
      manualHoldSeconds: { minimum: 5, maximum: 20 },
      takeProfitOffset: { minimum: 0.10, maximum: 0.90 },
      stopLoss: { minimum: 0.25, maximum: 0.90 },
    });
  });

  it.each(BEHAVIOR_IDS)('%s plans stay inside the documented parameter bounds', (behaviorId) => {
    const plans = Array.from({ length: 1_000 }, (_, trialIndex) => createTrialPlan({
        masterSeed: 'model-bounds',
        datasetId: 'simulator',
        behaviorId,
        trialIndex,
        legalEntryTickCount: 681,
        tickSeconds: 0.125,
        maxIndexMovePerTick: 0.0147,
      }));

    expect(plans.every((plan) => plan.entryIndex >= 0 && plan.entryIndex < 681)).toBe(true);
    expect(plans.every((plan) => plan.direction === 1 || plan.direction === -1)).toBe(true);
    expect(plans.every((plan) => plan.stake === 500)).toBe(true);
    expect(plans.every((plan) => (
      behaviorId === 'max-leverage'
        ? plan.leverage === 25
        : [2, 5, 10, 25].includes(plan.leverage)
    ))).toBe(true);

    const manual = behaviorId === 'random-hold' || behaviorId === 'max-leverage';
    expect(plans.every((plan) => manual
      ? plan.manualHoldTicks !== null && plan.manualHoldTicks >= 40 && plan.manualHoldTicks <= 159
      : plan.manualHoldTicks === null)).toBe(true);
    expect(plans.every((plan) => behaviorId === 'take-profit'
      ? plan.takeProfit !== undefined
        && plan.takeProfit >= 1 + plan.leverage * 0.0147 + 0.10
        && plan.takeProfit < 1 + plan.leverage * 0.0147 + 0.90
      : plan.takeProfit === undefined)).toBe(true);
    expect(plans.every((plan) => behaviorId === 'stop-loss'
      ? plan.stopLoss !== undefined && plan.stopLoss >= 0.25 && plan.stopLoss < 0.90
      : plan.stopLoss === undefined)).toBe(true);
  });

  it('is independent of the order in which trial ids are requested', () => {
    const create = (trialIndex: number) => createTrialPlan({
      masterSeed: 'order-independent',
      datasetId: 'replay/flash',
      behaviorId: 'random-hold',
      trialIndex,
      legalEntryTickCount: 200,
      tickSeconds: 0.125,
      maxIndexMovePerTick: 0.0147,
    });
    const forward = [0, 1, 2, 3].map(create);
    const reverse = [3, 2, 1, 0].map(create).reverse();
    expect(reverse).toEqual(forward);
  });
});
