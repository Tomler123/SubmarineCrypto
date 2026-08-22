import { describe, expect, it } from 'vitest';
import { cents } from '@crush/ledger';
import {
  DEFAULT_CONFIG,
  clearSettled,
  crushIndex,
  initialState,
  onTick,
  open,
  requestAscent,
  setLossLocked,
  settleAtRoundEnd,
} from '../src/index.js';
import type { Direction, EngineEvent, EngineState, Leverage, Tick } from '../src/index.js';

const I0 = 1000;
const START_BALANCE = 100_000; // $1,000.00, the prototype's play-money float

function tick(t: number, v: number): Tick {
  return { t, v };
}

function fresh(): EngineState {
  return initialState(cents(START_BALANCE));
}

/** Open a position and return the resulting state; fails loudly if rejected. */
function opened(
  state: EngineState,
  dir: Direction,
  stake: number,
  lev: Leverage,
  at: Tick,
): EngineState {
  const r = open(state, { dir, stake: cents(stake), lev, id: 'p1' }, at);
  expect(kinds(r.events)).toContain('position-opened');
  return r.state;
}

function kinds(events: readonly EngineEvent[]): string[] {
  return events.map((e) => e.kind);
}

describe('EN-3 — stake debited atomically with position creation', () => {
  it('EN-3: debit and position land in the same returned state', () => {
    const r = open(fresh(), { dir: 1, stake: cents(50_000), lev: 10, id: 'p1' }, tick(0, I0));
    expect(r.state.wallet.balance).toBe(START_BALANCE - 50_000);
    expect(r.state.wallet.wagered).toBe(50_000);
    expect(r.state.position?.state).toBe('open');
  });

  it('EN-3: a rejected entry leaves the wallet completely untouched', () => {
    const before = fresh();
    const r = open(before, { dir: 1, stake: cents(500_000), lev: 10, id: 'p1' }, tick(0, I0));
    expect(r.state.wallet).toEqual(before.wallet);
    expect(r.state.position).toBeNull();
    expect(kinds(r.events)).toEqual(['open-rejected']);
  });

  it('EN-3: the caller state object is never mutated', () => {
    const before = fresh();
    const snapshot = structuredClone(before);
    open(before, { dir: 1, stake: cents(50_000), lev: 10, id: 'p1' }, tick(0, I0));
    expect(before).toEqual(snapshot);
  });
});

describe('EN-2 — entry executes at the first tick after server receipt', () => {
  it('EN-2: I_e is the tick handed to open(), not any earlier value', () => {
    const r = open(fresh(), { dir: 1, stake: cents(50_000), lev: 10, id: 'p1' }, tick(125, 1007.5));
    expect(r.state.position?.entry).toBe(1007.5);
    expect(r.state.position?.openedT).toBe(125);
  });

  it('EN-2: with no tick available the entry is rejected rather than priced', () => {
    const r = open(fresh(), { dir: 1, stake: cents(50_000), lev: 10, id: 'p1' }, null);
    expect(r.events).toEqual([{ kind: 'open-rejected', code: 'NO_PRICE' }]);
    expect(r.state.wallet.balance).toBe(START_BALANCE);
  });
});

describe('EN-5 — one open position per player per round', () => {
  it('EN-5: a second open request while one is open is rejected', () => {
    const s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    const r = open(s, { dir: -1, stake: cents(10_000), lev: 2, id: 'p2' }, tick(125, I0));
    expect(r.events).toEqual([{ kind: 'open-rejected', code: 'POSITION_OPEN' }]);
    expect(r.state.wallet.balance).toBe(s.wallet.balance);
  });

  it('EN-5: re-entry after settlement in the same round is allowed', () => {
    let s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    s = settleAtRoundEnd(s, tick(125, I0)).state;
    const r = open(s, { dir: -1, stake: cents(10_000), lev: 2, id: 'p2' }, tick(250, I0));
    expect(kinds(r.events)).toContain('position-opened');
    expect(r.state.position?.id).toBe('p2');
  });
});

