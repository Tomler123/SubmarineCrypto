/**
 * M2.0 — RS-1…RS-8. The multi-player fan-out.
 *
 * The three milestone properties are order-independence (RS-2), player
 * isolation (RS-3) and canonical event ordering (RS-4). Each is tested here as
 * a property over a real population running real ticks through the real
 * per-player engine — not as a claim about the implementation's shape.
 *
 * The populations are built from a seeded deterministic generator rather than
 * `Math.random`, so a failure is reproducible from the test file alone. It is a
 * test fixture, never a money path (invariant 1).
 */

import { cents } from '@crush/ledger';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  type EngineState,
  type PlayerRef,
  type RoundEvent,
  type RoundState,
  type Tick,
  directionalExposure,
  initialRound,
  initialState,
  onTick,
  open,
  requestAscent,
  resetRoundPhase,
  roundClearSettled,
  roundOpen,
  roundRequestAscent,
  roundSetLossLocked,
  roundSettleAtRoundEnd,
  roundTick,
  seatPlayer,
  setRoundPhase,
  unseatPlayer,
} from '../src/index.js';

/* ----------------------------------------------------------------------------
   Fixtures
---------------------------------------------------------------------------- */

/** Seeded LCG. Fixture-only: no money path reads it (invariant 1). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

const LEVERAGES = [2, 5, 10, 25] as const;
const TICK_MS = 125;

/** A tick series that moves enough to crush some positions and pay others. */
function tickSeries(count: number, seed: number): Tick[] {
  const rnd = lcg(seed);
  const ticks: Tick[] = [];
  let v = 1000;
  for (let i = 0; i < count; i += 1) {
    // ±0.45 % per tick: comfortably inside FI-3's one-tick bound, wide enough
    // that 25x positions crush within a few dozen ticks.
    v *= 1 + (rnd() - 0.5) * 0.009;
    ticks.push({ t: i * TICK_MS, v });
  }
  return ticks;
}

interface PlayerScript {
  readonly ref: PlayerRef;
  readonly dir: 1 | -1;
  readonly lev: number;
  readonly stake: ReturnType<typeof cents>;
  /** Tick index at which this player opens. */
  readonly openAt: number;
  /** Tick index at which this player requests an ascent, or null for never. */
  readonly ascendAt: number | null;
  readonly takeProfit?: number;
  readonly stopLoss?: number;
}

/** Build `n` varied player scripts: both directions, every leverage, TP/SL mixed in. */
function population(n: number, seed: number): PlayerScript[] {
  const rnd = lcg(seed);
  const scripts: PlayerScript[] = [];
  for (let i = 0; i < n; i += 1) {
    const lev = LEVERAGES[i % LEVERAGES.length] as number;
    const openAt = Math.floor(rnd() * 8);
    const wantsAscent = rnd() < 0.6;
    const useTp = rnd() < 0.3;
    const useSl = rnd() < 0.3;
    scripts.push({
      // Padded so the lexicographic order is not the insertion order, and
      // deliberately not zero-padded uniformly: 'p9' sorts after 'p10', which
      // is exactly the code-unit ordering RS-4 declares.
      ref: `p${i}`,
      dir: i % 2 === 0 ? 1 : -1,
      lev,
      stake: cents(100 + (i % 17) * 25),
      openAt,
      ascendAt: wantsAscent ? openAt + 1 + Math.floor(rnd() * 20) : null,
      // AO-3: TP must exceed 1 + lev x maxIndexMovePerTick; SL in (0, 1).
      ...(useTp ? { takeProfit: 1 + lev * DEFAULT_CONFIG.maxIndexMovePerTick + 0.5 } : {}),
      ...(useSl ? { stopLoss: 0.4 } : {}),
    });
  }
  return scripts;
}

/** Seat every script's player, in the given key order. */
function seatAll(round: RoundState, refs: readonly PlayerRef[]): RoundState {
  return refs.reduce((r, ref) => seatPlayer(r, ref, initialState(cents(100_000))), round);
}

/**
 * Drive a whole round: seat, then step the tick series, opening and ascending
 * per script at the declared tick indices. Returns the final round and the full
 * concatenated event log.
 */
