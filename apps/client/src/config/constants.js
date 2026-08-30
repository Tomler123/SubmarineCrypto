/* ---------------- config ---------------- */
export const CFG = {
  TICK_MS: 125,           // 8 Hz feed
  DELAY_MS: 150,          // interpolation buffer delay
  ASCENT_MS: 500,         // ballast-blow cash-out delay
  ROUND_MS: 90000,        // 90s round — parameter sheet §12, RL-2
  ENTRY_CUTOFF_MS: 5000,  // no new positions in the last 5s (T−5s, EN-1)
  WAIT_MS: 8000,          // 8s intermission — parameter sheet §12, RL-2
  TICK_S: 0.125,          // seconds per authoritative tick; tau = ticks × this
  THETA_PER_S: 0.0025,    // oxygen: 0.25%/s, the sole house edge (§5, PL-2).
                          // The one business dial — everything else here is
                          // audit-locked. M1.7 replaces it with a calibrated
                          // value; Phase 2 serves it as remote config.
  LAUNCH_MS: 1400,
  ENDING_MS: 900,
  SETTLE_MS: 4200,
  IDX0: 1000,
  TICK_VOL: 0.0042,       // volatility-normalised per-tick target
  SCROLL: 26,             // px/s horizontal travel
  BASE_DEPTH: 2000,       // metres at IDX0 (presentation only)
  DEPTH_K: 5200,          // metres per natural log unit of I/I0 (presentation only)
  DEPTH_MIN: -500,        // numeric safety clamp only — not a playable boundary
  DEPTH_MAX: 30000,
  MAX_WIN_MULT: 50,       // max win 50x stake (AO-5, PL-4, parameter sheet §12)
  MAX_WIN_CENTS: 1000000, // and $10,000 absolute, per position. The payout is
                          // clamped to min(the two) at settlement — on every
                          // reason, not only an AO-5 auto-surface.
  LEV: [2,5,10,25],       // ASSUMPTION: discrete leverage set
  STAKES: [100,200,500,1000,2500,5000,10000,25000],
  START_BAL: 100000       // $1,000.00 play money
};
