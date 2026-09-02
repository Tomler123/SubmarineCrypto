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
    const playableCalmPath = fixturePath(
      'btcusdt-binance-2021-05-19-calm-playable-100ms.csv',
    );
    expect(sha256(flashPath)).toBe('1d9ea391c64557a7709af978a606b08f60c61be160dbbf8d891415f9858fd194');
    expect(sha256(calmPath)).toBe('59463c347c2a1d5532eb234475b5cd5125e7b51357b8669e67a030f6eae6aefb');
    expect(sha256(playableCalmPath)).toBe(
      'c1280e60127ff47fd6f6bbd3e521e54653b9a02b140298e2c1d50fc4d85431a6',
    );
    expect(parseReplayCsv(readFileSync(flashPath, 'utf8'))).toHaveLength(1_000);
    expect(parseReplayCsv(readFileSync(calmPath, 'utf8'))).toHaveLength(245);
    expect(parseReplayCsv(readFileSync(playableCalmPath, 'utf8'))).toHaveLength(868);
  });

  it.each([
    ['btcusdt-binance-2021-05-19-calm-100ms.csv', 55],
    ['btcusdt-binance-2021-05-19-calm-playable-100ms.csv', 132],
  ])('keeps sparse calm observations unfilled: %s', (fixture, expectedMissingBuckets) => {
    const rows = parseReplayCsv(readFileSync(fixturePath(fixture), 'utf8'));
    const missingBuckets = rows.at(-1)!.t / 100 - rows[0]!.t / 100 + 1 - rows.length;
    expect(missingBuckets).toBe(expectedMissingBuckets);
  });

  it.each([
    ['btcusdt-binance-2021-05-19-flash-crash-100ms.csv', 99_900],
    ['btcusdt-binance-2021-05-19-calm-playable-100ms.csv', 99_900],
  ])('covers a full 90-second round: %s', (fixture, exactDurationMs) => {
    const rows = parseReplayCsv(readFileSync(fixturePath(fixture), 'utf8'));
    const durationMs = rows.at(-1)!.t - rows[0]!.t;

    expect(durationMs).toBe(exactDurationMs);
    expect(durationMs).toBeGreaterThanOrEqual(90_000);
  });
});
