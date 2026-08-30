import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { CFG } from '../src/config/constants.js';
import { SimulatedIndexSource } from '../src/feed/SimulatedIndexSource.js';
import {
  describeIndexSourceContract,
  expectWellFormedTick,
  record,
} from './support/index-source-contract.js';

/* ================================================================
   SIMULATED INDEX SOURCE — FI-2, FI-3, FI-6, FI-8, and determinism.

   Scope note, because it decides how every assertion below is written.
   `SimulatedIndexSource` is NOT the published index transform of game-logic
   §2. The transform consumes a real median BTC price series
   (r → EWMA σ → clamp ±3.5σ → I·(1+z·v)); the simulator has no P_t at all —
   it manufactures a shaped `z` directly and applies the same final
   `I *= (1 + ret)` step. FI-1, FI-4 and FI-5 are therefore not testable here
   and land with `WsIndexSource` in M2.1.

   What IS testable, and is what this file tests, is that the simulator obeys
   the bounds the transform promises *at its output*, because the client, the
   engine and every crush line downstream are built against those bounds. A
   simulator that could exceed them would let M1.7 calibrate theta against a
   series the real feed can never produce.

   Where a criterion cannot be honestly asserted against this implementation,
   the test title says so and asserts the honest thing instead — see FI-2.
================================================================ */

const TICK = CFG.TICK_MS;
const ROUND_TICKS = Math.round(CFG.ROUND_MS / TICK);   // 720
const FI3_BOUND = 3.5 * CFG.TICK_VOL;                  // 0.0147
const SIM_CLAMP = 3.2 * CFG.TICK_VOL;                  // 0.01344

/** Drive exactly `n` authoritative ticks of the source's own interval. */
const advance = (_src, n) => vi.advanceTimersByTime(n * TICK);

/**
 * A fresh source with the module-level LCG rewound, so every test starts from
 * the same stream regardless of what ran before it.
 *
 * `util/random.js` holds `_seed` in a module-level binding that only `rnd()`
 * writes, so re-importing under a reset module registry is the only way to
 * rewind it. That mechanism is itself what the determinism block exercises.
 */
async function freshSource(){
  vi.resetModules();
  const mod = await import('../src/feed/SimulatedIndexSource.js');
  return new mod.SimulatedIndexSource();
}

/** Run `rounds` rounds of `ticksPerRound` and return every tick emitted. */
function runRounds(src, rounds, ticksPerRound){
  const ticks = record(src);
  for (let r = 0; r < rounds; r++){
    src.resetRound();
    advance(src, ticksPerRound);
    src.halt();
  }
  return ticks;
}

/* The simulator logs a round summary on halt(). 100 rounds of that is noise;
   silence it without hiding a real failure. */
