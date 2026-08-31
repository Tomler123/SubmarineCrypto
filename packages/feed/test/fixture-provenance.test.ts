import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseReplayCsv } from '../src/index.js';

const fixturePath = (name: string): string => resolve(process.cwd(), 'packages/feed/fixtures', name);

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

describe('FI-14 — committed fixture provenance', () => {
  it('keeps the documented fixture bytes and row counts stable', () => {
    const flashPath = fixturePath('btcusdt-binance-2021-05-19-flash-crash-100ms.csv');
    const calmPath = fixturePath('btcusdt-binance-2021-05-19-calm-100ms.csv');
    expect(sha256(flashPath)).toBe('1d9ea391c64557a7709af978a606b08f60c61be160dbbf8d891415f9858fd194');
    expect(sha256(calmPath)).toBe('59463c347c2a1d5532eb234475b5cd5125e7b51357b8669e67a030f6eae6aefb');
    expect(parseReplayCsv(readFileSync(flashPath, 'utf8'))).toHaveLength(1_000);
    expect(parseReplayCsv(readFileSync(calmPath, 'utf8'))).toHaveLength(245);
  });

  it('keeps the sparse control fixture sparse instead of filling missing buckets', () => {
    const rows = parseReplayCsv(readFileSync(
      fixturePath('btcusdt-binance-2021-05-19-calm-100ms.csv'),
      'utf8',
    ));
    const missingBuckets = rows.at(-1)!.t / 100 - rows[0]!.t / 100 + 1 - rows.length;
    expect(missingBuckets).toBe(55);
  });
});
