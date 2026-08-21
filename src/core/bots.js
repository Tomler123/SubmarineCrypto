import { CFG } from '../config/constants.js';
import { rnd } from '../util/random.js';
import { fmt$ } from '../util/format.js';
import { feedMsg } from '../ui/feed.js';

/* ================================================================
   BOTS — fake social layer, structured like real positions.
================================================================ */
export const BOTNAMES = ['MorayJoe','Baltic_Ann','DeepSix','K4raken','SonarSally','Trench_Tom','AbyssalFox','PelagicPam','HullBreach','FathomFred'];
export let bots = [];
export function spawnBots(launchT){
  bots = [];
  const n = 5 + Math.floor(rnd()*4);
  const used = new Set();
  for (let i=0;i<n;i++){
    let nm; do{ nm=BOTNAMES[Math.floor(rnd()*BOTNAMES.length)]; }while(used.has(nm));
    used.add(nm);
    bots.push({
      name:nm, state:'idle',
      tOpen: launchT + rnd()*CFG.ROUND_MS*0.55,
      dir: rnd()<0.58 ? 1 : -1,
      stake: [200,500,1000,2500,5000][Math.floor(rnd()*5)],
      lev: CFG.LEV[Math.floor(rnd()*CFG.LEV.length)],
      hold: 2500 + rnd()*22000,
      entry:0, tCash:0
    });
  }
}
export function botsTick(tk){
  for (const b of bots){
    if (b.state==='idle' && tk.t>=b.tOpen){
      b.state='open'; b.entry=tk.v; b.tCash=tk.t+b.hold;
      feedMsg(`<b>${b.name}</b> <span class="${b.dir>0?'up':'dn'}">${b.dir>0?'\u25B2':'\u25BC'}</span> ${fmt$(b.stake)} \u00D7${b.lev}`);
    } else if (b.state==='open'){
      const liq = b.entry*(1-b.dir/b.lev);
      if (b.dir>0 ? tk.v<=liq : tk.v>=liq){
        b.state='done';
        feedMsg(`<b>${b.name}</b> <span class="lose">CRUSHED \u2212${fmt$(b.stake).slice(1)}</span>`);
      } else if (tk.t>=b.tCash){
        b.state='done';
        const mult = Math.max(0, 1 + b.lev*b.dir*(tk.v/b.entry-1));
        const pnl = Math.round(b.stake*mult)-b.stake;
        feedMsg(`<b>${b.name}</b> surfaced <span class="${pnl>=0?'win':'lose'}">\u00D7${mult.toFixed(2)} ${pnl>=0?'+':''}${fmt$(pnl)}</span>`);
      }
    }
  }
}
export function botsRoundEnd(tk){
  for (const b of bots){
    if (b.state==='open'){
      b.state='done';
      const mult = Math.max(0, 1 + b.lev*b.dir*(tk.v/b.entry-1));
      const pnl = Math.round(b.stake*mult)-b.stake;
      feedMsg(`<b>${b.name}</b> auto-surfaced <span class="${pnl>=0?'win':'lose'}">${pnl>=0?'+':''}${fmt$(pnl)}</span>`);
    }
  }
}
