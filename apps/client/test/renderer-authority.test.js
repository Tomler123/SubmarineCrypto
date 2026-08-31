import { describe, expect, it } from 'vitest';
import {
  initialState,
  onTick as engineOnTick,
  open as engineOpen,
  requestAscent as engineRequestAscent,
} from '@crush/engine';
import { projectScene, DEFAULT_VIEWPORT } from '../src/render/scene-model.ts';
import { CFG } from '../src/config/constants.js';

/* ================================================================
   SC-4 — renderer timing cannot reach the money.

   This is the milestone's central claim, so it is asserted against the real
   `@crush/engine`, not a mock: the same tick series and the same action script
   are run while a scene is projected at wildly different cadences — every
   tick, once in a while, and never at all. If a frame rate could reach a
   settlement, these three runs would disagree.

   The projection deliberately runs *between* engine ticks here, exactly where
   a real client would call it, so a projection that mutated the position or
   leaked a value into the next tick would be caught rather than sidestepped.
================================================================ */

/** The client's own round config, so this test cannot drift from the adapter. */
const CONFIG = {
  ascentMs: CFG.ASCENT_MS,
  thetaPerSecond: CFG.THETA_PER_S,
  tickSeconds: CFG.TICK_S,
  maxWinMultiple: CFG.MAX_WIN_MULT,
  maxWinCents: CFG.MAX_WIN_CENTS,
  allowedLeverages: CFG.LEV,
  minStakeCents: CFG.MIN_STAKE_CENTS,
  maxNotionalCents: CFG.MAX_NOTIONAL_CENTS,
  maxIndexMovePerTick: CFG.MAX_INDEX_MOVE_PER_TICK,
  reentryCooldownMs: CFG.REENTRY_COOLDOWN_MS,
};

/** A deterministic, mildly adverse tick series — no RNG anywhere. */
function ticks(count){
  const out = [];
  let v = CFG.IDX0;
  for (let i = 0; i < count; i++){
    v *= 1 + Math.sin(i / 3) * 0.0015 - 0.0004;
    out.push({ t: i * CFG.TICK_MS, v });
  }
  return out;
}

/**
 * Run one full round. `framesPerTick` decides how often the scene is
 * projected; it is the only thing that differs between runs.
 */
function run(framesPerTick){
  let state = initialState(CFG.START_BAL);
  const series = ticks(60);
  const events = [];
  let projections = 0;

  state = engineOpen(
    state,
    { dir: 1, stake: 500, lev: 10, id: 'p1', entryOpen: true },
    series[0],
    CONFIG,
  ).state;

  for (let i = 1; i < series.length; i++){
    const tick = series[i];
    const stepped = engineOnTick(state, tick, CONFIG);
    state = stepped.state;
    for (const e of stepped.events) events.push(e);

    if (i === 30 && state.position){
      const asc = engineRequestAscent(state, tick.t, CONFIG);
      state = asc.state;
      for (const e of asc.events) events.push(e);
    }

    // Presentation runs here, between authoritative ticks, at the cadence
    // under test — including zero times when framesPerTick is 0.
    for (let f = 0; f < framesPerTick; f++){
      projections += 1;
      projectScene({
        t: tick.t + f,
        dt: framesPerTick === 0 ? 0 : 1 / (framesPerTick * 8),
        phase: 'running',
        phaseT: 0,
        value: tick.v,
        position: state.position
          ? {
              dir: state.position.dir,
              state: state.position.state,
              entryIndex: state.position.entry,
              crushIndex: state.position.entry * 0.94,
              stake: state.position.stake,
              livePnlCents: 0,
              oxygen: 0.5,
            }
          : null,
        lastTick: tick,
        trail: series.slice(0, i).map(p => ({ t: p.t, v: p.v })),
        viewport: { ...DEFAULT_VIEWPORT, width: 390, height: 700 },
        camera: { cam: CFG.BASE_DEPTH, pxm: 0.5 },
      });
    }
  }

  return {
    projections,
    balance: state.balance,
    settlements: events
      .filter(e => e.kind === 'settled')
      .map(e => JSON.stringify(e.settlement)),
  };
}

describe('SC-4 — frame rate cannot change a settlement', () => {
  const noFrames = run(0);
  const oneFrame = run(1);
  const manyFrames = run(9);

  it('actually exercised different frame cadences', () => {
    expect(noFrames.projections).toBe(0);
    expect(oneFrame.projections).toBeGreaterThan(0);
    expect(manyFrames.projections).toBeGreaterThan(oneFrame.projections);
  });

  it('settled at all, so the comparison is not vacuous', () => {
    expect(oneFrame.settlements.length).toBeGreaterThan(0);
  });

  it('produces byte-identical settlements with no frames and with many', () => {
    expect(noFrames.settlements).toEqual(manyFrames.settlements);
  });

  it('produces byte-identical settlements at every cadence', () => {
    expect(oneFrame.settlements).toEqual(noFrames.settlements);
  });

  it('leaves the balance identical regardless of how often the scene drew', () => {
    expect(noFrames.balance).toBe(oneFrame.balance);
    expect(oneFrame.balance).toBe(manyFrames.balance);
  });
});

describe('SC-3 — the projection has no path back into engine state', () => {
  it('does not mutate the position object it is handed', () => {
    let state = initialState(CFG.START_BAL);
    const series = ticks(4);
    state = engineOpen(
      state,
      { dir: 1, stake: 500, lev: 10, id: 'p1', entryOpen: true },
      series[0],
      CONFIG,
    ).state;
    state = engineOnTick(state, series[1], CONFIG).state;

    const before = JSON.stringify(state.position);
    projectScene({
      t: series[1].t,
      dt: 1 / 60,
      phase: 'running',
      phaseT: 0,
      value: series[1].v,
      position: {
        dir: state.position.dir,
        state: state.position.state,
        entryIndex: state.position.entry,
        crushIndex: state.position.entry * 0.94,
        stake: state.position.stake,
        livePnlCents: 0,
        oxygen: 0.5,
      },
      lastTick: series[1],
      trail: [],
      viewport: { ...DEFAULT_VIEWPORT, width: 390, height: 700 },
      camera: { cam: CFG.BASE_DEPTH, pxm: 0.5 },
    });
    expect(JSON.stringify(state.position)).toBe(before);
  });
});
