import { clamp, lerp } from '../util/math.js';


/* water colour by depth — the depth zones.
   Rebased for the logarithmic depth mapping (BASE_DEPTH 2000m at I0,
   DEPTH_K 5200): a typical round now sits in the 1400–2600m range and
   traverses several keys, where the old linear scale parked it in one. */
export const ZK=[[0,[24,98,115]],[450,[15,61,73]],[900,[9,38,48]],[1800,[4,18,26]],[3200,[2,10,15]],[5200,[1,5,10]]];
export function colAt(d){
  d=clamp(d,0,5200);
  for(let i=0;i<ZK.length-1;i++){
    if(d<=ZK[i+1][0]){
      const f=(d-ZK[i][0])/(ZK[i+1][0]-ZK[i][0]);
      const a=ZK[i][1], b=ZK[i+1][1];
      return [lerp(a[0],b[0],f),lerp(a[1],b[1],f),lerp(a[2],b[2],f)];
    }
  }
  return ZK[ZK.length-1][1];
}
export const rgb=(c,a=1)=>`rgba(${c[0]|0},${c[1]|0},${c[2]|0},${a})`;
export function zoneName(d){ return d<900?'SUNLIT':d<1800?'TWILIGHT':d<3200?'MIDNIGHT':'ABYSS'; }
