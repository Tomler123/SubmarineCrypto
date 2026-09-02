import { SimulatedIndexSource } from './SimulatedIndexSource.js';
import { InterpBuffer } from './InterpBuffer.js';
import { ReplayIndexSource, parseReplayCsv } from '@crush/feed';
import { CFG } from '../config/constants.js';
import { now } from '../util/math.js';
import { PresentationInterpBuffer } from './presentation-interp-buffer.ts';
import flashCrashFixtureCsv from '../../../../packages/feed/fixtures/btcusdt-binance-2021-05-19-flash-crash-100ms.csv?raw';
import calmFixtureCsv from '../../../../packages/feed/fixtures/btcusdt-binance-2021-05-19-calm-playable-100ms.csv?raw';

const replayScheduler = {
  every(intervalMs, task){ setInterval(task, intervalMs); },
};

const REPLAY_FIXTURES = {
  'flash-crash': flashCrashFixtureCsv,
  calm: calmFixtureCsv,
};

/** Resolve a playable replay fixture. Omitted and unknown names use flash-crash. */
export function selectReplayFixtureName(search = globalThis.location?.search ?? ''){
  const requested = new URLSearchParams(search).get('fixture');
  return Object.prototype.hasOwnProperty.call(REPLAY_FIXTURES, requested)
    ? requested
    : 'flash-crash';
}

/** The only client source-selection point. Default remains the simulator. */
export function createIndexSource(search = globalThis.location?.search ?? ''){
  const requested = new URLSearchParams(search).get('feed');
  if (requested === 'replay'){
    const fixtureName = selectReplayFixtureName(search);
    return new ReplayIndexSource(parseReplayCsv(REPLAY_FIXTURES[fixtureName]), {
      scheduler: replayScheduler,
    });
  }
  return new SimulatedIndexSource();
}

/** Build the presentation buffer in the same source-selection seam. */
export function createPresentationBuffer(
  search = globalThis.location?.search ?? '',
  clock = now,
){
  const historicalTimestamps = new URLSearchParams(search).get('feed') === 'replay';
  return historicalTimestamps
    ? new PresentationInterpBuffer({
        clock,
        historicalTimestamps: true,
        playbackIntervalMs: CFG.TICK_MS,
        interpolationDelayMs: CFG.DELAY_MS,
      })
    : new InterpBuffer();
}

const sessionSearch = globalThis.location?.search ?? '';
export const source = createIndexSource(sessionSearch);
export const buffer = createPresentationBuffer(sessionSearch);
