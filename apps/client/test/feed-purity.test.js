import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/* ================================================================
   FEED PURITY — FI-7 and invariant 1, for the feed half of the boundary.

   `packages/engine/test/purity.test.ts` guards the engine: no RNG, no clock,
   no DOM anywhere in the money path. This file guards the other side of the
   seam, and it has to state the rule differently, because the simulator uses
   an LCG *by design* — a blanket "no RNG in the feed" ban would be false.

   The rule that is true, and the one this file enforces:

     The simulator's RNG may reach the index, and only the index, and only
     through the published transform's final step. It may never reach a
     settlement, a balance, a stake, a payout, or any Cents value.

   Structurally that decomposes into three checks:

     1. Nothing on the money path imports the feed's randomness (FI-7).
     2. The feed's own modules touch no money type and no settlement API.
     3. The RNG's only observable exit from the source is `{t, v, ret}` —
        the tick object — which the engine then consumes as a price, exactly
        as it would consume a real one.

   Check 3 is the load-bearing one: it is what makes "the simulator and the
   WebSocket source are drop-in swaps" (invariant 2) a statement about money
   and not only about types.
================================================================ */

/* Resolved from the repo root rather than `import.meta.url`: this project runs
   in jsdom, where `import.meta.url` is an http:// URL and `fileURLToPath`
   throws. Vitest's cwd is the repo root. */
const CLIENT_SRC = resolve(process.cwd(), 'apps/client/src');
const FEED_SRC = join(CLIENT_SRC, 'feed');
const PACKAGE_FEED_SRC = resolve(process.cwd(), 'packages/feed/src');

function sourceFiles(dir){
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.js') || full.endsWith('.ts') ? [full] : [];
  });
}

const read = (file) => readFileSync(file, 'utf8');

