import { describe, expect, it, beforeEach, vi } from 'vitest';
import { installDom } from './support/dom.js';
import { installMocks, resetSpies, spies } from './support/mocks.js';

/* ================================================================
   ROUND — RL-1 (the transition graph) and RL-2 (the timings).

   `roundUpdate(t)` is the only thing that advances the machine in production;
   `setPhase` is the effect half. So RL-1 is asserted by driving `roundUpdate`
   with a controlled clock and recording the sequence of phases it produces,
   rather than by calling `setPhase` directly — the latter would test a
   function nothing but the machine is supposed to call.

   The renderer, audio, bots, feed source and every UI writer are mocked at the
   module boundary, so what is under test here is the graph and the clock and
   nothing else.

   Since M1.5 `setPhase` enforces the graph itself: it accepts only the legal
   successor of the current phase, so a test that needs to start mid-cycle uses
   `resetPhase`, the explicit out-of-band seed. That split is deliberate — it
   means a production call site cannot reach an illegal transition by accident,
   while a test can still place the machine anywhere it needs to, visibly.
================================================================ */

installDom();
installMocks();

let clock = 0;
vi.mock('../src/util/math.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, now: () => clock };
});

const { roundUpdate, setPhase, resetPhase } = await import('../src/core/round.js');
const { S } = await import('../src/state/store.js');
const { CFG } = await import('../src/config/constants.js');
const { Engine } = await import('../src/core/engine.js');

/** RL-1's permitted graph, written once, asserted from both directions. */
const ALLOWED = {
  waiting:   'launching',
  launching: 'running',
  running:   'ending',
  ending:    'settling',
  settling:  'waiting',
};
const PHASES = Object.keys(ALLOWED);

/** How long each phase is meant to last, per CFG. */
const DURATION = {
  waiting:   CFG.WAIT_MS,
  launching: CFG.LAUNCH_MS,
  ending:    CFG.ENDING_MS,
  settling:  CFG.SETTLE_MS,
};

beforeEach(() => {
  resetSpies();
  clock = 0;
  S.armed = null;
  S.lastTick = { t: 0, v: CFG.IDX0 };
  S.roundNo = 0;
});

/** The instant `phase` is due to hand over. */
function deadlineOf(phase){
  return phase === 'running' ? S.roundEnd : S.phaseT + DURATION[phase];
}

/**
 * Run the machine from `waiting` for `steps` transitions, recording each phase
 * as it is entered. Time is advanced to exactly the instant each phase is due
 * to end, so the recorded sequence is the graph and not a sampling artefact.
 */
function walk(steps){
  clock = 0;
  resetPhase('waiting');
  const seen = ['waiting'];
  for (let i = 0; i < steps; i++){
    clock = deadlineOf(S.phase);
    roundUpdate(clock);
    seen.push(S.phase);
  }
  return seen;
}

