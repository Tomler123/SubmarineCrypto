import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';

const [inputPath, outputPath, startIso, endIso] = process.argv.slice(2);
if (!inputPath || !outputPath || !startIso || !endIso) {
  throw new Error('usage: node derive-binance-aggtrades-fixture.mjs INPUT OUTPUT START_ISO END_ISO');
}

const start = Date.parse(startIso);
const end = Date.parse(endIso);
if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
  throw new Error('START_ISO and END_ISO must describe a non-empty UTC interval');
}
if (start % 100 !== 0 || end % 100 !== 0) {
  throw new Error('fixture interval bounds must align to UTC 100 ms buckets');
}

const stream = createReadStream(inputPath);
const lines = createInterface({ input: stream });
const fixtureRows = [];
let activeBucket = -1;
let activePrice = '';
let priorSourceTimestamp = -Infinity;

function finishBucket() {
  if (activeBucket >= start && activeBucket < end) {
    fixtureRows.push(`${activeBucket},${activePrice}`);
  }
}

for await (const line of lines) {
  const columns = line.split(',');
  if (columns.length !== 8) throw new Error(`malformed aggregate-trade row: ${line}`);
  const price = columns[1];
  const timestamp = Number(columns[5]);
  if (!Number.isFinite(timestamp) || timestamp < priorSourceTimestamp) {
    throw new Error(`non-monotonic aggregate-trade timestamp: ${columns[5]}`);
  }
  priorSourceTimestamp = timestamp;
  if (timestamp < start) continue;
  if (timestamp >= end) {
    finishBucket();
    lines.close();
    stream.destroy();
    break;
  }

  const bucket = Math.floor(timestamp / 100) * 100;
  if (activeBucket !== bucket) {
    finishBucket();
    activeBucket = bucket;
  }
  // The last aggregate trade in each UTC-aligned bucket is the observation.
  activePrice = price;
}

if (activeBucket >= 0 && priorSourceTimestamp < end) finishBucket();
if (fixtureRows.length === 0) throw new Error('selected interval contained no aggregate trades');

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `timestamp_ms,price\n${fixtureRows.join('\n')}\n`, 'utf8');

let gaps = 0;
for (let index = 1; index < fixtureRows.length; index += 1) {
  const previous = Number(fixtureRows[index - 1].split(',', 1)[0]);
  const current = Number(fixtureRows[index].split(',', 1)[0]);
  if (current - previous !== 100) gaps += 1;
}
console.log(JSON.stringify({ outputPath, rows: fixtureRows.length, gaps, startIso, endIso }));
