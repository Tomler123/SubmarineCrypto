import { S } from '../state/store.js';
import { $ } from '../util/dom.js';
import { now } from '../util/math.js';
import { fmt$, fmtClock } from '../util/format.js';
import { el, soundBtn } from './dom-refs.js';
import { Au } from '../audio/audio.js';
import { feedMsg } from './feed.js';
import { flashMsg } from './console.js';
import { openSheet } from './sheets.js';

$('#setLimitBtn').addEventListener('click',()=>{
  const v=parseFloat($('#lossLimitIn').value);
  if (v>0){ S.lossLimit=Math.round(v*100);
    $('#limitNote').textContent='Loss limit set: '+fmt$(S.lossLimit)+' for this session.';
    checkLossLimit(); }
});
export function refreshLimits(){
  $('#lsTime').textContent=fmtClock((now()-S.sessionStart)/1000);
  $('#lsWagered').textContent=fmt$(S.wagered);
  const n=$('#lsNet'); n.textContent=(S.net>0?'+':'')+fmt$(S.net);
  n.className=S.net>=0?'pos':'neg';
}
export function checkLossLimit(){
  if (S.lossLimit>0 && -S.net>=S.lossLimit && !S.lossLocked){
    S.lossLocked=true;
    flashMsg('LOSS LIMIT REACHED — BETTING LOCKED');
    feedMsg('<b>SYSTEM</b> session loss limit reached — betting locked', true);
  }
}
$('#rcContinue').addEventListener('click',()=>$('#rcModal').classList.remove('show'));
$('#rcLimits').addEventListener('click',()=>{ $('#rcModal').classList.remove('show');
  refreshLimits(); openSheet('#limitsSheet'); });
export function realityCheck(){
  const elapsed=now()-S.sessionStart;
  if (elapsed>=S.nextRC){
    S.nextRC+=15*60*1000;
    $('#rcTime').textContent=fmtClock(elapsed/1000);
    $('#rcWagered').textContent=fmt$(S.wagered);
    const n=$('#rcNet'); n.textContent=(S.net>0?'+':'')+fmt$(S.net);
    n.className=S.net>=0?'pos':'neg';
    $('#rcModal').classList.add('show');
  }
}
soundBtn.addEventListener('click',()=>{
  S.soundOn=!S.soundOn; Au.setMuted(!S.soundOn);
  soundBtn.style.opacity=S.soundOn?1:0.4;
});
setInterval(()=>{ el.session.textContent=fmtClock((now()-S.sessionStart)/1000);
  realityCheck(); },1000);

