import { InterpBuffer, type IndexTick } from '@crush/feed';

export interface PresentationInterpBufferOptions {
  readonly clock: () => number;
  readonly historicalTimestamps: boolean;
  readonly playbackIntervalMs: number;
  readonly interpolationDelayMs: number;
}

/**
 * Presentation-only timestamp adaptation at the client feed boundary.
 *
 * Replay ticks keep their original epoch timestamps for every authoritative
 * consumer. Only the copies stored for interpolation are paced on the page
 * clock. That clock is the one which actually delivers replay ticks, so the
 * visual path does not alternate between 100 and 200 ms velocities while the
 * scheduler advances steadily at 125 ms.
 *
 * A sparse fixture can leave the renderer holding the last value beyond its
 * 150 ms look-back. When a new tick arrives after such a stall, a
 * presentation-only hold sample is inserted at the current render horizon.
 * The newly known value is then approached smoothly instead of appearing as
 * a retroactive one-frame jump. Neither copy escapes this buffer.
 */
export class PresentationInterpBuffer extends InterpBuffer {
  public constructor(private readonly options: PresentationInterpBufferOptions) {
    super();
  }

  public override reset(): void {
    super.reset();
  }

  public override push(tick: IndexTick): void {
    if (!this.options.historicalTimestamps) {
      super.push(tick);
      return;
    }

    const pageNow = this.options.clock();
    const previous = this.a.at(-1);
    if (previous === undefined) {
      super.push({ ...tick, t: pageNow });
      return;
    }

    const renderHorizon = pageNow - this.options.interpolationDelayMs;
    if (renderHorizon > previous.t) {
      super.push({ ...previous, t: renderHorizon });
    }

    const latest = this.a.at(-1)!;
    super.push({
      ...tick,
      t: latest.t + this.options.playbackIntervalMs,
    });
  }
}
