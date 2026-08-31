import type { IndexTick } from './types.js';

/** Presentation-only smoothing; authoritative consumers use ticks directly. */
export class InterpBuffer {
  /** Public for legacy Phase 1 diagnostics; consumers use push/valueAt/reset. */
  public readonly a: IndexTick[] = [];

  public reset(): void {
    this.a.length = 0;
  }

  public push(tick: IndexTick): void {
    this.a.push(tick);
    if (this.a.length > 420) this.a.splice(0, 120);
  }

  public valueAt(renderTimestamp: number): number | null {
    if (this.a.length === 0) return null;
    const first = this.a[0]!;
    if (renderTimestamp <= first.t) return first.v;

    for (let index = this.a.length - 1; index >= 0; index -= 1) {
      const previous = this.a[index]!;
      if (previous.t <= renderTimestamp) {
        const next = this.a[index + 1];
        if (next === undefined) return previous.v;
        const rawFraction = (renderTimestamp - previous.t) / (next.t - previous.t);
        const fraction = Math.max(0, Math.min(1, rawFraction));
        const smooth = fraction * fraction * (3 - 2 * fraction);
        return previous.v + (next.v - previous.v) * smooth;
      }
    }
    return first.v;
  }
}
