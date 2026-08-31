import { DEFAULT_CONFIG } from '@crush/engine';
import type { IndexTick } from '@crush/feed';
import { BEHAVIOR_IDS, REFERENCE_BEHAVIOR_PARAMETERS, createTrialPlan, type BehaviorId } from './behaviors.js';
import {
  buildReplayDataset,
  generateSimulatorDataset,
  type CalibrationDataset,
  type CalibrationPath,
  type DatasetProvenance,
  type ReplayFixtureInput,
} from './datasets.js';
import { createSeededRandom, deriveSeed, uniformIndex } from './random.js';
import { summarizeOutcomes, type CellStatistics } from './statistics.js';
import { runEngineTrial, type TrialOutcome } from './trial.js';

export interface CalibrationOptions {
  readonly masterSeed: string;
  readonly targetRtp: number;
  readonly candidates: readonly number[];
  readonly selectionSamplesPerBehavior: number;
  readonly reportSamplesPerCell: number;
  readonly batchCount: number;
  readonly simulatorRoundCount: number;
  readonly replayFixtures: readonly ReplayFixtureInput[];
  readonly behaviorOrder?: readonly BehaviorId[];
  readonly trialOrder?: 'forward' | 'reverse';
}

export interface CandidateResult {
  readonly theta: number;
  readonly simulatorPortfolioRtp: number;
  readonly absoluteError: number;
  readonly behaviorRtps: Readonly<Record<BehaviorId, number>>;
}

export interface CalibrationCell extends CellStatistics {
  readonly source: 'simulator' | 'replay';
  readonly datasetId: string;
  readonly behaviorId: BehaviorId;
  readonly theta: number;
}

export interface PortfolioValidationEvidence {
  readonly positionCount: number;
  readonly rtp: number;
  readonly variance: number;
  readonly standardError: number;
  readonly confidence99: CellStatistics['confidence99'];
}

export interface CalibrationReport {
  readonly artifactVersion: 'm1.7-engineering-v1';
  readonly status: 'engineering-preliminary';
  readonly seedDerivation: 'fnv1a32/mulberry32-v1';
  readonly streamCohorts: {
    readonly selection: 'master';
    readonly report: 'master/report';
  };
  readonly masterSeed: string;
  readonly targetRtp: number;
  readonly selectedTheta: number;
  readonly sampleCounts: {
    readonly selectionPerBehaviorCandidate: number;
    readonly reportPerCell: number;
    readonly batchCount: number;
  };
  readonly behaviorParameters: typeof REFERENCE_BEHAVIOR_PARAMETERS;
  readonly candidateResults: readonly CandidateResult[];
  readonly portfolioEvidence: {
    readonly selectionSimulator: {
      readonly positionCount: number;
      readonly rtp: number;
      readonly absoluteTargetError: number;
    };
    readonly validationSimulator: PortfolioValidationEvidence & {
      readonly absoluteTargetError: number;
    };
    readonly replayStress: PortfolioValidationEvidence;
  };
  readonly cells: readonly CalibrationCell[];
  readonly datasets: {
    readonly simulator: {
      readonly id: string;
      readonly roundCount: number;
      readonly ticksPerFullRound: number;
      readonly tickMs: number;
      readonly initialIndex: number;
      readonly tickVolatility: number;
      readonly pathSelection: 'uniform-by-declared-path';
    };
    readonly replay: {
      readonly id: string;
      readonly mapping: string;
      readonly pathSelection: 'uniform-by-declared-path';
      readonly provenance: readonly DatasetProvenance[];
    };
  };
  readonly methodology: string;
  readonly limitations: readonly string[];
}

export function selectThetaCandidate(
  candidates: readonly number[],
  targetRtp: number,
  score: (theta: number) => number,
): number {
  const ordered = normalizedCandidates(candidates);
  let selected = ordered[0]!;
  let selectedError = Math.abs(score(selected) - targetRtp);
  for (const candidate of ordered.slice(1)) {
    const error = Math.abs(score(candidate) - targetRtp);
    if (error < selectedError - 1e-15) {
      selected = candidate;
      selectedError = error;
    }
  }
  return selected;
}

function normalizedCandidates(candidates: readonly number[]): readonly number[] {
  const ordered = [...new Set(candidates)].sort((first, second) => first - second);
  if (ordered.length === 0 || ordered.some((theta) => !Number.isFinite(theta) || theta < 0)) {
    throw new RangeError('theta candidates must be non-empty, finite, and non-negative');
  }
  return ordered;
}

function legalEntryTickCount(ticks: readonly IndexTick[]): number {
  const cutoff = Math.min(ticks[0]!.t + 85_000, ticks.at(-1)!.t - 5_000);
  let count = 0;
  while (count < ticks.length && ticks[count]!.t <= cutoff) count += 1;
  return Math.max(1, count);
}

function selectPath(
  dataset: CalibrationDataset,
  masterSeed: string,
  behaviorId: BehaviorId,
  trialIndex: number,
): CalibrationPath {
  const random = createSeededRandom(deriveSeed(masterSeed, dataset.id, behaviorId, trialIndex, 'path'));
  return dataset.paths[uniformIndex(random, dataset.paths.length)]!;
}

