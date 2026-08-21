import { CFG } from '../config/constants.js';
import { S } from '../state/store.js';
import { $ } from '../util/dom.js';
import { fmt$ } from '../util/format.js';
import { overlayEl } from './dom-refs.js';

export function overlayHTML(h){ overlayEl.innerHTML=h; }
export function showSettleCard(d){
  const cls = d>=0?'pos':'neg';
  let yr='';
  const r = (S.pos&&S.pos.result)||S.lastResult;
  if (r){
    yr = `<div class="yr ${r.pnl>=0?'pos':'neg'}">${r.crushed?'You were crushed':'You surfaced'} ${r.pnl>=0?'+':''}${fmt$(r.pnl)}</div>`;
  }
  overlayHTML(`<div class="card"><h3>ROUND ${S.roundNo} SETTLED</h3>
    <div class="delta ${cls}">${d>=0?'+':''}${d.toFixed(2)}%</div>
    <div style="font-family:var(--mono);font-size:11px;opacity:.55;margin-top:4px">
      peak +${((S.roundMax/CFG.IDX0-1)*100).toFixed(1)}% \u00B7 trough ${((S.roundMin/CFG.IDX0-1)*100).toFixed(1)}%</div>${yr}</div>`);
}
let toastT=0;
export function toast(msg,color){
  const t=$('#toast'); t.textContent=msg; t.style.color=color;
  t.classList.add('show');
  clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'),1700);
}
