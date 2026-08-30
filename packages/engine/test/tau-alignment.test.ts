/**
 * CR-6 τ-alignment across a full round — the release-blocker test.
 *
 * CR-6: "the crush line tested at tick *n* uses the same τ as the line displayed
 * at tick *n*. A line drawn at τ=n and tested at τ=n−1 (or vice versa) is a
 * release blocker... Test: across a full round, assert displayed-line(n) ===
 * engine-line(n) for every tick with a position open."
 *
 * `position.test.ts` already asserts the CR-6 property over hand-built fixtures.
 * This file asserts it over a *round*: 720 ticks at 8 Hz driven through the real
 * `onTick`, with τ advanced by the engine itself rather than by the test. That
 * distinction is the point. A fixture test proves the formula is single-sourced;
 * only a driven round proves the engine's own τ bookkeeping — the `ticksElapsed`
 * increment at the top of `onTick`, its ordering relative to the crush check
 * (CR-1), and the deliberate *absence* of an increment in `settleAtRoundEnd` —
 * keeps the two lines on the same tick.
 *
 * ## How the "engine line" is obtained
 *
 * The engine never returns the line it tested against: `isCrushed` computes it
 * internally and returns a boolean. Recomputing `positionCrushIndex` and calling
 * that "the engine line" would assert nothing — it would compare the displayed
 * line to itself and pass even if `isCrushed` used a different τ entirely.
 *
 * So the line is recovered from `isCrushed`'s *observable behaviour*:
 * `probeEngineLine` bisects the IEEE-754 ordering of doubles for the exact value
 * at which `isCrushed` flips. Because CR-1 makes the boundary inclusive, that
 * flip point IS the line the engine tested against, bit for bit. The probe calls
 * only the public `isCrushed` and reads nothing but its boolean, so it measures
 * the engine's real decision function. If `isCrushed` were changed to use a
 * stale τ, the probed boundary would move and the assertions here would fail —
 * which the can-it-fail block below demonstrates empirically.
 *
 * Equality is `Object.is` on the raw double throughout. `toBeCloseTo` would
 * defeat the criterion: CR-3 requires the two lines to be "the same computed
 * number, not merely equal within display precision".
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cents } from '@crush/ledger';
import {
  DEFAULT_CONFIG,
  crushIndex,
  isCrushed,
  onTick,
  open,
  positionCrushIndex,
  requestAscent,
  settleAtRoundEnd,
  tauOf,
} from '../src/index.js';
import type {
  Direction,
  EngineConfig,
  EngineState,
  Leverage,
  Position,
  Tick,
} from '../src/index.js';

/* ------------------------------------------------------------------ *
 * Parameters — the v1 sheet (§12).
 * ------------------------------------------------------------------ */

const I0 = 1000;
/** The v1 leverage set (EN-4, parameter sheet §12). */
const LEVERAGES: readonly Leverage[] = [2, 5, 10, 25];
const DIRECTIONS: readonly Direction[] = [1, -1];
const TICK_MS = 125;
/** 90 s round at 8 Hz = 720 authoritative ticks (RL-2, parameter sheet §12). */
const ROUND_TICKS = 720;
const STAKE = 5_000;
const START_BALANCE = 10_000_000;
/** θ = 0.25 %/s, the spec's opening value; non-zero so the line actually creeps. */
const CONFIG: EngineConfig = DEFAULT_CONFIG;

/* ------------------------------------------------------------------ *
 * A deterministic synthetic price series.
 * ------------------------------------------------------------------ */

/**
 * A closed-form price path — no RNG, no state, reproducible from the tick number
 * alone. Deliberately not the simulator: this test must produce the *same* 720
 * values on every machine and every run, so a CR-6 failure is reproducible from
 * its tick index without carrying a fixture file. Invariant 1 is untouched —
 * nothing random reaches money, here or anywhere.
 *
 * The superposed incommensurable sines give a non-repeating, non-monotonic walk
 * that crosses the entry price in both directions many times per round, so every
 * direction × leverage combination spends the round on both sides of its line.
 */
