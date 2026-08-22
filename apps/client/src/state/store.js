import { CFG } from '../config/constants.js';
import { now } from '../util/math.js';

/* ---------------- global state (→ Zustand store in phase 2) -------- */
export const S = {
  phase:'waiting', phaseT: now(), roundNo:0, roundEnd:0,
  balance: CFG.START_BAL, wagered:0, net:0,
  sessionStart: now(), nextRC: 15*60*1000, lossLimit:0, lossLocked:false,
  stake:500, lev:10,
  armed:null,          // {dir,stake,lev} queued during waiting
  pos:null,            // player position
  lastTick:{t:now(), v:CFG.IDX0},
  roundMax:CFG.IDX0, roundMin:CFG.IDX0,
  soundOn:true
};
