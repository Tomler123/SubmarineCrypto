import type { AlarmSubscriber, IndexSource, IndexTick, TickSubscriber } from './types.js';

/** FI-8's single monotonic-timestamp gate for every feed implementation. */
export class IndexSourceBase implements IndexSource {
  /** Public for legacy Phase 1 instrumentation; consumers subscribe via onTick. */
  public readonly subs: TickSubscriber[] = [];
  private alarmSubscriber: AlarmSubscriber | null = null;
  protected _lastT = -Infinity;
  public rejectedTicks = 0;

  public onTick(subscriber: TickSubscriber): void {
    this.subs.push(subscriber);
  }

  public onAlarm(subscriber: AlarmSubscriber): void {
    this.alarmSubscriber = subscriber;
  }

  public resetRound(): void {
    // Concrete sources own their lifecycle.
  }

  public halt(): void {
    // Concrete sources own their lifecycle.
  }

  protected _publish(tick: IndexTick): boolean {
    if (!Number.isFinite(tick.t) || tick.t <= this._lastT) {
      this.rejectedTicks += 1;
      this.alarmSubscriber?.({
        t: tick.t,
        lastT: this._lastT,
        count: this.rejectedTicks,
      });
      return false;
    }

    this._lastT = tick.t;
    for (const subscriber of this.subs) subscriber(tick);
    return true;
  }

  /** Explicitly rewind only sources whose recorded clock also rewinds. */
  protected _resetMonotonicity(): void {
    this._lastT = -Infinity;
  }
}