describe('RP-2 — the loss lock blocks new entries', () => {
  it('RP-2: an entry is rejected while locked, with the wallet untouched', () => {
    const s = setLossLocked(fresh(), true);
    const r = open(s, { dir: 1, stake: cents(50_000), lev: 10, id: 'p1' }, tick(0, I0));
    expect(r.events).toEqual([{ kind: 'open-rejected', code: 'LOSS_LIMIT_REACHED' }]);
    expect(r.state.wallet.balance).toBe(START_BALANCE);
  });

  it('RP-2: the lock takes precedence over an insufficient balance', () => {
    const s = setLossLocked(initialState(cents(0)), true);
    const r = open(s, { dir: 1, stake: cents(50_000), lev: 10, id: 'p1' }, tick(0, I0));
    expect(r.events).toEqual([{ kind: 'open-rejected', code: 'LOSS_LIMIT_REACHED' }]);
  });
});

describe('EN-8 — rejection precedence: a session-terminal condition is never masked', () => {
  /**
   * The order is loss-lock → position-open → balance → no-price. Each case below
   * holds every condition from its own rank downward, so the assertion pins the
   * rank rather than merely observing one branch.
   */
  it('EN-8: loss-lock outranks position-open, balance and no-price together', () => {
    let s = opened(initialState(cents(50_000)), 1, 50_000, 10, tick(0, I0));
    s = setLossLocked(s, true); // position open, balance now 0, and locked
    const r = open(s, { dir: 1, stake: cents(50_000), lev: 10, id: 'p2' }, null);
    expect(r.events).toEqual([{ kind: 'open-rejected', code: 'LOSS_LIMIT_REACHED' }]);
  });

  it('EN-8: position-open outranks balance and no-price', () => {
    const s = opened(initialState(cents(50_000)), 1, 50_000, 10, tick(0, I0));
    const r = open(s, { dir: 1, stake: cents(50_000), lev: 10, id: 'p2' }, null);
    expect(r.events).toEqual([{ kind: 'open-rejected', code: 'POSITION_OPEN' }]);
  });

  it('EN-8: balance outranks no-price', () => {
    const r = open(initialState(cents(0)), { dir: 1, stake: cents(50_000), lev: 10, id: 'p1' }, null);
    expect(r.events).toEqual([{ kind: 'open-rejected', code: 'INSUFFICIENT_BALANCE' }]);
  });

  it('EN-8: a loss-locked player is never told to add funds', () => {
    // The prototype checked balance first, so this returned INSUFFICIENT
    // BALANCE — telling a cut-off player that depositing more would let them
    // continue. RP-2 makes that a defect, not a copy choice.
    const s = setLossLocked(initialState(cents(100)), true);
    const r = open(s, { dir: 1, stake: cents(50_000), lev: 10, id: 'p1' }, tick(0, I0));
    expect(r.events).toEqual([{ kind: 'open-rejected', code: 'LOSS_LIMIT_REACHED' }]);
  });

  it('EN-8: every rejection leaves the wallet untouched, whatever the rank', () => {
    const locked = setLossLocked(initialState(cents(100_000)), true);
    for (const [state, at] of [
      [locked, tick(0, I0)],
      [opened(fresh(), 1, 50_000, 10, tick(0, I0)), tick(125, I0)],
      [initialState(cents(0)), tick(0, I0)],
      [fresh(), null],
    ] as const) {
      const before = state.wallet;
      const r = open(state, { dir: 1, stake: cents(50_000), lev: 10, id: 'x' }, at);
      expect(kinds(r.events)).toEqual(['open-rejected']);
      expect(r.state.wallet).toEqual(before);
    }
  });
});

