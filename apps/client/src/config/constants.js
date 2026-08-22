/* ---------------- config ---------------- */
export const CFG = {
  TICK_MS: 125,           // 8 Hz feed
  DELAY_MS: 150,          // interpolation buffer delay
  ASCENT_MS: 500,         // ballast-blow cash-out delay
  ROUND_MS: 75000,        // ASSUMPTION: 75s max round
  WAIT_MS: 5000,
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
  LEV: [2,5,10,25],       // ASSUMPTION: discrete leverage set
  STAKES: [100,200,500,1000,2500,5000,10000,25000],
  START_BAL: 100000       // $1,000.00 play money
};