function priceAt(n: number, amplitude = 0.016): number {
  const a = Math.sin(n * 0.031);
  const b = Math.sin(n * 0.0071 + 1.7) * 0.6;
  const c = Math.sin(n * 0.113 + 0.4) * 0.25;
  return I0 * (1 + amplitude * ((a + b + c) / 1.85));
}

function tickAt(n: number, v = priceAt(n)): Tick {
  return { t: n * TICK_MS, v };
}

/* ------------------------------------------------------------------ *
 * Float bit-ordering helpers — used to bisect isCrushed's boundary.
 * ------------------------------------------------------------------ */

const view = new DataView(new ArrayBuffer(8));

/**
 * Map a double onto a monotonically ordered unsigned integer.
 *
 * For non-NaN doubles the IEEE-754 bit pattern is already ordered within each
 * sign; flipping the ordering for negatives yields a total order in which
 * "adjacent integers" means "adjacent representable doubles". Bisecting this
 * ordering converges on an exact float boundary in ~64 steps, where a decimal
 * bisection on `hi - lo > epsilon` would never land on the exact bit pattern.
 */
function toOrdinal(x: number): bigint {
  view.setFloat64(0, x);
  const bits = (BigInt(view.getUint32(0)) << 32n) | BigInt(view.getUint32(4));
  return bits & (1n << 63n) ? (1n << 64n) - bits : bits | (1n << 63n);
}

function fromOrdinal(o: bigint): number {
  const bits = o & (1n << 63n) ? o - (1n << 63n) : (1n << 64n) - o;
  view.setUint32(0, Number(bits >> 32n));
  view.setUint32(4, Number(bits & 0xffff_ffffn));
  return view.getFloat64(0);
}

/**
 * Recover the exact index value at which `isCrushed` flips for this position.
 *
 * This is "the line the engine tests against inside its crush check", obtained
 * without reading engine internals and without recomputing the formula. Only
 * `isCrushed`'s boolean is consulted.
 *
 * CR-1 makes the boundary inclusive — a tick exactly at the line crushes — so
 * the returned value is the first crushing value approaching from the survival
 * side, i.e. the line itself.
 */
function probeEngineLine(p: Position, tickSeconds: number): number {
  const crushedAt = (v: number): boolean => isCrushed(p, v, tickSeconds);

  // Bracket: a value far on the crush side, and one far on the survival side.
  // Surface (d=+1) crushes when the index falls, Dive (d=−1) when it rises.
  let crushed = toOrdinal(p.dir > 0 ? -Number.MAX_VALUE : Number.MAX_VALUE);
  let survived = toOrdinal(p.dir > 0 ? Number.MAX_VALUE : -Number.MAX_VALUE);

  // The bracket must actually bracket, or the bisection below is meaningless.
  expect(crushedAt(fromOrdinal(crushed)), 'probe bracket: crush side').toBe(true);
  expect(crushedAt(fromOrdinal(survived)), 'probe bracket: survival side').toBe(false);

  while (crushed > survived ? crushed - survived > 1n : survived - crushed > 1n) {
    const mid = (crushed + survived) / 2n;
    if (crushedAt(fromOrdinal(mid))) crushed = mid;
    else survived = mid;
  }
  return fromOrdinal(crushed);
}

/**
 * The line a renderer would draw: the public API the client actually calls.
 *
 * `apps/client/src/core/engine.js` → `Engine.liqIdx(p)` is exactly this call,
 * and `render/renderer.js` and `ui/console.js` are its only consumers.
 */
function displayedLine(p: Position, tickSeconds: number): number {
  return positionCrushIndex(p, tickSeconds);
}

/* ------------------------------------------------------------------ *
 * Round driver.
 * ------------------------------------------------------------------ */

interface TickObservation {
  readonly tick: number;
  readonly engineLine: number;
  readonly displayed: number;
  readonly tau: number;
  readonly settledThisTick: boolean;
  readonly reason: string | null;
  /**
   * True for the RL-4 round-end record only.
   *
   * `settleAtRoundEnd` deliberately does **not** advance τ — the final tick was
   * already counted by `onTick`, and counting it twice would charge an extra
   * tick of oxygen for the privilege of the round ending. So this record shares
   * its τ, and therefore its line, with the `onTick` observation immediately
   * before it. That is correct engine behaviour, but it means the record is not
   * a distinct tick of the τ series, and assertions that walk the series (or
   * that expect a one-tick-stale line to differ) must exclude it.
   */
  readonly roundEnd: boolean;
}

