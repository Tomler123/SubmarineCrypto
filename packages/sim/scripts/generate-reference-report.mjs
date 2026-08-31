import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseReplayCsv } from '@crush/feed';
import { canonicalReportJson, runCalibration } from '../dist/index.js';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const fixtureDirectory = resolve(repositoryRoot, 'packages/feed/fixtures');
const reportDirectory = resolve(repositoryRoot, 'docs/calibration');
const fixtureNames = [
  'btcusdt-binance-2021-05-19-calm-100ms.csv',
  'btcusdt-binance-2021-05-19-flash-crash-100ms.csv',
];

const replayFixtures = fixtureNames.map((id) => {
  const bytes = readFileSync(resolve(fixtureDirectory, id));
  return {
    id,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    rows: parseReplayCsv(bytes.toString('utf8')),
  };
});

const candidates = Array.from({ length: 81 }, (_, index) => (
  Number((index * 0.00005).toFixed(5))
));
const report = runCalibration({
  masterSeed: 'crush-depth-m1.7-reference-v1',
  targetRtp: 0.965,
  candidates,
  selectionSamplesPerBehavior: 1_000,
  reportSamplesPerCell: 5_000,
  batchCount: 50,
  simulatorRoundCount: 256,
  replayFixtures,
});

const percent = (value) => `${(value * 100).toFixed(4)}%`;
const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const displayedCandidates = report.candidateResults.filter((candidate) => (
  Math.abs(candidate.theta - report.selectedTheta) <= 0.0002 + Number.EPSILON
));
const candidateRows = displayedCandidates.map((candidate) => (
  `| ${(candidate.theta * 100).toFixed(4)}%/s | ${percent(candidate.simulatorPortfolioRtp)} | ${percent(candidate.absoluteError)} |`
)).join('\n');
const cellRows = report.cells.map((cell) => (
  `| ${cell.source} | ${cell.behaviorId} | ${cell.positionCount.toLocaleString('en-US')} | ${percent(cell.rtp)} | ${percent(cell.confidence99.low)}–${percent(cell.confidence99.high)} | ${cell.settlementReasons.crush} | ${cell.settlementReasons.ascent} | ${cell.settlementReasons['round-end']} | ${cell.capBinds} | ${money(cell.maximumPayoutCents)} | ${money(cell.maximumLossCents)} |`
)).join('\n');

const markdown = `# M1.7 engineering calibration report

- Status: **${report.status}**
- Artifact: \`${report.artifactVersion}\`
- Master seed: \`${report.masterSeed}\`
- Seed derivation: \`${report.seedDerivation}\`
- Stream cohorts: selection \`${report.streamCohorts.selection}\`; final evidence \`${report.streamCohorts.report}\`
- Target RTP: **${percent(report.targetRtp)}**
- Selected θ: **${(report.selectedTheta * 100).toFixed(4)}%/s**

## Methodology

${report.methodology}

Selection samples: ${report.sampleCounts.selectionPerBehaviorCandidate.toLocaleString('en-US')} positions per behavior/candidate. Final evidence: ${report.sampleCounts.reportPerCell.toLocaleString('en-US')} positions per source/behavior cell, split into ${report.sampleCounts.batchCount} deterministic batches. RTP is aggregate paid cents divided by aggregate wagered cents.

Selection portfolio (${report.portfolioEvidence.selectionSimulator.positionCount.toLocaleString('en-US')} simulator positions): **${percent(report.portfolioEvidence.selectionSimulator.rtp)} RTP**, ${percent(report.portfolioEvidence.selectionSimulator.absoluteTargetError)} absolute target error. Final disjoint-stream simulator portfolio (${report.portfolioEvidence.validationSimulator.positionCount.toLocaleString('en-US')} positions): **${percent(report.portfolioEvidence.validationSimulator.rtp)} RTP**, 99% CI ${percent(report.portfolioEvidence.validationSimulator.confidence99.low)} to ${percent(report.portfolioEvidence.validationSimulator.confidence99.high)}, ${percent(report.portfolioEvidence.validationSimulator.absoluteTargetError)} absolute target error. Replay stress portfolio (${report.portfolioEvidence.replayStress.positionCount.toLocaleString('en-US')} positions): **${percent(report.portfolioEvidence.replayStress.rtp)} RTP**, 99% CI ${percent(report.portfolioEvidence.replayStress.confidence99.low)} to ${percent(report.portfolioEvidence.replayStress.confidence99.high)}; it is not calibration input.

## Candidate sweep

| θ | Equal-weight simulator RTP | Absolute target error |
|---:|---:|---:|
${candidateRows}

The table shows the local window around the selected candidate; all ${report.candidateResults.length} evaluated candidates are retained in the JSON artifact.

## Selected-θ evidence

| Source | Behavior | n | RTP | 99% CI | Crush | Ascent | Round end | Cap binds | Max payout | Max loss |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${cellRows}

Peak notional in the reference suite is ${money(Math.max(...report.cells.map((cell) => cell.peakNotionalCents)))}. Full variance, standard-error, cause counts, cents totals, dataset configuration, and provenance are in the adjacent JSON artifact.

## Behavior parameters

\`\`\`json
${JSON.stringify(report.behaviorParameters, null, 2)}
\`\`\`

## Replay dataset and mapping

${report.datasets.replay.provenance.map((fixture) => `- \`${fixture.id}\`: ${fixture.rowCount.toLocaleString('en-US')} rows, SHA-256 \`${fixture.sha256}\``).join('\n')}

Mapping is unchanged from M1.6: ${report.datasets.replay.mapping}.

## Limitations

${report.limitations.map((limitation) => `- ${limitation}`).join('\n')}
`;

mkdirSync(reportDirectory, { recursive: true });
writeFileSync(resolve(reportDirectory, 'm1.7-engineering-report.json'), canonicalReportJson(report));
writeFileSync(resolve(reportDirectory, 'm1.7-engineering-report.md'), markdown);
