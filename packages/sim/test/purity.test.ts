import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function sourceFiles(directory: string): readonly string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

describe('MC-7 — deterministic core purity', () => {
  it('contains no wall clock, timers, ambient RNG, DOM, or interpolation dependency', () => {
    const root = resolve(process.cwd(), 'packages/sim/src');
    for (const path of sourceFiles(root)) {
      const source = readFileSync(path, 'utf8');
      for (const forbidden of [
        /Date\.now/, /new\s+Date/, /performance\./, /setTimeout/, /setInterval/,
        /Math\.random/, /document\b/, /window\b/, /InterpBuffer/,
      ]) {
        expect(forbidden.test(source), `${path} matches ${forbidden}`).toBe(false);
      }
    }
  });
});