interface RoundRun {
  readonly observations: readonly TickObservation[];
  readonly ticksObserved: number;
  readonly settledAt: number | null;
  readonly settlementReason: string | null;
}

interface RoundOptions {
  /** The renderer path. Swapped for a stale one in the can-it-fail block. */
  readonly lineOf?: (p: Position, previous: Position | null, tickSeconds: number) => number;
  readonly ascentAtTick?: number;
  readonly amplitude?: number;
  readonly ticks?: number;
}

/**
 * Drive one full round and observe both lines on every tick with a position open.
 */
function runRound(
  dir: Direction,
  lev: Leverage,
  entryTick: number,
  options: RoundOptions = {},
): RoundRun {
  const lineOf = options.lineOf ?? ((p, _previous, ts): number => displayedLine(p, ts));
  const totalTicks = options.ticks ?? ROUND_TICKS;
  const price = (n: number): number => priceAt(n, options.amplitude);

  let state: EngineState = {
    wallet: { balance: cents(START_BALANCE), wagered: cents(0), net: cents(0) },
    position: null,
    lastResult: null,
    lossLocked: false,
  };

  const observations: TickObservation[] = [];
  let settledAt: number | null = null;
  let settlementReason: string | null = null;
  /** The position as it stood on the previous tick — the stale-τ source. */
  let previous: Position | null = null;

  for (let n = 0; n < totalTicks; n += 1) {
    const tk = tickAt(n, price(n));

    if (n === entryTick) {
      const r = open(state, { dir, stake: cents(STAKE), lev, id: 'p1' }, tk, CONFIG);
      expect(r.events.map((e) => e.kind), `entry at tick ${n}`).toContain('position-opened');
      state = r.state;
      previous = state.position;
      // The entry tick is tick 0 (PL-1); it is not replayed through onTick.
      continue;
    }

    if (options.ascentAtTick === n && state.position?.state === 'open') {
      state = requestAscent(state, tk.t, CONFIG).state;
    }

    const before = state.position;
    if (before === null || before.state === 'done') continue;

    const result = onTick(state, tk, CONFIG);
    state = result.state;

    // The position as the engine evaluated it on this tick: τ already advanced.
    // This is the exact object the crush check saw.
    const evaluated = state.position;
    expect(evaluated, `position present at tick ${n}`).not.toBeNull();
    if (evaluated === null) break;

    const settled = result.events.find((e) => e.kind === 'settled');
    observations.push({
      tick: n,
      engineLine: probeEngineLine(evaluated, CONFIG.tickSeconds),
      displayed: lineOf(evaluated, previous, CONFIG.tickSeconds),
      tau: tauOf(evaluated, CONFIG.tickSeconds),
      settledThisTick: settled !== undefined,
      reason: settled?.kind === 'settled' ? settled.settlement.reason : null,
      roundEnd: false,
    });

    if (settled?.kind === 'settled') {
      settledAt = n;
      settlementReason = settled.settlement.reason;
      break;
    }
    previous = evaluated;
  }

  // RL-4: a position still open at the last tick auto-surfaces there. Observe
  // the alignment on that settlement tick too. `settleAtRoundEnd` deliberately
  // does not advance τ, so the line here is the one the player was last shown.
  const stillOpen = state.position;
  if (settledAt === null && stillOpen !== null && stillOpen.state !== 'done') {
    observations.push({
      tick: totalTicks - 1,
      engineLine: probeEngineLine(stillOpen, CONFIG.tickSeconds),
      displayed: lineOf(stillOpen, previous, CONFIG.tickSeconds),
      tau: tauOf(stillOpen, CONFIG.tickSeconds),
      settledThisTick: true,
      reason: 'round-end',
      roundEnd: true,
    });
    settleAtRoundEnd(state, tickAt(totalTicks - 1, price(totalTicks - 1)), CONFIG);
    settledAt = totalTicks - 1;
    settlementReason = 'round-end';
  }

  return { observations, ticksObserved: observations.length, settledAt, settlementReason };
}

