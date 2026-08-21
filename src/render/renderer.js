import { CFG } from '../config/constants.js';
import { S } from '../state/store.js';
import { $ } from '../util/dom.js';
import { clamp, lerp, now } from '../util/math.js';
import { rnd, noise1 } from '../util/random.js';
import { fmt$ } from '../util/format.js';
import { buffer } from '../feed/index.js';
import { Engine } from '../core/engine.js';
import { Au } from '../audio/audio.js';
import { colAt, rgb } from './palette.js';

/* ================================================================
   RENDERER — Canvas 2D scene. (→ PixiJS module in the real repo.)
================================================================ */
const wrap=$('#sceneWrap'), cv=$('#scene'), ctx=cv.getContext('2d');
let W=0,H=0,DPRq=Math.min(window.devicePixelRatio||1,2);
export function resize(){
  W=wrap.clientWidth; H=wrap.clientHeight;
  cv.width=Math.round(W*DPRq); cv.height=Math.round(H*DPRq);
  ctx.setTransform(DPRq,0,0,DPRq,0,0);
}
window.addEventListener('resize', resize);

export const trail=[];               // {t, v} — recorded path; terrain derives from it
export const view={ cam:CFG.BASE_DEPTH, pxm:0.5, shake:0, flash:0, dim:0, shear:0 };
export const FX={
  debris:[], rings:[], snow:[], bubbles:[], creatures:[],
  pod:null, sweep:0, pingR:-1, pingT:0, creatT:8000,
  roundReset(){ this.debris.length=0; this.rings.length=0; this.pod=null;
    lastV=CFG.IDX0; },
  startBlow(){
    const p=S.pos; if(!p) return;
    this.pod={x:SUBX(), y:lastSubY, state:'rising'};
    for(let i=0;i<26;i++) this.bubbles.push({
      x:this.pod.x+(rnd()-0.5)*14, y:this.pod.y+8,
      vx:(rnd()-0.5)*30, vy:-(60+rnd()*120), r:1+rnd()*2.6, life:1});
    view.dim=0.32;
  },
  implode(){
    const x=this.pod?this.pod.x:SUBX(), y=this.pod?this.pod.y:lastSubY;
    for(let i=0;i<40;i++){ const a=rnd()*6.283, sp=40+rnd()*220;
      this.debris.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,
        life:0.7+rnd()*0.7, size:1+rnd()*3}); }
    this.rings.push({x,y,r:4,vr:420,life:0.55});
    view.flash=0.55; view.shake=15; view.dim=0;
    this.pod=null;
  },
  surfaceBurst(){
    const x=this.pod?this.pod.x:SUBX(), y=this.pod?this.pod.y:lastSubY;
    this.rings.push({x,y,r:3,vr:260,life:0.4});
    for(let i=0;i<18;i++) this.bubbles.push({x:x+(rnd()-0.5)*10,y,
      vx:(rnd()-0.5)*50, vy:-(90+rnd()*140), r:1+rnd()*2.2, life:1});
    view.dim=0;
    this.pod=null;
  }
};
const SUBX=()=> W*0.38;
let lastSubY=0, lastSubDepth=CFG.BASE_DEPTH, lastV=CFG.IDX0, prevCam=CFG.BASE_DEPTH;

const depthOf = v => clamp(CFG.BASE_DEPTH-(v-CFG.IDX0)*CFG.M_PER_PT, -36, 4200);
const yOf = d => H*0.46 + (d-view.cam)*view.pxm;
const xOf = (t,rt) => SUBX() - (rt-t)*(CFG.SCROLL/1000);

/* quality tiers — auto-degrade for weaker devices */
let TIER=0, ftimes=[], tierLock=0;
const SNOWN=[120,72,42];
export function qualityCheck(dt){
  ftimes.push(dt); if(ftimes.length<180) return;
  const avg=ftimes.reduce((a,b)=>a+b,0)/ftimes.length; ftimes.length=0;
  if (avg>21 && TIER<2 && now()>tierLock){ TIER++; tierLock=now()+8000;
    DPRq=[Math.min(window.devicePixelRatio||1,2),1.5,1][TIER]; resize(); }
}

