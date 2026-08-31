/**
 * @crush/sim — Monte-Carlo RTP calibration harness (M1.7).
 *
 * Runs the real @crush/engine across the MC-3 reference behaviors using seeded
 * simulator and recorded replay datasets. The deterministic report is
 * engineering evidence used before the separate PL-6 release-scale run.
 */

export const SIM_PACKAGE = '@crush/sim';

export {
  BEHAVIOR_IDS,
  REFERENCE_BEHAVIOR_PARAMETERS,
  createTrialPlan,
  type BehaviorId,
  type TrialPlan,
  type TrialPlanOptions,
} from './behaviors.js';
export {
  buildReplayDataset,
  generateSimulatorDataset,
  type CalibrationDataset,
  type CalibrationPath,
  type DatasetProvenance,
  type ReplayDatasetOptions,
  type ReplayFixtureInput,
  type SimulatorDatasetOptions,
} from './datasets.js';
export {
  canonicalReportJson,
  runCalibration,
  selectThetaCandidate,
  type CalibrationCell,
  type CalibrationOptions,
  type CalibrationReport,
  type CandidateResult,
  type PortfolioValidationEvidence,
} from './calibration.js';
export { createSeededRandom, deriveSeed, type SeededRandom } from './random.js';
export {
  summarizeOutcomes,
  type CellStatistics,
  type ConfidenceInterval,
} from './statistics.js';
export { runEngineTrial, type RunTrialOptions, type TrialOutcome } from './trial.js';