/** Assert exact, bit-for-bit alignment on every observed tick. */
function expectAligned(run: RoundRun, label: string): void {
  expect(run.ticksObserved, `${label}: observed no ticks`).toBeGreaterThan(0);
  for (const o of run.observations) {
    // Object.is, not toBeCloseTo. CR-3: "the same computed number, not merely
    // equal within display precision."
    expect(
      Object.is(o.displayed, o.engineLine),
      `${label} tick ${o.tick} (tau=${o.tau}): displayed ${o.displayed} !== engine ${o.engineLine}`,
    ).toBe(true);
  }
}

/* ================================================================== *
 * The criterion.
 * ================================================================== */

describe('CR-6 — tau alignment across a full round, every direction × leverage', () => {
  /**
   * The headline criterion, stated as CR-6 states it: across a full round, for
   * every tick with a position open, the displayed line and the engine's own
   * tested line are the same number.
   */
  it('CR-6/CR-1: displayed-line(n) === engine-line(n) on every tick of a 720-tick round', () => {
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        expectAligned(runRound(dir, lev, 120), `dir ${dir} lev ${lev}`);
      }
    }
  });

  /**
   * The alignment must hold across the whole round, not merely on a handful of
   * ticks before an early crush. This pins the coverage the criterion implies:
   * at least one configuration rides essentially the entire round and settles at
   * round-end rather than crushing out.
   */
  it('CR-6/CR-1: the round is genuinely driven — 720 ticks at 8 Hz, 600+ observed', () => {
    const run = runRound(1, 2, 0);
    expect(run.ticksObserved).toBeGreaterThan(600);
    expect(run.settlementReason).toBe('round-end');
    expectAligned(run, 'dir 1 lev 2 full round');
  });

  /**
   * CR-6's τ is the engine's own bookkeeping, so the observed τ series must be
   * the tick count times `tickSeconds` — 0.125 s per tick, starting at 0.125 on
   * the first tick after entry (the entry tick is tick 0, PL-1).
   */
  it('CR-6/CR-1: the observed tau series is tick-derived — 0.125 s per tick from entry', () => {
    const run = runRound(1, 2, 120);
    // The RL-4 record shares its τ with the tick before it by design, so the
    // series proper is the `onTick` observations.
    const ticked = run.observations.filter((o) => !o.roundEnd);
    // Entry at tick 120 leaves ticks 121..719 — every remaining tick of the round.
    expect(ticked.length).toBe(ROUND_TICKS - 120 - 1);
    ticked.forEach((o, i) => {
      expect(o.tau, `tick ${o.tick}`).toBeCloseTo((i + 1) * CONFIG.tickSeconds, 12);
    });
  });

  /**
   * The line must creep (CR-3) — an alignment test that passed only because the
   * line never moved would be worthless. Assert the line at the last observed
   * tick differs from the line at the first, for every configuration.
   */
  it('CR-6/CR-3: the aligned line is a creeping one, not a constant', () => {
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        const run = runRound(dir, lev, 0);
        const first = run.observations[0];
        const last = run.observations[run.observations.length - 1];
        expect(first, `dir ${dir} lev ${lev}`).toBeDefined();
        expect(last, `dir ${dir} lev ${lev}`).toBeDefined();
        if (first === undefined || last === undefined) continue;
        expect(
          first.engineLine === last.engineLine,
          `dir ${dir} lev ${lev}: the line never moved (${first.engineLine})`,
        ).toBe(false);
      }
    }
  });
});

