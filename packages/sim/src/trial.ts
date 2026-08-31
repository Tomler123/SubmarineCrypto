import {
  DEFAULT_CONFIG,
  initialState,
  maxPayoutFor,
  onTick,
  open,
  requestAscent,
  settleAtRoundEnd,
  type AscentCause,
  type EngineConfig,
  type SettlementReason,
} from '@crush/engine';
import { cents, scaleCents, type Cents } from '@crush/ledger';
import type { IndexTick } from '@crush/feed';
import type { TrialPlan } from './behaviors.js';

export interface TrialOutcome {
  readonly behaviorId: TrialPlan['behaviorId'];
  readonly stake: Cents;
  readonly payout: Cents;
  readonly pnl: Cents;
  readonly returnRatio: number;
  readonly reason: SettlementReason;
  readonly ascentCause: AscentCause | null;
  readonly settlementTick: number;
  readonly tau: number;
  readonly capped: boolean;
  readonly notionalCents: number;
}

export interface RunTrialOptions {
  readonly ticks: readonly IndexTick[];
  readonly plan: TrialPlan;
  readonly theta: number;
}

export function runEngineTrial(options: RunTrialOptions): TrialOutcome {
  if (options.ticks.length === 0) throw new RangeError('trial requires at least one tick');
  if (options.plan.entryIndex < 0 || options.plan.entryIndex >= options.ticks.length) {
    throw new RangeError('entryIndex is outside the authoritative path');
  }
  const config: EngineConfig = Object.freeze({
    ...DEFAULT_CONFIG,
    thetaPerSecond: options.theta,
  });
  let state = initialState(cents(2_000_000));
  const entryTick = options.ticks[options.plan.entryIndex]!;
  const opened = open(state, {
    id: 'calibration-position',
    dir: options.plan.direction,
    lev: options.plan.leverage,
    stake: options.plan.stake,
    ...(options.plan.takeProfit === undefined ? {} : { takeProfit: options.plan.takeProfit }),
    ...(options.plan.stopLoss === undefined ? {} : { stopLoss: options.plan.stopLoss }),
  }, entryTick, config);
  state = opened.state;
  if (state.position === null) throw new Error('reference trial entry was rejected');

  let processedTicks = 0;
  for (let tickIndex = options.plan.entryIndex + 1; tickIndex < options.ticks.length; tickIndex += 1) {
    const tick = options.ticks[tickIndex]!;
    state = onTick(state, tick, config).state;
    processedTicks += 1;
    if (state.position?.state === 'done') break;
    if (
      options.plan.manualHoldTicks !== null
      && processedTicks >= options.plan.manualHoldTicks
      && state.position?.state === 'open'
    ) {
      state = requestAscent(state, tick.t, config).state;
    }
  }

  if (state.position?.state !== 'done') {
    state = settleAtRoundEnd(state, options.ticks.at(-1)!, config).state;
  }
  const settlement = state.lastResult;
  if (settlement === null) throw new Error('reference trial did not settle');
  const cap = maxPayoutFor(options.plan.stake, config);
  const uncapped = settlement.multiplier <= 0
    ? cents(0)
    : scaleCents(options.plan.stake, settlement.multiplier);
  const settlementTick = options.ticks.findIndex((tick) => tick === settlement.tick);

  return {
    behaviorId: options.plan.behaviorId,
    stake: options.plan.stake,
    payout: settlement.payout,
    pnl: settlement.pnl,
    returnRatio: settlement.payout / options.plan.stake,
    reason: settlement.reason,
    ascentCause: settlement.ascentCause,
    settlementTick,
    tau: settlement.tau,
    capped: uncapped > cap,
    notionalCents: options.plan.stake * options.plan.leverage,
  };
}