describe('CO-1 — the Blow settles at the first tick ≥ t_r + 500 ms', () => {
  it('CO-1: resolveT is exactly t_r + 500 ms', () => {
    const s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    const r = requestAscent(s, 1_000);
    expect(r.state.position?.state).toBe('ascending');
    expect(r.state.position?.resolveT).toBe(1_500);
    expect(kinds(r.events)).toEqual(['ascent-started']);
  });

  it('CO-1: a tick before the settlement time does not settle', () => {
    let s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    s = requestAscent(s, 1_000).state;
    const r = onTick(s, tick(1_375, 1010));
    expect(r.events).toEqual([]);
    expect(r.state.position?.state).toBe('ascending');
  });

  it('CO-1: the first tick at or past the settlement time settles', () => {
    let s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    s = requestAscent(s, 1_000).state;
    const r = onTick(s, tick(1_500, 1010));
    expect(r.state.position?.result?.reason).toBe('ascent');
    expect(r.state.position?.result?.tick.t).toBe(1_500);
  });

  it('CO-1: settlement uses the settlement tick, not the requesting tick', () => {
    let s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    s = requestAscent(s, 1_000).state;
    // Index moves during the 500 ms ascent; the later value is what pays.
    s = onTick(s, tick(1_250, 1020)).state;
    const r = onTick(s, tick(1_625, 1010));
    // Two ticks past entry, so tau = 0.25 s and oxygen has taken 0.000625.
    // M = 1 + 10·(1010/1000 − 1) − 0.0025·0.25 = 1.099375 → 54_968.75 → 54_969.
    expect(r.state.position?.result?.tau).toBe(0.25);
    expect(r.state.position?.result?.multiplier).toBeCloseTo(1.099375, 12);
    expect(r.state.position?.result?.payout).toBe(54_969);
  });

  it('PL-3: oxygen accrues during the ascent exactly as while open', () => {
    // The same tick series run twice — once held open, once with an ascent
    // requested at t=0 that settles on the t=500 tick. Both must reach the same
    // tau on that tick: an ascent is not a grace period, you keep paying to
    // escape, which is what keeps the Blow a real risk rather than a free exit.
    const ticks = [tick(125, I0), tick(250, I0), tick(375, I0), tick(500, I0)];

    let held = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    for (const tk of ticks) held = onTick(held, tk).state;

    let ascending = requestAscent(opened(fresh(), 1, 50_000, 10, tick(0, I0)), 0).state;
    let settled;
    for (const tk of ticks) {
      const r = onTick(ascending, tk);
      ascending = r.state;
      if (r.state.position?.result) settled = r.state.position.result;
    }

    expect(held.position?.ticksElapsed).toBe(4);
    expect(settled?.reason).toBe('ascent');
    expect(settled?.tau).toBe(4 * 0.125);
    // The multiplier the ascent settled at is the one the still-open position
    // shows on that same tick — no discount, no penalty, just the same oxygen.
    expect(settled?.multiplier).toBeCloseTo(1 - 0.0025 * 0.5, 12);
  });

  it('CO-4: oxygen and index keep running during the ascent — a losing move still lands', () => {
    let s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    s = requestAscent(s, 1_000).state;
    const r = onTick(s, tick(1_500, 995));
    // One tick past entry: tau = 0.125 s, oxygen takes 0.0003125.
    // M = 1 + 10·(−0.005) − 0.0003125 = 0.9496875 → 47_484.375 → 47_484.
    expect(r.state.position?.result?.payout).toBe(47_484);
    expect(r.state.position?.result?.pnl).toBe(-2_516);
  });
});

describe('CO-2 / CO-3 — ascent is irrevocable and re-requests are idempotent', () => {
  it('CO-3: a second cash-out during ascent is a no-op with no error', () => {
    let s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    s = requestAscent(s, 1_000).state;
    const r = requestAscent(s, 1_200);
    expect(r.events).toEqual([]);
    expect(r.state).toBe(s);
    // CO-2: the original settlement time is not pushed back by the re-request.
    expect(r.state.position?.resolveT).toBe(1_500);
  });

  it('CO-3: a cash-out on a settled position is a no-op', () => {
    let s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    s = settleAtRoundEnd(s, tick(125, I0)).state;
    expect(requestAscent(s, 500).events).toEqual([]);
  });

  it('CO-3: a cash-out with no position is a no-op', () => {
    expect(requestAscent(fresh(), 500).events).toEqual([]);
  });
});