describe('CR-6 — alignment on the crush tick and on an ascent settlement tick', () => {
  /**
   * The crush tick is where a τ misalignment does actual damage: the player is
   * crushed against a line one tick away from the one they were shown. Assert
   * alignment on that exact tick, for configurations that really crush.
   */
  it('CR-6/CR-1: the crush tick itself is aligned', () => {
    let crushesSeen = 0;
    for (const dir of DIRECTIONS) {
      // A wider path, so 25× (which needs a 4 % adverse move) actually reaches
      // its line. At the default ±1.6 % amplitude no leverage in the v1 set
      // crushes, and this case would assert nothing — hence the count below.
      const run = runRound(dir, 25, 0, { amplitude: 0.08 });
      if (run.settlementReason !== 'crush') continue;
      const last = run.observations[run.observations.length - 1];
      expect(last, `dir ${dir}: no observations`).toBeDefined();
      if (last === undefined) continue;
      crushesSeen += 1;
      expect(last.settledThisTick, `dir ${dir}: last observation is the crush tick`).toBe(true);
      expect(
        Object.is(last.displayed, last.engineLine),
        `dir ${dir}: crush tick ${last.tick} displayed ${last.displayed} !== engine ${last.engineLine}`,
      ).toBe(true);
      // And every tick up to and including the crush stayed aligned.
      expectAligned(run, `dir ${dir} lev 25 to the crush`);
    }
    expect(crushesSeen, 'no direction crushed — the crush-tick case never ran').toBeGreaterThan(0);
  });

  /**
   * CO-1 / PL-3: oxygen accrues during the 500 ms ascent exactly as while open,
   * so the line keeps creeping through The Blow and must stay aligned on the
   * settlement tick — the tick the money actually derives from.
   */
  it('CR-6/CR-1: the settlement tick of an ascent is aligned', () => {
    let ascentsSeen = 0;
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        const run = runRound(dir, lev, 0, { ascentAtTick: 40 });
        if (run.settlementReason !== 'ascent') continue;
        const last = run.observations[run.observations.length - 1];
        expect(last).toBeDefined();
        if (last === undefined) continue;
        ascentsSeen += 1;
        expect(last.settledThisTick).toBe(true);
        expect(
          Object.is(last.displayed, last.engineLine),
          `dir ${dir} lev ${lev}: ascent settle tick ${last.tick} misaligned`,
        ).toBe(true);
        expectAligned(run, `dir ${dir} lev ${lev} through the ascent`);
      }
    }
    // The loop above asserts nothing if no configuration ever settles by
    // ascent, so the count is itself an assertion.
    expect(ascentsSeen, 'no configuration settled by ascent').toBeGreaterThan(0);
  });

  /**
   * RL-4: the round-end settlement tick. `settleAtRoundEnd` deliberately does
   * not advance τ — counting the final tick twice would charge an extra tick of
   * oxygen — so the line on that tick must still be the one already displayed.
   */
  it('CR-6/CR-1: the round-end settlement holds tau, and its line stays aligned', () => {
    const run = runRound(1, 2, 0);
    expect(run.settlementReason).toBe('round-end');
    const last = run.observations[run.observations.length - 1];
    const priorTick = run.observations[run.observations.length - 2];
    expect(last).toBeDefined();
    expect(priorTick).toBeDefined();
    if (last === undefined || priorTick === undefined) return;
    expect(last.roundEnd).toBe(true);
    expect(priorTick.roundEnd).toBe(false);
    expect(Object.is(last.displayed, last.engineLine)).toBe(true);

    // RL-4 settles "at the final tick at its current multiplier" — the
    // multiplier the player was already shown. `settleAtRoundEnd` therefore
    // does not advance τ: the final tick was already counted by `onTick`, and
    // counting it again would charge one extra tick of oxygen for the round
    // merely ending. So τ is held, and the line is byte-identical to the one
    // displayed on the last ticked observation. A τ advance here would be the
    // CR-6 defect wearing a different hat — the player settling against a line
    // one tick past the one on screen.
    expect(last.tau).toBe(priorTick.tau);
    expect(Object.is(last.engineLine, priorTick.engineLine)).toBe(true);
  });
});