function runRound(
  scripts: readonly PlayerScript[],
  ticks: readonly Tick[],
  seatOrder: readonly PlayerRef[],
  roundId = 'r1',
): { round: RoundState; events: RoundEvent[] } {
  let round = seatAll(initialRound(roundId), seatOrder);
  const events: RoundEvent[] = [];

  ticks.forEach((tick, index) => {
    // Requests are applied in script order at each tick. RS-2 is about the
    // *fan-out* being order-independent; individually addressed requests are
    // inherently ordered by arrival, exactly as they will be at M2.4.
    for (const s of scripts) {
      if (s.openAt === index) {
        const r = roundOpen(round, {
          player: s.ref,
          request: {
            dir: s.dir,
            stake: s.stake,
            lev: s.lev,
            id: `${s.ref}-open`,
            ...(s.takeProfit === undefined ? {} : { takeProfit: s.takeProfit }),
            ...(s.stopLoss === undefined ? {} : { stopLoss: s.stopLoss }),
          },
        }, tick);
        round = r.state;
        events.push(...r.events);
      }
      if (s.ascendAt === index) {
        const r = roundRequestAscent(round, s.ref, tick.t);
        round = r.state;
        events.push(...r.events);
      }
    }

    const stepped = roundTick(round, tick);
    round = stepped.state;
    events.push(...stepped.events);
  });

  return { round, events };
}

