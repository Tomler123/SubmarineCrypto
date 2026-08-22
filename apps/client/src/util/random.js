import { lerp } from './math.js';

export let _seed = 987654321;
export function rnd(){ _seed=(_seed*1664525+1013904223)>>>0; return _seed/4294967296; }
export function gauss(){ let u=0,v=0; while(!u)u=rnd(); while(!v)v=rnd();
  return Math.sqrt(-2*Math.log(u))*Math.cos(6.28318530718*v); }
export const fract = x => x - Math.floor(x);
export let RSEED = 7;
export function hash1(i){ return fract(Math.sin(i*127.1 + RSEED)*43758.5453123); }
export function noise1(x){ const i=Math.floor(x), f=x-i, u=f*f*(3-2*f);
  return lerp(hash1(i), hash1(i+1), u); }
/* RSEED is written by the round state machine (setPhase). ES module live
   bindings are read-only at the importer, so the write must go through this
   setter; every read site keeps importing RSEED directly and is unchanged. */
export function setRSEED(v){ RSEED = v; }
