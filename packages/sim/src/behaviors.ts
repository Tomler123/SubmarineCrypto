import { cents, type Cents } from '@crush/ledger';
import type { Direction, Leverage } from '@crush/engine';
import { createSeededRandom, deriveSeed, uniformIndex } from './random.js';

export const BEHAVIOR_IDS = Object.freeze([
  'random-hold',
  'take-profit',
  'stop-loss',
  'max-leverage',
] as const);

export type BehaviorId = (typeof BEHAVIOR_IDS)[number];

// ASSUMPTION: MC-3 freezes this engineering reference population; it is not a
// claim about observed players and must be versioned before its weights change.
export const REFERENCE_BEHAVIOR_PARAMETERS = Object.freeze({
  stakeCents: 500,
  entryWindowSeconds: 85,
  manualHoldSeconds: Object.freeze({ minimum: 5, maximum: 20 }),
  takeProfitOffset: Object.freeze({ minimum: 0.10, maximum: 0.90 }),
  stopLoss: Object.freeze({ minimum: 0.25, maximum: 0.90 }),
  allowedLeverages: Object.freeze([2, 5, 10, 25]),
});

export interface TrialPlan {
  readonly behaviorId: BehaviorId;
  readonly direction: Direction;
  readonly leverage: Leverage;
  readonly stake: Cents;
  readonly entryIndex: number;
  readonly manualHoldTicks: number | null;
  readonly takeProfit?: number;
  readonly stopLoss?: number;
}

export interface TrialPlanOptions {
  readonly masterSeed: string;
  readonly datasetId: string;
  readonly behaviorId: BehaviorId;
  readonly trialIndex: number;
  readonly legalEntryTickCount: number;
  readonly tickSeconds: number;
  readonly maxIndexMovePerTick: number;
}

export function createTrialPlan(options: TrialPlanOptions): TrialPlan {
  const random = createSeededRandom(deriveSeed(
    options.masterSeed,
    options.datasetId,
    options.behaviorId,
    options.trialIndex,
  ));
  const direction: Direction = random.next() < 0.5 ? 1 : -1;
  const leverage = options.behaviorId === 'max-leverage'
    ? 25
    : REFERENCE_BEHAVIOR_PARAMETERS.allowedLeverages[
      uniformIndex(random, REFERENCE_BEHAVIOR_PARAMETERS.allowedLeverages.length)
    ]!;
  const entryIndex = uniformIndex(random, options.legalEntryTickCount);
  const base: TrialPlan = {
    behaviorId: options.behaviorId,
    direction,
    leverage,
    stake: cents(REFERENCE_BEHAVIOR_PARAMETERS.stakeCents),
    entryIndex,
    manualHoldTicks: null,
  };

  if (options.behaviorId === 'random-hold' || options.behaviorId === 'max-leverage') {
    const range = REFERENCE_BEHAVIOR_PARAMETERS.manualHoldSeconds;
    const holdSeconds = range.minimum + random.next() * (range.maximum - range.minimum);
    return { ...base, manualHoldTicks: Math.floor(holdSeconds / options.tickSeconds) };
  }
  if (options.behaviorId === 'take-profit') {
    const range = REFERENCE_BEHAVIOR_PARAMETERS.takeProfitOffset;
    const offset = range.minimum + random.next() * (range.maximum - range.minimum);
    return {
      ...base,
      takeProfit: 1 + leverage * options.maxIndexMovePerTick + offset,
    };
  }

  const range = REFERENCE_BEHAVIOR_PARAMETERS.stopLoss;
  return {
    ...base,
    stopLoss: range.minimum + random.next() * (range.maximum - range.minimum),
  };
}