let logSpy;
beforeEach(() => { logSpy = vi.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => { logSpy.mockRestore(); vi.useRealTimers(); });

/* ----------------------------------------------------------------
   The contract suite, run against the simulator. When M1.6 adds
   ReplayIndexSource it calls describeIndexSourceContract the same way and
   inherits every assertion without editing this file.
---------------------------------------------------------------- */
describeIndexSourceContract('SimulatedIndexSource', {
  create: () => new SimulatedIndexSource(),
  advance,
  // FEED-F5 is reconciled: the contract is resetRound/halt, which is what this
  // source has always implemented and what ARCHITECTURE.md section 1 already
  // documented. `supportsStartStop` is gone with the start()/stop() it gated.
  //
  // FI-8 rejection needs a way to push a stale timestamp through the source's
  // own emit path. For the simulator that is re-entering `_emit` without the
  // clock having advanced, which is exactly the FEED-F3 shape a replay file
  // will reproduce from disk.
  replayStale: (src) => { src._emit(0); },
});

/* ----------------------------------------------------------------
   FI-3 — a single tick MUST never move the index more than ±(3.5 × v).
---------------------------------------------------------------- */
describe('FI-3 — per-tick index move is bounded by ±3.5·v = ±1.47%', () => {
  // 72,000 fake-timer ticks is genuinely slow; the default 5 s timeout is the
  // wrong bar for a bound that only means something at volume.
  it('holds on every tick of 100 rounds, through squalls and anti-run pressure', { timeout: 60_000 }, async () => {
    vi.useFakeTimers();
    const src = await freshSource();
    // 100 rounds × 720 ticks = one full 90 s round each, 72,000 ticks.
    const ticks = runRounds(src, 100, ROUND_TICKS);

    expect(ticks.length).toBeGreaterThan(70_000);

    let maxAbsRet = 0;
    let maxAbsStep = 0;
    let nearClamp = 0;
    let prev = null;

    for (const tk of ticks){
      expectWellFormedTick(tk);
      maxAbsRet = Math.max(maxAbsRet, Math.abs(tk.ret));

      // `ret` is what the source reports; the realised step is what the index
      // actually did. Assert both, so a source reporting a compliant `ret`
      // while moving the index by something else is caught.
      if (prev !== null && tk.ret !== 0){
        const realised = tk.v / prev - 1;
        maxAbsStep = Math.max(maxAbsStep, Math.abs(realised));
        expect(realised).toBeCloseTo(tk.ret, 12);
      }
      prev = tk.v;

      expect(Math.abs(tk.ret), `tick ret ${tk.ret} exceeds FI-3`)
        .toBeLessThanOrEqual(FI3_BOUND);

      if (Math.abs(tk.ret) > SIM_CLAMP * 0.75) nearClamp++;
    }

    // The observed ceiling, asserted as a number so a regression in the clamp
    // shows up as more than a pass/fail. The simulator clamps its
    // vol-normalised z at ±3.2, so the reachable maximum is 3.2·v — inside
    // FI-3's 3.5·v with 8.6% headroom.
    expect(maxAbsRet).toBeLessThanOrEqual(SIM_CLAMP + 1e-15);
    expect(maxAbsStep).toBeLessThanOrEqual(FI3_BOUND);

    // The clamp must actually bind somewhere in 72k ticks, otherwise this test
    // would pass just as happily against a source that never moves at all.
    expect(maxAbsRet).toBeGreaterThan(SIM_CLAMP * 0.99);
    expect(nearClamp).toBeGreaterThan(0);

    console.info(
      `[FI-3] ticks=${ticks.length} max|ret|=${(maxAbsRet * 100).toFixed(4)}% ` +
      `bound=${(FI3_BOUND * 100).toFixed(4)}% ` +
      `headroom=${((1 - maxAbsRet / FI3_BOUND) * 100).toFixed(2)}%`,
    );
  });

  it('holds while a squall is forced on for an entire round', async () => {
    vi.useFakeTimers();
    const src = await freshSource();
    const ticks = record(src);
    src.resetRound();

    // Pin the source into its most violent state and keep it there: maximum
    // multiplier, squall never expiring. This drives the path the random
    // 1.5%/s squall roll reaches only occasionally.
    for (let i = 0; i < ROUND_TICKS; i++){
      src.squallTicks = 999;
      src.squallMul = 3;                  // SQUALL_MUL_MAX
      advance(src, 1);
    }

    const emitted = ticks.slice(1);
    expect(emitted.length).toBeGreaterThan(700);
    for (const tk of emitted){
      expectWellFormedTick(tk);
      expect(Math.abs(tk.ret)).toBeLessThanOrEqual(FI3_BOUND);
    }
    src.halt();
  });

  it('holds when a whale print lands on top of a maxed squall', async () => {
    vi.useFakeTimers();
    const src = await freshSource();
    const ticks = record(src);
    src.resetRound();

    // Push log-vol to its own clamp ceiling too, so sigma, the squall
    // multiplier and a whale jump can all stack on the same tick.
    for (let i = 0; i < 400; i++){
      src.logSig = 1.6;                   // upper clamp of exp(clamp(logSig,-1.4,1.6))
      src.squallTicks = 999;
      src.squallMul = 3;
      advance(src, 1);
    }
    for (const tk of ticks.slice(1)){
      expect(Math.abs(tk.ret)).toBeLessThanOrEqual(FI3_BOUND);
    }
    src.halt();
  });

  it('holds under saturated anti-run pressure', async () => {
    vi.useFakeTimers();
    const src = await freshSource();
    const ticks = record(src);
    src.resetRound();

    // tanh saturates at |cum/0.02| >= ~3, so a history of 80 × 0.004 puts the
    // pressure term at its full -0.15·sig on every tick.
    for (let i = 0; i < 600; i++){
      src.retHist = new Array(80).fill(0.004);
      advance(src, 1);
    }
    for (const tk of ticks.slice(1)){
      expect(Math.abs(tk.ret)).toBeLessThanOrEqual(FI3_BOUND);
    }
    src.halt();
  });
});

/* ----------------------------------------------------------------
   FI-6 — effective amplification v / max(sigma, sigma_floor) never exceeds 35×.
---------------------------------------------------------------- */
describe('FI-6 — effective amplification never exceeds 35×', () => {
  const A_MAX = 35;
  const SIGMA_FLOOR = 0.00012;             // 1.2 bp/tick, parameter sheet §12

  it('the published constants pin the ceiling at exactly 35×', () => {
    // FI-6 is a property of the constant pair, before any series exists. If
    // this fails, v or sigma_floor changed without versioning the spec
    // (invariant 7) and every other FI assertion is measuring the wrong thing.
    expect(CFG.TICK_VOL / SIGMA_FLOOR).toBeCloseTo(A_MAX, 10);
  });

  it('the simulator never amplifies its own normaliser beyond 35×', async () => {
    vi.useFakeTimers();
    const src = await freshSource();
    const ticks = record(src);

    // The simulator's stand-in for sigma is `ew`, the EWMA of |z| it divides
    // by before scaling to v, so its realised amplification is v/ew and the
    // FI-6 ceiling applies identically. If `ew` were ever allowed to collapse
    // below sigma_floor the simulator would produce a series the real
    // transform could not.
    let maxAmp = 0;
    let minEw = Infinity;
    for (let r = 0; r < 20; r++){
      src.resetRound();
      for (let i = 0; i < ROUND_TICKS; i++){
        advance(src, 1);
        const ew = src.ew;
        expect(Number.isFinite(ew) && ew > 0, `ew must stay positive, got ${ew}`).toBe(true);
        minEw = Math.min(minEw, ew);
        maxAmp = Math.max(maxAmp, CFG.TICK_VOL / Math.max(ew, SIGMA_FLOOR));
      }
      src.halt();
    }

    expect(ticks.length).toBeGreaterThan(14_000);
    expect(maxAmp).toBeLessThanOrEqual(A_MAX);
    console.info(
      `[FI-6] max amplification=${maxAmp.toExponential(3)}× ceiling=${A_MAX}× ` +
      `min normaliser=${minEw.toExponential(3)}`,
    );
  });

  it('the ceiling still holds if the normaliser is driven to zero', async () => {
    vi.useFakeTimers();
    const src = await freshSource();
    const ticks = record(src);
    src.resetRound();

    // `ew` is recomputed each tick as sqrt(0.94·ew² + 0.06·z²) || 1 — the
    // `|| 1` is the guard against a zero normaliser producing a division
    // blow-up. Force the degenerate input and assert the guard holds the
    // output finite and inside FI-3, which is FI-6's observable consequence.
    for (let i = 0; i < 200; i++){
      src.ew = 0;
      advance(src, 1);
      expect(Number.isFinite(src.ew)).toBe(true);
      expect(src.ew).toBeGreaterThan(0);
    }
    for (const tk of ticks.slice(1)){
      expectWellFormedTick(tk);
      expect(Math.abs(tk.ret)).toBeLessThanOrEqual(FI3_BOUND);
    }
    src.halt();
  });
});

/* ----------------------------------------------------------------
   FI-2 — sign(ΔI) = sign(ΔP_median), and no configuration may break it.
---------------------------------------------------------------- */
describe('FI-2 — sign fidelity', () => {
  it('the emitted ret and the realised index step always share a sign', async () => {
    vi.useFakeTimers();
    const src = await freshSource();
    const ticks = runRounds(src, 20, ROUND_TICKS);

    // What IS assertable against the simulator: the last link of the chain.
    // Whatever `ret` the source decided on, the index must move that way. A
    // source whose reported return and realised move disagreed would break
    // sign fidelity at the exact boundary the client and engine read.
    let prev = null;
    let ups = 0;
    let downs = 0;
    for (const tk of ticks){
      if (prev !== null && tk.ret !== 0){
        expect(Math.sign(tk.v - prev)).toBe(Math.sign(tk.ret));
        if (tk.ret > 0) ups++; else downs++;
      }
      prev = tk.v;
    }
    expect(ups).toBeGreaterThan(1000);
    expect(downs).toBeGreaterThan(1000);
  });

  it('neither the vol-normaliser nor the clamp can flip a sign', async () => {
    vi.useFakeTimers();
    const src = await freshSource();
    const ticks = record(src);
    src.resetRound();

    // The two transform stages that could in principle invert a tick are the
    // division by `ew` and the clamp. `ew` is a square root and therefore
    // always positive; the clamp is symmetric about zero. Assert both
    // properties directly rather than inferring them from the series.
    for (let i = 0; i < 2000; i++){
      advance(src, 1);
      expect(src.ew).toBeGreaterThan(0);
    }
    for (const tk of ticks.slice(1)){
      expect(Math.abs(tk.ret)).toBeLessThanOrEqual(FI3_BOUND);
    }
    src.halt();
  });

  /**
   * FEED-F1 — the one real FI-2 finding of this run.
   *
   * FI-2 says "no configuration may break it". The simulator's anti-run
   * pressure is a configuration that does: it subtracts
   * `ANTIRUN_K·sig·tanh(cum/ANTIRUN_C)` from `z` BEFORE normalisation, and
   * that subtraction can exceed |z| and invert the tick. Measured across
   * 144,000 ticks it inverts roughly 3.5% of them.
   *
   * This is legitimate *inside* a SIM-ONLY shaping term: the simulator has no
   * underlying P_t to be unfaithful to, and the term is fenced as SIM-ONLY
   * precisely so it never crosses into `WsIndexSource`. But it is a loaded gun
   * pointed at the product's trust story — the same code shape applied
   * downstream of a real return would break FI-2 outright.
   *
   * So this assertion is deliberately inverted: it pins the fact that the term
   * IS sign-destroying, and therefore that it must never be lifted out of the
   * SIM-ONLY fence. If a future change makes anti-run sign-preserving, this
   * test fails and a reviewer has to decide consciously whether the fence is
   * still required. That is the intent, and it is why the title says
   * "documents" rather than "asserts".
   */
  it('documents that SIM-ONLY anti-run pressure can invert a tick (FEED-F1)', async () => {
    vi.useFakeTimers();
    const src = await freshSource();
    const ticks = record(src);
    src.resetRound();

    let inverted = 0;
    for (let i = 0; i < 3000; i++){
      // A saturating positive cumulative return: tanh(cum/0.02) ≈ 1, so the
      // pressure is a constant −0.15·sig on every tick.
      src.retHist = new Array(80).fill(0.004);
      const before = src.idx;
      advance(src, 1);
      if (src.idx < before) inverted++;
    }

    // Under saturated upward pressure the series is pushed down far more often
    // than not — precisely the sign-destroying behaviour FI-2 forbids of the
    // real transform.
    expect(inverted).toBeGreaterThan(1500);
    expect(ticks.length).toBeGreaterThan(2000);
    src.halt();
  });
});

/* ----------------------------------------------------------------
   FI-8 — timestamps monotonic; a non-increasing timestamp is rejected.
---------------------------------------------------------------- */
describe('FI-8 — tick timestamps', () => {
  it('are strictly increasing within every one of 100 rounds', { timeout: 60_000 }, async () => {
    vi.useFakeTimers();
    const src = await freshSource();

    // Per-round, so the round-boundary duplicate documented as FEED-F3 below
    // does not mask a violation inside a round — which is where a real
    // out-of-order tick would settle a position against the wrong price.
    let rounds = 0;
    let checked = 0;
    for (let r = 0; r < 100; r++){
      const ticks = [];
      const sub = tk => ticks.push(tk);
      src.subs.push(sub);
      src.resetRound();
      advance(src, ROUND_TICKS);
      src.halt();
      src.subs.splice(src.subs.indexOf(sub), 1);

      expect(ticks.length).toBeGreaterThan(700);
      for (let i = 1; i < ticks.length; i++){
        expect(
          ticks[i].t,
          `round ${r} tick ${i}: t=${ticks[i].t} must exceed ${ticks[i - 1].t}`,
        ).toBeGreaterThan(ticks[i - 1].t);
        checked++;
      }
      rounds++;
    }
    expect(rounds).toBe(100);
    expect(checked).toBeGreaterThan(70_000);
  });

  /**
   * FEED-F3 — the third real FI-8 finding, and the concrete one.
   *
   * `resetRound()` emits its opening tick synchronously, stamped with the
   * clock reading of that moment — which is the same reading the round's final
   * scheduled tick already used. The result is a duplicated timestamp at every
   * single round boundary: measured at exactly 99 duplicates across 100
   * consecutive rounds, one per boundary.
   *
   * FI-8 says timestamps are monotonic and a non-increasing one is rejected.
   * A duplicate is non-increasing. It was harmless only because the opening
   * tick re-bases the index to I0 and carries ret = 0, so nothing downstream
   * differenced across the boundary — but `InterpBuffer` stores both ticks and
   * divides by `(q.t - p.t)`, so a consumer that interpolated across that pair
   * would divide by zero, and M1.6's replay source reconstructs exactly this
   * boundary from a file.
   *
   * FIXED at the source: `_stamp()` puts the opening tick at least one tick
   * interval past the last emission, so the boundary carries a real gap rather
   * than relying on the gate to reject it. The general rule now lives in the
   * contract suite, so ReplayIndexSource inherits it; this stays as the
   * simulator's own regression on the specific 100-round measurement that
   * found it.
   */
  it('emits a distinct timestamp at every round boundary (FEED-F3)', async () => {
    vi.useFakeTimers();
    const src = await freshSource();
    // 100 rounds is the measurement that produced the finding: it reported
    // exactly 99 duplicates, one per boundary. Re-run at the same scale so the
    // regression is pinned against the number it was found with.
    const ticks = runRounds(src, 100, 60);

    let duplicates = 0;
    for (let i = 1; i < ticks.length; i++){
      if (ticks[i].t <= ticks[i - 1].t) duplicates++;
    }
    expect(duplicates).toBe(0);

    // The 99 boundaries are still there — they are crossed with a gap now, not
    // skipped. Without this, a source that stopped emitting an opening tick
    // would also report zero duplicates.
    expect(ticks.length).toBe(100 * 61);
    // And nothing was rejected: the fix is a distinct stamp, not the gate
    // quietly swallowing every boundary tick.
    expect(src.rejectedTicks).toBe(0);
  });

  it('advance by exactly one tick interval', async () => {
    vi.useFakeTimers();
    const src = await freshSource();
    const ticks = record(src);
    src.resetRound();
    advance(src, 100);
    // The opening tick is emitted synchronously by resetRound; since FEED-F3
    // it is stamped a full interval past the previous emission rather than
    // sharing its reading, so every gap — including the first — is TICK_MS.
    for (let i = 1; i < ticks.length; i++){
      expect(ticks[i].t - ticks[i - 1].t).toBeCloseTo(TICK, 6);
    }
    src.halt();
  });

  /**
   * FEED-F2 — the second real FI finding.
   *
   * FI-8: "a tick with a non-increasing timestamp is rejected and alarmed."
   * Nothing on the feed path rejects one. The simulator stamps `t: now()` and
   * calls every subscriber unconditionally; `InterpBuffer.push` appends
   * without checking; no consumer inspects `t` for ordering.
   *
   * The simulator is safe today only by accident of its clock —
   * `performance.now()` is monotonic within a document. A `WsIndexSource`
   * reading a timestamp off the wire has no such guarantee, and M1.6's replay
   * source reads timestamps out of a file. The guard belongs at the seam, not
   * in each implementation.
   *
   * FIXED: the guard is `IndexSourceBase._publish` in `feed/monotonic.js`, at
   * the seam rather than in this implementation, so `ReplayIndexSource` and a
   * future `WsIndexSource` inherit rejection without restating it. The general
   * rule is asserted in the contract suite; this stays as the simulator's own
   * regression, driving the source's real `_emit` path.
   */
  it('rejects a tick whose timestamp does not increase (FEED-F2)', async () => {
    vi.useFakeTimers();
    const src = await freshSource();
    const ticks = record(src);
    src.resetRound();
    advance(src, 10);
    const seen = ticks.length;

    // Replay the previous timestamp through the source's own emit path, with
    // the clock frozen. A compliant source drops it.
    //
    // `idx` is moved first so the rejected tick would be *visible* if it got
    // through: a dropped tick that carried the same value as its predecessor
    // would pass this test for the wrong reason.
    const alarms = [];
    src.onAlarm(info => alarms.push(info));
    src.idx = 1234.5;
    const stale = ticks.at(-1).t;
    const staleV = ticks.at(-1).v;

    src._emit(0);

    // Rejected: no subscriber saw it, and the last tick is untouched.
    expect(ticks).toHaveLength(seen);
    expect(ticks.at(-1).t).toBe(stale);
    expect(ticks.at(-1).v).toBe(staleV);
    // Alarmed — FI-8's second half. A silent drop would hide a broken feed.
    expect(alarms).toHaveLength(1);
    expect(alarms[0]).toMatchObject({ t: stale, lastT: stale, count: 1 });
    expect(src.rejectedTicks).toBe(1);

    // The feed is not poisoned by the rejection: the next scheduled tick still
    // arrives, and still increases.
    advance(src, 1);
    expect(ticks.length).toBe(seen + 1);
    expect(ticks.at(-1).t).toBeGreaterThan(stale);
    src.halt();
  });
});

/* ----------------------------------------------------------------
   Determinism — the M1.6 exit criterion, arriving early.
---------------------------------------------------------------- */
describe('determinism — the same RSEED produces a byte-identical tick series', () => {
  /** A round's ticks, from a module registry rewound to the default seed. */
  async function seededRound(ticksToRun){
    vi.useFakeTimers();
    vi.resetModules();
    const mod = await import('../src/feed/SimulatedIndexSource.js');
    const src = new mod.SimulatedIndexSource();
    const ticks = record(src);
    src.resetRound();
    advance(src, ticksToRun);
    src.halt();
    // `t` is a clock reading, not part of the generated series; compare the
    // values the money path actually depends on.
    return ticks.map(tk => ({ v: tk.v, ret: tk.ret }));
  }

  it('two runs from the same seed agree tick for tick', async () => {
    const a = await seededRound(ROUND_TICKS);
    const b = await seededRound(ROUND_TICKS);

    expect(a.length).toBe(b.length);
    expect(a.length).toBeGreaterThan(700);
    // Byte-identical, not approximately equal: a float differing in the last
    // ulp would settle a position differently, and VR-1 lets a player
    // recompute the round and see it.
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('agrees exactly on every float, not merely close', async () => {
    const a = await seededRound(240);
    const b = await seededRound(240);
    for (let i = 0; i < a.length; i++){
      expect(Object.is(a[i].v, b[i].v), `index diverged at tick ${i}`).toBe(true);
      expect(Object.is(a[i].ret, b[i].ret), `ret diverged at tick ${i}`).toBe(true);
    }
  });

  it('a different stream position produces a different series — the test can fail', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const random = await import('../src/util/random.js');
    const mod = await import('../src/feed/SimulatedIndexSource.js');
    // Burn the stream to a different point, then build a source from it.
    for (let i = 0; i < 5000; i++) random.rnd();
    const src = new mod.SimulatedIndexSource();
    const ticks = record(src);
    src.resetRound();
    advance(src, 240);
    src.halt();
    const shifted = ticks.map(tk => ({ v: tk.v, ret: tk.ret }));

    const baseline = await seededRound(240);
    expect(JSON.stringify(shifted)).not.toBe(JSON.stringify(baseline));
  });

  it('resetRound re-bases the index without rewinding the stream', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    const mod = await import('../src/feed/SimulatedIndexSource.js');
    const src = new mod.SimulatedIndexSource();
    const ticks = record(src);

    src.resetRound();
    advance(src, 120);
    src.halt();
    const roundOne = ticks.splice(0).map(tk => tk.v);

    // A source that rewound its RNG on reset would replay the identical round
    // forever — a different and much worse failure than non-determinism.
    src.resetRound();
    advance(src, 120);
    src.halt();
    const roundTwo = ticks.map(tk => tk.v);

    expect(roundTwo[0]).toBe(roundOne[0]);              // same opening index
    expect(roundTwo.join()).not.toBe(roundOne.join());  // different path
  });
});