function runOutcomes(
  dataset: CalibrationDataset,
  behaviorId: BehaviorId,
  theta: number,
  sampleCount: number,
  masterSeed: string,
  trialOrder: 'forward' | 'reverse',
  cohort: 'selection' | 'report',
): readonly TrialOutcome[] {
  if (!Number.isSafeInteger(sampleCount) || sampleCount <= 0) {
    throw new RangeError('sampleCount must be a positive safe integer');
  }
  const outcomes = new Array<TrialOutcome>(sampleCount);
  const cohortSeed = cohort === 'selection' ? masterSeed : `${masterSeed}/report`;
  for (let executionIndex = 0; executionIndex < sampleCount; executionIndex += 1) {
    const trialIndex = trialOrder === 'reverse' ? sampleCount - executionIndex - 1 : executionIndex;
    const path = selectPath(dataset, cohortSeed, behaviorId, trialIndex);
    const plan = createTrialPlan({
      masterSeed: cohortSeed,
      datasetId: dataset.id,
      behaviorId,
      trialIndex,
      legalEntryTickCount: legalEntryTickCount(path.ticks),
      tickSeconds: DEFAULT_CONFIG.tickSeconds,
      maxIndexMovePerTick: DEFAULT_CONFIG.maxIndexMovePerTick,
    });
    outcomes[trialIndex] = runEngineTrial({ ticks: path.ticks, plan, theta });
  }
  return outcomes;
}

function rtpOf(outcomes: readonly TrialOutcome[]): number {
  const wagered = outcomes.reduce((sum, outcome) => sum + outcome.stake, 0);
  const paid = outcomes.reduce((sum, outcome) => sum + outcome.payout, 0);
  return paid / wagered;
}

function behaviorRtpRecord(values: ReadonlyMap<BehaviorId, number>): Record<BehaviorId, number> {
  return {
    'random-hold': values.get('random-hold')!,
    'take-profit': values.get('take-profit')!,
    'stop-loss': values.get('stop-loss')!,
    'max-leverage': values.get('max-leverage')!,
  };
}

function validateBehaviorOrder(order: readonly BehaviorId[]): readonly BehaviorId[] {
  if (order.length !== BEHAVIOR_IDS.length || new Set(order).size !== BEHAVIOR_IDS.length) {
    throw new RangeError('behaviorOrder must contain every reference behavior exactly once');
  }
  for (const behavior of BEHAVIOR_IDS) {
    if (!order.includes(behavior)) throw new RangeError('behaviorOrder is incomplete');
  }
  return order;
}

function interleaveOutcomes(
  outcomesByBehavior: ReadonlyMap<BehaviorId, readonly TrialOutcome[]>,
): readonly TrialOutcome[] {
  const sampleCount = outcomesByBehavior.get(BEHAVIOR_IDS[0])?.length ?? 0;
  const interleaved: TrialOutcome[] = [];
  for (let trialIndex = 0; trialIndex < sampleCount; trialIndex += 1) {
    for (const behaviorId of BEHAVIOR_IDS) {
      const outcomes = outcomesByBehavior.get(behaviorId);
      if (outcomes?.length !== sampleCount) {
        throw new RangeError('portfolio behavior samples must have equal sizes');
      }
      interleaved.push(outcomes[trialIndex]!);
    }
  }
  return interleaved;
}

function portfolioStatistics(stats: CellStatistics): PortfolioValidationEvidence {
  return {
    positionCount: stats.positionCount,
    rtp: stats.rtp,
    variance: stats.variance,
    standardError: stats.standardError,
    confidence99: stats.confidence99,
  };
}

