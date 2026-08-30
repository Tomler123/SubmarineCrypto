import { CFG } from '../config/constants.js';
import { clamp, now } from '../util/math.js';
import { rnd, gauss } from '../util/random.js';
import { IndexSourceBase } from './monotonic.js';

/* ================================================================
   FEED — SimulatedIndexSource behind the sacred IndexSource seam.
   Contract: onTick(fn) → {t,v,ret}, resetRound(), halt().
   The source self-starts its interval in the constructor and stays dormant
   until resetRound() opens a round (FEED-F5 — one surface, matching
   ARCHITECTURE.md §1; there is no start()/stop()).
   Phase 2: WsIndexSource implements the same contract; nothing
   downstream changes.

   Every constant marked SIM-ONLY below shapes the *simulated* series
   for round-level drama. None of it is part of the real-feed spec:
   a WsIndexSource carries none of it across.
================================================================ */

/* SIM-ONLY: not part of the real-feed spec — drift regimes */
const REGIME_FLIP_P = 0.06;    // per-tick chance of a new drift regime (was 0.02)
const REGIME_DECAY  = 0.985;   // per-tick drift decay (was 0.994) → ~2-8s regimes
/* SIM-ONLY: not part of the real-feed spec — anti-run pressure */
const ANTIRUN_K     = 0.15;    // pushback strength, in units of sigma
const ANTIRUN_C     = 0.02;    // cumulative-return scale (2%) of the tanh
const ANTIRUN_TICKS = 80;      // 10s of cumulative return at 8 Hz
/* SIM-ONLY: not part of the real-feed spec — volatility squalls */
const SQUALL_P_SEC  = 0.015;   // ~1.5% chance per second of entering a squall
const SQUALL_MIN_MS = 3000, SQUALL_MAX_MS = 8000;
const SQUALL_MUL_MIN = 2, SQUALL_MUL_MAX = 3;
/* SIM-ONLY: instrumentation — a "swing" is a completed 2% reversal */
const SWING_PCT = 0.02;

export class SimulatedIndexSource extends IndexSourceBase {
  constructor(){
    super();
    this.idx=CFG.IDX0;
    this.logSig=0; this.mu=0; this.ew=1; this.live=false;
    this.retHist=[];                       // SIM-ONLY: recent returns, anti-run
    this.squallTicks=0; this.squallMul=1;  // SIM-ONLY: squall state
    this._resetStats();
    this.timer=setInterval(()=>this._tick(), CFG.TICK_MS);
  }
  resetRound(){ this.idx=CFG.IDX0; this.mu=0; this.live=true;
    this.retHist.length=0; this.squallTicks=0; this.squallMul=1;
    this._resetStats();
    this._emit(0, this._openingStamp()); }
  halt(){ this.live=false; this._reportRound(); }
  _tick(){ if(this.live) this._step(); }

  /* ---- SIM-ONLY: round instrumentation ------------------------------
     Tracks max drawup/drawdown from I0 and counts completed swings of
     >= 2%: every time the series reverses by SWING_PCT from the running
     extreme of the current leg, that leg is closed and counted. */
  _resetStats(){
    this.stMaxUp=0; this.stMaxDn=0;
    this.stSwings=0; this.stLegDir=0; this.stLegExt=CFG.IDX0;
  }
  _updateStats(){
    const r = this.idx/CFG.IDX0 - 1;
    if (r>this.stMaxUp) this.stMaxUp=r;
    if (r<this.stMaxDn) this.stMaxDn=r;
    /* Leg tracking: hold the current leg's extreme; a swing completes when
       the series retraces >= SWING_PCT from it and the leg flips. The
       opening leg (dir 0) only establishes direction — it is not a swing. */
    if (this.stLegDir===0){
      if (r >= SWING_PCT){ this.stLegDir=1; this.stLegExt=this.idx; }
      else if (r <= -SWING_PCT){ this.stLegDir=-1; this.stLegExt=this.idx; }
      return;
    }
    if (this.stLegDir>0){
      if (this.idx>this.stLegExt) this.stLegExt=this.idx;
      if (this.idx/this.stLegExt-1 <= -SWING_PCT){
        this.stSwings++; this.stLegDir=-1; this.stLegExt=this.idx; }
    } else {
      if (this.idx<this.stLegExt) this.stLegExt=this.idx;
      if (this.idx/this.stLegExt-1 >= SWING_PCT){
        this.stSwings++; this.stLegDir=1; this.stLegExt=this.idx; }
    }
  }
  _reportRound(){
    console.log(
      `[sim] round end — drawup ${(this.stMaxUp*100).toFixed(2)}% · `+
      `drawdown ${(this.stMaxDn*100).toFixed(2)}% · `+
      `swings>=${(SWING_PCT*100).toFixed(0)}% ${this.stSwings}`);
  }

