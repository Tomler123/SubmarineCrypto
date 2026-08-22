import { CFG } from '../config/constants.js';
import { S } from '../state/store.js';
import { $ } from '../util/dom.js';
import { fmt$ } from '../util/format.js';
import { el } from './dom-refs.js';
import { Au } from '../audio/audio.js';
import { Engine } from '../core/engine.js';
import { Gateway } from '../core/gateway.js';
import { entryOpen, entrySecondsLeft } from '../core/entry-window.js';

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
    // Not re-checked here beyond the disabled button: the Gateway asks EN-1 at
    // ack time and the engine owns the rejection, so a tap that races the cutoff
    // gets the engine's answer rather than a second, differently-timed client
    // opinion. The mirror must never be stricter than the authority (ADR 0002).
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
  // EN-1: during `running` the window is the cutoff; `waiting`/`launching` arm
  // a bet for launch, which is inside the window by construction.
  const windowOpen = S.phase==='running' ? entryOpen() : true;
  const canBet=(S.phase==='running'||S.phase==='waiting'||S.phase==='launching')
    && windowOpen && S.balance>=S.stake && !S.lossLocked;
  el.btnS.disabled=el.btnD.disabled=!canBet;
  // The last 10s get a visible countdown rather than a silently dead button —
  // the cutoff is a rule to play around, not a glitch to notice.
  if (!hasPos && !S.armed && S.phase==='running'){
    const left = entrySecondsLeft();
    el.hatch.textContent = left<=0 ? 'HATCH SEALED · NO NEW DIVES'
      : left<=10 ? `HATCH SEALS IN ${left.toFixed(1)}S` : '';
  } else if (el.hatch.textContent) el.hatch.textContent='';
  if (hasPos){
    const p=S.pos;
    // M1.3: through the engine, not a second copy of the P&L formula, so the
    // live payout cannot drift from the settled figure (UI-2).
    const pnlI=Engine.pnl(v);
    const pay=p.stake+pnlI;
    el.cashAmt.textContent=fmt$(pay);
    el.cashMult.textContent=(pay/p.stake).toFixed(2)+'\u00D7';
    el.btnCash.classList.toggle('neg', pnlI<0);
    // O2 bar (UI-4): the engine's own oxygen fraction for this position, so the
    // bar depicts the same theta and tau the multiplier above it is paying.
    const o2=Engine.oxygen(p);
    el.o2Fill.style.width=(o2*100).toFixed(2)+'%';
    el.btnCash.classList.toggle('lowO2', o2<0.35);
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