describe('CR-6 — the test can fail: a renderer one tick stale goes red', () => {
  /**
   * A test that cannot fail is not evidence.
   *
   * This injects precisely the defect CR-6 names — "a line drawn at τ=n and
   * tested at τ=n−1" — by having the renderer path compute its line from the
   * *previous* tick's position, and asserts that the alignment check rejects it.
   * The engine is untouched; only the injected `lineOf` differs from the real
   * one, so a passing suite genuinely depends on the engine's τ bookkeeping.
   */
  const stale = (_p: Position, previous: Position | null, ts: number): number =>
    previous === null ? Number.NaN : positionCrushIndex(previous, ts);

  it('CR-6: a stale-tau renderer path is detected on every direction × leverage', () => {
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        const run = runRound(dir, lev, 120, { lineOf: stale });
        expect(run.ticksObserved).toBeGreaterThan(0);
        const misaligned = run.observations.filter((o) => !Object.is(o.displayed, o.engineLine));
        expect(
          misaligned.length,
          `dir ${dir} lev ${lev}: a one-tick-stale line was NOT detected`,
        ).toBeGreaterThan(0);
        // And the very harness the passing tests use rejects it.
        expect(() => expectAligned(run, `stale dir ${dir} lev ${lev}`)).toThrow();
      }
    }
  });

  /**
   * The stale line is wrong on *every* tick, not merely on some — the creep is
   * monotone, so one tick of τ always separates the two numbers. This pins the
   * sensitivity: the check catches the defect on its first opportunity.
   */
  it('CR-6: the stale line differs on every single ticked observation, not just some', () => {
    const run = runRound(1, 10, 120, { lineOf: stale });
    // Every `onTick` observation is caught. The RL-4 round-end record is
    // excluded on purpose: `settleAtRoundEnd` holds τ, so "the previous tick's
    // position" and "this record's position" carry the same τ there and a
    // stale reader coincidentally agrees. That is the engine behaving
    // correctly, not the check missing a defect — the assertion above already
    // pins τ being held at round-end.
    const ticked = run.observations.filter((o) => !o.roundEnd);
    expect(ticked.length).toBe(ROUND_TICKS - 120 - 1);
    expect(ticked.filter((o) => Object.is(o.displayed, o.engineLine))).toEqual([]);
  });

  /**
   * The complement: with the real renderer path the same round is fully aligned.
   * Together with the case above this brackets the test's discriminating power —
   * it says yes to the correct path and no to the stale one, on the same round.
   */
  it('CR-6: the same round with the real renderer path is fully aligned', () => {
    const run = runRound(1, 10, 120);
    expect(run.observations.filter((o) => !Object.is(o.displayed, o.engineLine))).toEqual([]);
  });
});

/* ================================================================== *
 * CR-3 — the client renders a rounded copy and never recomputes.
 * ================================================================== */

