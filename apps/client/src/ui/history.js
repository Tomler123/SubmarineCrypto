import { histEl } from './dom-refs.js';

export function pushHistory(d){
  const c=document.createElement('span');
  const cls = d>0.15?'pos': d<-0.15?'neg':'flat';
  c.className='chip '+cls;
  c.textContent=(d>0?'+':'')+d.toFixed(1)+'%';
  histEl.prepend(c);
  while (histEl.children.length>14) histEl.removeChild(histEl.lastChild);
}
