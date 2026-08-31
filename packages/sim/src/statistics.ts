import type { AscentCause, SettlementReason } from '@crush/engine';
import type { TrialOutcome } from './trial.js';

export interface ConfidenceInterval {
  readonly low: number;
  readonly high: number;
}

export interface CellStatistics {
  readonly positionCount: number;
  readonly wageredCents: number;
  readonly paidCents: number;
  readonly rtp: number;
  readonly variance: number;
  readonly standardError: number;
  readonly confidence99: ConfidenceInterval;
  readonly batchCount: number;
  readonly settlementReasons: Readonly<Record<SettlementReason, number>>;
  readonly ascentCauses: Readonly<Record<AscentCause | 'none', number>>;
  readonly capBinds: number;
  readonly capBindRate: number;
  readonly maximumPayoutCents: number;
  readonly maximumLossCents: number;
  readonly peakNotionalCents: number;
}

const T99_DF49 = 2.67995197363155;

function sampleVariance(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
}

export function summarizeOutcomes(
  outcomes: readonly TrialOutcome[],
  batchCount: number,
): CellStatistics {
  if (batchCount !== 50 || outcomes.length < batchCount || outcomes.length % batchCount !== 0) {
    throw new RangeError('outcomes must divide exactly into the declared 50 batches');
  }
  const wageredCents = outcomes.reduce((sum, outcome) => sum + outcome.stake, 0);
  const paidCents = outcomes.reduce((sum, outcome) => sum + outcome.payout, 0);
  if (wageredCents <= 0) throw new RangeError('reported wager must be positive');
  const rtp = paidCents / wageredCents;
  const batchSize = outcomes.length / batchCount;
  const batchRtps = Array.from({ length: batchCount }, (_, batchIndex) => {
    const batch = outcomes.slice(batchIndex * batchSize, (batchIndex + 1) * batchSize);
    const wagered = batch.reduce((sum, outcome) => sum + outcome.stake, 0);
    const paid = batch.reduce((sum, outcome) => sum + outcome.payout, 0);
    return paid / wagered;
  });
  const standardError = Math.sqrt(sampleVariance(batchRtps) / batchCount);
  const margin = T99_DF49 * standardError;
  const settlementReasons: Record<SettlementReason, number> = {
    crush: 0,
    ascent: 0,
    'round-end': 0,
  };
  const ascentCauses: Record<AscentCause | 'none', number> = {
    manual: 0,
    'take-profit': 0,
    'stop-loss': 0,
    'max-win': 0,
    none: 0,
  };
  let capBinds = 0;
  let maximumPayoutCents = 0;
  let maximumLossCents = 0;
  let peakNotionalCents = 0;
  for (const outcome of outcomes) {
    settlementReasons[outcome.reason] += 1;
    ascentCauses[outcome.ascentCause ?? 'none'] += 1;
    if (outcome.capped) capBinds += 1;
    maximumPayoutCents = Math.max(maximumPayoutCents, outcome.payout);
    maximumLossCents = Math.max(maximumLossCents, -outcome.pnl);
    peakNotionalCents = Math.max(peakNotionalCents, outcome.notionalCents);
  }
  const variance = sampleVariance(outcomes.map((outcome) => outcome.returnRatio));
  for (const value of [rtp, variance, standardError, margin]) {
    if (!Number.isFinite(value)) throw new RangeError('non-finite report statistic');
  }

  return {
    positionCount: outcomes.length,
    wageredCents,
    paidCents,
    rtp,
    variance,
    standardError,
    confidence99: { low: rtp - margin, high: rtp + margin },
    batchCount,
    settlementReasons,
    ascentCauses,
    capBinds,
    capBindRate: capBinds / outcomes.length,
    maximumPayoutCents,
    maximumLossCents,
    peakNotionalCents,
  };
}