describe('CR-1 / CR-2 — crush at the first tick where M ≤ 0, payout zero', () => {
  it('CR-2: a crush settles at payout 0 and pnl −stake', () => {
    const s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    // The line at the tick under test (tau = 0.125 s), not the tau=0 line —
    // CR-6: the value tested must be the line as it stands on that tick.
    const r = onTick(s, tick(125, crushIndex(1, 10, I0, 0.0025, 0.125)));
    const settlement = r.state.position?.result;
    expect(settlement?.reason).toBe('crush');
    expect(settlement?.crushed).toBe(true);
    expect(settlement?.payout).toBe(0);
    expect(settlement?.pnl).toBe(-50_000);
  });

  it('CR-2: the crush tick and its index are recorded for the ledger', () => {
    const s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    const r = onTick(s, tick(375, 880));
    expect(r.state.position?.result?.tick).toEqual({ t: 375, v: 880 });
  });

  it('CR-1: the tick before the line does not crush', () => {
    const s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    const r = onTick(s, tick(125, 900.5));
    expect(r.events).toEqual([]);
    expect(r.state.position?.state).toBe('open');
  });

  it('CR-5: a gap tick far past the line still settles at exactly 0, never negative', () => {
    const s = opened(fresh(), 1, 50_000, 25, tick(0, I0));
    const r = onTick(s, tick(125, 1)); // absurd gap
    expect(r.state.position?.result?.payout).toBe(0);
    expect(r.state.position?.result?.pnl).toBe(-50_000);
    expect(r.state.wallet.balance).toBe(START_BALANCE - 50_000);
    expect(r.state.wallet.balance).toBeGreaterThanOrEqual(0);
  });

  it('CR-4: a crush on the same tick as a due ascent takes precedence', () => {
    let s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    s = requestAscent(s, 1_000).state;
    // This tick is both at/after resolveT and at/below the crush line.
    const r = onTick(s, tick(1_500, 890));
    expect(r.state.position?.result?.reason).toBe('crush');
    expect(r.state.position?.result?.payout).toBe(0);
  });
});

describe('RL-4 / CO-5 — round end auto-surfaces at the final tick', () => {
  it('RL-4: an open position settles at the final tick multiplier, no penalty', () => {
    const s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    const r = settleAtRoundEnd(s, tick(90_000, 1020));
    // M = 1 + 10·0.02 = 1.20 → payout 60_000.
    expect(r.state.position?.result?.reason).toBe('round-end');
    expect(r.state.position?.result?.payout).toBe(60_000);
    expect(r.state.wallet.balance).toBe(START_BALANCE - 50_000 + 60_000);
  });

  it('CO-5: an ascent that has not reached its settlement tick settles at the final tick', () => {
    let s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    s = requestAscent(s, 89_800).state; // resolveT 90_300, past round end
    const r = settleAtRoundEnd(s, tick(90_000, 1010));
    expect(r.state.position?.result?.reason).toBe('round-end');
    expect(r.state.position?.result?.payout).toBe(55_000);
  });

  it('RL-4: with no position, round end is a no-op', () => {
    const s = fresh();
    expect(settleAtRoundEnd(s, tick(90_000, I0)).events).toEqual([]);
  });

  it('RL-4: an already-settled position is not settled twice', () => {
    let s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    s = onTick(s, tick(125, 800)).state; // crushed
    const balanceAfterCrush = s.wallet.balance;
    const r = settleAtRoundEnd(s, tick(90_000, 1500));
    expect(r.events).toEqual([]);
    expect(r.state.wallet.balance).toBe(balanceAfterCrush);
  });
});

describe('LG-1 — wallet arithmetic stays balanced and integral', () => {
  it('LG-1: balance = start − stake + payout for every settlement path', () => {
    const cases: readonly { readonly v: number; readonly payout: number }[] = [
      { v: 1010, payout: 55_000 },
      { v: 990, payout: 45_000 },
      { v: 1000, payout: 50_000 },
    ];
    for (const { v, payout } of cases) {
      const s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
      const r = settleAtRoundEnd(s, tick(125, v));
      expect(r.state.wallet.balance).toBe(START_BALANCE - 50_000 + payout);
      expect(r.state.wallet.net).toBe(payout - 50_000);
    }
  });

  it('LG-1: wagered accumulates across positions and is never refunded', () => {
    let s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    s = settleAtRoundEnd(s, tick(125, I0)).state;
    s = clearSettled(s).state;
    s = opened(s, -1, 10_000, 2, tick(250, I0));
    expect(s.wallet.wagered).toBe(60_000);
  });

  it('LG-1: every wallet field remains an integer after a full round trip', () => {
    let s = opened(fresh(), -1, 12_345, 25, tick(0, 997.3));
    s = onTick(s, tick(125, 998.7)).state;
    s = settleAtRoundEnd(s, tick(250, 1001.1)).state;
    expect(Number.isInteger(s.wallet.balance)).toBe(true);
    expect(Number.isInteger(s.wallet.wagered)).toBe(true);
    expect(Number.isInteger(s.wallet.net)).toBe(true);
  });
});

