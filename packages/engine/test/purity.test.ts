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
    // M1.3: the engine reads no clock of its own. Every timestamp arrives on a
    // tick (MF-5: all timing derives from the authority's clock), so a
    // settlement is reproducible from its tick series alone — which is what
    // M1.6's replay determinism and VR-1's round recomputation depend on.
    /\bDate\.now\b/,
    /\bperformance\./,
    /\bnew Date\b/,
    // Invariant 1: no RNG may ever touch money.
    /\bMath\.random\b/,
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

  /**
   * The purity rules above are structural; this is the behavioural consequence
   * they exist for. A settlement must be a deterministic function of the tick
   * series and the player's actions (invariant 1), which is what lets M1.6
   * replay a round byte-identically and VR-1 let a player recompute one.
   */
  it('M1.3: the same tick series and actions settle identically every run', async () => {
    const { cents } = await import('@crush/ledger');
    const { initialState, onTick, open, requestAscent } = await import('../src/index.js');

    const ticks = [1000, 1004.5, 997.25, 1012.75, 1003.5, 991.125].map((v, i) => ({
      t: i * 125,
      v,
    }));

    const runOnce = (): unknown => {
      let s = initialState(cents(100_000));
      const first = ticks[0]!;
      s = open(s, { dir: 1, stake: cents(12_345), lev: 10, id: 'p1' }, first).state;
      s = requestAscent(s, 250).state;
      for (const tk of ticks.slice(1)) {
        s = onTick(s, tk).state;
      }
      return s.lastResult;
    };

    const a = runOnce();
    const b = runOnce();
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
