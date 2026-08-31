import type { ReplayPriceRow } from './types.js';

export type ReplayFixtureErrorCode =
  | 'EMPTY_FIXTURE'
  | 'MALFORMED_HEADER'
  | 'MALFORMED_ROW'
  | 'INVALID_TIMESTAMP'
  | 'INVALID_PRICE'
  | 'NON_MONOTONIC_TIMESTAMP';

export class ReplayFixtureError extends Error {
  public constructor(
    public readonly code: ReplayFixtureErrorCode,
    public readonly rowIndex: number,
  ) {
    super(`${code} at row ${rowIndex}`);
    this.name = 'ReplayFixtureError';
  }
}

/** Validate and detach replay rows so caller mutation cannot alter a run. */
export function validateReplayRows(rows: readonly ReplayPriceRow[]): readonly ReplayPriceRow[] {
  if (rows.length === 0) throw new ReplayFixtureError('EMPTY_FIXTURE', 0);

  const validated: ReplayPriceRow[] = [];
  let previousTimestamp = -Infinity;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] as ReplayPriceRow | null | undefined;
    if (row === null || row === undefined || typeof row !== 'object' || !Number.isFinite(row.t)) {
      throw new ReplayFixtureError('INVALID_TIMESTAMP', rowIndex);
    }
    if (!Number.isFinite(row.price) || row.price <= 0) {
      throw new ReplayFixtureError('INVALID_PRICE', rowIndex);
    }
    if (row.t <= previousTimestamp) {
      throw new ReplayFixtureError('NON_MONOTONIC_TIMESTAMP', rowIndex);
    }
    const copy = Object.freeze({ t: row.t, price: row.price });
    validated.push(copy);
    previousTimestamp = row.t;
  }
  return Object.freeze(validated);
}

/** Parse the committed `timestamp_ms,price` fixture representation. */
export function parseReplayCsv(csv: string): readonly ReplayPriceRow[] {
  const lines = csv.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  if (lines[0] !== 'timestamp_ms,price') {
    throw new ReplayFixtureError('MALFORMED_HEADER', 0);
  }

  const rows: ReplayPriceRow[] = [];
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (line === undefined) throw new ReplayFixtureError('MALFORMED_ROW', lineIndex);
    const columns = line.split(',');
    if (columns.length !== 2 || columns[0]?.trim() === '' || columns[1]?.trim() === '') {
      throw new ReplayFixtureError('MALFORMED_ROW', lineIndex);
    }
    rows.push({ t: Number(columns[0]), price: Number(columns[1]) });
  }
  return validateReplayRows(rows);
}