describe('RL-1 the state machine permits exactly one cycle', () => {
  it('walks waiting to launching to running to ending to settling to waiting', () => {
    expect(walk(5)).toEqual([
      'waiting', 'launching', 'running', 'ending', 'settling', 'waiting',
    ]);
  });

  it('keeps cycling on the same graph for three full rounds', () => {
    expect(walk(15)).toEqual([
      'waiting', 'launching', 'running', 'ending', 'settling',
      'waiting', 'launching', 'running', 'ending', 'settling',
      'waiting', 'launching', 'running', 'ending', 'settling',
      'waiting',
    ]);
  });

  it('every phase has exactly one legal successor and reaches no other', () => {
    for (const from of PHASES){
      clock = 1000;
      resetPhase(from);
      // Well past the deadline: even over-shooting cannot skip a phase.
      clock = deadlineOf(from) + 10 * CFG.ROUND_MS;
      roundUpdate(clock);
      expect(S.phase, `from ${from}`).toBe(ALLOWED[from]);
    }
  });

  it('never advances before its phase is due', () => {
    for (const from of PHASES){
      clock = 1000;
      resetPhase(from);
      clock = deadlineOf(from) - 1;
      roundUpdate(clock);
      expect(S.phase, `from ${from} one ms early`).toBe(from);
    }
  });

  it('advances on the deadline instant itself, not a millisecond later', () => {
    for (const from of PHASES){
      clock = 1000;
      resetPhase(from);
      clock = deadlineOf(from);
      roundUpdate(clock);
      expect(S.phase, `from ${from} at the deadline`).toBe(ALLOWED[from]);
    }
  });

  it('roundUpdate on an unknown phase is inert — no transition is invented', () => {
    // The switch's default arm. Reachable only by writing S.phase directly,
    // which is what this does; `setPhase` and `resetPhase` both refuse it.
    S.phase = 'nonsense';
    S.phaseT = 0;
    clock = 10 * CFG.ROUND_MS;
    roundUpdate(clock);
    expect(S.phase).toBe('nonsense');
  });

  it('RL-1: setPhase refuses every transition outside the graph, self included', () => {
    // RL-1 says "no other transitions exist". Since M1.5 that is a property of
    // the setter rather than of its one well-behaved caller: phase entry runs
    // side effects that are not idempotent, so an illegal transition is a
    // double settlement, not a cosmetic state error.
    for (const from of PHASES){
      for (const to of PHASES){
        if (to === ALLOWED[from]) continue;
        clock = 1000;
        resetPhase(from);
        const phaseT = S.phaseT;
        expect(setPhase(to), `${from} -> ${to} should be refused`).toBe(false);
        expect(S.phase, `${from} -> ${to} changed the phase`).toBe(from);
        // The timestamp must not move either: a refused transition that still
        // restamped phaseT would silently extend the phase.
        expect(S.phaseT, `${from} -> ${to} restamped phaseT`).toBe(phaseT);
      }
    }
  });

  it('RL-1: setPhase accepts the legal successor and reports that it did', () => {
    for (const from of PHASES){
      clock = 1000;
      resetPhase(from);
      expect(setPhase(ALLOWED[from]), `${from} -> ${ALLOWED[from]}`).toBe(true);
      expect(S.phase).toBe(ALLOWED[from]);
    }
  });

  it('RL-1: setPhase refuses a phase name that is not in the graph at all', () => {
    clock = 1000;
    resetPhase('waiting');
    expect(setPhase('nonsense')).toBe(false);
    expect(setPhase(undefined)).toBe(false);
    expect(S.phase).toBe('waiting');
  });

  it('RL-1: resetPhase refuses a phase name outside the graph too', () => {
    // The seed is a bypass of the *transition* rule, not of the phase set: it
    // must not be usable to park the machine in a state `roundUpdate` cannot
    // leave. `hasOwnProperty` rather than `in`, so an inherited Object key
    // ('constructor', 'toString') is refused like any other non-phase.
    clock = 1000;
    resetPhase('waiting');
    expect(resetPhase('nonsense')).toBe(false);
    expect(resetPhase('constructor')).toBe(false);
    expect(resetPhase(undefined)).toBe(false);
    expect(S.phase).toBe('waiting');
  });
});

describe('RL-2 timings match CFG and the spec parameter sheet', () => {
  it('running lasts ROUND_MS = 90 s', () => {
    clock = 5000;
    resetPhase('running');
    expect(S.roundEnd - clock).toBe(CFG.ROUND_MS);
    expect(CFG.ROUND_MS).toBe(90_000);
  });

  it('the intermission is WAIT_MS = 8 s', () => {
    clock = 5000;
    resetPhase('waiting');
    clock = S.phaseT + CFG.WAIT_MS - 1;
    roundUpdate(clock);
    expect(S.phase).toBe('waiting');
    clock = S.phaseT + CFG.WAIT_MS;
    roundUpdate(clock);
    expect(S.phase).toBe('launching');
    expect(CFG.WAIT_MS).toBe(8000);
  });

  it('running ends against roundEnd, not against elapsed phase time', () => {
    // The `running` arm is the one case that compares an absolute deadline
    // rather than `t - phaseT`. If it ever switched to elapsed time, a round
    // whose phaseT and roundEnd disagree would end at the wrong instant.
    clock = 1000;
    resetPhase('running');
    S.roundEnd = clock + 1234;
    clock += 1233;
    roundUpdate(clock);
    expect(S.phase).toBe('running');
    clock += 1;
    roundUpdate(clock);
    expect(S.phase).toBe('ending');
  });
});

