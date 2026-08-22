export const fmt$ = c => (c<0?'\u2212$':'$') +
  (Math.abs(c)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
export const fmtClock = s => String(Math.floor(s/60)).padStart(2,'0')+':'+String(Math.floor(s%60)).padStart(2,'0');
