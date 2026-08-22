import { CFG } from '../config/constants.js';
import { S } from '../state/store.js';
import { now } from '../util/math.js';
import { setRSEED } from '../util/random.js';
import { source, buffer } from '../feed/index.js';
import { trail, FX } from '../render/renderer.js';
import { Au } from '../audio/audio.js';
import { Engine } from './engine.js';
import { Gateway } from './gateway.js';
import { spawnBots, botsRoundEnd } from './bots.js';
import { overlayHTML, showSettleCard } from '../ui/overlay.js';
import { pushHistory } from '../ui/history.js';

/* ================================================================
   ROUND — explicit state machine.
   waiting → launching → running → ending → settling → waiting
================================================================ */
export function setPhase(p){
  S.phase=p; S.phaseT=now();
  const t=now();
  if (p==='launching'){
    S.roundNo++; setRSEED(S.roundNo*977.13 + 7);
    trail.length=0; buffer.reset(); FX.roundReset();
    S.roundMax=S.roundMin=CFG.IDX0;
    overlayHTML('');
  }
  if (p==='running'){
    source.resetRound();
    S.roundEnd = t + CFG.ROUND_MS;
    spawnBots(t);
    if (S.armed){ Gateway.openPosition(S.armed); S.armed=null; }
    Au.ping();
  }
  if (p==='ending'){
    source.halt();
    Au.horn();
  }
  if (p==='settling'){
    Engine.forceSettleAtRoundEnd();
    botsRoundEnd(S.lastTick);
    const d = (S.lastTick.v/CFG.IDX0 - 1)*100;
    pushHistory(d);
    showSettleCard(d);
  }
  if (p==='waiting'){
    overlayHTML('');
    S.lastResult=null;
  }
}
export function roundUpdate(t){
  const el = t - S.phaseT;
  switch(S.phase){
    case 'waiting':   if (el>=CFG.WAIT_MS)   setPhase('launching'); break;
    case 'launching': if (el>=CFG.LAUNCH_MS) setPhase('running');   break;
    case 'running':   if (t>=S.roundEnd)     setPhase('ending');    break;
    case 'ending':    if (el>=CFG.ENDING_MS) setPhase('settling');  break;
    case 'settling':  if (el>=CFG.SETTLE_MS) setPhase('waiting');   break;
  }
}
