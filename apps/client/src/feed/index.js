import { SimulatedIndexSource } from './SimulatedIndexSource.js';
import { InterpBuffer } from './InterpBuffer.js';
import { ReplayIndexSource, parseReplayCsv } from '@crush/feed';
import flashCrashFixtureCsv from '../../../../packages/feed/fixtures/btcusdt-binance-2021-05-19-flash-crash-100ms.csv?raw';

const replayScheduler = {
  every(intervalMs, task){ setInterval(task, intervalMs); },
};

/** The only client source-selection point. Default remains the simulator. */
export function createIndexSource(search = globalThis.location?.search ?? ''){
  const requested = new URLSearchParams(search).get('feed');
  if (requested === 'replay'){
    return new ReplayIndexSource(parseReplayCsv(flashCrashFixtureCsv), {
      scheduler: replayScheduler,
    });
  }
  return new SimulatedIndexSource();
}

export const source = createIndexSource();
export const buffer = new InterpBuffer();