describe('PL-5 — no path produces a negative balance', () => {
  it('PL-5: a crush at maximum leverage cannot overdraw the wallet', () => {
    const s = opened(initialState(cents(50_000)), 1, 50_000, 25, tick(0, I0));
    const r = onTick(s, tick(125, 500));
    expect(r.state.wallet.balance).toBe(0);
  });

  it('PL-5: net loss over a position never exceeds the stake', () => {
    for (const lev of [2, 5, 10, 25]) {
      const s = opened(fresh(), 1, 50_000, lev, tick(0, I0));
      const r = onTick(s, tick(125, 1));
      expect(r.state.wallet.net).toBe(-50_000);
    }
  });
});

describe('M1.3 — events replace the engine’s DOM calls', () => {
  it('M1.3: opening emits position-opened and wallet-changed, and nothing else', () => {
    const r = open(fresh(), { dir: 1, stake: cents(50_000), lev: 10, id: 'p1' }, tick(0, I0));
    expect(kinds(r.events)).toEqual(['position-opened', 'wallet-changed']);
  });

  it('M1.3: settlement emits settled then wallet-changed — the checkLossLimit hook', () => {
    const s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    const r = onTick(s, tick(125, 800));
    expect(kinds(r.events)).toEqual(['settled', 'wallet-changed']);
    const walletEvent = r.events.find((e) => e.kind === 'wallet-changed');
    expect(walletEvent).toEqual({ kind: 'wallet-changed', wallet: r.state.wallet });
  });

  it('M1.3: a tick with no position emits nothing and returns the same state object', () => {
    const s = fresh();
    const r = onTick(s, tick(125, 1234));
    expect(r.events).toEqual([]);
    expect(r.state).toBe(s);
  });

  it('M1.3: clearSettled replaces the setTimeout that dropped the position', () => {
    let s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    s = onTick(s, tick(125, 800)).state;
    expect(s.position?.state).toBe('done');
    const r = clearSettled(s);
    expect(r.state.position).toBeNull();
    // The result survives for the settle card, as the prototype's S.lastResult did.
    expect(r.state.lastResult?.reason).toBe('crush');
  });

  it('M1.3: clearSettled on an open position is a no-op', () => {
    const s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    expect(clearSettled(s).state).toBe(s);
    expect(clearSettled(fresh()).events).toEqual([]);
  });

  it('M1.3: DEFAULT_CONFIG carries the audit-locked 500 ms ascent', () => {
    expect(DEFAULT_CONFIG.ascentMs).toBe(500);
  });

  it('M1.3: a caller-supplied config overrides the ascent duration', () => {
    const s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    const r = requestAscent(s, 1_000, { ...DEFAULT_CONFIG, ascentMs: 750 });
    expect(r.state.position?.resolveT).toBe(1_750);
  });
});

/* ================================================================
   M1.4 — oxygen, tick-derived tau, the entry cutoff, and the CR-1
   evaluation order.
================================================================ */

