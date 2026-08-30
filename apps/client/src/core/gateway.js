import { wait } from '../util/math.js';
import { Engine } from './engine.js';
import { entryOpen } from './entry-window.js';

/* ================================================================
   GATEWAY — every player action is a request. Phase 2: these await
   real server acks; UI stays optimistic either side of the seam.
================================================================ */
export const Gateway = {
  async openPosition(req){
    await wait(60);
    // EN-1 is evaluated *after* the latency leg, because the criterion is about
    // when the request is RECEIVED, not when it was sent. A tap at T−4.98s that
    // lands at T−4.92s is late, and must be late here exactly as it would be at
    // M2.2 — otherwise the client accepts entries the server will reject and
    // the optimistic mirror has nothing to reconcile to.
    return Engine.open(
      req.dir,
      req.stake,
      req.lev,
      entryOpen(),
      req.takeProfit,
      req.stopLoss,
    );
  },
  async cashOut(){ await wait(60); Engine.requestAscent(); }
};
