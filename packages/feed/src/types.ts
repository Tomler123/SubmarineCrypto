export interface IndexTick {
  readonly t: number;
  readonly v: number;
  readonly ret: number;
}

export interface IndexAlarm {
  readonly t: number;
  readonly lastT: number;
  readonly count: number;
}

export type TickSubscriber = (tick: IndexTick) => void;
export type AlarmSubscriber = (alarm: IndexAlarm) => void;

export interface IndexSource {
  readonly rejectedTicks: number;
  onTick(subscriber: TickSubscriber): void;
  onAlarm(subscriber: AlarmSubscriber): void;
  resetRound(): void;
  halt(): void;
}

export interface ReplayPriceRow {
  readonly t: number;
  readonly price: number;
}

/** Playback pacing only; it never supplies a replay timestamp or value. */
export interface ReplayScheduler {
  every(intervalMs: number, task: () => void): void;
}
