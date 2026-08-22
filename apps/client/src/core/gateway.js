import { wait } from '../util/math.js';
import { Engine } from './engine.js';

/* ================================================================
   GATEWAY — every player action is a request. Phase 2: these await
   real server acks; UI stays optimistic either side of the seam.
================================================================ */
export const Gateway = {
  async openPosition(req){ await wait(60); return Engine.open(req.dir, req.stake, req.lev); },
  async cashOut(){ await wait(60); Engine.requestAscent(); }
};
