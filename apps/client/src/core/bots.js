import { CFG } from '../config/constants.js';
import { rnd } from '../util/random.js';
import { fmt$ } from '../util/format.js';
import { feedMsg } from '../ui/feed.js';
import { closeCallFeed } from './close-calls.ts';
import {
  initialState,
  onTick as engineOnTick,
  open as engineOpen,
  requestAscent,
  settleAtRoundEnd,
} from '@crush/engine';

/* ================================================================
   BOTS — fake social actors driven through isolated real engine states.

   Names and action schedules are seeded presentation data. Multiplier, crush,
   payout, P&L, settlement and Close Calls come only from @crush/engine events.
================================================================ */
export const BOTNAMES = ['MorayJoe','Baltic_Ann','DeepSix','K4raken','SonarSally','Trench_Tom','AbyssalFox','PelagicPam','HullBreach','FathomFred'];
export let bots = [];

function botConfig(){
  return {
    ascentMs: CFG.ASCENT_MS,
    thetaPerSecond: CFG.THETA_PER_S,
    tickSeconds: CFG.TICK_S,
    maxWinMultiple: CFG.MAX_WIN_MULT,
    maxWinCents: CFG.MAX_WIN_CENTS,
    allowedLeverages: CFG.LEV,
    minStakeCents: CFG.MIN_STAKE_CENTS,
    maxNotionalCents: CFG.MAX_NOTIONAL_CENTS,
    maxIndexMovePerTick: CFG.MAX_INDEX_MOVE_PER_TICK,
    reentryCooldownMs: CFG.REENTRY_COOLDOWN_MS,
  };
}

function applyBotResult(bot, result){
  bot.engineState = result.state;
  bot.state = result.state.position?.state ?? 'done';

  for (const event of result.events){
    if (event.kind === 'position-opened'){
      const p = event.position;
      feedMsg(`<b>${bot.name}</b> <span class="${p.dir>0?'up':'dn'}">${p.dir>0?'\u25B2':'\u25BC'}</span> ${fmt$(p.stake)} ×${p.lev}`);
    } else if (event.kind === 'settled'){
      const settlement = event.settlement;
      if (settlement.crushed){
        feedMsg(`<b>${bot.name}</b> <span class="lose">CRUSHED ${fmt$(settlement.pnl)}</span>`);
      } else {
        const verb = settlement.reason === 'round-end' ? 'auto-surfaced' : 'surfaced';
        const cls = settlement.pnl >= 0 ? 'win' : 'lose';
        feedMsg(`<b>${bot.name}</b> ${verb} <span class="${cls}">×${settlement.multiplier.toFixed(2)} ${settlement.pnl>=0?'+':''}${fmt$(settlement.pnl)}</span>`);
      }
    } else if (event.kind === 'close-call'){
      closeCallFeed.publish(event, bot.name);
    }
  }
}

export function spawnBots(launchT){
  bots = [];
  const n = 5 + Math.floor(rnd()*4);
  const used = new Set();
  for (let i=0;i<n;i++){
    let name;
    do { name = BOTNAMES[Math.floor(rnd()*BOTNAMES.length)]; } while (used.has(name));
    used.add(name);
    const tOpen = launchT + rnd()*CFG.ROUND_MS*0.55;
    const dir = rnd()<0.58 ? 1 : -1;
    const stake = [200,500,1000,2500,5000][Math.floor(rnd()*5)];
    const lev = CFG.LEV[Math.floor(rnd()*CFG.LEV.length)];
    const hold = 2500 + rnd()*22000;
    bots.push({
      id: `bot:${launchT}:${i}:${name}`,
      name,
      state:'idle',
      tOpen,
      dir,
      stake,
      lev,
      hold,
      tCash:0,
      engineState: initialState(CFG.START_BAL),
    });
  }
}

export function botsTick(tick){
  const config = botConfig();
  for (const bot of bots){
    if (bot.state === 'idle' && tick.t >= bot.tOpen){
      bot.tCash = tick.t + bot.hold;
      applyBotResult(bot, engineOpen(bot.engineState, {
        id: bot.id,
        dir: bot.dir,
        stake: bot.stake,
        lev: bot.lev,
      }, tick, config));
      continue;
    }

    if (bot.state !== 'open' && bot.state !== 'ascending') continue;
    if (bot.state === 'open' && tick.t >= bot.tCash){
      applyBotResult(bot, requestAscent(bot.engineState, tick.t, config));
    }
    applyBotResult(bot, engineOnTick(bot.engineState, tick, config));
  }
}

export function botsRoundEnd(tick){
  const config = botConfig();
  for (const bot of bots){
    if (bot.state !== 'open' && bot.state !== 'ascending') continue;
    applyBotResult(bot, settleAtRoundEnd(bot.engineState, tick, config));
  }
}
