export const clamp = (v,a,b)=> v<a?a : v>b?b : v;
export const lerp  = (a,b,f)=> a+(b-a)*f;
export const now   = ()=> performance.now();
export const wait = ms => new Promise(r=>setTimeout(r,ms));
