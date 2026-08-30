/**
 * EN-7 — entry idempotency by request id.
 *
 * "Every entry request carries a client-generated idempotency id; replaying the
 * same id never creates a second position or a second debit."
 *
 * `OpenRequest.id` was documented as the idempotency key from M1.3 and stored
 * on the position, but nothing checked it: the client's `nextPositionId`
 * incremented unconditionally, so a replayed request — the ordinary consequence
 * of a dropped ack, which the Phase 2 gateway will retry — opened a second
 * position and took a second debit. The criterion was declared and unenforced.
 *
 * ## Why a replay is a no-op returning the existing position, not a rejection
 *
 * The replay is the *same* request, and its original outcome was success. A
 * retry after a lost ack is asking "did this happen?", and the honest answer is
 * "yes, here it is" — not `POSITION_OPEN`, which is EN-5's answer to a
 * *different* second request and would tell a client to abandon a position it
 * actually owns. So the id check ranks above every EN-8 rejection, including
 * the loss lock: a locked player still owns the position they opened before the
 * lock landed.
 *
 * The window is the position's lifetime in engine state — through `done`, until
 * `clearSettled` drops it. Beyond that the id has left the engine and EN-5
 * (one open position) plus LG-3 (ledger-level idempotency by operation id)
 * govern; a Phase 2 authority keeps a longer-lived id set, which is a server
 * concern and deliberately not modelled here.
 */

import { describe, expect, it } from 'vitest';
import { cents } from '@crush/ledger';
import {
  DEFAULT_CONFIG,
  clearSettled,
  initialState,
  onTick,
  open,
  requestAscent,
  setLossLocked,
} from '../src/index.js';
import type { EngineConfig, OpenRequest, Tick } from '../src/index.js';

const I0 = 1000;
const START_BALANCE = 1_000_000;
const CONFIG: EngineConfig = {
  ...DEFAULT_CONFIG,
  maxNotionalCents: cents(Number.MAX_SAFE_INTEGER),
};

function tick(t: number, v: number): Tick {
  return { t, v };
}

const REQ: OpenRequest = { dir: 1, stake: cents(50_000), lev: 10, id: 'req-1' };

describe('EN-7 — replaying an accepted request creates no second position or debit', () => {
  it('EN-7: the replay leaves the wallet untouched', () => {
    let state = initialState(cents(START_BALANCE));
    state = open(state, REQ, tick(0, I0), CONFIG).state;
    const afterFirst = state.wallet;

    const replay = open(state, REQ, tick(125, I0 * 1.01), CONFIG);

    expect(replay.state.wallet.balance).toBe(afterFirst.balance);
    expect(replay.state.wallet.wagered).toBe(afterFirst.wagered);
    expect(replay.state.wallet.net).toBe(afterFirst.net);
    // Exactly one debit, of exactly the stake.
    expect(START_BALANCE - replay.state.wallet.balance).toBe(50_000);
  });

  it('EN-7: the replay returns the existing position, unmodified', () => {
    let state = initialState(cents(START_BALANCE));
    state = open(state, REQ, tick(0, I0), CONFIG).state;
    const original = state.position;

    // A replay priced at a different tick must NOT re-price the position:
    // `I_e` is fixed at the entry-execution tick (EN-2) and a retry cannot move
    // it, which is the property that makes the retry safe to send.
    const replay = open(state, REQ, tick(5_000, I0 * 1.5), CONFIG);

    expect(replay.state.position).toBe(original);
    expect(replay.state.position?.entry).toBe(I0);
    expect(replay.state.position?.id).toBe('req-1');
  });

  it('EN-7: the replay re-reports success rather than a rejection', () => {
    // The client cannot distinguish "your request succeeded" from "your request
    // failed" if a retry answers with a reject code, so the replay repeats the
    // original event rather than emitting `open-rejected`.
    let state = initialState(cents(START_BALANCE));
    state = open(state, REQ, tick(0, I0), CONFIG).state;
    const replay = open(state, REQ, tick(125, I0), CONFIG);

    expect(replay.events.some((e) => e.kind === 'open-rejected')).toBe(false);
    const opened = replay.events.find((e) => e.kind === 'position-opened');
    expect(opened).toBeDefined();
    expect(opened?.kind === 'position-opened' && opened.position).toBe(state.position);
    // No second `wallet-changed`: nothing moved, so nothing is reported as
    // having moved. A spurious wallet event would re-run the client's
    // responsible-play check against an unchanged balance.
    expect(replay.events.some((e) => e.kind === 'wallet-changed')).toBe(false);
  });

  it('EN-7: replaying many times is still one position and one debit', () => {
    let state = initialState(cents(START_BALANCE));
    state = open(state, REQ, tick(0, I0), CONFIG).state;
    for (let i = 0; i < 20; i++) {
      state = open(state, REQ, tick(125 * (i + 1), I0), CONFIG).state;
    }
    expect(START_BALANCE - state.wallet.balance).toBe(50_000);
    expect(state.wallet.wagered).toBe(50_000);
  });

  it('EN-7: a DIFFERENT id while a position is open is still rejected (EN-5)', () => {
    // The id check must not become a blanket bypass of EN-5. A genuinely new
    // request during an open position is a second position and is refused.
    let state = initialState(cents(START_BALANCE));
    state = open(state, REQ, tick(0, I0), CONFIG).state;
    const other = open(state, { ...REQ, id: 'req-2' }, tick(125, I0), CONFIG);

    const rejection = other.events.find((e) => e.kind === 'open-rejected');
    expect(rejection?.kind === 'open-rejected' && rejection.code).toBe('POSITION_OPEN');
    expect(other.state.wallet.balance).toBe(state.wallet.balance);
  });
});

