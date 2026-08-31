import { describe, expect, it } from 'vitest';
import {
  buildReplayDataset,
  generateSimulatorDataset,
} from '../src/index.js';

describe('MC-1/MC-2 — feed-backed calibration datasets', () => {
  it('generates byte-identical simulator rounds from an explicit seed', () => {
    const config = {
      id: 'simulator/reference',
      masterSeed: 'source-seed',
      roundCount: 3,
      ticksPerRound: 80,
    } as const;
    const first = generateSimulatorDataset(config);
    const second = generateSimulatorDataset(config);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.kind).toBe('simulator');
    expect(first.paths).toHaveLength(3);
    expect(first.paths.every((path) => path.ticks.length === 81)).toBe(true);
  });

  it('changes simulator paths when the explicit seed changes', () => {
    const first = generateSimulatorDataset({
      id: 'simulator/reference', masterSeed: 'a', roundCount: 1, ticksPerRound: 20,
    });
    const second = generateSimulatorDataset({
      id: 'simulator/reference', masterSeed: 'b', roundCount: 1, ticksPerRound: 20,
    });
    expect(JSON.stringify(first.paths)).not.toBe(JSON.stringify(second.paths));
  });

  it('builds replay paths through the unchanged 125 ms latest-at-or-before mapping', () => {
    const dataset = buildReplayDataset({
      id: 'replay/test',
      fixtures: [{
        id: 'fixture.csv',
        sha256: 'abc123',
        rows: [0, 100, 200, 300, 400, 500, 600].map((t, index) => ({
          t,
          price: 40_000 + index,
        })),
      }],
    });

    expect(dataset.kind).toBe('replay');
    expect(dataset.paths[0]!.ticks.map((tick) => tick.t))
      .toEqual([0, 100, 200, 300, 500, 600]);
    expect(dataset.provenance).toEqual([{ id: 'fixture.csv', sha256: 'abc123', rowCount: 7 }]);
  });
});
