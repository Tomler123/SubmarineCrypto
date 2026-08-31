import { ReplayIndexSource } from '@crush/feed';
import { describeIndexSourceContract } from './support/index-source-contract.js';

class ManualScheduler {
  every(_intervalMs, task){ this.task = task; }
  advance(count){
    for (let index = 0; index < count; index++) this.task?.();
  }
}

const fixture = Array.from({ length: 2_001 }, (_, index) => ({
  t: index * 100,
  price: 40_000 + Math.sin(index / 10),
}));

let scheduler;

describeIndexSourceContract('ReplayIndexSource', {
  create: () => {
    scheduler = new ManualScheduler();
    return new ReplayIndexSource(fixture, { scheduler });
  },
  advance: (_source, ticks) => scheduler.advance(ticks),
  rewindsClock: true,
});
