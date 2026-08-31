/* =====================================================================
   CRUSH DEPTH — Phase 1 visual client (single-file prototype)

   Module map → phase-2 repo (React + PixiJS v8 + Zustand):
     SimulatedIndexSource → @crush/feed      (swap for WsIndexSource;
                                              same subscribe/tick contract)
     InterpBuffer         → @crush/feed      (unchanged in phase 2)
     Round (state machine) → @crush/round    (becomes server-driven)
     Engine / Bots        → server risk engine; client keeps an
                            optimistic mirror behind Gateway acks
     Gateway              → @crush/net       (request/ack seam — today it
                            resolves locally after a fake 60ms latency)
     Renderer (Canvas 2D) → @crush/scene     (PixiJS in the real build;
                            everything below draw() is renderer-private)

   AUTHORITY RULE: liquidation and settlement are decided on TICK values
   only (server-authoritative semantics). The 60fps interpolated value is
   presentation — it drives visuals and the live payout readout, never
   money movement.
   All balances are integer minor units (US cents). No float money.
===================================================================== */

/* Import order is load-bearing: it reproduces the module-level side-effect
   order of the original single-file script. See ARCHITECTURE.md. */
import { S } from './state/store.js';
import { source, buffer } from './feed/index.js';
import { Engine } from './core/engine.js';
import { botsTick } from './core/bots.js';
import { resetPhase } from './core/round.js';
import './audio/audio.js';                 // pointerdown unlock listener
import { bootScene } from './render/boot.js';    // renderer seam + resize listener
import { setStake } from './ui/console.js';      // console listeners
import './ui/sheets.js';                   // sheet + scrim listeners
import './ui/responsible.js';              // limits, reality check, 1s session interval
import { frame } from './loop/frame.js';

/* wire ticks: buffer + money engines (tick-authoritative) */
source.onTick(tk=>{
  S.lastTick = tk;
  buffer.push(tk);
  if (tk.v>S.roundMax) S.roundMax=tk.v;
  if (tk.v<S.roundMin) S.roundMin=tk.v;
  Engine.onTick(tk);
  botsTick(tk);
});

bootScene();
setStake(S.stake);
// RL-1: boot has no predecessor phase, so it seeds the machine explicitly
// rather than going through the guarded `setPhase`. Every transition after
// this one comes from `roundUpdate` and must satisfy the graph.
resetPhase('waiting');
requestAnimationFrame(frame);
