import { CFG } from '../config/constants.js';
import { S } from '../state/store.js';
import { $ } from '../util/dom.js';
import { fmt$ } from '../util/format.js';
import { el } from './dom-refs.js';
import { Au } from '../audio/audio.js';
import { Engine } from '../core/engine.js';
import { Gateway } from '../core/gateway.js';

/* ================================================================
   UI SYNC + INPUT
================================================================ */
export function stakeIdx(){ let best=0,bd=1e18;
  CFG.STAKES.forEach((s,i)=>{const d=Math.abs(s-S.stake); if(d<bd){bd=d;best=i;}});
  return best; }
export function setStake(v){ S.stake=v; el.stakeVal.textContent=fmt$(v); }
$('#stakeDown').addEventListener('click',()=>{ setStake(CFG.STAKES[Math.max(0,stakeIdx()-1)]); Au.click(); });
$('#stakeUp').addEventListener('click',()=>{ setStake(CFG.STAKES[Math.min(CFG.STAKES.length-1,stakeIdx()+1)]); Au.click(); });
document.querySelectorAll('.preset').forEach(b=>b.addEventListener('click',()=>{ setStake(+b.dataset.v); Au.click(); }));
document.querySelectorAll('.levOpt').forEach(b=>b.addEventListener('click',()=>{
  S.lev=+b.dataset.l;
  document.querySelectorAll('.levOpt').forEach(x=>x.classList.toggle('sel',x===b));
  Au.click();
}));
export function flashMsg(m){ el.msg.textContent=m;
  clearTimeout(flashMsg._t); flashMsg._t=setTimeout(()=>el.msg.textContent='',2200); }
export async function tryOpen(dir){
  // M1.3: a *live* position blocks re-entry, not a settled one still on screen.
  // S.pos lingers ~900ms after settlement so the wreck can be drawn; guarding on
  // its mere existence made the client enforce a rule the engine does not have
  // (EN-5 permits re-entry once a position settles). An optimistic mirror must
  // never be stricter than the authority, or Phase 2 reconciliation has nothing
  // to reconcile to. A deliberate re-entry cooldown is M1.5, as an engine rule.
  if (S.pos && S.pos.state !== 'done') return;
  if (S.lossLocked){ flashMsg('LOSS LIMIT REACHED — BETTING LOCKED'); return; }
  if (S.balance < S.stake){ flashMsg('INSUFFICIENT BALANCE'); return; }
  if (S.phase==='running'){
    const r=await Gateway.openPosition({dir, stake:S.stake, lev:S.lev});
    if (!r.ok) flashMsg(r.err);
  } else if (S.phase==='waiting'||S.phase==='launching'){
    S.armed={dir, stake:S.stake, lev:S.lev};
    el.armedTxt.innerHTML=`${dir>0?'\u25B2':'\u25BC'} ${fmt$(S.stake)} \u00D7${S.lev} — opens at launch`;
    Au.click();
  } else flashMsg('ROUND SETTLING — NEXT DIVE SOON');
}
el.btnS.addEventListener('pointerdown',()=>tryOpen(1));
el.btnD.addEventListener('pointerdown',()=>tryOpen(-1));
$('#armedCancel').addEventListener('click',()=>{ S.armed=null; });
el.btnCash.addEventListener('pointerdown',()=>{
  if (S.pos && S.pos.state==='open') Gateway.cashOut();
});

export function syncConsole(v){
  const hasPos=S.pos&&S.pos.state!=='done';
  el.betPanel.classList.toggle('hidden', !!(hasPos||S.armed));
  el.armedPanel.classList.toggle('hidden', !(S.armed&&!hasPos));
  el.cashPanel.classList.toggle('hidden', !hasPos);
  const canBet=(S.phase==='running'||S.phase==='waiting'||S.phase==='launching')
    && S.balance>=S.stake && !S.lossLocked;
  el.btnS.disabled=el.btnD.disabled=!canBet;
  if (hasPos){
    const p=S.pos;
    // M1.3: through the engine, not a second copy of the P&L formula, so the
    // live payout cannot drift from the settled figure (UI-2).
    const pnlI=Engine.pnl(v);
    const pay=p.stake+pnlI;
    el.cashAmt.textContent=fmt$(pay);
    el.cashMult.textContent=(pay/p.stake).toFixed(2)+'\u00D7';
    el.btnCash.classList.toggle('neg', pnlI<0);
    el.piLeft.innerHTML=`${p.dir>0?'\u25B2':'\u25BC'} ${fmt$(p.stake)} \u00D7${p.lev}`;
    el.piRight.textContent=`entry ${p.entry.toFixed(1)} \u00B7 crush ${Engine.liqIdx(p).toFixed(1)}`;
    if (p.state==='ascending'){
      el.btnCash.classList.add('ascending');
      el.cashLabel.textContent='BLOWING BALLAST';
    } else {
      el.btnCash.classList.remove('ascending');
      el.cashLabel.textContent='CASH OUT';
    }
  }
}