/** Deterministic shuffle of a key list, for RS-2's permutations. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const rnd = lcg(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/** Round state as a comparable plain object — `Map` is not deep-equal friendly. */
function comparable(round: RoundState): unknown {
  return {
    roundId: round.roundId,
    phase: round.phase,
    ticks: round.ticks,
    players: [...round.players.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  };
}

/* ----------------------------------------------------------------------------
   RS-1 — the round holds the existing per-player state
---------------------------------------------------------------------------- */

describe('RS-1: RoundState holds round id, phase, tick series and player states', () => {
  it('starts empty, in waiting, with no ticks', () => {
    const round = initialRound('round-42');
    expect(round.roundId).toBe('round-42');
    expect(round.phase).toBe('waiting');
    expect(round.ticks).toEqual([]);
    expect(round.players.size).toBe(0);
  });

  it('a seated player holds the same EngineState the per-player engine produces', () => {
    const state = initialState(cents(50_000));
    const round = seatPlayer(initialRound('r'), 'alice', state);
    expect(round.players.get('alice')).toBe(state);
  });

  it('seating and unseating never mutate the round handed in', () => {
    const empty = initialRound('r');
    const seated = seatPlayer(empty, 'alice', initialState(cents(1000)));
    expect(empty.players.size).toBe(0);

    const unseated = unseatPlayer(seated, 'alice');
    expect(seated.players.size).toBe(1);
    expect(unseated.players.size).toBe(0);
  });

  it('unseating an absent player returns the identical round', () => {
    const round = seatPlayer(initialRound('r'), 'alice', initialState(cents(1000)));
    expect(unseatPlayer(round, 'bob')).toBe(round);
  });

  it('re-seating an existing reference replaces that player state', () => {
    const first = initialState(cents(1000));
    const second = initialState(cents(2000));
    let round = seatPlayer(initialRound('r'), 'alice', first);
    round = seatPlayer(round, 'alice', second);
    expect(round.players.size).toBe(1);
    expect(round.players.get('alice')).toBe(second);
  });

  it('the round retains every applied tick, in order (VR-1)', () => {
    const ticks = tickSeries(12, 7);
    let round = seatPlayer(initialRound('r'), 'alice', initialState(cents(10_000)));
    for (const tick of ticks) round = roundTick(round, tick).state;
    expect(round.ticks).toEqual(ticks);
  });
});

/* ----------------------------------------------------------------------------
   RS-2 — fan-out determinism
---------------------------------------------------------------------------- */

describe('RS-2: tick application is order-independent', () => {
  it('a 3-player round settles identically under every insertion order', () => {
    const scripts = population(3, 11);
    const ticks = tickSeries(60, 12);
    const refs = scripts.map((s) => s.ref);

    // All six permutations of {A, B, C}, explicitly — the roadmap's example.
    const permutations = [
      [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
    ].map((order) => order.map((i) => refs[i] as PlayerRef));

    const baseline = runRound(scripts, ticks, permutations[0] as PlayerRef[]);
    for (const order of permutations.slice(1)) {
      const run = runRound(scripts, ticks, order);
      expect(comparable(run.round)).toEqual(comparable(baseline.round));
      expect(run.events).toEqual(baseline.events);
    }
  });

  it('a 500-player round is deeply equal under shuffled insertion orders', () => {
    const scripts = population(500, 21);
    const ticks = tickSeries(120, 22);
    const refs = scripts.map((s) => s.ref);

    const baseline = runRound(scripts, ticks, refs);
    expect(baseline.round.players.size).toBe(500);

    for (const seed of [31, 32, 33]) {
      const run = runRound(scripts, ticks, shuffled(refs, seed));
      expect(comparable(run.round)).toEqual(comparable(baseline.round));
      expect(run.events).toEqual(baseline.events);
    }
  });

  it('the event log itself is insertion-order-independent, not only the state', () => {
    const scripts = population(40, 41);
    const ticks = tickSeries(80, 42);
    const refs = scripts.map((s) => s.ref);

    const a = runRound(scripts, ticks, refs);
    const b = runRound(scripts, ticks, shuffled(refs, 43));

    // Stronger than set equality: the same sequence, index for index.
    expect(JSON.stringify(b.events)).toBe(JSON.stringify(a.events));
    expect(a.events.length).toBeGreaterThan(0);
  });

  it('applying one tick twice in different orders produces identical wallets', () => {
    const scripts = population(20, 51);
    const ticks = tickSeries(30, 52);
    const refs = scripts.map((s) => s.ref);

    const a = runRound(scripts, ticks, refs);
    const b = runRound(scripts, ticks, [...refs].reverse());

    for (const ref of refs) {
      expect(b.round.players.get(ref)?.wallet).toEqual(a.round.players.get(ref)?.wallet);
    }
  });
});

/* ----------------------------------------------------------------------------
   RS-3 / RS-8 — player isolation and population invariance of money
---------------------------------------------------------------------------- */

describe('RS-3: one player cannot influence another', () => {
  /** Run one script alone through the per-player engine, with no round at all. */
  function runSolo(script: PlayerScript, ticks: readonly Tick[]): {
    state: EngineState;
    events: unknown[];
  } {
    let state = initialState(cents(100_000));
    const events: unknown[] = [];

    ticks.forEach((tick, index) => {
      if (script.openAt === index) {
        const r = open(state, {
          dir: script.dir,
          stake: script.stake,
          lev: script.lev,
          id: `${script.ref}-open`,
          ...(script.takeProfit === undefined ? {} : { takeProfit: script.takeProfit }),
          ...(script.stopLoss === undefined ? {} : { stopLoss: script.stopLoss }),
        }, tick);
        state = r.state;
        events.push(...r.events);
      }
      if (script.ascendAt === index) {
        const r = requestAscent(state, tick.t);
        state = r.state;
        events.push(...r.events);
      }
      const r = onTick(state, tick);
      state = r.state;
      events.push(...r.events);
    });

    return { state, events };
  }

  it('A alone and A among 500 others produce identical events, position and wallet', () => {
    const scripts = population(500, 61);
    const ticks = tickSeries(150, 62);
    const subject = scripts[0] as PlayerScript;

    const solo = runSolo(subject, ticks);
    const crowd = runRound(scripts, ticks, scripts.map((s) => s.ref));

    const inCrowd = crowd.round.players.get(subject.ref) as EngineState;
    expect(inCrowd.position).toEqual(solo.state.position);
    expect(inCrowd.wallet).toEqual(solo.state.wallet);
    expect(inCrowd.lastResult).toEqual(solo.state.lastResult);

    const crowdEvents = crowd.events
      .filter((e) => e.player === subject.ref)
      .map((e) => e.event);
    expect(crowdEvents).toEqual(solo.events);
  });

  it('holds for every player in the population, not only the first', () => {
    const scripts = population(60, 71);
    const ticks = tickSeries(120, 72);
    const crowd = runRound(scripts, ticks, scripts.map((s) => s.ref));

    for (const script of scripts) {
      const solo = runSolo(script, ticks);
      const inCrowd = crowd.round.players.get(script.ref) as EngineState;
      expect(inCrowd.position).toEqual(solo.state.position);
      expect(inCrowd.wallet).toEqual(solo.state.wallet);
    }
  });

  it('a neighbour crushing on the same tick does not perturb a survivor', () => {
    // An explicit monotonic ramp rather than the random walk: this test needs a
    // *guaranteed* crush beside a guaranteed survivor, and +0.2 %/tick reaches
    // the 25x Dive line (about +4 %) around tick 20 while staying far inside the
    // 2x Surface line. A seeded walk would make the assertion depend on the seed.
    const ticks: Tick[] = Array.from({ length: 60 }, (_, i) => ({
      t: i * TICK_MS,
      v: 1000 * 1.002 ** i,
    }));
    // 25x Dive against a rising series crushes; 2x Surface survives it.
    const doomed: PlayerScript = {
      ref: 'a-doomed', dir: -1, lev: 25, stake: cents(500), openAt: 0, ascendAt: null,
    };
    const survivor: PlayerScript = {
      ref: 'b-survivor', dir: 1, lev: 2, stake: cents(500), openAt: 0, ascendAt: 40,
    };

    const together = runRound([doomed, survivor], ticks, [doomed.ref, survivor.ref]);
    const alone = runRound([survivor], ticks, [survivor.ref]);

    const withNeighbour = together.round.players.get(survivor.ref) as EngineState;
    const withoutNeighbour = alone.round.players.get(survivor.ref) as EngineState;
    expect(withNeighbour.wallet).toEqual(withoutNeighbour.wallet);
    expect(withNeighbour.lastResult).toEqual(withoutNeighbour.lastResult);

    // The doomed player did in fact crush — otherwise this asserts nothing.
    const doomedState = together.round.players.get(doomed.ref) as EngineState;
    expect(doomedState.lastResult?.reason).toBe('crush');
  });

  it('a rejected entry anywhere in the population changes nothing for anyone else', () => {
    const ticks = tickSeries(20, 91);
    const good: PlayerScript = {
      ref: 'a-good', dir: 1, lev: 5, stake: cents(1000), openAt: 0, ascendAt: 10,
    };

    const clean = runRound([good], ticks, [good.ref]);

    // Same round, plus a second player whose every request is refused.
    let dirty = seatAll(initialRound('r1'), [good.ref, 'z-broke']);
    dirty = seatPlayer(dirty, 'z-broke', initialState(cents(1)));
    const dirtyEvents: RoundEvent[] = [];
    ticks.forEach((tick, index) => {
      if (index === 0) {
        const r1 = roundOpen(dirty, {
          player: good.ref,
          request: { dir: good.dir, stake: good.stake, lev: good.lev, id: 'a-good-open' },
        }, tick);
        dirty = r1.state;
        dirtyEvents.push(...r1.events);
        // INSUFFICIENT_BALANCE, plus an INVALID_LEVERAGE for good measure.
        dirty = roundOpen(dirty, {
          player: 'z-broke',
          request: { dir: 1, stake: cents(5000), lev: 5, id: 'z-1' },
        }, tick).state;
        dirty = roundOpen(dirty, {
          player: 'z-broke',
          request: { dir: 1, stake: cents(1), lev: 7, id: 'z-2' },
        }, tick).state;
      }
      if (index === good.ascendAt) {
        const r = roundRequestAscent(dirty, good.ref, tick.t);
        dirty = r.state;
        dirtyEvents.push(...r.events);
      }
      const stepped = roundTick(dirty, tick);
      dirty = stepped.state;
      dirtyEvents.push(...stepped.events.filter((e) => e.player === good.ref));
    });

    expect((dirty.players.get(good.ref) as EngineState).wallet)
      .toEqual((clean.round.players.get(good.ref) as EngineState).wallet);
    expect(dirtyEvents.map((e) => e.event)).toEqual(clean.events.map((e) => e.event));
  });
});

describe('RS-8: payout is byte-identical regardless of population size', () => {
  it('the same script pays the same in a 1-player and a 2,000-player round', () => {
    const ticks = tickSeries(150, 101);
    const subject: PlayerScript = {
      ref: 'aaa-subject', dir: 1, lev: 10, stake: cents(1234), openAt: 2, ascendAt: 45,
    };
    const others = population(2000, 102)
      .map((s, i) => ({ ...s, ref: `zz-other-${i}` }));

    const alone = runRound([subject], ticks, [subject.ref]);
    const crowded = runRound(
      [subject, ...others],
      ticks,
      [subject.ref, ...others.map((s) => s.ref)],
    );

    const a = (alone.round.players.get(subject.ref) as EngineState).lastResult;
    const b = (crowded.round.players.get(subject.ref) as EngineState).lastResult;
    expect(a).not.toBeNull();
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

/* ----------------------------------------------------------------------------
   RS-4 — canonical event ordering
---------------------------------------------------------------------------- */

describe('RS-4: round events are a canonical concatenation of per-player events', () => {
  it('every event carries its player reference and the round id (RL-5)', () => {
    const scripts = population(10, 111);
    const ticks = tickSeries(40, 112);
    const run = runRound(scripts, ticks, scripts.map((s) => s.ref), 'round-xyz');

    expect(run.events.length).toBeGreaterThan(0);
    for (const event of run.events) {
      expect(event.roundId).toBe('round-xyz');
      expect(scripts.some((s) => s.ref === event.player)).toBe(true);
    }
  });

  it('one tick emits players in ascending code-unit order of reference', () => {
    // 'p10' < 'p9' in code-unit order. If the implementation had used numeric
    // or locale ordering, this is the assertion that would fail.
    const refs = ['p9', 'p10', 'p2'];
    let round = seatAll(initialRound('r'), refs);
    const entry = tickSeries(2, 121);
    const first = entry[0] as Tick;

    for (const ref of refs) {
      round = roundOpen(round, {
        player: ref,
        request: { dir: 1, stake: cents(500), lev: 5, id: `${ref}-open` },
      }, first).state;
    }
    // Force every position to settle on one tick, so one tick emits many events.
    for (const ref of refs) {
      round = roundRequestAscent(round, ref, first.t).state;
    }

    const settled = roundTick(round, { t: first.t + 1000, v: first.v });
    const order = settled.events.map((e) => e.player);
    const distinct = order.filter((ref, i) => order.indexOf(ref) === i);
    expect(distinct).toEqual(['p10', 'p2', 'p9']);
  });

  it("each player's own per-player event order is preserved inside its block", () => {
    const refs = ['a', 'b'];
    let round = seatAll(initialRound('r'), refs);
    const first: Tick = { t: 0, v: 1000 };

    for (const ref of refs) {
      round = roundOpen(round, {
        player: ref,
        request: { dir: 1, stake: cents(500), lev: 5, id: `${ref}-open` },
      }, first).state;
      round = roundRequestAscent(round, ref, first.t).state;
    }

    const settled = roundTick(round, { t: 1000, v: 1005 });
    // Per-player settlement order is `settled` then `wallet-changed` (M1.3).
    expect(settled.events.map((e) => `${e.player}:${e.event.kind}`)).toEqual([
      'a:settled', 'a:wallet-changed', 'b:settled', 'b:wallet-changed',
    ]);
  });

  it('the round log equals the per-player logs concatenated in that order', () => {
    const scripts = population(25, 131);
    const ticks = tickSeries(90, 132);
    const run = runRound(scripts, ticks, shuffled(scripts.map((s) => s.ref), 133));

    // Rebuild the log by grouping per player, then concatenating in sort order.
    const byPlayer = new Map<PlayerRef, RoundEvent[]>();
    for (const event of run.events) {
      const list = byPlayer.get(event.player) ?? [];
      list.push(event);
      byPlayer.set(event.player, list);
    }

    // Within one tick, the concatenation must reproduce the emitted order. The
    // per-tick grouping is what makes that check meaningful, so replay the round
    // one tick at a time and compare each tick's slice.
    let round = seatAll(initialRound('r1'), scripts.map((s) => s.ref));
    ticks.forEach((tick, index) => {
      for (const s of scripts) {
        if (s.openAt === index) {
          round = roundOpen(round, {
            player: s.ref,
            request: {
              dir: s.dir, stake: s.stake, lev: s.lev, id: `${s.ref}-open`,
              ...(s.takeProfit === undefined ? {} : { takeProfit: s.takeProfit }),
              ...(s.stopLoss === undefined ? {} : { stopLoss: s.stopLoss }),
            },
          }, tick).state;
        }
        if (s.ascendAt === index) {
          round = roundRequestAscent(round, s.ref, tick.t).state;
        }
      }

      const before = round;
      const stepped = roundTick(before, tick);
      round = stepped.state;

      const expected = [...before.players.keys()]
        .sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))
        .flatMap((ref) => {
          const single = onTick(before.players.get(ref) as EngineState, tick);
          return single.events.map((event) => ({ roundId: before.roundId, player: ref, event }));
        });
      expect(stepped.events).toEqual(expected);
    });
  });
});

/* ----------------------------------------------------------------------------
   RS-5 — round-scoped entry
---------------------------------------------------------------------------- */

describe('RS-5: entry is addressed, and never creates a player', () => {
  it('an unknown player is rejected with UNKNOWN_PLAYER and changes nothing', () => {
    const round = seatPlayer(initialRound('r'), 'alice', initialState(cents(10_000)));
    const result = roundOpen(round, {
      player: 'mallory',
      request: { dir: 1, stake: cents(500), lev: 5, id: 'm1' },
    }, { t: 0, v: 1000 });

    expect(result.rejection).toEqual({
      kind: 'round-rejected', player: 'mallory', code: 'UNKNOWN_PLAYER',
    });
    expect(result.events).toEqual([]);
    expect(result.state).toBe(round);
    expect(result.state.players.has('mallory')).toBe(false);
  });

  it('an unknown player cannot cash out either', () => {
    const round = seatPlayer(initialRound('r'), 'alice', initialState(cents(10_000)));
    const result = roundRequestAscent(round, 'mallory', 500);
    expect(result.rejection?.code).toBe('UNKNOWN_PLAYER');
    expect(result.state).toBe(round);
  });

  it('a seated player runs the unchanged EN-8 precedence', () => {
    const round = seatPlayer(initialRound('r'), 'alice', initialState(cents(10_000)));
    // INVALID_LEVERAGE outranks INSUFFICIENT_BALANCE (EN-8 stage 1 before 2).
    const result = roundOpen(round, {
      player: 'alice',
      request: { dir: 1, stake: cents(999_999), lev: 7, id: 'a1' },
    }, { t: 0, v: 1000 });

    expect(result.rejection).toBeNull();
    expect(result.events).toEqual([{
      roundId: 'r', player: 'alice',
      event: { kind: 'open-rejected', code: 'INVALID_LEVERAGE' },
    }]);
  });

  it('EN-5 stays per player: one open position each, not one per round', () => {
    const tick: Tick = { t: 0, v: 1000 };
    let round = seatAll(initialRound('r'), ['alice', 'bob']);

    round = roundOpen(round, {
      player: 'alice', request: { dir: 1, stake: cents(500), lev: 5, id: 'a1' },
    }, tick).state;
    const bob = roundOpen(round, {
      player: 'bob', request: { dir: -1, stake: cents(500), lev: 5, id: 'b1' },
    }, tick);
    round = bob.state;

    // Bob's entry is accepted even though Alice already holds a position.
    expect(bob.events.some((e) => e.event.kind === 'position-opened')).toBe(true);
    expect(round.players.get('alice')?.position).not.toBeNull();
    expect(round.players.get('bob')?.position).not.toBeNull();

    // Alice's second entry is still refused, as EN-5 requires.
    const again = roundOpen(round, {
      player: 'alice', request: { dir: 1, stake: cents(500), lev: 5, id: 'a2' },
    }, tick);
    expect(again.events).toEqual([{
      roundId: 'r', player: 'alice',
      event: { kind: 'open-rejected', code: 'POSITION_OPEN' },
    }]);
  });

  it('EN-7 idempotency survives the round addressing', () => {
    const tick: Tick = { t: 0, v: 1000 };
    let round = seatPlayer(initialRound('r'), 'alice', initialState(cents(10_000)));
    const request = { dir: 1 as const, stake: cents(500), lev: 5, id: 'dup' };

    const first = roundOpen(round, { player: 'alice', request }, tick);
    round = first.state;
    const balanceAfterFirst = round.players.get('alice')?.wallet.balance;

    const replay = roundOpen(round, { player: 'alice', request }, tick);
    expect(replay.events.map((e) => e.event.kind)).toEqual(['position-opened']);
    expect(replay.state.players.get('alice')?.wallet.balance).toBe(balanceAfterFirst);
  });

  it('a loss lock is addressed per player and blocks only that player', () => {
    const tick: Tick = { t: 0, v: 1000 };
    let round = seatAll(initialRound('r'), ['alice', 'bob']);
    round = roundSetLossLocked(round, 'alice', true);

    const alice = roundOpen(round, {
      player: 'alice', request: { dir: 1, stake: cents(500), lev: 5, id: 'a1' },
    }, tick);
    expect(alice.events[0]?.event).toEqual({
      kind: 'open-rejected', code: 'LOSS_LIMIT_REACHED',
    });

    const bob = roundOpen(round, {
      player: 'bob', request: { dir: 1, stake: cents(500), lev: 5, id: 'b1' },
    }, tick);
    expect(bob.events.some((e) => e.event.kind === 'position-opened')).toBe(true);
  });

  it('a loss lock for an unknown player leaves the round identical', () => {
    const round = seatPlayer(initialRound('r'), 'alice', initialState(cents(1000)));
    expect(roundSetLossLocked(round, 'nobody', true)).toBe(round);
  });
});

/* ----------------------------------------------------------------------------
   RS-6 — phase authority
---------------------------------------------------------------------------- */

describe('RS-6: RL-1 is enforced by the round phase setter', () => {
  const PHASES = ['waiting', 'launching', 'running', 'ending', 'settling'] as const;
  const LEGAL: Record<string, string> = {
    waiting: 'launching',
    launching: 'running',
    running: 'ending',
    ending: 'settling',
    settling: 'waiting',
  };

  it('from every phase, only the single legal successor is accepted', () => {
    for (const from of PHASES) {
      for (const to of PHASES) {
        const round = resetRoundPhase(initialRound('r'), from).state;
        const result = setRoundPhase(round, to);
        const legal = LEGAL[from] === to;
        expect(result.changed, `${from} -> ${to}`).toBe(legal);
        expect(result.state.phase).toBe(legal ? to : from);
      }
    }
  });

  it('a self-transition is refused from every phase', () => {
    for (const phase of PHASES) {
      const round = resetRoundPhase(initialRound('r'), phase).state;
      const result = setRoundPhase(round, phase);
      expect(result.changed).toBe(false);
      expect(result.state).toBe(round);
      expect(result.events).toEqual([]);
    }
  });

  it('entering settling settles every still-open position exactly once (RL-4)', () => {
    const ticks = tickSeries(20, 141);
    const scripts = population(12, 142);
    let round = seatAll(initialRound('r'), scripts.map((s) => s.ref));
    const first = ticks[0] as Tick;

    for (const s of scripts) {
      round = roundOpen(round, {
        player: s.ref,
        request: { dir: s.dir, stake: s.stake, lev: s.lev, id: `${s.ref}-o` },
      }, first).state;
    }
    for (const tick of ticks) round = roundTick(round, tick).state;

    // waiting -> launching -> running -> ending -> settling
    round = setRoundPhase(round, 'launching').state;
    round = setRoundPhase(round, 'running').state;
    round = setRoundPhase(round, 'ending').state;
    const settling = setRoundPhase(round, 'settling');

    expect(settling.changed).toBe(true);
    expect(settling.state.phase).toBe('settling');

    const settledEvents = settling.events.filter((e) => e.event.kind === 'settled');
    const stillOpen = [...round.players.values()]
      .filter((s) => s.position !== null && s.position.state !== 'done');
    expect(settledEvents.length).toBe(stillOpen.length);
    expect(stillOpen.length).toBeGreaterThan(0);

    // Every position is now done, and no player settled twice.
    for (const state of settling.state.players.values()) {
      expect(state.position === null || state.position.state === 'done').toBe(true);
    }
    const perPlayer = settledEvents.map((e) => e.player);
    expect(new Set(perPlayer).size).toBe(perPlayer.length);
  });

  it('a repeated settling transition is refused, so nobody settles twice', () => {
    const ticks = tickSeries(10, 151);
    let round = seatPlayer(initialRound('r'), 'alice', initialState(cents(10_000)));
    const first = ticks[0] as Tick;
    round = roundOpen(round, {
      player: 'alice', request: { dir: 1, stake: cents(1000), lev: 5, id: 'a1' },
    }, first).state;
    for (const tick of ticks) round = roundTick(round, tick).state;

    round = resetRoundPhase(round, 'ending').state;
    const first_ = setRoundPhase(round, 'settling');
    const walletAfter = first_.state.players.get('alice')?.wallet;

    const again = setRoundPhase(first_.state, 'settling');
    expect(again.changed).toBe(false);
    expect(again.events).toEqual([]);
    expect(again.state.players.get('alice')?.wallet).toEqual(walletAfter);
  });

  it('settling with no ticks settles nothing rather than inventing a price', () => {
    const round = resetRoundPhase(
      seatPlayer(initialRound('r'), 'alice', initialState(cents(1000))),
      'ending',
    ).state;
    const result = setRoundPhase(round, 'settling');
    expect(result.changed).toBe(true);
    expect(result.events).toEqual([]);
    expect(result.state.players.get('alice')?.lastResult).toBeNull();
  });

  it('resetRoundPhase is the one bypass, and still runs entry effects', () => {
    const ticks = tickSeries(6, 161);
    let round = seatPlayer(initialRound('r'), 'alice', initialState(cents(10_000)));
    round = roundOpen(round, {
      player: 'alice', request: { dir: 1, stake: cents(1000), lev: 5, id: 'a1' },
    }, ticks[0] as Tick).state;
    for (const tick of ticks) round = roundTick(round, tick).state;

    // waiting -> settling is illegal for the setter; the seed takes it anyway,
    // and runs RL-4 on the way in.
    const seeded = resetRoundPhase(round, 'settling');
    expect(seeded.state.phase).toBe('settling');
    expect(seeded.events.some((e) => e.event.kind === 'settled')).toBe(true);
  });

  it('a refused transition fires no side effect at all', () => {
    const ticks = tickSeries(6, 171);
    let round = seatPlayer(initialRound('r'), 'alice', initialState(cents(10_000)));
    round = roundOpen(round, {
      player: 'alice', request: { dir: 1, stake: cents(1000), lev: 5, id: 'a1' },
    }, ticks[0] as Tick).state;
    for (const tick of ticks) round = roundTick(round, tick).state;

    // running -> settling skips `ending`, so it must be refused outright.
    round = resetRoundPhase(round, 'running').state;
    const result = setRoundPhase(round, 'settling');
    expect(result.changed).toBe(false);
    expect(result.state).toBe(round);
    expect(result.state.players.get('alice')?.position?.state).toBe('open');
  });
});

/* ----------------------------------------------------------------------------
   RS-7 — directional aggregate
---------------------------------------------------------------------------- */

describe('RS-7: per-round directional exposure', () => {
  it('is zero on an empty round', () => {
    expect(directionalExposure(initialRound('r'))).toEqual({
      surface: cents(0), dive: cents(0), net: cents(0),
    });
  });

  it('sums stake x leverage per direction, and nets them', () => {
    const tick: Tick = { t: 0, v: 1000 };
    let round = seatAll(initialRound('r'), ['a', 'b', 'c']);
    round = roundOpen(round, {
      player: 'a', request: { dir: 1, stake: cents(1000), lev: 10, id: 'a1' },
    }, tick).state;
    round = roundOpen(round, {
      player: 'b', request: { dir: 1, stake: cents(500), lev: 2, id: 'b1' },
    }, tick).state;
    round = roundOpen(round, {
      player: 'c', request: { dir: -1, stake: cents(2000), lev: 5, id: 'c1' },
    }, tick).state;

    expect(directionalExposure(round)).toEqual({
      surface: cents(10_000 + 1000),
      dive: cents(10_000),
      net: cents(1000),
    });
  });

  it('counts an ascending position — it can still crush inside the Blow', () => {
    const tick: Tick = { t: 0, v: 1000 };
    let round = seatPlayer(initialRound('r'), 'a', initialState(cents(100_000)));
    round = roundOpen(round, {
      player: 'a', request: { dir: 1, stake: cents(1000), lev: 10, id: 'a1' },
    }, tick).state;
    round = roundRequestAscent(round, 'a', tick.t).state;

    expect(round.players.get('a')?.position?.state).toBe('ascending');
    expect(directionalExposure(round).surface).toBe(cents(10_000));
  });

  it('drops a settled position from the aggregate', () => {
    const tick: Tick = { t: 0, v: 1000 };
    let round = seatPlayer(initialRound('r'), 'a', initialState(cents(100_000)));
    round = roundOpen(round, {
      player: 'a', request: { dir: 1, stake: cents(1000), lev: 10, id: 'a1' },
    }, tick).state;
    round = roundRequestAscent(round, 'a', tick.t).state;
    round = roundTick(round, { t: 1000, v: 1000 }).state;

    expect(round.players.get('a')?.position?.state).toBe('done');
    expect(directionalExposure(round)).toEqual({
      surface: cents(0), dive: cents(0), net: cents(0),
    });
  });

  it('is order-independent, like everything else in the round', () => {
    const scripts = population(200, 181);
    const ticks = tickSeries(40, 182);
    const refs = scripts.map((s) => s.ref);

    const a = runRound(scripts, ticks, refs);
    const b = runRound(scripts, ticks, shuffled(refs, 183));
    expect(directionalExposure(b.round)).toEqual(directionalExposure(a.round));
    // The population is actually exposed at this point, so this asserts something.
    expect(directionalExposure(a.round).surface).toBeGreaterThan(0);
  });

  it('is integer minor units throughout (LG-2)', () => {
    const scripts = population(50, 191);
    const ticks = tickSeries(30, 192);
    const { round } = runRound(scripts, ticks, scripts.map((s) => s.ref));
    const exposure = directionalExposure(round);

    expect(Number.isSafeInteger(exposure.surface)).toBe(true);
    expect(Number.isSafeInteger(exposure.dive)).toBe(true);
    expect(Number.isSafeInteger(exposure.net)).toBe(true);
  });
});

/* ----------------------------------------------------------------------------
   Round-level helpers
---------------------------------------------------------------------------- */

describe('round-level settlement and clearing helpers', () => {
  it('roundSettleAtRoundEnd does not advance tau for anyone', () => {
    const ticks = tickSeries(10, 201);
    let round = seatAll(initialRound('r'), ['a', 'b']);
    const first = ticks[0] as Tick;
    for (const ref of ['a', 'b']) {
      round = roundOpen(round, {
        player: ref, request: { dir: 1, stake: cents(1000), lev: 5, id: `${ref}1` },
      }, first).state;
    }
    for (const tick of ticks.slice(1)) round = roundTick(round, tick).state;

    const ticksElapsedBefore = round.players.get('a')?.position?.ticksElapsed;
    const final = ticks[ticks.length - 1] as Tick;
    const settled = roundSettleAtRoundEnd(round, final);

    expect(settled.state.players.get('a')?.lastResult?.tau)
      .toBe((ticksElapsedBefore as number) * DEFAULT_CONFIG.tickSeconds);
    // The tick series is unchanged: settling appends nothing.
    expect(settled.state.ticks).toEqual(round.ticks);
  });

  it('roundClearSettled drops every done position and leaves open ones alone', () => {
    const tick: Tick = { t: 0, v: 1000 };
    let round = seatAll(initialRound('r'), ['a', 'b']);
    for (const ref of ['a', 'b']) {
      round = roundOpen(round, {
        player: ref, request: { dir: 1, stake: cents(1000), lev: 5, id: `${ref}1` },
      }, tick).state;
    }
    round = roundRequestAscent(round, 'a', tick.t).state;
    round = roundTick(round, { t: 1000, v: 1000 }).state;

    const cleared = roundClearSettled(round);
    expect(cleared.state.players.get('a')?.position).toBeNull();
    expect(cleared.state.players.get('b')?.position?.state).toBe('open');
    expect(cleared.events).toEqual([]);
  });

  it('a tick over a round with no players is a no-op that still records the tick', () => {
    const round = initialRound('r');
    const result = roundTick(round, { t: 0, v: 1000 });
    expect(result.events).toEqual([]);
    expect(result.state.ticks).toEqual([{ t: 0, v: 1000 }]);
  });
});
