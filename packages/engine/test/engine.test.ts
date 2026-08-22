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
    // M = 1 + 10·(1010/1000 − 1) = 1.10 → payout 55_000.
    expect(r.state.position?.result?.payout).toBe(55_000);
  });

  it('CO-4: oxygen and index keep running during the ascent — a losing move still lands', () => {
    let s = opened(fresh(), 1, 50_000, 10, tick(0, I0));
    s = requestAscent(s, 1_000).state;
    const r = onTick(s, tick(1_500, 995));
    // M = 1 + 10·(−0.005) = 0.95 → payout 47_500, a loss taken on the ascent.
    expect(r.state.position?.result?.payout).toBe(47_500);
    expect(r.state.position?.result?.pnl).toBe(-2_500);
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
    const r = onTick(s, tick(125, crushIndex(1, 10, I0)));
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
    const r = requestAscent(s, 1_000, { ascentMs: 750 });
    expect(r.state.position?.resolveT).toBe(1_750);
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
    // M = 1 + 10·(−0.2) = −1, recorded for audit; payout still exactly 0.
    expect(settlement?.multiplier).toBeCloseTo(-1, 12);
    expect(settlement?.payout).toBe(0);
  });
});
