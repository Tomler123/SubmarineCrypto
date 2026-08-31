export interface IndexTransformConfig {
  readonly lambda: number;
  readonly sigmaFloor: number;
  readonly clampZ: number;
  readonly tickVolatility: number;
  readonly initialIndex: number;
  readonly initialSigmaSquared: number;
}

export const DEFAULT_INDEX_TRANSFORM_CONFIG: IndexTransformConfig = Object.freeze({
  lambda: 0.997,
  sigmaFloor: 0.00012,
  clampZ: 3.5,
  tickVolatility: 0.0042,
  initialIndex: 1_000,
  // ASSUMPTION: the published transform omitted sigma^2 at round start.
  // FI-11 freezes sigma_floor^2 as the deterministic M1.6 initial state.
  initialSigmaSquared: 0.00012 ** 2,
});

export interface IndexTransformSample {
  readonly value: number;
  readonly ret: number;
}

/** FI-1's operation order, isolated so replay and the future live feed share it. */
export class IndexTransform {
  private previousPrice: number | null = null;
  private sigmaSquared: number;
  private value: number;

  public constructor(private readonly config: IndexTransformConfig) {
    this.sigmaSquared = config.initialSigmaSquared;
    this.value = config.initialIndex;
  }

  public next(price: number): IndexTransformSample {
    if (this.previousPrice === null) {
      this.previousPrice = price;
      return { value: this.value, ret: 0 };
    }

    const rawReturn = Math.log(price / this.previousPrice);
    this.sigmaSquared = (
      this.config.lambda * this.sigmaSquared
      + (1 - this.config.lambda) * rawReturn * rawReturn
    );
    const sigma = Math.sqrt(this.sigmaSquared);
    const unclampedZ = rawReturn / Math.max(sigma, this.config.sigmaFloor);
    const z = Math.max(-this.config.clampZ, Math.min(this.config.clampZ, unclampedZ));
    const indexReturn = z * this.config.tickVolatility;
    this.value *= 1 + indexReturn;
    this.previousPrice = price;

    return { value: this.value, ret: indexReturn };
  }
}