function ensureSnow(){
  while (FX.snow.length<SNOWN[TIER])
    FX.snow.push({x:rnd()*W, y:rnd()*H, f:0.45+rnd()*0.7,
      r:0.5+rnd()*1.4, vy:2+rnd()*7, ph:rnd()*6.28, bio:rnd()<0.28});
  if (FX.snow.length>SNOWN[TIER]) FX.snow.length=SNOWN[TIER];
}

/* ---------------- main draw ---------------- */
export function draw(t, dt){
  const rt = t - CFG.DELAY_MS;
  const active = (S.phase==='running'||S.phase==='ending');
  let v = active ? buffer.valueAt(rt) : lastV;
  if (v==null) v=CFG.IDX0;
  lastV=v;

  if (S.phase==='running'){
    const last=trail[trail.length-1];
    if(!last || rt-last.t>=24) trail.push({t:rt, v});
    while (trail.length && trail[0].t < rt-16000) trail.shift();
  }

  const launching = S.phase==='launching';
  const idle = !active && !launching;
  const bob = idle? Math.sin(t*0.0012)*10 : 0;
  const subDepth = depthOf(v)+bob;

  /* camera */
  view.cam = lerp(view.cam, subDepth, 1-Math.pow(0.0025,dt));
  let span=220;
  if (trail.length>4){
    let mn=1e9,mx=-1e9;
    for (const p of trail){ const d=depthOf(p.v); if(d<mn)mn=d; if(d>mx)mx=d; }
    span=Math.max(mx-mn+140,220);
  }
  const tgtPx = clamp(H*0.62/span, 0.14, 1.15);
  view.pxm = lerp(view.pxm, tgtPx, 1-Math.pow(0.02,dt));

  const sx = launching ? lerp(-60, SUBX(), Math.min(1,(t-S.phaseT)/CFG.LAUNCH_MS)) : SUBX();
  const sy = yOf(subDepth);
  lastSubY=sy; lastSubDepth=subDepth;

  /* tilt & velocity from recent trail slope */
  let slope=0;
  if (trail.length>3){
    const a=trail[trail.length-3], b=trail[trail.length-1];
    slope = (depthOf(b.v)-depthOf(a.v))/Math.max(b.t-a.t,1); // m per ms
  }
  const tilt = clamp(slope*view.pxm*260, -0.4, 0.4);

  /* tension: proximity to player's crush line */
  let tension=0, liqI=0, entI=0;
  if (S.pos && S.pos.state!=='done'){
    const p=S.pos; liqI=Engine.liqIdx(p); entI=p.entry;
    const span2=Math.abs(entI-liqI);
    tension = clamp(1-Math.abs(v-liqI)/(span2*0.55), 0, 1);
  }

  /* shake & shear */
  if (S.lastTick && Math.abs(S.lastTick.ret||0) > CFG.TICK_VOL*2.55 && active)
    { view.shake=Math.max(view.shake, 6); view.shear=1; }
  view.shake*=Math.pow(0.0035,dt); view.shear*=Math.pow(0.05,dt);
  view.flash*=Math.pow(0.0005,dt);
  const shx=(rnd()-0.5)*view.shake, shy=(rnd()-0.5)*view.shake;

  ctx.clearRect(0,0,W,H);
  ctx.save(); ctx.translate(shx,shy);

  /* --- water gradient by depth zones --- */
  const dTop=view.cam+(0-H*0.46)/view.pxm, dBot=view.cam+(H-H*0.46)/view.pxm;
  const g=ctx.createLinearGradient(0,0,0,H);
  for(let i=0;i<=5;i++) g.addColorStop(i/5, rgb(colAt(lerp(dTop,dBot,i/5))));
  ctx.fillStyle=g; ctx.fillRect(-20,-20,W+40,H+40);

  /* surface & sky */
  const ySurf=yOf(0);
  if (ySurf>-40){
    if (ySurf>0){
      const sk=ctx.createLinearGradient(0,0,0,ySurf);
      sk.addColorStop(0,'#B7E2EA'); sk.addColorStop(1,'#6FB3C2');
      ctx.fillStyle=sk; ctx.fillRect(-20,-20,W+40,ySurf+20);
    }
    ctx.strokeStyle='rgba(234,244,241,.7)'; ctx.lineWidth=1.6; ctx.beginPath();
    for(let x=-10;x<=W+10;x+=7){
      const wy=ySurf+Math.sin(x*0.05+t*0.004)*2.4+Math.sin(x*0.013-t*0.0022)*3.6;
      x===-10?ctx.moveTo(x,wy):ctx.lineTo(x,wy);
    }
    ctx.stroke();
  }

  /* god rays in the sunlit band */
  const sunF=clamp(1-view.cam/420,0,1);
  if (sunF>0.02 && TIER<2){
    ctx.save(); ctx.globalCompositeOperation='lighter';
    for(let i=0;i<5;i++){
      const bx=W*(0.12+i*0.2)+Math.sin(t*0.0002+i*2)*30;
      const sw=Math.sin(t*0.00013+i)*0.16;
      ctx.save(); ctx.translate(bx,Math.max(ySurf,-10)); ctx.rotate(0.16+sw);
      const rg=ctx.createLinearGradient(0,0,0,H*0.9);
      rg.addColorStop(0,`rgba(255,236,190,${0.10*sunF})`);
      rg.addColorStop(1,'rgba(255,236,190,0)');
      ctx.fillStyle=rg; ctx.fillRect(-26,0,52,H*0.9); ctx.restore();
    }
    ctx.restore();
  }

  /* creatures — far silhouettes */
  FX.creatT-=dt*1000;
  if (FX.creatT<0 && view.cam>260 && FX.creatures.length<2){
    FX.creatT=12000+rnd()*18000;
    FX.creatures.push({x:W+120, depth:view.cam+(rnd()-0.5)*700+120,
      spd:9+rnd()*16, size:26+rnd()*70, wig:rnd()*6.28});
  }
  for (let i=FX.creatures.length-1;i>=0;i--){
    const c=FX.creatures[i];
    c.x-=(CFG.SCROLL*0.5+c.spd)*dt;
    const cy=H*0.46+(c.depth-view.cam)*view.pxm*0.55+Math.sin(t*0.001+c.wig)*8;
    if (c.x<-c.size*2){ FX.creatures.splice(i,1); continue; }
    ctx.fillStyle='rgba(2,9,13,.55)';
    ctx.beginPath();
    ctx.ellipse(c.x,cy,c.size,c.size*0.3,Math.sin(t*0.0008+c.wig)*0.06,0,6.283);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(c.x+c.size*0.9,cy);
    ctx.lineTo(c.x+c.size*1.5,cy-c.size*0.3);
    ctx.lineTo(c.x+c.size*1.5,cy+c.size*0.3);
    ctx.fill();
  }

  /* marine snow / biolight motes */
  ensureSnow();
  const dCam=(view.cam-prevCam)*view.pxm; prevCam=view.cam;
  const deep=view.cam>750;
  for (const p of FX.snow){
    p.x-=CFG.SCROLL*p.f*dt + view.shear*90*dt;
    p.y+=p.vy*dt - dCam*p.f + Math.sin(t*0.001+p.ph)*0.15;
    if (p.x<-8){p.x=W+8; p.y=rnd()*H;}
    if (p.y>H+8) p.y=-8; if (p.y<-8) p.y=H+8;
    if (p.bio&&deep){
      const tw=0.35+0.65*Math.abs(Math.sin(t*0.002+p.ph*3));
      ctx.fillStyle=`rgba(76,242,192,${0.5*tw})`;
    } else ctx.fillStyle=`rgba(210,228,232,${0.16+p.f*0.12})`;
    ctx.fillRect(p.x,p.y,p.r,p.r);
  }

  /* --- terrain — generated from the recorded path only (no future) --- */
  if (trail.length>3){
    const step=Math.max(1,Math.floor(trail.length/90));
    const fpts=[],cpts=[];
    for (let i=0;i<trail.length;i+=step){
      const p=trail[i], px=xOf(p.t,rt), pd=depthOf(p.v);
      const nf=noise1(p.t*0.00042), nf2=noise1(p.t*0.0021);
      fpts.push([px, yOf(pd+250+nf*280+nf2*46)]);
      const nc=noise1(p.t*0.00038+55.5), nc2=noise1(p.t*0.0019+91.2);
      cpts.push([px, yOf(pd-270-nc*310-nc2*50)]);
    }
    ctx.fillStyle='#02070B';
    ctx.beginPath(); ctx.moveTo(fpts[0][0],fpts[0][1]);
    for(const q of fpts) ctx.lineTo(q[0],q[1]);
    ctx.lineTo(fpts[fpts.length-1][0],H+30); ctx.lineTo(fpts[0][0],H+30);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle='rgba(130,170,180,.13)'; ctx.lineWidth=1.4;
    ctx.beginPath(); for(let i=0;i<fpts.length;i++){ const q=fpts[i];
      i===0?ctx.moveTo(q[0],q[1]):ctx.lineTo(q[0],q[1]); } ctx.stroke();
    ctx.fillStyle='#02070B';
    ctx.beginPath(); ctx.moveTo(cpts[0][0],cpts[0][1]);
    for(const q of cpts) ctx.lineTo(q[0],q[1]);
    ctx.lineTo(cpts[cpts.length-1][0],-30); ctx.lineTo(cpts[0][0],-30);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle='rgba(130,170,180,.10)';
    ctx.beginPath(); for(let i=0;i<cpts.length;i++){ const q=cpts[i];
      i===0?ctx.moveTo(q[0],q[1]):ctx.lineTo(q[0],q[1]); } ctx.stroke();
  }

  /* --- the wake IS the chart --- */
  if (trail.length>2){
    ctx.lineJoin='round'; ctx.lineCap='round';
    ctx.strokeStyle='rgba(234,244,241,.08)'; ctx.lineWidth=7;
    ctx.beginPath();
    for(let i=0;i<trail.length;i++){ const p=trail[i];
      const px=xOf(p.t,rt), py=yOf(depthOf(p.v));
      i===0?ctx.moveTo(px,py):ctx.lineTo(px,py); }
    ctx.lineTo(sx,sy); ctx.stroke();
    ctx.strokeStyle='rgba(255,180,84,.8)'; ctx.lineWidth=1.8; ctx.stroke();
  }

  /* bubbles */
  for (let i=FX.bubbles.length-1;i>=0;i--){
    const b=FX.bubbles[i];
    b.x+=b.vx*dt - CFG.SCROLL*dt*0.7; b.y+=b.vy*dt - dCam;
    b.vy-=40*dt; b.life-=dt*0.8;
    if (b.life<=0||b.y<-10){FX.bubbles.splice(i,1);continue;}
    ctx.strokeStyle=`rgba(214,240,240,${0.5*b.life})`;
    ctx.lineWidth=1;
    ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,6.283); ctx.stroke();
  }
  if (active && rnd()<dt*22){ // prop wash
    FX.bubbles.push({x:sx-30,y:sy+(rnd()-0.5)*8,vx:-20-rnd()*20,
      vy:-(8+rnd()*25),r:0.7+rnd()*1.6,life:0.9});
  }

  /* --- murk of the future: everything ahead resolves out of gloom --- */
  const mg=ctx.createLinearGradient(sx-30,0,W,0);
  mg.addColorStop(0,'rgba(1,6,9,0)');
  mg.addColorStop(clamp(120/(W-sx+30),0,1),'rgba(1,6,9,.55)');
  mg.addColorStop(1,'rgba(1,6,9,.94)');
  ctx.fillStyle=mg; ctx.fillRect(sx-30,-20,W-sx+50,H+40);

  /* sonar sweep + ping (cosmetic — reveals nothing real) */
  if (active && TIER<2){
    ctx.save(); ctx.globalCompositeOperation='lighter';
    const sa=Math.sin(t*0.0012)*0.5+tilt*0.6;
    const nx=sx+Math.cos(tilt)*30, ny=sy+Math.sin(tilt)*30;
    ctx.strokeStyle='rgba(120,230,205,.20)'; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(nx,ny);
    ctx.lineTo(nx+Math.cos(sa)*200, ny+Math.sin(sa)*200); ctx.stroke();
    FX.pingT-=dt*1000;
    if (FX.pingT<0){ FX.pingT=2800+rnd()*1200; FX.pingR=0;
      if(view.cam>380) Au.ping(); }
    if (FX.pingR>=0){
      FX.pingR+=dt*260;
      if (FX.pingR>260) FX.pingR=-1;
      else { ctx.strokeStyle=`rgba(120,230,205,${0.3*(1-FX.pingR/260)})`;
        ctx.beginPath(); ctx.arc(nx,ny,FX.pingR,-0.9+tilt,0.9+tilt); ctx.stroke(); }
    }
    ctx.restore();
  }

  /* headlight cone re-lights the water just ahead */
  if (!idle){
    ctx.save(); ctx.globalCompositeOperation='lighter';
    const nx=sx+Math.cos(tilt)*32, ny=sy+Math.sin(tilt)*32;
    const rg=ctx.createRadialGradient(nx,ny,4,nx,ny,210);
    rg.addColorStop(0,'rgba(255,214,150,.17)');
    rg.addColorStop(1,'rgba(255,214,150,0)');
    ctx.fillStyle=rg;
    ctx.beginPath(); ctx.moveTo(nx,ny);
    ctx.arc(nx,ny,210,tilt-0.34,tilt+0.34); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /* entry & crush lines — always readable */
  if (S.pos && S.pos.state!=='done'){
    const ey=yOf(depthOf(entI)), ly=yOf(depthOf(liqI));
    ctx.setLineDash([5,5]);
    ctx.strokeStyle='rgba(255,180,84,.6)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(0,ey); ctx.lineTo(W,ey); ctx.stroke();
    ctx.strokeStyle='rgba(255,75,51,.75)';
    ctx.beginPath(); ctx.moveTo(0,ly); ctx.lineTo(W,ly); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font='10px '+'"IBM Plex Mono",monospace';
    ctx.fillStyle='rgba(255,180,84,.85)';
    ctx.fillText('ENTRY '+entI.toFixed(1), 8, ey-4);
    ctx.fillStyle='rgba(255,75,51,.9)';
    ctx.fillText('CRUSH '+liqI.toFixed(1), 8, ly-4);
    const zg=ctx.createLinearGradient(0,ly,0,ly+(S.pos.dir>0?46:-46));
    zg.addColorStop(0,'rgba(255,75,51,.16)'); zg.addColorStop(1,'rgba(255,75,51,0)');
    ctx.fillStyle=zg;
    ctx.fillRect(0,Math.min(ly,ly+(S.pos.dir>0?46:-46)),W,46);
  }

  /* the submarine — shared index vessel */
  if (!(S.phase==='waiting'&&(t-S.phaseT)<400)){
    drawSub(sx,sy,tilt,tension,t,active);
  }

  /* your pod — clamped, rising, or gone */
  if (S.pos && S.pos.state==='open'){
    drawPod(sx+3+Math.sin(tilt)*-14, sy+15, S.pos.dir, t);
  } else if (FX.pod){
    FX.pod.x-=CFG.SCROLL*dt*0.45;
    FX.pod.y-=(92/(CFG.ASCENT_MS/1000))*dt*0.001*1000; // 92px over ascent
    drawPod(FX.pod.x,FX.pod.y,S.pos?S.pos.dir:1,t);
    if (rnd()<dt*40) FX.bubbles.push({x:FX.pod.x+(rnd()-0.5)*8,y:FX.pod.y+8,
      vx:(rnd()-0.5)*20,vy:-(70+rnd()*90),r:0.8+rnd()*1.8,life:1});
    if (S.pos && S.pos.state==='ascending'){
      const pnlI=Math.max(-S.pos.stake, Math.round(S.pos.stake*S.pos.lev*S.pos.dir*(v/S.pos.entry-1)));
      ctx.font='600 13px "IBM Plex Mono",monospace';
      ctx.fillStyle=pnlI>=0?'#4CF2C0':'#FF4B33';
      ctx.fillText(fmt$(S.pos.stake+pnlI), FX.pod.x+14, FX.pod.y-8);
    }
  }

  /* debris + shock rings */
  for (let i=FX.debris.length-1;i>=0;i--){
    const d=FX.debris[i];
    d.x+=d.vx*dt; d.y+=d.vy*dt+20*dt; d.vx*=0.985; d.vy*=0.985; d.life-=dt;
    if(d.life<=0){FX.debris.splice(i,1);continue;}
    ctx.fillStyle=`rgba(255,140,90,${Math.min(1,d.life)})`;
    ctx.fillRect(d.x,d.y,d.size,d.size);
  }
  for (let i=FX.rings.length-1;i>=0;i--){
    const r=FX.rings[i]; r.r+=r.vr*dt; r.life-=dt;
    if(r.life<=0){FX.rings.splice(i,1);continue;}
    ctx.strokeStyle=`rgba(234,244,241,${r.life})`; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(r.x,r.y,r.r,0,6.283); ctx.stroke();
  }

  ctx.restore(); // shake

  /* dim during the Blow */
  if (view.dim>0.005){
    ctx.fillStyle=`rgba(1,4,7,${view.dim})`; ctx.fillRect(0,0,W,H);
    view.dim=S.pos&&S.pos.state==='ascending'?view.dim:view.dim*Math.pow(0.001,dt);
  }
  /* implosion flash */
  if (view.flash>0.01){ ctx.fillStyle=`rgba(255,244,230,${view.flash})`;
    ctx.fillRect(0,0,W,H); }

  /* vignette + pressure warning */
  const vg=ctx.createRadialGradient(W/2,H*0.45,H*0.35,W/2,H*0.5,H*0.85);
  vg.addColorStop(0,'rgba(0,0,0,0)'); vg.addColorStop(1,'rgba(0,2,4,.42)');
  ctx.fillStyle=vg; ctx.fillRect(0,0,W,H);
  if (tension>0.08){
    const pulse=tension*0.26*(0.6+0.4*Math.sin(t*0.012));
    const wg=ctx.createRadialGradient(W/2,H*0.45,H*0.3,W/2,H*0.5,H*0.8);
    wg.addColorStop(0,'rgba(255,75,51,0)'); wg.addColorStop(1,`rgba(255,75,51,${pulse})`);
    ctx.fillStyle=wg; ctx.fillRect(0,0,W,H);
    if (rnd()<dt*tension*3.2) Au.creak(tension);
    if (tension>0.6) view.shake=Math.max(view.shake, tension*3);
  }

  Au.droneUpdate(view.cam, tension);
  return {v, tension};
}

