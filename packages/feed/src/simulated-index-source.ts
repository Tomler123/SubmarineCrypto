import { IndexSourceBase } from './index-source-base.js';

/* SIM-ONLY: not part of the real-feed spec — drift regimes. */
const REGIME_FLIP_P = 0.06;
const REGIME_DECAY = 0.985;
/* SIM-ONLY: not part of the real-feed spec — anti-run pressure. */
const ANTIRUN_K = 0.15;
const ANTIRUN_C = 0.02;
const ANTIRUN_TICKS = 80;
/* SIM-ONLY: not part of the real-feed spec — volatility squalls. */
const SQUALL_P_SEC = 0.015;
const SQUALL_MIN_MS = 3_000;
const SQUALL_MAX_MS = 8_000;
/* SIM-ONLY: squall intensity range. */
const SQUALL_MUL_MIN = 2;
const SQUALL_MUL_MAX = 3;
/* SIM-ONLY: instrumentation — a swing is a completed 2% reversal. */
const SWING_PCT = 0.02;

export interface SimulatedIndexSourceOptions {
  readonly tickMs: number;
  readonly initialIndex: number;
  readonly tickVolatility: number;
  readonly now: () => number;
  readonly random: () => number;
  readonly gaussian: () => number;
  readonly scheduleEvery: (task: () => void, intervalMs: number) => unknown;
  readonly reportRound?: (message: string) => void;
}

const clamp = (value: number, minimum: number, maximum: number): number => (
  value < minimum ? minimum : value > maximum ? maximum : value
);

/** Existing Phase 1 synthetic source, now hosted by the shared feed package. */
export class SimulatedIndexSource extends IndexSourceBase {
  public idx: number;
  public logSig = 0;
  public mu = 0;
  public ew = 1;
  public live = false;
  public retHist: number[] = [];
  public squallTicks = 0;
  public squallMul = 1;
  public stMaxUp = 0;
  public stMaxDn = 0;
  public stSwings = 0;
  public stLegDir = 0;
  public stLegExt: number;
  public readonly timer: unknown;

  public constructor(private readonly options: SimulatedIndexSourceOptions) {
    super();
    this.idx = options.initialIndex;
    this.stLegExt = options.initialIndex;
    this.resetStats();
    this.timer = options.scheduleEvery(() => this._tick(), options.tickMs);
  }

  public override resetRound(): void {
    this.idx = this.options.initialIndex;
    this.mu = 0;
    this.live = true;
    this.retHist.length = 0;
    this.squallTicks = 0;
    this.squallMul = 1;
    this.resetStats();
    this._emit(0, this.openingStamp());
  }

  public override halt(): void {
    this.live = false;
    this.reportRound();
  }

  public _tick(): void {
    if (this.live) this._step();
  }

  private resetStats(): void {
    this.stMaxUp = 0;
    this.stMaxDn = 0;
    this.stSwings = 0;
    this.stLegDir = 0;
    this.stLegExt = this.options.initialIndex;
  }

  private updateStats(): void {
    const currentReturn = this.idx / this.options.initialIndex - 1;
    if (currentReturn > this.stMaxUp) this.stMaxUp = currentReturn;
    if (currentReturn < this.stMaxDn) this.stMaxDn = currentReturn;
    if (this.stLegDir === 0) {
      if (currentReturn >= SWING_PCT) {
        this.stLegDir = 1;
        this.stLegExt = this.idx;
      } else if (currentReturn <= -SWING_PCT) {
        this.stLegDir = -1;
        this.stLegExt = this.idx;
      }
      return;
    }
    if (this.stLegDir > 0) {
      if (this.idx > this.stLegExt) this.stLegExt = this.idx;
      if (this.idx / this.stLegExt - 1 <= -SWING_PCT) {
        this.stSwings += 1;
        this.stLegDir = -1;
        this.stLegExt = this.idx;
      }
    } else {
      if (this.idx < this.stLegExt) this.stLegExt = this.idx;
      if (this.idx / this.stLegExt - 1 >= SWING_PCT) {
        this.stSwings += 1;
        this.stLegDir = 1;
        this.stLegExt = this.idx;
      }
    }
  }

  private reportRound(): void {
    this.options.reportRound?.(
      `[sim] round end — drawup ${(this.stMaxUp * 100).toFixed(2)}% · `
      + `drawdown ${(this.stMaxDn * 100).toFixed(2)}% · `
      + `swings>=${(SWING_PCT * 100).toFixed(0)}% ${this.stSwings}`,
    );
  }

  public _step(): void {
    this.logSig += 0.06 * (0 - this.logSig) + 0.30 * this.options.gaussian();
    let sigma = Math.exp(clamp(this.logSig, -1.4, 1.6));

    if (this.squallTicks > 0) {
      this.squallTicks -= 1;
    } else if (this.options.random() < SQUALL_P_SEC * (this.options.tickMs / 1_000)) {
      this.squallTicks = Math.round(
        (SQUALL_MIN_MS + this.options.random() * (SQUALL_MAX_MS - SQUALL_MIN_MS))
        / this.options.tickMs,
      );
      this.squallMul = (
        SQUALL_MUL_MIN + this.options.random() * (SQUALL_MUL_MAX - SQUALL_MUL_MIN)
      );
    }
    if (this.squallTicks > 0) sigma *= this.squallMul;

    if (this.options.random() < REGIME_FLIP_P) {
      this.mu = (this.options.random() - 0.5) * 1.8;
    }
    this.mu *= REGIME_DECAY;

    let z = this.options.gaussian() * sigma + this.mu * 0.16;
    if (this.options.random() < 0.006) {
      z += (this.options.random() < 0.5 ? -1 : 1)
        * (2 + this.options.random() * 3) * sigma;
    }

    let cumulativeReturn = 0;
    for (const recentReturn of this.retHist) cumulativeReturn += recentReturn;
    z -= ANTIRUN_K * sigma * Math.tanh(cumulativeReturn / ANTIRUN_C);

    this.ew = Math.sqrt(0.94 * this.ew * this.ew + 0.06 * z * z) || 1;
    const indexReturn = clamp(z / this.ew, -3.2, 3.2) * this.options.tickVolatility;
    this.retHist.push(indexReturn);
    if (this.retHist.length > ANTIRUN_TICKS) this.retHist.shift();
    this.idx *= 1 + indexReturn;
    this.updateStats();
    this._emit(indexReturn);
  }

  private openingStamp(): number {
    const timestamp = this.options.now();
    if (!Number.isFinite(this._lastT)) return timestamp;
    return Math.max(timestamp, this._lastT + this.options.tickMs / 2);
  }

  public _emit(ret: number, t = this.options.now()): void {
    this._publish({ t, v: this.idx, ret });
  }
}
