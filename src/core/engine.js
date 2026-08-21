import { S } from '../state/store.js';
import { now } from '../util/math.js';
import { fmt$ } from '../util/format.js';
import { FX } from '../render/renderer.js';
import { Au } from '../audio/audio.js';
import { feedMsg } from '../ui/feed.js';
import { toast } from '../ui/overlay.js';
import { checkLossLimit } from '../ui/responsible.js';
import { CFG } from '../config/constants.js';

/* ================================================================
   ENGINE — player position. Money moves on ticks only.
================================================================ */
export const Engine = {
  pnl(v){ const p=S.pos;
    return Math.round(p.stake * p.lev * p.dir * (v/p.entry - 1)); },
  liqIdx(p){ return p.entry * (1 - p.dir/p.lev); },
  open(dir, stake, lev){
    if (S.pos) return {ok:false, err:'POSITION OPEN'};
    if (S.balance < stake) return {ok:false, err:'INSUFFICIENT BALANCE'};
    if (S.lossLocked) return {ok:false, err:'LOSS LIMIT REACHED'};
    S.balance -= stake; S.wagered += stake;
    S.pos = { dir, stake, lev, entry:S.lastTick.v, state:'open',
              openedT: S.lastTick.t, resolveT:0 };
    feedMsg(`<b>YOU</b> <span class="${dir>0?'up':'dn'}">${dir>0?'\u25B2':'\u25BC'}</span> ${fmt$(stake)} \u00D7${lev}`, true);
    Au.click();
    return {ok:true};
  },
  requestAscent(){
    const p=S.pos; if(!p || p.state!=='open') return;
    p.state='ascending';
    p.resolveT = now() + CFG.ASCENT_MS;
    FX.startBlow();
    Au.blow();
  },
  onTick(tk){
    const p=S.pos; if(!p || p.state==='done') return;
    const liq=this.liqIdx(p);
    const crushed = p.dir>0 ? tk.v<=liq : tk.v>=liq;
    if (crushed){ this.settle(tk, true); return; }
    if (p.state==='ascending' && tk.t>=p.resolveT) this.settle(tk, false);
  },
  settle(tk, crushed){
    const p=S.pos;
    const pnl = crushed ? -p.stake : Math.max(-p.stake, this.pnl(tk.v));
    const payout = p.stake + pnl;             // ≥ 0
    S.balance += payout; S.net += pnl;
    p.state='done'; p.result={pnl, crushed, v:tk.v,
      mult: crushed?0:(payout/p.stake)};
    if (crushed){
      FX.implode(); Au.implode();
      feedMsg(`<b>YOU</b> <span class="lose">CRUSHED ${fmt$(pnl)}</span>`, true);
      toast(`CRUSHED ${fmt$(pnl)}`, 'var(--klaxon)');
    } else {
      FX.surfaceBurst(); Au.win(pnl>=0);
      const cls = pnl>=0?'win':'lose';
      feedMsg(`<b>YOU</b> surfaced <span class="${cls}">\u00D7${p.result.mult.toFixed(2)} ${pnl>=0?'+':''}${fmt$(pnl)}</span>`, true);
      toast(`SURFACED ${pnl>=0?'+':''}${fmt$(pnl)}`, pnl>=0?'var(--bio)':'var(--sodium)');
    }
    checkLossLimit();
    setTimeout(()=>{ if(S.pos && S.pos.state==='done'){ S.lastResult=S.pos.result; S.pos=null; } }, 900);
  },
  forceSettleAtRoundEnd(){
    const p=S.pos;
    if (p && p.state!=='done') this.settle(S.lastTick, false); // auto-surface (ASSUMPTION)
  }
};
