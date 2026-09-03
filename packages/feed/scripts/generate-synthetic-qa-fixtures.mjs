import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const INTERVAL_MS = 125;
const ROW_COUNT = 801;
const INITIAL_PRICE = 40_000;
const LAMBDA = 0.997;
const SIGMA_FLOOR = 0.00012;
const CLAMP_Z = 3.5;

function cappedRawReturn(sigmaSquared, direction) {
  if (direction === 0) return 0;
  const denominator = 1 - (1 - LAMBDA) * CLAMP_Z ** 2;
  return direction * CLAMP_Z * Math.sqrt(LAMBDA * sigmaSquared / denominator);
}

function makeRows(startTimestamp, directionAt) {
  let price = INITIAL_PRICE;
  let sigmaSquared = SIGMA_FLOOR ** 2;
  return Array.from({ length: ROW_COUNT }, (_, index) => {
    if (index > 0) {
      const rawReturn = cappedRawReturn(sigmaSquared, directionAt(index));
      price *= Math.exp(rawReturn);
      sigmaSquared = LAMBDA * sigmaSquared + (1 - LAMBDA) * rawReturn ** 2;
    }
    return `${startTimestamp + index * INTERVAL_MS},${price.toPrecision(15)}`;
  });
}

function writeFixture(fileName, startTimestamp, directionAt) {
  const rows = makeRows(startTimestamp, directionAt);
  writeFileSync(
    join(FIXTURE_DIRECTORY, fileName),
    `timestamp_ms,price\n${rows.join('\n')}\n`,
    'utf8',
  );
}

// ASSUMPTION: ten quiet running seconds make the upper-bound transition easy
// to observe after the 8 s waiting and 1.4 s launching phases.
writeFixture('synthetic-upper-limit-125ms.csv', 1_700_000_000_000, (index) => {
  if (index >= 80 && index < 136) return 1;
  if (index >= 136 && index < 192) return -1;
  return 0;
});

// ASSUMPTION: the lower numeric safety clamp is intentionally extreme. At the
// audit-locked maximum index move it takes about 46 s to reach, after which a
// four-second reversal demonstrates that rendering can leave the clamp again.
writeFixture('synthetic-lower-limit-125ms.csv', 1_700_000_101_000, (index) => {
  if (index >= 1 && index < 377) return -1;
  if (index >= 377 && index < 409) return 1;
  return 0;
});

writeFixture('synthetic-constant-price-125ms.csv', 1_700_000_202_000, () => 0);