describe('CR-3 — the client Engine.liqIdx() returns that identical number', () => {
  /**
   * `apps/client/src/core/engine.js` cannot be imported here: it pulls in
   * `render/renderer.js`, `audio/audio.js` and `ui/*`, which touch `document`
   * and attach listeners at module scope, and the suite runs in
   * `environment: 'node'` with no DOM shim. Standing up jsdom for one adapter
   * method would add a dependency and still only prove that a mocked DOM did
   * not throw.
   *
   * Instead the adapter's own source is read — exactly as `purity.test.ts`
   * reads engine sources — and its `liqIdx` body asserted to be a pure
   * delegation to `positionCrushIndex`; then that delegation is executed here
   * against the engine over a full round. Both halves of CR-3 are covered: the
   * client does not recompute (static), and the value it forwards is the
   * engine's own line, bit for bit (behavioural).
   */
  const ADAPTER = fileURLToPath(new URL('../../../apps/client/src/core/engine.js', import.meta.url));
  const LIQ_IDX = /liqIdx\s*\(([^)]*)\)\s*\{([^}]*)\}/;

  it('CR-3: liqIdx() delegates to positionCrushIndex and does not re-derive the line', () => {
    const src = readFileSync(ADAPTER, 'utf8');
    const match = LIQ_IDX.exec(src);
    expect(match, 'Engine.liqIdx not found in the client adapter').not.toBeNull();
    if (match === null) return;
    const params = match[1] ?? '';
    const body = match[2] ?? '';

    // It forwards its own argument to the engine...
    expect(body).toContain('positionCrushIndex');
    expect(body).toContain(params.trim());
    // ...at the round config's tickSeconds, i.e. the position's own τ.
    expect(body).toContain('tickSeconds');
    // ...and performs no arithmetic of its own. CR-3 forbids a second copy of
    // the formula; these are the operators `I_e·(1 − d·(1 − θτ)/L)` would need.
    const withoutCall = body.replace(/positionCrushIndex\s*\([^)]*\)/g, '');
    for (const op of ['*', '/', '-', '+']) {
      expect(withoutCall, `liqIdx body performs arithmetic: ${op}`).not.toContain(op);
    }
    // ...and the engine's symbol is imported from the package, not redefined.
    expect(src).toMatch(/import\s*\{[\s\S]*positionCrushIndex[\s\S]*\}\s*from\s*'@crush\/engine'/);
  });

  /**
   * The behavioural half: the delegation the adapter declares —
   * `positionCrushIndex(p, roundConfig.tickSeconds)` — returns bit-for-bit the
   * number the engine tests against, for the same position, on every tick of a
   * full round, in both directions and at all four leverages.
   */
  it('CR-3/CR-6: the delegated liqIdx value === the engine line, every tick, every config', () => {
    /** `Engine.liqIdx`'s body verbatim, with `roundConfig` bound to CONFIG. */
    const liqIdx = (p: Position): number => positionCrushIndex(p, CONFIG.tickSeconds);

    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        expectAligned(runRound(dir, lev, 0, { lineOf: (p) => liqIdx(p) }), `liqIdx ${dir}/${lev}`);
      }
    }
  });

  /**
   * CR-3 also says the client renders a *rounded copy*. `ui/console.js` shows
   * `Engine.liqIdx(p).toFixed(1)` and the renderer maps the raw value to a
   * pixel. Assert the rounding is a display-only projection of the same number:
   * the raw value the engine tests is unchanged by anything the client displays.
   */
  it('CR-3: the displayed rounding is a projection of the engine line, not a substitute', () => {
    const run = runRound(-1, 10, 0);
    expect(run.ticksObserved).toBeGreaterThan(0);
    for (const o of run.observations) {
      expect(o.engineLine.toFixed(1)).toBe(o.displayed.toFixed(1));
      expect(Object.is(o.engineLine, o.displayed)).toBe(true);
    }
  });

  /**
   * A guard on the guard: if the adapter were ever changed to inline the
   * formula, the static check above must fail rather than pass on a body that
   * merely mentions the symbol. Demonstrated on a synthetic body, so proving it
   * requires editing no client file.
   */
  it('CR-3: the delegation check rejects an inlined re-derivation', () => {
    const inlined = 'liqIdx(p){ return p.entry * (1 - (p.dir * (1 - p.theta * tau)) / p.lev); }';
    const match = LIQ_IDX.exec(inlined);
    expect(match).not.toBeNull();
    const body = match?.[2] ?? '';
    expect(body).not.toContain('positionCrushIndex');
    const withoutCall = body.replace(/positionCrushIndex\s*\([^)]*\)/g, '');
    expect(['*', '/', '-'].some((op) => withoutCall.includes(op))).toBe(true);
  });
});

/* ================================================================== *
 * Cross-check: the probe measures the engine, not a copy of the formula.
 * ================================================================== */

describe('CR-6 — the probe measures the engine itself', () => {
  /**
   * The whole file rests on `probeEngineLine` recovering the real internal line.
   * This pins it: the probed boundary equals `crushIndex` evaluated from the
   * spec formula at the position's own τ, for every direction × leverage across
   * the round. If the probe were subtly wrong, every other assertion here would
   * be measuring the wrong thing.
   */
  it('CR-6/CR-3: the probed boundary equals the spec formula at the position tau', () => {
    for (const dir of DIRECTIONS) {
      for (const lev of LEVERAGES) {
        for (let n = 0; n <= ROUND_TICKS; n += 43) {
          const p: Position = {
            id: 'p1',
            dir,
            stake: cents(STAKE),
            lev,
            entry: I0,
            state: 'open',
            openedT: 0,
            ticksElapsed: n,
            theta: CONFIG.thetaPerSecond,
            lastMultiplier: 1,
            ascentCause: null,
            resolveT: 0,
          };
          const probed = probeEngineLine(p, CONFIG.tickSeconds);
          const fromSpec = crushIndex(dir, lev, I0, CONFIG.thetaPerSecond, n * CONFIG.tickSeconds);
          expect(
            Object.is(probed, fromSpec),
            `dir ${dir} lev ${lev} tick ${n}: probe ${probed} !== spec ${fromSpec}`,
          ).toBe(true);
        }
      }
    }
  });
});
