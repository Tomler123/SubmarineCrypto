import { describe, expect, it, beforeEach } from 'vitest';
import { InterpBuffer } from '../src/feed/InterpBuffer.js';
import { CFG } from '../src/config/constants.js';

/* ================================================================
   INTERP BUFFER — invariant 3 and UI-2.

   The buffer is presentation: ticks are authoritative, and the 60 fps sample
   is a smoothed read of the past. Invariant 3 is the reason it exists — the
   interpolated value may drive visuals and live readouts and never a balance
   change — and the mechanism that makes it safe is the DELAY_MS lag. The
   caller passes `rt = now - DELAY_MS`, so the buffer is only ever asked about
   a moment it already has both ends of.

   That places the load-bearing property here: for a real playing time `t`, the
   value returned must never be newer than `t − 150 ms`. If the buffer ever
   returned a sample derived from a tick in `(t − 150, t]`, the player would be
   seeing the present rather than the delayed past, and invariant 8 ("never see
   the future") would be one refactor away from breaking.

   This file has no DOM and no mocks: InterpBuffer imports only `clamp`.
================================================================ */

const DELAY = CFG.DELAY_MS;
const TICK = CFG.TICK_MS;

/** A tick series starting at `t0`, one every TICK ms, value `f(n)`. */
function series(count, f, t0 = 0){
  return Array.from({ length: count }, (_, n) => ({ t: t0 + n * TICK, v: f(n) }));
}

/** The read the client actually performs at wall-clock `t`. */
const readAt = (buf, t) => buf.valueAt(t - DELAY);

let buf;
beforeEach(() => { buf = new InterpBuffer(); });

describe('the 150 ms delay (invariant 3, UI-2)', () => {
  it('never returns a value newer than now − 150 ms', () => {
    // A strictly increasing series makes "newer" directly readable off the
    // value: any sample above v(t − 150) is a sample from the future.
    const ticks = series(60, n => 1000 + n);
    for (const tk of ticks) buf.push(tk);

    for (let t = DELAY; t <= ticks[ticks.length - 1].t; t += 7){
      const got = readAt(buf, t);
      const horizon = t - DELAY;
      // The newest tick at or before the horizon bounds what may be returned.
      const newest = ticks.filter(k => k.t <= horizon).at(-1);
      const next = ticks.find(k => k.t > horizon);
      const ceiling = next ? next.v : newest.v;
      expect(got, `t=${t}`).toBeLessThanOrEqual(ceiling);
      // And it must not have run ahead of the live value at all.
      const live = ticks.filter(k => k.t <= t).at(-1);
      expect(got, `t=${t} must lag the live tick`).toBeLessThanOrEqual(live.v);
    }
  });

  it('lags the live value by roughly one delay window once running', () => {
    const ticks = series(80, n => 1000 + n);
    for (const tk of ticks) buf.push(tk);
    const t = ticks[60].t;
    const got = readAt(buf, t);
    const live = 1000 + 60;
    // 150 ms at 8 Hz is 1.2 ticks, and each tick moves the value by 1.
    expect(live - got).toBeGreaterThan(0.5);
    expect(live - got).toBeLessThan(3);
  });

  it('interpolates strictly between the bracketing ticks, never outside them', () => {
    buf.push({ t: 0, v: 1000 });
    buf.push({ t: TICK, v: 1010 });
    for (let rt = 0; rt <= TICK; rt += 5){
      const v = buf.valueAt(rt);
      expect(v).toBeGreaterThanOrEqual(1000);
      expect(v).toBeLessThanOrEqual(1010);
    }
    // Smoothstep, so the endpoints are exact.
    expect(buf.valueAt(0)).toBe(1000);
    expect(buf.valueAt(TICK)).toBe(1010);
    // and the midpoint is the midpoint.
    expect(buf.valueAt(TICK / 2)).toBeCloseTo(1005, 9);
  });
});

describe('degenerate inputs', () => {
  it('returns null on an empty buffer rather than throwing or guessing', () => {
    expect(buf.valueAt(0)).toBe(null);
    expect(buf.valueAt(12345)).toBe(null);
  });

  it('clamps to the first tick when asked about a time before the buffer starts', () => {
    buf.push({ t: 1000, v: 1000 });
    buf.push({ t: 1000 + TICK, v: 1005 });
    expect(buf.valueAt(0)).toBe(1000);
    expect(buf.valueAt(999)).toBe(1000);
    expect(buf.valueAt(1000)).toBe(1000);
  });

  it('holds the last tick when asked about a time past the end — never extrapolates', () => {
    // This is the invariant-8 case: with no next tick to bracket against, the
    // only safe answer is the last known value. Extrapolating the trend would
    // literally be showing the player a price that does not exist yet.
    const ticks = series(5, n => 1000 + n * 10);
    for (const tk of ticks) buf.push(tk);
    const last = ticks.at(-1);
    expect(buf.valueAt(last.t)).toBe(last.v);
    expect(buf.valueAt(last.t + 1)).toBe(last.v);
    expect(buf.valueAt(last.t + 60_000)).toBe(last.v);
  });

  it('reset() empties it back to the null answer', () => {
    for (const tk of series(10, n => 1000 + n)) buf.push(tk);
    expect(buf.valueAt(TICK)).not.toBe(null);
    buf.reset();
    expect(buf.valueAt(TICK)).toBe(null);
  });
});

