import { SimulatedIndexSource as PackageSimulatedIndexSource } from '@crush/feed';
import { CFG } from '../config/constants.js';
import { now } from '../util/math.js';
import { rnd, gauss } from '../util/random.js';

/** Phase 1 dependency adapter; the simulator implementation lives in @crush/feed. */
export class SimulatedIndexSource extends PackageSimulatedIndexSource {
  constructor(){
    super({
      tickMs: CFG.TICK_MS,
      initialIndex: CFG.IDX0,
      tickVolatility: CFG.TICK_VOL,
      now,
      random: rnd,
      gaussian: gauss,
      scheduleEvery: (task, intervalMs) => setInterval(task, intervalMs),
      reportRound: message => console.log(message),
    });
  }
}