export function runCalibration(options: CalibrationOptions): CalibrationReport {
  if (!Number.isFinite(options.targetRtp) || options.targetRtp <= 0) {
    throw new RangeError('targetRtp must be finite and positive');
  }
  if (options.batchCount !== 50 || options.reportSamplesPerCell % options.batchCount !== 0) {
    throw new RangeError('reportSamplesPerCell must divide into 50 batches');
  }
  const candidates = normalizedCandidates(options.candidates);
  const behaviorExecutionOrder = validateBehaviorOrder(options.behaviorOrder ?? BEHAVIOR_IDS);
  const trialOrder = options.trialOrder ?? 'forward';
  const simulator = generateSimulatorDataset({
    id: 'simulator/reference-v1',
    masterSeed: options.masterSeed,
    roundCount: options.simulatorRoundCount,
    ticksPerRound: 720,
  });
  const replay = buildReplayDataset({ id: 'replay/m1.6-fixtures', fixtures: options.replayFixtures });

  const candidateResults = candidates.map((theta): CandidateResult => {
    const behaviorRtps = new Map<BehaviorId, number>();
    for (const behaviorId of behaviorExecutionOrder) {
      behaviorRtps.set(behaviorId, rtpOf(runOutcomes(
        simulator,
        behaviorId,
        theta,
        options.selectionSamplesPerBehavior,
        options.masterSeed,
        trialOrder,
        'selection',
      )));
    }
    const canonicalRtps = behaviorRtpRecord(behaviorRtps);
    const simulatorPortfolioRtp = BEHAVIOR_IDS.reduce(
      (sum, behaviorId) => sum + canonicalRtps[behaviorId],
      0,
    ) / BEHAVIOR_IDS.length;
    return {
      theta,
      simulatorPortfolioRtp,
      absoluteError: Math.abs(simulatorPortfolioRtp - options.targetRtp),
      behaviorRtps: canonicalRtps,
    };
  });
  const scoreByTheta = new Map(candidateResults.map((result) => [result.theta, result.simulatorPortfolioRtp]));
  const selectedTheta = selectThetaCandidate(candidates, options.targetRtp, (theta) => scoreByTheta.get(theta)!);

  const cellMap = new Map<string, CalibrationCell>();
  const outcomeMap = new Map<string, readonly TrialOutcome[]>();
  for (const dataset of [simulator, replay]) {
    for (const behaviorId of behaviorExecutionOrder) {
      const outcomes = runOutcomes(
        dataset,
        behaviorId,
        selectedTheta,
        options.reportSamplesPerCell,
        options.masterSeed,
        trialOrder,
        'report',
      );
      outcomeMap.set(`${dataset.kind}/${behaviorId}`, outcomes);
      const stats = summarizeOutcomes(outcomes, options.batchCount);
      cellMap.set(`${dataset.kind}/${behaviorId}`, {
        source: dataset.kind,
        datasetId: dataset.id,
        behaviorId,
        theta: selectedTheta,
        ...stats,
      });
    }
  }
  const cells = (['simulator', 'replay'] as const).flatMap((source) => (
    BEHAVIOR_IDS.map((behaviorId) => cellMap.get(`${source}/${behaviorId}`)!)
  ));
  const aggregate = (source: 'simulator' | 'replay'): CellStatistics => summarizeOutcomes(
    interleaveOutcomes(new Map(BEHAVIOR_IDS.map((behaviorId) => [
      behaviorId,
      outcomeMap.get(`${source}/${behaviorId}`)!,
    ]))),
    options.batchCount,
  );
  const validationSimulator = portfolioStatistics(aggregate('simulator'));
  const replayStress = portfolioStatistics(aggregate('replay'));
  const selectionSimulator = candidateResults.find((result) => result.theta === selectedTheta)!;

  return {
    artifactVersion: 'm1.7-engineering-v1',
    status: 'engineering-preliminary',
    seedDerivation: 'fnv1a32/mulberry32-v1',
    streamCohorts: { selection: 'master', report: 'master/report' },
    masterSeed: options.masterSeed,
    targetRtp: options.targetRtp,
    selectedTheta,
    sampleCounts: {
      selectionPerBehaviorCandidate: options.selectionSamplesPerBehavior,
      reportPerCell: options.reportSamplesPerCell,
      batchCount: options.batchCount,
    },
    behaviorParameters: REFERENCE_BEHAVIOR_PARAMETERS,
    candidateResults,
    portfolioEvidence: {
      selectionSimulator: {
        positionCount: options.selectionSamplesPerBehavior * BEHAVIOR_IDS.length,
        rtp: selectionSimulator.simulatorPortfolioRtp,
        absoluteTargetError: selectionSimulator.absoluteError,
      },
      validationSimulator: {
        ...validationSimulator,
        absoluteTargetError: Math.abs(validationSimulator.rtp - options.targetRtp),
      },
      replayStress,
    },
    cells,
    datasets: {
      simulator: {
        id: simulator.id,
        roundCount: options.simulatorRoundCount,
        ticksPerFullRound: 721,
        tickMs: 125,
        initialIndex: 1_000,
        tickVolatility: 0.0042,
        pathSelection: 'uniform-by-declared-path',
      },
      replay: {
        id: replay.id,
        mapping: 'fixture-start 125 ms grid; latest original row at-or-before; original timestamp/price; no interpolation or invented ticks',
        pathSelection: 'uniform-by-declared-path',
        provenance: replay.provenance,
      },
    },
    methodology: 'Theta minimizes absolute error from 96.5% for the equal-weight mean of four simulator behavior RTPs. Trials select uniformly among the declared paths in their source dataset. Candidates use common trial-addressed random streams; the final report uses a disjoint derived stream cohort. Replay cells are separate selected-regime stress evidence and are not pooled into theta selection. Cell and portfolio uncertainty are two-sided 99% Student-t intervals over 50 deterministic contiguous batches.',
    limitations: [
      'Engineering-preliminary only: PL-6 still requires a release run of at least 10⁷ simulator positions.',
      'The two committed M1.6 replay fixtures contain 130 seconds of selected calm/flash-crash BTC data, not the at least 90 days required by PL-6.',
      'Reference behavior and equal mixture weights are declared assumptions, not observed production-player telemetry.',
      'Confidence intervals quantify action/path sampling conditional on these datasets; they do not estimate unobserved BTC market regimes.',
    ],
  };
}

export function canonicalReportJson(report: CalibrationReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
