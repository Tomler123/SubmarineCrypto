import { $ } from '../util/dom.js';
import { scrim } from './dom-refs.js';
import { refreshLimits } from './responsible.js';

/* sheets / modal */
export function openSheet(id){ scrim.classList.add('show'); $(id).classList.add('show'); }
export function closeSheets(){ scrim.classList.remove('show');
  document.querySelectorAll('.sheet').forEach(s=>s.classList.remove('show')); }
scrim.addEventListener('click',closeSheets);
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',closeSheets));
$('#limitsBtn').addEventListener('click',()=>{ refreshLimits(); openSheet('#limitsSheet'); });
$('#mathBtn').addEventListener('click',()=>openSheet('#mathSheet'));