describe('the round-end settlement path', () => {
  it('calls forceSettleAtRoundEnd exactly once per round', () => {
    const spy = vi.spyOn(Engine, 'forceSettleAtRoundEnd');
    walk(5);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('calls it three times across three rounds — once each, never twice', () => {
    const spy = vi.spyOn(Engine, 'forceSettleAtRoundEnd');
    walk(15);
    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });

  it('settles on entering settling, not on ending', () => {
    const spy = vi.spyOn(Engine, 'forceSettleAtRoundEnd');
    clock = 0;
    resetPhase('ending');
    expect(spy).not.toHaveBeenCalled();
    clock = S.phaseT + CFG.ENDING_MS;
    roundUpdate(clock);
    expect(S.phase).toBe('settling');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('RL-1: re-entering settling cannot settle twice — the setter refuses it', () => {
    // The case the guard exists for. Before M1.5 this settled twice: nothing in
    // production could call setPhase('settling') from 'settling', but that was a
    // property of the caller, not of the setter, so a second call site anywhere
    // would have paid an open position out twice. Now the transition is refused
    // and forceSettleAtRoundEnd runs exactly once.
    const spy = vi.spyOn(Engine, 'forceSettleAtRoundEnd');
    clock = 0;
    resetPhase('ending');
    expect(setPhase('settling')).toBe(true);
    expect(setPhase('settling')).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('RL-1: no illegal entry into settling from any phase fires a settlement', () => {
    // The general form: only `ending -> settling` may settle. Every other
    // source phase must leave forceSettleAtRoundEnd untouched.
    for (const from of PHASES){
      if (from === 'ending') continue;
      clock = 0;
      // Seed first, then spy: `resetPhase('settling')` legitimately runs the
      // settle effect (it is the out-of-band seed), and counting that would
      // measure the seeding rather than the guarded transition under test.
      resetPhase(from);
      const spy = vi.spyOn(Engine, 'forceSettleAtRoundEnd');
      expect(setPhase('settling'), `${from} -> settling`).toBe(false);
      expect(spy, `${from} -> settling settled anyway`).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });

  it('RL-1: resetPhase is the only out-of-band seed, and it does run side effects', () => {
    // resetPhase exists for boot and for tests. It deliberately still runs the
    // phase's entry effects — `main.js` boots through it and needs the waiting
    // overlay cleared — so it is a seed, not a silent state poke. Kept honest
    // here so nobody assumes it is effect-free.
    const spy = vi.spyOn(Engine, 'forceSettleAtRoundEnd');
    clock = 0;
    resetPhase('settling');
    expect(S.phase).toBe('settling');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('phase side effects land on the right boundary', () => {
  it('launching bumps the round number and resets the feed buffer', () => {
    clock = 0;
    resetPhase('waiting');
    const before = S.roundNo;
    clock = CFG.WAIT_MS;
    roundUpdate(clock);
    expect(S.phase).toBe('launching');
    expect(S.roundNo).toBe(before + 1);
    expect(spies.bufferReset).toHaveBeenCalled();
    expect(spies.FX.roundReset).toHaveBeenCalled();
  });

  it('running resets the feed round and spawns bots', () => {
    clock = 0;
    resetPhase('running');
    expect(spies.sourceResetRound).toHaveBeenCalledTimes(1);
    expect(spies.spawnBots).toHaveBeenCalledTimes(1);
  });

  it('ending halts the source before settlement reads the last tick', () => {
    clock = 0;
    resetPhase('ending');
    expect(spies.sourceHalt).toHaveBeenCalledTimes(1);
  });

  it('an armed bet is released at running and cleared so it cannot double-fire', () => {
    S.armed = { dir: 1, stake: 500, lev: 10 };
    clock = 0;
    resetPhase('running');
    expect(S.armed).toBe(null);
  });
});
