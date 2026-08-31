import { IndexSourceBase } from './index-source-base.js';
import {
  DEFAULT_INDEX_TRANSFORM_CONFIG,
  IndexTransform,
  type IndexTransformConfig,
} from './index-transform.js';
import { validateReplayRows } from './replay-fixture.js';
import type { ReplayPriceRow, ReplayScheduler } from './types.js';

export interface ReplayIndexSourceOptions {
  readonly scheduler: ReplayScheduler;
  readonly gridIntervalMs?: number;
  readonly playbackIntervalMs?: number;
  readonly indexConfig?: IndexTransformConfig;
}

/** Deterministic recorded-price source behind the shared IndexSource seam. */
export class ReplayIndexSource extends IndexSourceBase {
  private readonly rows: readonly ReplayPriceRow[];
  private readonly gridIntervalMs: number;
  private readonly indexConfig: IndexTransformConfig;
  private transform: IndexTransform;
  private nextRowIndex = 0;
  private lastEmittedRowIndex = -1;
  private nextBoundary = 0;
  private live = false;

  public constructor(rows: readonly ReplayPriceRow[], options: ReplayIndexSourceOptions) {
    super();
    this.rows = validateReplayRows(rows);
    this.gridIntervalMs = options.gridIntervalMs ?? 125;
    const playbackIntervalMs = options.playbackIntervalMs ?? this.gridIntervalMs;
    this.indexConfig = options.indexConfig ?? DEFAULT_INDEX_TRANSFORM_CONFIG;
    if (!Number.isFinite(this.gridIntervalMs) || this.gridIntervalMs <= 0) {
      throw new RangeError('gridIntervalMs must be finite and positive');
    }
    if (!Number.isFinite(playbackIntervalMs) || playbackIntervalMs <= 0) {
      throw new RangeError('playbackIntervalMs must be finite and positive');
    }
    this.transform = new IndexTransform(this.indexConfig);
    options.scheduler.every(playbackIntervalMs, () => this.advanceBoundary());
  }

  public override resetRound(): void {
    this.nextRowIndex = 0;
    this.lastEmittedRowIndex = -1;
    this.nextBoundary = this.rows[0]!.t;
    this.transform = new IndexTransform(this.indexConfig);
    this.live = true;
    this._resetMonotonicity();
    this.advanceBoundary();
  }

  public override halt(): void {
    this.live = false;
  }

  private advanceBoundary(): void {
    if (!this.live) return;

    let selectedRowIndex = -1;
    while (
      this.nextRowIndex < this.rows.length
      && this.rows[this.nextRowIndex]!.t <= this.nextBoundary
    ) {
      selectedRowIndex = this.nextRowIndex;
      this.nextRowIndex += 1;
    }

    if (selectedRowIndex > this.lastEmittedRowIndex) {
      const row = this.rows[selectedRowIndex]!;
      const sample = this.transform.next(row.price);
      this._publish({ t: row.t, v: sample.value, ret: sample.ret });
      this.lastEmittedRowIndex = selectedRowIndex;
    }

    this.nextBoundary += this.gridIntervalMs;
    if (this.nextRowIndex >= this.rows.length) this.live = false;
  }
}