describe('FI-7 — no RNG reaches anything on the money path', () => {
  /**
   * The money path on the client is the engine adapter and the gateway: the
   * two modules that turn a player action into a balance change. Neither may
   * import randomness, directly or by re-export.
   *
   * `core/round.js` is deliberately excluded: it writes RSEED for the
   * cosmetic terrain (`setRSEED`), which invariant 1 explicitly permits —
   * "randomness is allowed only in cosmetics". It is covered by its own
   * assertion below instead.
   */
  const MONEY_PATH = [
    join(CLIENT_SRC, 'core', 'engine.js'),
    join(CLIENT_SRC, 'core', 'gateway.js'),
    join(CLIENT_SRC, 'core', 'entry-window.js'),
  ];

  const RNG_IMPORT = /from\s+['"][^'"]*util\/random(\.js)?['"]/;
  const RNG_CALL = /\b(rnd|gauss|hash1|noise1)\s*\(/;

  it('no money-path module imports util/random', () => {
    for (const file of MONEY_PATH){
      const text = read(file);
      expect(RNG_IMPORT.test(text), `${file} imports util/random`).toBe(false);
      expect(RNG_CALL.test(text), `${file} calls an RNG helper`).toBe(false);
      expect(/\bMath\.random\b/.test(text), `${file} calls Math.random`).toBe(false);
    }
  });

  it('no money-path module reaches into the feed implementation', () => {
    // Invariant 2: only `feed/index.js` may be imported, never a concrete
    // source. A money-path module that imported SimulatedIndexSource directly
    // would be reading the RNG's home module.
    for (const file of MONEY_PATH){
      const text = read(file);
      expect(/SimulatedIndexSource/.test(text), `${file} names a concrete source`).toBe(false);
    }
  });

  it('the only randomness in core/round.js is the cosmetic terrain seed', () => {
    // Invariant 1 permits RNG in cosmetics. The permission is narrow, so pin
    // exactly which symbol is allowed through: setRSEED and nothing else.
    const text = read(join(CLIENT_SRC, 'core', 'round.js'));
    const importLine = text.match(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]*util\/random[^'"]*['"]/);
    if (importLine){
      const named = importLine[1].split(',').map(s => s.trim()).filter(Boolean);
      expect(named).toEqual(['setRSEED']);
    }
    expect(/\bgauss\s*\(/.test(text), 'round.js draws a gaussian').toBe(false);
  });
});

describe('FI-7 — the feed touches no money type and no settlement API', () => {
  const MONEY_SYMBOLS = [
    /\bcents\s*\(/,
    /\bCents\b/,
    /\bscaleCents\b/,
    /\broundHalfAwayFromZero\b/,
    /@crush\/ledger/,
    /@crush\/engine/,
    /\bbalance\b/,
    /\bstake\b/,
    /\bpayout\b/,
    /\bsettle\b/i,
  ];

  it('no feed module names a money symbol or a settlement entry point', () => {
    const files = [...sourceFiles(FEED_SRC), ...sourceFiles(PACKAGE_FEED_SRC)];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files){
      const text = read(file);
      for (const pattern of MONEY_SYMBOLS){
        expect(pattern.test(text), `${file} matches ${pattern}`).toBe(false);
      }
    }
  });

  it('the feed imports nothing from core, ui, render or audio', () => {
    for (const file of [...sourceFiles(FEED_SRC), ...sourceFiles(PACKAGE_FEED_SRC)]){
      const text = read(file);
      expect(
        /from\s+['"][^'"]*\/(core|ui|render|audio)\//.test(text),
        `${file} imports across the seam`,
      ).toBe(false);
    }
  });
});

describe('FI-7 — the RNG reaches the index only through the published transform', () => {
  /**
   * The behavioural half of the rule, and the reason the two structural
   * checks above are not sufficient on their own.
   *
   * A source is allowed to be random. What it is not allowed to do is hand
   * that randomness to anything except the tick object. So: run the source
   * with the RNG replaced by a stub that records every draw, and assert the
   * draws influenced nothing but `{t, v, ret}` — the values arriving are
   * finite prices, and the tick object carries no extra field a settlement
   * could read.
   */
  it('every RNG draw exits only as {t, v, ret}', async () => {
    vi.useFakeTimers();
    vi.resetModules();

    let draws = 0;
    const real = await import('../src/util/random.js');
    vi.doMock('../src/util/random.js', () => ({
      ...real,
      rnd: () => { draws++; return real.rnd(); },
      gauss: () => { draws++; return real.gauss(); },
    }));

    const mod = await import('../src/feed/SimulatedIndexSource.js');
    const src = new mod.SimulatedIndexSource();
    const ticks = [];
    src.onTick(tk => ticks.push(tk));
    src.resetRound();
    vi.advanceTimersByTime(720 * 125);

    expect(draws).toBeGreaterThan(700);
    expect(ticks.length).toBeGreaterThan(700);

    for (const tk of ticks){
      // No channel other than the three published fields. A source that
      // attached, say, a `seed` or a `roll` for a consumer to read would be
      // handing RNG to the money path through the tick itself.
      expect(Object.keys(tk).sort()).toEqual(['ret', 't', 'v']);
      expect(Number.isFinite(tk.v)).toBe(true);
      expect(Number.isFinite(tk.ret)).toBe(true);
    }

    vi.doUnmock('../src/util/random.js');
    vi.useRealTimers();
  });

  it('the engine settles from prices alone — the same series settles identically', async () => {
    // The end-to-end statement of invariant 1 across the seam: feed the
    // engine a tick series captured from the RNG-driven simulator, twice.
    // Settlement is a function of the series and the actions, so the RNG's
    // only influence on money is via a price the engine cannot distinguish
    // from a real one.
    vi.useFakeTimers();
    vi.resetModules();
    const mod = await import('../src/feed/SimulatedIndexSource.js');
    const src = new mod.SimulatedIndexSource();
    const captured = [];
    src.onTick(tk => captured.push({ t: tk.t, v: tk.v }));
    src.resetRound();
    vi.advanceTimersByTime(200 * 125);
    src.halt();
    vi.useRealTimers();

    expect(captured.length).toBeGreaterThan(150);

    const { cents } = await import('@crush/ledger');
    const engine = await import('@crush/engine');

    const settleOnce = () => {
      let s = engine.initialState(cents(100_000));
      s = engine.open(s, { dir: 1, stake: cents(5_000), lev: 10, id: 'p1' }, captured[0]).state;
      for (const tk of captured.slice(1)) s = engine.onTick(s, tk).state;
      s = engine.settleAtRoundEnd(s, captured.at(-1)).state;
      return s.lastResult;
    };

    const a = settleOnce();
    const b = settleOnce();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('SIM-ONLY fencing stays intact', () => {
  /**
   * Every shaping constant in the simulator is marked SIM-ONLY because none of
   * it is part of the real-feed spec — a `WsIndexSource` carries none of it
   * across. The fence is a comment, which means only a test keeps it honest.
   */
  const SIM_ONLY_CONSTANTS = [
    'REGIME_FLIP_P', 'REGIME_DECAY',
    'ANTIRUN_K', 'ANTIRUN_C', 'ANTIRUN_TICKS',
    'SQUALL_P_SEC', 'SQUALL_MIN_MS', 'SQUALL_MAX_MS',
    'SQUALL_MUL_MIN', 'SQUALL_MUL_MAX',
    'SWING_PCT',
  ];

  it('every SIM-ONLY constant is declared inside SimulatedIndexSource and nowhere else', () => {
    const simFile = join(PACKAGE_FEED_SRC, 'simulated-index-source.ts');
    const simText = read(simFile);
    for (const name of SIM_ONLY_CONSTANTS){
      expect(simText.includes(name), `${name} missing from the simulator`).toBe(true);
    }

    // The fence: no other client module may reference them. If one leaks into
    // the renderer or the engine adapter, swapping in a real source silently
    // changes behaviour somewhere outside the feed.
    for (const file of [...sourceFiles(CLIENT_SRC), ...sourceFiles(PACKAGE_FEED_SRC)]){
      if (file === simFile) continue;
      const text = read(file);
      for (const name of SIM_ONLY_CONSTANTS){
        expect(text.includes(name), `${file} references SIM-ONLY ${name}`).toBe(false);
      }
    }
  });

  it('none of the SIM-ONLY constants is exported', () => {
    const simText = read(join(PACKAGE_FEED_SRC, 'simulated-index-source.ts'));
    for (const name of SIM_ONLY_CONSTANTS){
      expect(
        new RegExp(`export\\s+const\\s+${name}\\b`).test(simText),
        `${name} is exported out of the fence`,
      ).toBe(false);
    }
  });

  it('every SIM-ONLY constant declaration carries the SIM-ONLY marker', () => {
    // The marker is what tells the M2.1 author which lines do not cross. A
    // constant added without one is the failure mode this guards.
    const lines = read(join(PACKAGE_FEED_SRC, 'simulated-index-source.ts')).split('\n');
    for (let i = 0; i < lines.length; i++){
      const decl = lines[i].match(/^const\s+([A-Z][A-Z0-9_]*)\s*=/);
      if (!decl) continue;
      const window = lines.slice(Math.max(0, i - 4), i + 1).join('\n');
      expect(
        window.includes('SIM-ONLY'),
        `const ${decl[1]} at line ${i + 1} has no SIM-ONLY marker above it`,
      ).toBe(true);
    }
  });
});
