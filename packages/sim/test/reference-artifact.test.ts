import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CalibrationReport } from '../src/index.js';

describe('MC-8 — committed engineering artifact', () => {
  it('locks the reviewed M1.7 seed, sources, selected theta, and RTP evidence', () => {
    const path = resolve(process.cwd(), 'docs/calibration/m1.7-engineering-report.json');
    const report = JSON.parse(readFileSync(path, 'utf8')) as CalibrationReport;

    expect(report).toMatchObject({
      artifactVersion: 'm1.7-engineering-v1',
      status: 'engineering-preliminary',
      masterSeed: 'crush-depth-m1.7-reference-v1',
      seedDerivation: 'fnv1a32/mulberry32-v1',
      streamCohorts: { selection: 'master', report: 'master/report' },
      targetRtp: 0.965,
      selectedTheta: 0.0003,
      sampleCounts: {
        selectionPerBehaviorCandidate: 1_000,
        reportPerCell: 5_000,
        batchCount: 50,
      },
      portfolioEvidence: {
        selectionSimulator: { positionCount: 4_000, rtp: expect.any(Number) },
        validationSimulator: { positionCount: 20_000, rtp: expect.any(Number) },
        replayStress: { positionCount: 20_000, rtp: expect.any(Number) },
      },
    });
    expect(report.portfolioEvidence.selectionSimulator.rtp).toBeCloseTo(0.965437, 12);
    expect(report.portfolioEvidence.validationSimulator.rtp).toBeCloseTo(0.969492, 12);
    expect(report.portfolioEvidence.replayStress.rtp).toBeCloseTo(1.1034059, 12);
    expect(report.candidateResults).toHaveLength(81);
    expect(report.cells).toHaveLength(8);
    expect(report.datasets.simulator.pathSelection).toBe('uniform-by-declared-path');
    expect(report.datasets.replay.pathSelection).toBe('uniform-by-declared-path');
    expect(report.datasets.replay.mapping).toBe(
      'fixture-start 125 ms grid; latest original row at-or-before; original timestamp/price; no interpolation or invented ticks',
    );
    expect(report.datasets.replay.provenance.map(({ id, sha256 }) => ({ id, sha256 }))).toEqual([
      {
        id: 'btcusdt-binance-2021-05-19-calm-100ms.csv',
        sha256: '59463c347c2a1d5532eb234475b5cd5125e7b51357b8669e67a030f6eae6aefb',
      },
      {
        id: 'btcusdt-binance-2021-05-19-flash-crash-100ms.csv',
        sha256: '1d9ea391c64557a7709af978a606b08f60c61be160dbbf8d891415f9858fd194',
      },
    ]);
  });
});
