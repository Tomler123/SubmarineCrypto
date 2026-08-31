import { describe, expect, it } from 'vitest';
import {
  canonicalReportJson,
  runCalibration,
  selectThetaCandidate,
} from '../src/index.js';

const replayFixtures = [{
  id: 'recorded-test.csv',
  sha256: 'fixture-sha',
  rows: Array.from({ length: 121 }, (_, index) => ({
    t: index * 100,
    price: 40_000 + Math.sin(index / 5) * 100,
  })),
}];

describe('MC-5 — deterministic candidate selection', () => {
  it('is candidate-order independent and favors lower theta on a tie', () => {
    const scores = new Map([[0.001, 0.96], [0.002, 0.97], [0.003, 0.94]]);
    const select = (candidates: readonly number[]) => selectThetaCandidate(
      candidates,
      0.965,
      (theta) => scores.get(theta)!,
    );
    expect(select([0.003, 0.002, 0.001])).toBe(0.001);
    expect(select([0.001, 0.002, 0.003])).toBe(0.001);
  });
});

describe('MC-4…MC-8 — calibration report', () => {
  it('is byte-identical across fresh runs and input iteration orders', () => {
    const base = {
      masterSeed: 'report-seed',
      targetRtp: 0.965,
      candidates: [0.002, 0.0025],
      selectionSamplesPerBehavior: 50,
      reportSamplesPerCell: 100,
      batchCount: 50,
      simulatorRoundCount: 4,
      replayFixtures,
    } as const;
    const first = runCalibration(base);
    const second = runCalibration({
      ...base,
      candidates: [...base.candidates].reverse(),
      behaviorOrder: ['max-leverage', 'stop-loss', 'take-profit', 'random-hold'],
      trialOrder: 'reverse',
    });

    expect(canonicalReportJson(first)).toBe(canonicalReportJson(second));
  }, 30_000);

  it('contains the review and limitation fields required by MC-8', () => {
    const report = runCalibration({
      masterSeed: 'report-fields',
      targetRtp: 0.965,
      candidates: [0.0025],
      selectionSamplesPerBehavior: 50,
      reportSamplesPerCell: 100,
      batchCount: 50,
      simulatorRoundCount: 2,
      replayFixtures,
    });

    expect(report).toMatchObject({
      artifactVersion: 'm1.7-engineering-v1',
      status: 'engineering-preliminary',
      seedDerivation: 'fnv1a32/mulberry32-v1',
      streamCohorts: { selection: 'master', report: 'master/report' },
      masterSeed: 'report-fields',
      targetRtp: 0.965,
      selectedTheta: 0.0025,
      methodology: expect.any(String),
      limitations: expect.arrayContaining([
        expect.stringMatching(/10⁷/),
        expect.stringMatching(/90 days/i),
      ]),
    });
    expect(report.candidateResults).toHaveLength(1);
    expect(report.cells).toHaveLength(8);
    expect(report.portfolioEvidence).toMatchObject({
      selectionSimulator: {
        positionCount: 200,
        rtp: expect.any(Number),
        absoluteTargetError: expect.any(Number),
      },
      validationSimulator: {
        positionCount: 400,
        rtp: expect.any(Number),
        absoluteTargetError: expect.any(Number),
        standardError: expect.any(Number),
        confidence99: { low: expect.any(Number), high: expect.any(Number) },
      },
      replayStress: {
        positionCount: 400,
        rtp: expect.any(Number),
        standardError: expect.any(Number),
        confidence99: { low: expect.any(Number), high: expect.any(Number) },
      },
    });
    expect(report.datasets.replay.provenance[0]).toMatchObject({
      id: 'recorded-test.csv', sha256: 'fixture-sha', rowCount: 121,
    });
    expect(report.datasets).toMatchObject({
      simulator: { pathSelection: 'uniform-by-declared-path' },
      replay: { pathSelection: 'uniform-by-declared-path' },
    });
  }, 30_000);
});