describe('EN-7 — the id check outranks every EN-8 rejection', () => {
  it('EN-7: a replay is honoured even once the loss lock has landed', () => {
    // RP-2 blocks *new* entries. It cannot retroactively unmake a position the
    // player already owns, so a retry of that entry must not be answered with
    // LOSS_LIMIT_REACHED — the client would conclude the entry never happened.
    let state = initialState(cents(START_BALANCE));
    state = open(state, REQ, tick(0, I0), CONFIG).state;
    const held = state.position;
    state = setLossLocked(state, true);

    const replay = open(state, REQ, tick(125, I0), CONFIG);
    expect(replay.events.some((e) => e.kind === 'open-rejected')).toBe(false);
    expect(replay.state.position).toBe(held);

    // But a new id under the lock is still refused, with the RP-2 code.
    const fresh = open(state, { ...REQ, id: 'req-9' }, tick(125, I0), CONFIG);
    const rejection = fresh.events.find((e) => e.kind === 'open-rejected');
    expect(rejection?.kind === 'open-rejected' && rejection.code).toBe('LOSS_LIMIT_REACHED');
  });

  it('EN-7: a replay is honoured after the entry window has shut', () => {
    // Same reasoning for EN-1: a retry crossing the T−5 s cutoff is a retry of
    // an entry that was accepted inside the window.
    let state = initialState(cents(START_BALANCE));
    state = open(state, { ...REQ, entryOpen: true }, tick(0, I0), CONFIG).state;
    const held = state.position;

    const replay = open(state, { ...REQ, entryOpen: false }, tick(125, I0), CONFIG);
    expect(replay.events.some((e) => e.kind === 'open-rejected')).toBe(false);
    expect(replay.state.position).toBe(held);
  });

  it('EN-7: a replay is honoured with no tick to price it against', () => {
    // NO_PRICE exists because there is nothing to set `I_e` from. A replay does
    // not need one: `I_e` was fixed at the original entry tick.
    let state = initialState(cents(START_BALANCE));
    state = open(state, REQ, tick(0, I0), CONFIG).state;
    const held = state.position;

    const replay = open(state, REQ, null, CONFIG);
    expect(replay.events.some((e) => e.kind === 'open-rejected')).toBe(false);
    expect(replay.state.position).toBe(held);
  });

  it('EN-7: a replay is honoured even if the balance would no longer cover the stake', () => {
    // The stake was already debited by the original entry. Charging the balance
    // check again on a retry would reject a position that is already paid for.
    let state = initialState(cents(60_000));
    state = open(state, REQ, tick(0, I0), CONFIG).state;
    expect(state.wallet.balance).toBe(10_000); // below the 50,000 stake
    const held = state.position;

    const replay = open(state, REQ, tick(125, I0), CONFIG);
    expect(replay.events.some((e) => e.kind === 'open-rejected')).toBe(false);
    expect(replay.state.position).toBe(held);
    expect(replay.state.wallet.balance).toBe(10_000);
  });
});

describe('EN-7 — the idempotency window is the position lifetime', () => {
  it('EN-7: a replay during ascent returns the ascending position, not a new one', () => {
    let state = initialState(cents(START_BALANCE));
    state = open(state, REQ, tick(0, I0), CONFIG).state;
    state = requestAscent(state, 0, CONFIG).state;
    const ascending = state.position;

    const replay = open(state, REQ, tick(125, I0), CONFIG);
    expect(replay.state.position).toBe(ascending);
    expect(replay.state.position?.state).toBe('ascending');
    expect(START_BALANCE - replay.state.wallet.balance).toBe(50_000);
  });

  it('EN-7: a replay after settlement returns the settled position, taking no new debit', () => {
    // The settled position is still in engine state until `clearSettled`. A
    // retry arriving in that window must not re-open the same id as a fresh
    // position — which the bare EN-5 check would allow, since a `done` position
    // does not block entry.
    let state = initialState(cents(START_BALANCE));
    state = open(state, REQ, tick(0, I0), CONFIG).state;
    state = requestAscent(state, 0, CONFIG).state;
    state = onTick(state, tick(CONFIG.ascentMs, I0), CONFIG).state;
    expect(state.position?.state).toBe('done');
    const settled = state.position;
    const walletAfterSettle = state.wallet;

    const replay = open(state, REQ, tick(1000, I0), CONFIG);
    expect(replay.state.position).toBe(settled);
    expect(replay.state.wallet).toBe(walletAfterSettle);
    expect(replay.state.wallet.wagered).toBe(50_000);
  });

  it('EN-5: re-entry in the same round with a NEW id is still allowed after settlement', () => {
    // The complement of the case above: idempotency must not break EN-5's
    // "re-entry after settlement in the same round is allowed".
    let state = initialState(cents(START_BALANCE));
    state = open(state, REQ, tick(0, I0), CONFIG).state;
    state = requestAscent(state, 0, CONFIG).state;
    state = onTick(state, tick(CONFIG.ascentMs, I0), CONFIG).state;
    state = clearSettled(state).state;

    const second = open(state, { ...REQ, id: 'req-2' }, tick(1_400, I0 * 1.02), CONFIG);
    expect(second.events.some((e) => e.kind === 'open-rejected')).toBe(false);
    expect(second.state.position?.id).toBe('req-2');
    expect(second.state.position?.entry).toBe(I0 * 1.02);
    expect(second.state.wallet.wagered).toBe(100_000);
  });
});