describe('PL-2 — theta comes from config and is fixed for the life of a position', () => {
  it('PL-2: DEFAULT_CONFIG carries theta = 0.25 %/s and the 8 Hz tick', () => {
    expect(DEFAULT_CONFIG.thetaPerSecond).toBe(0.0025);
    expect(DEFAULT_CONFIG.tickSeconds).toBe(0.125);
  });

  it('PL-2: theta is read from config, not a literal — a different config pays differently', () => {
    // The exit criterion in one assertion: if theta were hard-coded in the
    // math, this would settle identically under both configs.
    const settleUnder = (theta: number): number => {
      const config = { ...DEFAULT_CONFIG, thetaPerSecond: theta };
      let s = open(fresh(), { dir: 1, stake: cents(50_000), lev: 10, id: 'p1' }, tick(0, I0), config)
        .state;
      for (let i = 1; i <= 80; i += 1) s = onTick(s, tick(i * 125, I0), config).state;
      return settleAtRoundEnd(s, tick(10_000, I0), config).state.position!.result!.payout;
    };
    // 10 s held at a flat index: zero oxygen pays the stake back exactly,
    // 0.25 %/s takes 2.5 % of it, and double theta takes twice as much.
    expect(settleUnder(0)).toBe(50_000);
    expect(settleUnder(0.0025)).toBe(48_750);
    expect(settleUnder(0.005)).toBe(47_500);
  });

  it('PL-2: theta is snapshotted at entry — a mid-round config change cannot reach in', () => {
    // The engine enforces the half of PL-2 it can. Even a caller that broke the
    // round-boundary rule and swapped config mid-round cannot change the edge
    // on a position that is already open: the position carries its own theta.
    const atEntry = { ...DEFAULT_CONFIG, thetaPerSecond: 0.0025 };
    const raised = { ...DEFAULT_CONFIG, thetaPerSecond: 0.05 };

    let s = open(fresh(), { dir: 1, stake: cents(50_000), lev: 10, id: 'p1' }, tick(0, I0), atEntry)
      .state;
    expect(s.position?.theta).toBe(0.0025);

    for (let i = 1; i <= 80; i += 1) s = onTick(s, tick(i * 125, I0), raised).state;
    const settlement = settleAtRoundEnd(s, tick(10_000, I0), raised).state.position!.result!;

    // 10 s at the ENTRY theta, not the raised one: 48_750, not 25_000.
    expect(settlement.theta).toBe(0.0025);
    expect(settlement.payout).toBe(48_750);
  });

  it('PL-2/LG-4: the settlement retains the theta in force and the tau it settled at', () => {
    let s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    for (let i = 1; i <= 8; i += 1) s = onTick(s, tick(i * 125, I0)).state;
    const settlement = settleAtRoundEnd(s, tick(1_000, I0)).state.position!.result!;
    expect(settlement.theta).toBe(0.0025);
    expect(settlement.tau).toBe(1);
  });
});

describe('PL-1 — tau is derived from the tick count, never from a clock', () => {
  it('PL-1: tau counts ticks, so identical ticks at wildly different timestamps agree', () => {
    // The same four ticks delivered over 0.5 s and over an hour settle
    // identically. A wall-clock tau would not — and a replayed round (M1.6)
    // delivers its ticks as fast as the file can be read.
    const settleOver = (spacingMs: number): number => {
      let s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
      for (let i = 1; i <= 4; i += 1) s = onTick(s, tick(i * spacingMs, I0)).state;
      return settleAtRoundEnd(s, tick(4 * spacingMs, I0)).state.position!.result!.payout;
    };
    expect(settleOver(125)).toBe(settleOver(1));
    expect(settleOver(125)).toBe(settleOver(3_600_000));
  });

  it('PL-1: a jitter gap costs one tick of oxygen, not the wall-clock interval', () => {
    // Game logic section 8: a 125–2000 ms gap is treated as ONE tick. Charging
    // it as 2 s of oxygen would make a network hiccup cost the player money.
    let s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    s = onTick(s, tick(2_000, I0)).state; // a 2 s gap, still one tick
    expect(s.position?.ticksElapsed).toBe(1);
    expect(settleAtRoundEnd(s, tick(2_000, I0)).state.position!.result!.tau).toBe(0.125);
  });

  it('PL-1: ticksElapsed advances once per tick and only while a position lives', () => {
    let s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    expect(s.position?.ticksElapsed).toBe(0); // the entry tick is tick 0
    for (const n of [1, 2, 3]) {
      s = onTick(s, tick(n * 125, I0)).state;
      expect(s.position?.ticksElapsed).toBe(n);
    }
    // Settled: further ticks are no-ops and do not keep charging oxygen.
    const done = settleAtRoundEnd(s, tick(500, I0)).state;
    const after = onTick(done, tick(625, I0));
    expect(after.state).toBe(done);
  });

  it('PL-1: round-end settlement does not double-count the final tick', () => {
    // The final tick arrives through onTick, which counts it; settleAtRoundEnd
    // then settles at the multiplier the player was already shown (RL-4).
    let s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    s = onTick(s, tick(125, I0)).state;
    const settlement = settleAtRoundEnd(s, tick(125, I0)).state.position!.result!;
    expect(settlement.tau).toBe(0.125);
  });
});

