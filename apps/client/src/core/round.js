import { CFG } from '../config/constants.js';
import { S } from '../state/store.js';
import { now } from '../util/math.js';
import { setRSEED } from '../util/random.js';
import { source, buffer } from '../feed/index.js';
import { trail, FX } from '../render/effects.js';
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

/**
 * RL-1's graph, as data: the single legal successor of each phase.
 *
 * Written once and used by the guard, so "no other transitions exist" is
 * enforced by the setter rather than asserted about its callers.
 */
const NEXT_PHASE = {
  waiting:   'launching',
  launching: 'running',
  running:   'ending',
  ending:    'settling',
  settling:  'waiting',
};

/**
 * Run a phase's entry effects. Split out of `setPhase` so `resetPhase` can
 * share them without duplicating the body.
 */
function enterPhase(p){
  S.phase=p; S.phaseT=now();
  const t=now();
  if (p==='launching'){
    S.roundNo++; setRSEED(S.roundNo*977.13 + 7);
    // PL-2: tunables are re-read here and only here. A theta change lands at a
    // round boundary, never mid-round, and is logged with the round it starts.
    Engine.beginRound();
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

/**
 * RL-1: advance to `p`, but only if it is the current phase's legal successor.
 *
 * The guard exists because phase entry is **not idempotent**. Entering
 * `settling` calls `Engine.forceSettleAtRoundEnd()`, so a repeated or illegal
 * transition is a double settlement — a money defect, not a cosmetic state
 * error. Before this guard RL-1 held only because `roundUpdate` was the sole
 * caller and happened to drive the graph in order; that is a property of the
 * caller, and one new call site anywhere would have paid a position out twice.
 *
 * A self-transition is refused along with everything else: `settling` →
 * `settling` is exactly the double-settle case, and no phase in RL-1's graph is
 * its own successor.
 *
 * Returns whether the transition was taken, so a caller that cares can tell a
 * refusal from a success. `roundUpdate` ignores it — it only ever proposes the
 * legal successor — but a Phase 2 round server logging every transition
 * (RL-1's second sentence) needs the answer.
 *
 * @param {string} p target phase
 * @returns {boolean} true if the phase changed
 */
export function setPhase(p){
  if (NEXT_PHASE[S.phase] !== p) return false;
  enterPhase(p);
  return true;
}

/**
 * Seed the machine at `p` out of band, ignoring the graph.
 *
 * The one sanctioned way past the guard, for the two callers that legitimately
 * have no predecessor: `main.js` at boot, and tests that need to start
 * mid-cycle. Kept as a separate named export rather than a flag on `setPhase`
 * so that a bypass is visible at the call site — a reader can grep for every
 * place the graph is skipped.
 *
 * It deliberately still runs the phase's entry effects: boot goes through it
 * and needs `waiting`'s overlay clear, so this is a seed, not a silent poke at
 * `S.phase`.
 *
 * @param {string} p phase to seed
 * @returns {boolean} true if `p` is a real phase and was entered
 */
export function resetPhase(p){
  if (!Object.prototype.hasOwnProperty.call(NEXT_PHASE, p)) return false;
  enterPhase(p);
  return true;
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