  _step(){
    // volatility clustering (log-vol OU) + drift regimes + whale jumps
    this.logSig += 0.06*(0-this.logSig) + 0.30*gauss();
    let sig = Math.exp(clamp(this.logSig,-1.4,1.6));

    /* SIM-ONLY: volatility squalls — short bursts of 2-3x sigma, then release */
    if (this.squallTicks>0){ this.squallTicks--; }
    else if (rnd() < SQUALL_P_SEC*(CFG.TICK_MS/1000)){
      this.squallTicks = Math.round(
        (SQUALL_MIN_MS + rnd()*(SQUALL_MAX_MS-SQUALL_MIN_MS))/CFG.TICK_MS);
      this.squallMul = SQUALL_MUL_MIN + rnd()*(SQUALL_MUL_MAX-SQUALL_MUL_MIN);
    }
    if (this.squallTicks>0) sig *= this.squallMul;

    /* SIM-ONLY: drift regimes flip more often and decay faster, so a 90s
       round contains several reversals instead of one dominant run. */
    if (rnd()<REGIME_FLIP_P) this.mu = (rnd()-0.5)*1.8;
    this.mu *= REGIME_DECAY;

    let z = gauss()*sig + this.mu*0.16;
    if (rnd()<0.006) z += (rnd()<0.5?-1:1)*(2+rnd()*3)*sig;   // whale print

    /* SIM-ONLY: anti-run pressure — a long one-way run attracts pushback
       proportional to tanh(cumRet10s / c), but never a hard reversal, so
       genuine runs remain possible. Applied to the raw return, before
       vol-normalisation, so the normaliser still sees it. */
    let cum=0; for (const r of this.retHist) cum+=r;
    z -= ANTIRUN_K*sig*Math.tanh(cum/ANTIRUN_C);

    this.ew = Math.sqrt(0.94*this.ew*this.ew + 0.06*z*z) || 1;
    const ret = clamp(z/this.ew,-3.2,3.2)*CFG.TICK_VOL;       // vol-normalised
    this.retHist.push(ret);
    if (this.retHist.length>ANTIRUN_TICKS) this.retHist.shift();
    this.idx *= (1+ret);
    this._updateStats();
    this._emit(ret);
  }
  /* FEED-F3 — the OPENING tick may not reuse a spent timestamp.

     `resetRound()` emits synchronously, stamped with the clock reading of that
     moment. The round's final scheduled tick has already used that reading, so
     a bare `now()` duplicated one timestamp at every round boundary — 99
     duplicates across 100 rounds, and a `(q.t - p.t)` division by zero waiting
     for any consumer that interpolates across the pair.

     Fixed at the source rather than left to the gate, because the boundary tick
     is a legitimate tick that must be DELIVERED, not rejected: it re-bases the
     index to I0 and opens the round.

     The stamp goes strictly BETWEEN the spent reading and the next scheduled
     tick, not forward onto it. Landing on `_lastT + TICK_MS` would claim the
     slot the still-running interval is about to fire into, and that scheduled
     tick would then be rejected as the duplicate — trading a duplicated
     timestamp for a dropped one, which is strictly worse: a duplicate is a bad
     divisor, a drop is a missing price. Half an interval is the natural
     midpoint, is representable in float without loss at these magnitudes, and
     leaves the round's scheduled cadence untouched.

     Deliberately scoped to the round opening and nowhere else. An unconditional
     nudge in `_emit` would hand every emission a fresh timestamp on demand,
     which is precisely the guarantee FI-8 exists to withhold: it would make the
     monotonicity gate unreachable and a genuinely stale tick indistinguishable
     from a boundary. Scheduled ticks stamp the raw clock and face the gate like
     any other source's would.

     Under a live clock the reading has already moved past `_lastT` by the time
     a round opens, so `now()` wins and this is a no-op. It binds only when two
     emissions land inside one reading — the fake-timer case here, and the
     replay-from-file case in M1.6. */
  _openingStamp(){
    const t = now();
    if (!Number.isFinite(this._lastT)) return t;
    return Math.max(t, this._lastT + CFG.TICK_MS / 2);
  }
  _emit(ret, t = now()){
    this._publish({ t, v: this.idx, ret });
  }
}
