import { S } from '../state/store.js';
import { now } from '../util/math.js';
import { fmt$ } from '../util/format.js';
import { FX } from '../render/renderer.js';
import { Au } from '../audio/audio.js';
import { feedMsg } from '../ui/feed.js';
import { toast } from '../ui/overlay.js';
import { checkLossLimit } from '../ui/responsible.js';
import { closeCallFeed } from './close-calls.ts';
import { CFG } from '../config/constants.js';
import {
  clearSettled,
  initialState,
  livePnl,
  onTick as engineOnTick,
  open as engineOpen,
  oxygenFraction,
  positionCrushIndex,
  requestAscent as engineRequestAscent,
  setLossLocked,
  settleAtRoundEnd,
} from '@crush/engine';

/* ================================================================
   ENGINE ADAPTER — M1.3.

   The position math and settlement moved to @crush/engine, which is pure:
   it takes a state and returns a new one plus a list of events. This file is
   what is left over — the presentation half that the prototype had tangled
   into `settle()`. It owns three things and no arithmetic:

     1. the engine state, mirrored into `S` so the renderer and console read
        it exactly as before;
     2. the translation from EngineEvent to FX / Au / feedMsg / toast /
        checkLossLimit;
     3. the 900 ms delay before a settled position leaves the screen, which is
        a presentation choice and therefore does not belong in the engine.

   M1.5 extends only the entry adapter with optional TP/SL values and rejection
   copy. In Phase 2 this adapter becomes the optimistic mirror and the same
   @crush/engine package runs on the server as the authority.
================================================================ */

/** Authoritative engine state. `S` is a derived view of it, never the source. */
let state = initialState(CFG.START_BAL);

/**
 * The config in force for the current round (PL-2).
 *
 * Read once at a round boundary and then held constant for the whole round, so
 * a theta change can never reach a position that is already open. `CFG` is a
 * module constant today; in Phase 2 this same call site reads remote config,
 * and the round-boundary rule is already the shape of the code rather than
 * something that has to be remembered.
 */
function configFromSettings(){
  return {
    ascentMs: CFG.ASCENT_MS,
    thetaPerSecond: CFG.THETA_PER_S,
    tickSeconds: CFG.TICK_S,
    // PL-4/AO-5. Read at the same round boundary as theta: a cap change is
    // audit-logged (RK-3) and, like theta, must not move mid-round.
    maxWinMultiple: CFG.MAX_WIN_MULT,
    maxWinCents: CFG.MAX_WIN_CENTS,
    allowedLeverages: CFG.LEV,
    minStakeCents: CFG.MIN_STAKE_CENTS,
    maxNotionalCents: CFG.MAX_NOTIONAL_CENTS,
    maxIndexMovePerTick: CFG.MAX_INDEX_MOVE_PER_TICK,
    reentryCooldownMs: CFG.REENTRY_COOLDOWN_MS,
  };
}
let roundConfig = configFromSettings();

let clearTimer = 0;

/** Mirror engine state into the mutable store the rest of the client reads. */
function sync(){
  S.balance = state.wallet.balance;
  S.wagered = state.wallet.wagered;
  S.net     = state.wallet.net;
  S.pos     = state.position;
  S.lastResult = state.lastResult;
}

/** Translate one engine event into the client effects the prototype fired inline. */
function applyEvent(ev){
  switch (ev.kind){
    case 'position-opened': {
      const p = ev.position;
      feedMsg(`<b>YOU</b> <span class="${p.dir>0?'up':'dn'}">${p.dir>0?'▲':'▼'}</span> ${fmt$(p.stake)} ×${p.lev}`, true);
      Au.click();
      break;
    }
    case 'ascent-started':
      FX.startBlow();
      Au.blow();
      break;
    case 'settled': {
      const r = ev.settlement;
      if (r.crushed){
        FX.implode(); Au.implode();
        feedMsg(`<b>YOU</b> <span class="lose">CRUSHED ${fmt$(r.pnl)}</span>`, true);
        toast(`CRUSHED ${fmt$(r.pnl)}`, 'var(--klaxon)');
      } else {
        FX.surfaceBurst(); Au.win(r.pnl>=0);
        const cls = r.pnl>=0?'win':'lose';
        // payout/stake, as the prototype showed — the settled ratio, not the
        // raw M, so the figure always matches the money that actually moved.
        const mult = r.payout / r.stake;
        feedMsg(`<b>YOU</b> surfaced <span class="${cls}">×${mult.toFixed(2)} ${r.pnl>=0?'+':''}${fmt$(r.pnl)}</span>`, true);
        toast(`SURFACED ${r.pnl>=0?'+':''}${fmt$(r.pnl)}`, r.pnl>=0?'var(--bio)':'var(--sodium)');
      }
      // The prototype dropped the settled position from a timer inside
      // settle(). The engine no longer schedules anything, so the delay lives
      // here, where the reason for it (holding the wreck on screen) lives.
      clearTimeout(clearTimer);
      clearTimer = setTimeout(()=>{ apply(clearSettled(state)); }, 900);
      break;
    }
    case 'close-call':
      closeCallFeed.publish(ev, 'YOU', true);
      break;
    case 'wallet-changed':
      // Replaces the direct checkLossLimit() call inside settle(). The engine
      // reports the numbers; the responsible-play policy stays in the client.
      checkLossLimit();
      break;
    default:
      break;
  }
}

