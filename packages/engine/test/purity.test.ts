import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ENGINE_SRC = fileURLToPath(new URL('../src', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

/**
 * The single most important structural rule of the migration: @crush/engine
 * must run unmodified as the Phase 2 server authority, so it may not import
 * anything from the client, the renderer, audio, or the DOM.
 *
 * TypeScript alone does not enforce this — a client import currently fails only
 * because the prototype is untyped JavaScript, which stops being true as the
 * client converts to TS. This test is the durable guard.
 */
describe('engine purity — zero DOM, zero render imports', () => {
  const FORBIDDEN = [
    /from\s+['"].*apps\/client/,
    /from\s+['"].*\/(render|ui|audio)\//,
    /\bdocument\./,
    /\bwindow\./,
    /\brequestAnimationFrame\b/,
    /\bsetTimeout\b/,
    /\bsetInterval\b/,
  ];

  it('M1.3: no engine source imports client, render, ui or audio code', () => {
    for (const file of sourceFiles(ENGINE_SRC)) {
      const text = readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN) {
        expect(pattern.test(text), `${file} matches ${pattern}`).toBe(false);
      }
    }
  });

  it('M1.3: engine imports resolve under plain Node with no DOM shim', async () => {
    const mod = await import('../src/index.js');
    expect(mod.ENGINE_PACKAGE).toBe('@crush/engine');
  });
});
