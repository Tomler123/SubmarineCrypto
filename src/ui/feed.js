import { feedEl } from './dom-refs.js';

/* ================================================================
   DOM helpers — feed, history, overlays, toast
================================================================ */
export function feedMsg(html, you=false){
  const d=document.createElement('div');
  d.className='feedItem'+(you?' you':'');
  d.innerHTML=html;
  feedEl.appendChild(d);
  while (feedEl.children.length>6) feedEl.removeChild(feedEl.firstChild);
  setTimeout(()=>{ if(d.parentNode){ d.style.opacity='0'; d.style.transition='opacity .6s';
    setTimeout(()=>d.remove(), 650);} }, 9000);
}