describe('CR-1 — per-tick evaluation order: crush → auto-orders → ascent', () => {
  it('CR-4: a crush on the same tick as a due ascent takes precedence', () => {
    let s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    s = requestAscent(s, 0).state; // resolveT = 500
    // The t=500 tick is both the ascent's settlement tick and past the line.
    const r = onTick(s, tick(500, 850));
    expect(r.state.position?.result?.reason).toBe('crush');
    expect(r.state.position?.result?.payout).toBe(0);
  });

  it('CR-1: tau advances before the crush test — the line tested is this tick\'s', () => {
    // A tick sitting exactly on the tau=0.125 line must crush. If tau were
    // advanced after the check, the engine would test the tau=0 line here and
    // spare it — the CR-6 mismatch, one tick wide.
    const s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    const lineNow = crushIndex(1, 10, I0, DEFAULT_CONFIG.thetaPerSecond, 0.125);
    const lineStale = crushIndex(1, 10, I0, DEFAULT_CONFIG.thetaPerSecond, 0);
    expect(lineNow).toBeGreaterThan(lineStale); // it crept up

    expect(onTick(s, tick(125, lineNow)).state.position?.result?.reason).toBe('crush');
    // and a value between the two lines — spared by the stale line, killed by
    // the live one — also crushes.
    const between = (lineNow + lineStale) / 2;
    expect(onTick(s, tick(125, between)).state.position?.result?.reason).toBe('crush');
  });

  it('CR-1: a surviving tick advances tau and emits nothing', () => {
    const s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    const r = onTick(s, tick(125, I0));
    expect(r.events).toEqual([]);
    expect(r.state.position?.ticksElapsed).toBe(1);
    expect(r.state.position?.state).toBe('open');
    // The state object is new, so a caller holding the pre-tick state still
    // sees pre-tick oxygen.
    expect(s.position?.ticksElapsed).toBe(0);
  });

  it('CR-1: the auto-order slot is empty in M1.4 — no trigger fires between them', () => {
    // A position that neither crushes nor is due to settle passes straight
    // through. M1.5 fills the middle slot; until it does, nothing may settle
    // from it, which is what makes this milestone's ordering claim testable.
    // All well inside the survival band for a 10x Surface (line near 900) and
    // with no ascent pending, so neither slot 1 nor slot 3 can fire. Anything
    // that settled here could only have come from slot 2.
    let s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    for (const [i, v] of [1200, 950, 1500, 999].entries()) {
      const r = onTick(s, tick((i + 1) * 125, v));
      expect(r.state.position?.result, `tick ${i + 1} at ${v}`).toBeUndefined();
      s = r.state;
    }
  });
});

describe('EN-1 — the T−5 s entry cutoff', () => {
  it('EN-1: an entry outside the window is rejected with ENTRY_CLOSED', () => {
    const r = open(
      fresh(),
      { dir: 1, stake: cents(50_000), lev: 10, id: 'p1', entryOpen: false },
      tick(86_000, I0),
    );
    expect(r.events).toEqual([{ kind: 'open-rejected', code: 'ENTRY_CLOSED' }]);
  });

  it('EN-1: the rejection is a full non-debit — the stake never leaves the wallet', () => {
    const before = fresh();
    const r = open(
      before,
      { dir: 1, stake: cents(50_000), lev: 10, id: 'p1', entryOpen: false },
      tick(86_000, I0),
    );
    expect(r.state.wallet).toEqual(before.wallet);
    expect(r.state.position).toBeNull();
  });

  it('EN-1: an entry inside the window is accepted', () => {
    const r = open(
      fresh(),
      { dir: 1, stake: cents(50_000), lev: 10, id: 'p1', entryOpen: true },
      tick(1_000, I0),
    );
    expect(kinds(r.events)).toContain('position-opened');
  });

  it('EN-1: an omitted flag means open — every pre-M1.4 call site keeps working', () => {
    const r = open(fresh(), { dir: 1, stake: cents(50_000), lev: 10, id: 'p1' }, tick(0, I0));
    expect(kinds(r.events)).toContain('position-opened');
  });

  it('EN-8: ENTRY_CLOSED outranks position-open, balance and no-price', () => {
    // The window is round-terminal: nothing the player does reopens it, so it
    // must not be masked by a condition that clears on its own.
    let s = setLossLocked(fresh(), false);
    s = opened(s, 1, 50_000, 10, tick(0, I0)); // holds POSITION_OPEN
    const r = open(
      s,
      { dir: 1, stake: cents(10_000_000), lev: 10, id: 'p2', entryOpen: false },
      null, // and NO_PRICE
    );
    expect(r.events).toEqual([{ kind: 'open-rejected', code: 'ENTRY_CLOSED' }]);
  });

  it('EN-8: the loss lock still outranks ENTRY_CLOSED', () => {
    // A session-terminal condition is never masked by a round-terminal one.
    const s = setLossLocked(fresh(), true);
    const r = open(
      s,
      { dir: 1, stake: cents(50_000), lev: 10, id: 'p1', entryOpen: false },
      tick(0, I0),
    );
    expect(r.events).toEqual([{ kind: 'open-rejected', code: 'LOSS_LIMIT_REACHED' }]);
  });
});

