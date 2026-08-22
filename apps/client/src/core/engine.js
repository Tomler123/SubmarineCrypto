import { S } from '../state/store.js';
import { now } from '../util/math.js';
import { fmt$ } from '../util/format.js';
import { FX } from '../render/renderer.js';
import { Au } from '../audio/audio.js';
import { feedMsg } from '../ui/feed.js';
import { toast } from '../ui/overlay.js';
import { checkLossLimit } from '../ui/responsible.js';
import { CFG } from '../config/constants.js';
import {
  clearSettled,
  initialState,
  livePnl,
  onTick as engineOnTick,
  open as engineOpen,
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

   The `Engine.*` call signatures are unchanged, so gateway.js, round.js,
   frame.js, renderer.js and console.js are untouched. In Phase 2 this adapter
   becomes the optimistic mirror and the same @crush/engine package runs on the
   server as the authority.
================================================================ */

/** Authoritative engine state. `S` is a derived view of it, never the source. */
let state = initialState(CFG.START_BAL);

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
  /** Live P&L in cents at index value `v` — presentation only (UI-2). */
  pnl(v){ return state.position ? livePnl(state.position, v) : 0; },

  /** The crush line for the open position; read by the renderer and console. */
  liqIdx(p){ return positionCrushIndex(p); },

  open(dir, stake, lev){
    // The client mirrors the loss lock into the engine before every entry, so
    // the engine's own RP-2 rejection stays the single decision point.
    state = setLossLocked(state, S.lossLocked);
    nextPositionId += 1;
    const result = apply(engineOpen(
      state,
      { dir, stake, lev, id: `p${nextPositionId}` },
      S.lastTick,
    ));
    const rejection = result.events.find(e => e.kind === 'open-rejected');
    if (rejection) return { ok:false, err: REJECT_COPY[rejection.code] ?? 'REJECTED' };
    return { ok:true };
  },

  requestAscent(){ apply(engineRequestAscent(state, now(), { ascentMs: CFG.ASCENT_MS })); },

  onTick(tk){ apply(engineOnTick(state, tk)); },

  forceSettleAtRoundEnd(){ apply(settleAtRoundEnd(state, S.lastTick)); }
};

/** Engine reject codes → the console copy the prototype showed. */
const REJECT_COPY = {
  POSITION_OPEN: 'POSITION OPEN',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT BALANCE',
  LOSS_LIMIT_REACHED: 'LOSS LIMIT REACHED',
  // Deliberately NOT MF-1's "SIGNAL LOST". That is a round-level abort —
  // positions auto-surface, the round dies, it is alarmed. This rejects one
  // request and settles nothing. Collapsing the two would cost the back office
  // the ability to tell "the feed died" from "one entry raced the round start",
  // and a rising NO_PRICE rate is exactly the early warning worth keeping.
  NO_PRICE: 'STANDBY — NO ENTRY PRICE YET',
};

sync();