describe('a gap in the feed', () => {
  it('interpolates across the gap without overshooting either end', () => {
    // 2 s of missing ticks — a stall well short of MF-1's outage threshold.
    buf.push({ t: 0, v: 1000 });
    buf.push({ t: 2000, v: 1100 });
    for (let rt = 0; rt <= 2000; rt += 25){
      const v = buf.valueAt(rt);
      expect(v).toBeGreaterThanOrEqual(1000);
      expect(v).toBeLessThanOrEqual(1100);
    }
    expect(buf.valueAt(0)).toBe(1000);
    expect(buf.valueAt(2000)).toBe(1100);
    expect(buf.valueAt(1000)).toBeCloseTo(1050, 9);
  });

  it('a resumed feed after a gap still reads monotonically in time', () => {
    buf.push({ t: 0, v: 1000 });
    buf.push({ t: 3000, v: 1000 });
    for (const tk of series(10, n => 1000 + n, 3000 + TICK)) buf.push(tk);
    let prev = -Infinity;
    for (let rt = 0; rt <= 4000; rt += 20){
      const v = buf.valueAt(rt);
      expect(Number.isFinite(v), `rt=${rt}`).toBe(true);
      // Values are non-decreasing here by construction of the series, so a
      // decrease would mean the scan picked the wrong bracket.
      expect(v, `rt=${rt}`).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });

  it('handles two ticks sharing a timestamp without producing NaN', () => {
    // A duplicate timestamp makes the interpolation fraction 0/0. clamp()
    // turns NaN into... NaN, so this documents what actually happens: the
    // guard is that the reverse scan picks the later of the two, whose own
    // next tick has a positive interval.
    buf.push({ t: 0, v: 1000 });
    buf.push({ t: TICK, v: 1010 });
    buf.push({ t: TICK, v: 1012 });
    buf.push({ t: 2 * TICK, v: 1020 });
    for (let rt = 0; rt <= 2 * TICK; rt += 5){
      const v = buf.valueAt(rt);
      expect(Number.isNaN(v), `rt=${rt} produced NaN`).toBe(false);
    }
  });
});

describe('out-of-order arrivals', () => {
  it('a late tick inserted out of order still yields finite, bracketed values', () => {
    // push() appends unconditionally — it does not sort. A source that
    // delivered a tick late would leave `a` non-monotonic in t, and the
    // reverse scan then brackets against whatever it finds first. This asserts
    // the weak property that survives that: no NaN, no null, and every answer
    // inside the range of values actually pushed.
    buf.push({ t: 0, v: 1000 });
    buf.push({ t: 2 * TICK, v: 1020 });
    buf.push({ t: TICK, v: 1010 });      // arrives late
    buf.push({ t: 3 * TICK, v: 1030 });

    const values = [1000, 1010, 1020, 1030];
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    for (let rt = 0; rt <= 3 * TICK; rt += 5){
      const v = buf.valueAt(rt);
      expect(v, `rt=${rt}`).not.toBe(null);
      expect(Number.isNaN(v), `rt=${rt} produced NaN`).toBe(false);
      expect(v, `rt=${rt}`).toBeGreaterThanOrEqual(lo);
      expect(v, `rt=${rt}`).toBeLessThanOrEqual(hi);
    }
  });

  it('is unaffected once the out-of-order tick is behind the read horizon', () => {
    buf.push({ t: 0, v: 1000 });
    buf.push({ t: 2 * TICK, v: 1020 });
    buf.push({ t: TICK, v: 1010 });
    for (const tk of series(20, n => 1030 + n * 10, 3 * TICK)) buf.push(tk);
    // Reading well past the disturbance returns the ordered tail exactly.
    const v = buf.valueAt(10 * TICK);
    expect(v).toBeCloseTo(1030 + 7 * 10, 9);
  });
});

describe('the ring trim', () => {
  it('keeps the buffer bounded under a long round', () => {
    // 90 s at 8 Hz is 720 ticks; the trim keeps `a` under 420.
    for (const tk of series(720, n => 1000 + Math.sin(n / 10), 0)) buf.push(tk);
    expect(buf.a.length).toBeLessThanOrEqual(420);
    expect(buf.a.length).toBeGreaterThan(0);
  });

  it('still answers correctly for recent times after trimming', () => {
    const ticks = series(720, n => 1000 + n, 0);
    for (const tk of ticks) buf.push(tk);
    const last = ticks.at(-1);
    expect(buf.valueAt(last.t)).toBe(last.v);
    // One tick back interpolates against the retained tail.
    expect(buf.valueAt(last.t - TICK)).toBeCloseTo(last.v - 1, 9);
  });

  it('drops only the oldest samples, so the retained window stays contiguous', () => {
    for (const tk of series(720, n => 1000 + n, 0)) buf.push(tk);
    const ts = buf.a.map(k => k.t);
    for (let i = 1; i < ts.length; i++){
      expect(ts[i] - ts[i - 1], `gap at ${i}`).toBe(TICK);
    }
  });
});