function drawSub(x,y,tilt,tension,t,active){
  const sc=Math.min(W/430,1.15);
  const jx=(rnd()-0.5)*4*tension, jy=(rnd()-0.5)*4*tension;
  ctx.save(); ctx.translate(x+jx,y+jy); ctx.rotate(tilt*0.55); ctx.scale(sc,sc);
  /* propeller */
  ctx.save(); ctx.translate(-36,0); ctx.rotate(active?t*0.02:t*0.004);
  ctx.fillStyle='rgba(160,190,196,.75)';
  for(let i=0;i<3;i++){ ctx.rotate(2.094);
    ctx.beginPath(); ctx.ellipse(0,-6,2.4,6.5,0,0,6.283); ctx.fill(); }
  ctx.restore();
  /* hull */
  const hg=ctx.createLinearGradient(0,-14,0,14);
  hg.addColorStop(0,'#2E4048'); hg.addColorStop(0.55,'#16262D'); hg.addColorStop(1,'#0A151A');
  ctx.fillStyle=hg;
  ctx.beginPath(); ctx.ellipse(0,0,34,12.5,0,0,6.283); ctx.fill();
  ctx.strokeStyle='rgba(255,180,84,.14)'; ctx.lineWidth=1; ctx.stroke();
  /* tower */
  ctx.fillStyle='#1B2C33';
  ctx.beginPath();
  ctx.moveTo(-8,-11); ctx.lineTo(-5,-19); ctx.lineTo(7,-19); ctx.lineTo(10,-11);
  ctx.closePath(); ctx.fill();
  /* fins */
  ctx.fillStyle='#152329';
  ctx.beginPath(); ctx.moveTo(-30,-4); ctx.lineTo(-40,-9); ctx.lineTo(-33,0); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-30,4); ctx.lineTo(-40,9); ctx.lineTo(-33,0); ctx.closePath(); ctx.fill();
  /* rivet line */
  ctx.fillStyle='rgba(190,214,218,.25)';
  for(let i=-24;i<=24;i+=8) ctx.fillRect(i,-1,1.6,1.6);
  /* portholes */
  for (const px of [-14,-2,10]){
    ctx.fillStyle='rgba(255,180,84,.22)';
    ctx.beginPath(); ctx.arc(px,2,4.4,0,6.283); ctx.fill();
    ctx.fillStyle='#FFB454';
    ctx.beginPath(); ctx.arc(px,2,2,0,6.283); ctx.fill();
  }
  /* nose lamp */
  ctx.fillStyle='rgba(255,226,170,.95)';
  ctx.beginPath(); ctx.arc(31,0,2.6,0,6.283); ctx.fill();
  /* warning lamp */
  if (tension>0.4 && Math.sin(t*(0.012+tension*0.02))>0){
    ctx.fillStyle='#FF4B33';
    ctx.beginPath(); ctx.arc(1,-21,2.6,0,6.283); ctx.fill();
    ctx.fillStyle='rgba(255,75,51,.3)';
    ctx.beginPath(); ctx.arc(1,-21,7,0,6.283); ctx.fill();
  }
  ctx.restore();
}
function drawPod(x,y,dir,t){
  ctx.save(); ctx.translate(x,y);
  const c = dir>0 ? '#4CF2C0' : '#9FC4D8';
  ctx.fillStyle='#101E24';
  ctx.beginPath(); ctx.ellipse(0,0,6.5,9,0,0,6.283); ctx.fill();
  ctx.strokeStyle=c; ctx.lineWidth=1.4; ctx.stroke();
  ctx.fillStyle=c;
  ctx.beginPath(); ctx.arc(0,-2,2,0,6.283); ctx.fill();
  ctx.restore();
}

/* lastSubDepth is renderer-private (written by draw). The main loop reads it
   once per frame for the HUD depth/zone readout; ES module live bindings make
   an imported read safe, but this accessor keeps the write site private. */
export const getLastSubDepth = ()=> lastSubDepth;
