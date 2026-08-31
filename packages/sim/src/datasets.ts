import {
  ReplayIndexSource,
  SimulatedIndexSource,
  type IndexTick,
  type ReplayPriceRow,
  type ReplayScheduler,
} from '@crush/feed';
import { createSeededRandom, deriveSeed } from './random.js';

export interface CalibrationPath {
  readonly id: string;
  readonly ticks: readonly IndexTick[];
}

export interface DatasetProvenance {
  readonly id: string;
  readonly sha256: string;
  readonly rowCount: number;
}

export interface CalibrationDataset {
  readonly id: string;
  readonly kind: 'simulator' | 'replay';
  readonly paths: readonly CalibrationPath[];
  readonly provenance: readonly DatasetProvenance[];
}

export interface SimulatorDatasetOptions {
  readonly id: string;
  readonly masterSeed: string;
  readonly roundCount: number;
  readonly ticksPerRound: number;
}

class ManualSimulatorScheduler {
  private task: (() => void) | null = null;
  private intervalMs = 0;
  public now = 0;

  public every(task: () => void, intervalMs: number): void {
    this.task = task;
    this.intervalMs = intervalMs;
  }

  public advance(count: number): void {
    for (let index = 0; index < count; index += 1) {
      this.now += this.intervalMs;
      this.task?.();
    }
  }
}

export function generateSimulatorDataset(options: SimulatorDatasetOptions): CalibrationDataset {
  if (!Number.isSafeInteger(options.roundCount) || options.roundCount <= 0) {
    throw new RangeError('roundCount must be a positive safe integer');
  }
  if (!Number.isSafeInteger(options.ticksPerRound) || options.ticksPerRound <= 0) {
    throw new RangeError('ticksPerRound must be a positive safe integer');
  }

  const paths: CalibrationPath[] = [];
  for (let roundIndex = 0; roundIndex < options.roundCount; roundIndex += 1) {
    const random = createSeededRandom(deriveSeed(
      options.masterSeed,
      options.id,
      'source-round',
      roundIndex,
    ));
    const scheduler = new ManualSimulatorScheduler();
    const source = new SimulatedIndexSource({
      tickMs: 125,
      initialIndex: 1_000,
      tickVolatility: 0.0042,
      now: () => scheduler.now,
      random: () => random.next(),
      gaussian: () => random.gaussian(),
      scheduleEvery: (task, intervalMs) => scheduler.every(task, intervalMs),
    });
    const ticks: IndexTick[] = [];
    source.onTick((tick) => ticks.push(tick));
    source.resetRound();
    scheduler.advance(options.ticksPerRound);
    source.halt();
    paths.push({ id: `${options.id}/round-${roundIndex}`, ticks });
  }
  return { id: options.id, kind: 'simulator', paths, provenance: [] };
}

export interface ReplayFixtureInput {
  readonly id: string;
  readonly sha256: string;
  readonly rows: readonly ReplayPriceRow[];
}

export interface ReplayDatasetOptions {
  readonly id: string;
  readonly fixtures: readonly ReplayFixtureInput[];
}

class ManualReplayScheduler implements ReplayScheduler {
  private task: (() => void) | null = null;

  public every(_intervalMs: number, task: () => void): void {
    this.task = task;
  }

  public advance(count: number): void {
    for (let index = 0; index < count; index += 1) this.task?.();
  }
}

export function buildReplayDataset(options: ReplayDatasetOptions): CalibrationDataset {
  if (options.fixtures.length === 0) throw new RangeError('at least one replay fixture is required');
  const paths = options.fixtures.map((fixture): CalibrationPath => {
    const scheduler = new ManualReplayScheduler();
    const source = new ReplayIndexSource(fixture.rows, { scheduler });
    const ticks: IndexTick[] = [];
    source.onTick((tick) => ticks.push(tick));
    source.resetRound();
    const first = fixture.rows[0]!;
    const last = fixture.rows.at(-1)!;
    scheduler.advance(Math.ceil((last.t - first.t) / 125) + 2);
    source.halt();
    // ASSUMPTION: RL-2 caps a recorded path at one 90-second round. A shorter
    // fixture remains short per MC-3; no tick is looped, padded, or invented.
    return { id: fixture.id, ticks: ticks.slice(0, 721) };
  });
  const provenance = options.fixtures.map((fixture) => ({
    id: fixture.id,
    sha256: fixture.sha256,
    rowCount: fixture.rows.length,
  }));
  return { id: options.id, kind: 'replay', paths, provenance };
}
