import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { installDom } from './support/dom.js';
import { installMocks } from './support/mocks.js';

/* ================================================================
   REJECT COPY — every RejectCode the engine can emit has player-facing copy.

   The failure this guards against is silent by construction. `RejectCode` is a
   TypeScript union, erased at runtime, so `REJECT_COPY[code] ?? 'REJECTED'`
   type-checks and runs perfectly well while showing a player a bare
   "REJECTED" for a case somebody thought about hard enough to name. Nothing in
   the build catches it: not tsc (the lookup is on a plain object literal), not
   the engine tests (they assert codes, not copy).

   So the union declaration in packages/engine/src/types.ts is read as the
   source of truth. Adding a member there without adding copy fails this test,
   which is the property asked for. Parsing a .ts file from a test is a
   deliberate trade — the alternative is a runtime `REJECT_CODES` array in the
   engine, which is the better fix and is recommended in the run report; until
   that exists, the declaration is the only enumeration that exists.
================================================================ */

installDom();
installMocks();

const { REJECT_COPY } = await import('../src/core/engine.js');

// Resolved from the repo root rather than `import.meta.url`: under jsdom the
// module URL is not a file: URL, so fileURLToPath() throws. Vitest runs with
// cwd at the root, which is also where vitest.config.ts lives.
const TYPES_TS = resolve(process.cwd(), 'packages/engine/src/types.ts');

/**
 * Extract the string-literal members of `export type RejectCode = ...`.
 *
 * Deliberately narrow: it reads the one declaration by name and stops at the
 * terminating semicolon, so an unrelated union elsewhere in the file cannot
 * quietly widen or shrink the expected set.
 */
function declaredRejectCodes(){
  const src = readFileSync(TYPES_TS, 'utf8');
  const start = src.indexOf('export type RejectCode =');
  if (start === -1) throw new Error('RejectCode declaration not found in types.ts');
  const end = src.indexOf(';', start);
  if (end === -1) throw new Error('RejectCode declaration is unterminated');
  const body = src.slice(start, end);
  const codes = [...body.matchAll(/'([A-Z_]+)'/g)].map(m => m[1]);
  if (codes.length === 0) throw new Error('RejectCode declaration parsed to zero members');
  return codes;
}

describe('REJECT_COPY covers every RejectCode', () => {
  const codes = declaredRejectCodes();

  it('parsed the union and found the codes the engine documents', () => {
    // Sanity check on the parser itself: if types.ts is reformatted into a
    // shape this regex cannot read, fail loudly here rather than vacuously
    // passing the exhaustiveness test below with an empty set.
    expect(codes.length).toBeGreaterThanOrEqual(6);
    expect(codes).toContain('ENTRY_CLOSED');
    expect(codes).toContain('LOSS_LIMIT_REACHED');
  });

  it.each(declaredRejectCodes())('%s has copy that is not the generic fallback', (code) => {
    expect(REJECT_COPY[code], `no copy for RejectCode '${code}'`).toBeTruthy();
    expect(REJECT_COPY[code]).not.toBe('REJECTED');
  });

  it('has no copy for a code the engine cannot emit', () => {
    // The other direction: dead copy is a smaller problem than missing copy,
    // but it means a code was renamed and the map was not, which is how the
    // missing half happens next time.
    for (const key of Object.keys(REJECT_COPY)){
      expect(codes, `REJECT_COPY has stale key '${key}'`).toContain(key);
    }
  });

  it('the fallback is unreachable for declared codes', () => {
    const uncovered = codes.filter(c => REJECT_COPY[c] === undefined);
    expect(uncovered, `codes falling back to 'REJECTED': ${uncovered.join(', ')}`).toEqual([]);
  });
});