/** Commit an EngineResult: adopt the new state, mirror it, then fire effects. */
function apply(result){
  state = result.state;
  sync();
  for (const ev of result.events) applyEvent(ev);
  return result;
}

let nextPositionId = 0;

export const Engine = {
  /**
   * Re-read the tunables for the round that is about to start (PL-2).
   *
   * Called from the round machine at the `launching` boundary and nowhere else.
   * A theta change therefore takes effect at the next round and never mid-round
   * — and even if this were called mid-round, every open position carries the
   * theta it was opened under, so the edge on a live position cannot move.
   */
  beginRound(){ roundConfig = configFromSettings(); },

  /** The config in force this round; the renderer reads `tickSeconds` from it. */
  config(){ return roundConfig; },

  /**
   * Live P&L in cents at index value `v` — presentation only (UI-2).
   *
   * Capped exactly as settlement is (PL-4/AO-5), because it goes through the
   * same `livePnl`: the readout must not promise money the cap will not pay.
   */
  pnl(v){ return state.position ? livePnl(state.position, v, roundConfig) : 0; },

  /**
   * The crush line for the open position; read by the renderer and console.
   *
   * CR-3/CR-6: this is the engine's own line, at the position's own tau — the
   * same computed number `isCrushed` tests against, not a re-derivation. The
   * client rounds it for display and never recomputes it.
   */
  liqIdx(p){ return positionCrushIndex(p, roundConfig.tickSeconds); },

  /** Oxygen remaining in [0,1] for the O2 bar on the cash-out button (UI-4). */
  oxygen(p){ return oxygenFraction(p, roundConfig.tickSeconds); },

  open(dir, stake, lev, entryOpen, takeProfit, stopLoss){
    // The client mirrors the loss lock into the engine before every entry, so
    // the engine's own RP-2 rejection stays the single decision point.
    state = setLossLocked(state, S.lossLocked);
    nextPositionId += 1;
    const result = apply(engineOpen(
      state,
      {
        dir,
        stake,
        lev,
        id: `p${nextPositionId}`,
        entryOpen,
        ...(takeProfit === undefined ? {} : { takeProfit }),
        ...(stopLoss === undefined ? {} : { stopLoss }),
      },
      S.lastTick,
      roundConfig,
    ));
    const rejection = result.events.find(e => e.kind === 'open-rejected');
    if (rejection) return { ok:false, err: REJECT_COPY[rejection.code] ?? 'REJECTED' };
    return { ok:true };
  },

  requestAscent(){ apply(engineRequestAscent(state, now(), roundConfig)); },

  onTick(tk){ apply(engineOnTick(state, tk, roundConfig)); },

  forceSettleAtRoundEnd(){ apply(settleAtRoundEnd(state, S.lastTick, roundConfig)); }
};

/**
 * Engine reject codes → the console copy the prototype showed.
 *
 * Exported so `apps/client/test/reject-copy.test.js` can assert this map is
 * exhaustive over `RejectCode`. It is a read-only lookup for everyone else —
 * the `?? 'REJECTED'` fallback at the call site exists only as a runtime
 * backstop and, per that test, must never actually be reachable.
 */
export const REJECT_COPY = {
  INVALID_DIRECTION: 'INVALID DIRECTION',
  INVALID_LEVERAGE: 'INVALID LEVERAGE',
  INVALID_STAKE: 'STAKE MUST BE AT LEAST $0.50',
  NOTIONAL_LIMIT_EXCEEDED: 'BALLAST LIMIT — MAX $2,000 NOTIONAL',
  INVALID_TAKE_PROFIT: 'TAKE-PROFIT TOO CLOSE',
  INVALID_STOP_LOSS: 'STOP-LOSS MUST BE BETWEEN 0× AND 1×',
  POSITION_OPEN: 'POSITION OPEN',
  COOLING_OFF: 'POD CYCLING — STAND BY',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT BALANCE',
  LOSS_LIMIT_REACHED: 'LOSS LIMIT REACHED',
  // Deliberately NOT MF-1's "SIGNAL LOST". That is a round-level abort —
  // positions auto-surface, the round dies, it is alarmed. This rejects one
  // request and settles nothing. Collapsing the two would cost the back office
  // the ability to tell "the feed died" from "one entry raced the round start",
  // and a rising NO_PRICE rate is exactly the early warning worth keeping.
  NO_PRICE: 'STANDBY — NO ENTRY PRICE YET',
  // EN-1. Deliberately states the reason rather than a bare "REJECTED": the
  // window shutting at T−5s is a rule the player can learn and play around,
  // which is the whole point of having it.
  ENTRY_CLOSED: 'HATCH SEALED — TOO LATE TO DIVE',
  // Reserved for M2.1 (MF-1 round abort). The engine cannot emit this yet, but
  // the code is declared, so the copy is declared with it: a player who does
  // hit it at M2.1 must not see a bare "REJECTED", and the exhaustiveness test
  // must not have to carry an exception list.
  ROUND_ABORTED: 'DIVE ABORTED — SIGNAL LOST',
};

sync();