describe('M1.4 — the house edge exists', () => {
  it('PL-6 precondition: a flat round now returns LESS than the stake', () => {
    // The roadmap gap this milestone closes: before M1.4 a motionless index
    // returned the stake exactly and RTP was 100 % minus rounding. A 90 s hold
    // at 0.25 %/s costs 22.5 % of the multiplier.
    let s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    for (let i = 1; i <= 720; i += 1) s = onTick(s, tick(i * 125, I0)).state;
    const settlement = settleAtRoundEnd(s, tick(90_000, I0)).state.position!.result!;
    expect(settlement.tau).toBe(90);
    expect(settlement.multiplier).toBeCloseTo(1 - 0.225, 12);
    expect(settlement.payout).toBe(38_750);
    expect(settlement.pnl).toBeLessThan(0);
  });

  it('PL-5: oxygen can never push a settlement below zero payout', () => {
    // Even a theta absurd enough to drive M far negative floors at 0, so the
    // edge can never create a debt (PL-5, CR-5).
    const config = { ...DEFAULT_CONFIG, thetaPerSecond: 0.5 };
    let s = open(fresh(), { dir: 1, stake: cents(50_000), lev: 10, id: 'p1' }, tick(0, I0), config)
      .state;
    for (let i = 1; i <= 80; i += 1) {
      const r = onTick(s, tick(i * 125, I0), config);
      s = r.state;
      if (s.position?.result) break;
    }
    const settlement = s.position!.result!;
    expect(settlement.payout).toBe(0);
    expect(settlement.pnl).toBe(-50_000);
    expect(s.wallet.balance).toBe(START_BALANCE - 50_000);
  });
});

describe('LG-4 — settlement records carry what the ledger must retain', () => {
  it('LG-4: a settlement names its position, tick, multiplier and money', () => {
    const s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    const settlement = settleAtRoundEnd(s, tick(90_000, 1010)).state.position?.result;
    expect(settlement).toMatchObject({
      positionId: 'p1',
      reason: 'round-end',
      crushed: false,
      tick: { t: 90_000, v: 1010 },
      payout: 55_000,
      pnl: 5_000,
    });
    expect(settlement?.multiplier).toBeCloseTo(1.1, 12);
  });

  it('LG-4: a settlement is self-contained — direction, stake, leverage and I_e', () => {
    const s = opened(fresh(), -1, 12_345, 25, tick(0, 1007.5));
    const settlement = settleAtRoundEnd(s, tick(90_000, 1006)).state.position?.result;
    expect(settlement).toMatchObject({
      dir: -1,
      stake: 12_345,
      lev: 25,
      entry: 1007.5,
    });
  });

  it('LG-4: the retained stake reproduces the settled ratio the client displays', () => {
    const s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    const settlement = settleAtRoundEnd(s, tick(90_000, 1010)).state.position?.result;
    expect(settlement!.payout / settlement!.stake).toBeCloseTo(1.1, 12);
  });

  it('LG-4: a crush records its true multiplier even though payout is floored to 0', () => {
    const s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    const settlement = onTick(s, tick(125, 800)).state.position?.result;
    // M = 1 + 10·(−0.2) − 0.0025·0.125 = −1.0003125, recorded for audit;
    // payout still exactly 0. The oxygen term is in the recorded multiplier
    // because LG-4 wants the number the formula produced, not a tidied one.
    expect(settlement?.multiplier).toBeCloseTo(-1.0003125, 12);
    expect(settlement?.payout).toBe(0);
  });
});
