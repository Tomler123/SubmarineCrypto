import { describe, expect, it } from 'vitest';
import { IndexSourceBase } from '../src/feed/monotonic.js';

/* ================================================================
   FI-8 — THE MONOTONICITY GATE, tested at the seam it lives on.

   `simulated-index-source.test.js` proves the simulator obeys the gate. This
   file proves the GATE, directly and without a simulator underneath it,
   because that is the thing `ReplayIndexSource` and a future `WsIndexSource`
   inherit. A rule enforced only through one implementation's happy path is a
   rule that has not been tested.

   Everything here drives `_publish` on a bare subclass. That is deliberate:
   the gate must hold for a source that stamps timestamps from a file or off
   the wire, neither of which has the simulator's monotonic `performance.now()`
   to hide behind.
================================================================ */

/** The minimum an IndexSource is: values in, `_publish` out. */
class TestSource extends IndexSourceBase {
  emit(t, v = 1000, ret = 0){ return this._publish({ t, v, ret }); }
}

const collect = (src) => {
  const ticks = [];
  src.onTick(tk => ticks.push(tk));
  return ticks;
};

describe('FI-8 gate — acceptance', () => {
  it('publishes a strictly increasing series untouched', () => {
    const src = new TestSource();
    const ticks = collect(src);
    for (const t of [0, 125, 250, 375]) expect(src.emit(t)).toBe(true);
    expect(ticks.map(tk => tk.t)).toEqual([0, 125, 250, 375]);
    expect(src.rejectedTicks).toBe(0);
  });

  it('accepts t = 0 as a first tick — the mark starts below every real clock', () => {
    // `_lastT` starts at -Infinity rather than 0 precisely so a source whose
    // clock legitimately begins at zero is not rejected on its own first tick.
    const src = new TestSource();
    const ticks = collect(src);
    expect(src.emit(0)).toBe(true);
    expect(ticks).toHaveLength(1);
  });

  it('accepts a negative timestamp, and then holds the line above it', () => {
    // A replay file may carry an epoch-relative or negative offset. FI-8 is
    // about ORDER, not about sign.
    const src = new TestSource();
    const ticks = collect(src);
    expect(src.emit(-1000)).toBe(true);
    expect(src.emit(-999)).toBe(true);
    expect(src.emit(-999)).toBe(false);
    expect(ticks).toHaveLength(2);
  });

  it('accepts an arbitrarily small forward step', () => {
    // The gate's rule is `> lastT`, not `>= lastT + someInterval`. A source is
    // free to tick faster than the game's cadence; only going backwards is a
    // fault. This is what lets the FEED-F3 half-interval opening stamp through.
    const src = new TestSource();
    const ticks = collect(src);
    src.emit(1000);
    expect(src.emit(1000 + Number.EPSILON * 1000)).toBe(true);
    expect(ticks).toHaveLength(2);
  });

  it('fans out to every subscriber in subscription order', () => {
    const src = new TestSource();
    const order = [];
    src.onTick(() => order.push('a'));
    src.onTick(() => order.push('b'));
    src.emit(1);
    expect(order).toEqual(['a', 'b']);
  });
});

describe('FI-8 gate — rejection', () => {
  it('rejects a duplicate timestamp', () => {
    const src = new TestSource();
    const ticks = collect(src);
    src.emit(500);
    expect(src.emit(500)).toBe(false);
    expect(ticks).toHaveLength(1);
    expect(src.rejectedTicks).toBe(1);
  });

  it('rejects a timestamp that goes backwards', () => {
    const src = new TestSource();
    const ticks = collect(src);
    src.emit(500);
    expect(src.emit(499)).toBe(false);
    expect(ticks).toHaveLength(1);
  });

  it('rejects NaN, Infinity and a missing timestamp', () => {
    // A NaN compares false against everything, so a bare `t <= lastT` test
    // would let it through — and it would poison `InterpBuffer`'s
    // `(q.t - p.t)` divisor exactly as surely as a duplicate would. This is
    // why the guard tests `Number.isFinite` first rather than ordering alone.
    const src = new TestSource();
    const ticks = collect(src);
    src.emit(100);
    for (const bad of [NaN, Infinity, -Infinity, undefined, null, '200']){
      expect(src.emit(bad), `${String(bad)} must be rejected`).toBe(false);
    }
    expect(ticks).toHaveLength(1);
    expect(src.rejectedTicks).toBe(6);
  });

  it('a rejected tick does not advance the high-water mark', () => {
    // Otherwise one bad tick from the future would lock out every good tick
    // behind it — a far worse failure than the duplicate being guarded against.
    const src = new TestSource();
    const ticks = collect(src);
    src.emit(100);
    src.emit(50);          // rejected
    expect(src.emit(101)).toBe(true);
    expect(ticks.map(tk => tk.t)).toEqual([100, 101]);
  });

  it('drops the tick, not the feed — emission continues after a rejection', () => {
    const src = new TestSource();
    const ticks = collect(src);
    src.emit(100);
    src.emit(100);
    src.emit(125);
    src.emit(250);
    expect(ticks.map(tk => tk.t)).toEqual([100, 125, 250]);
    expect(src.rejectedTicks).toBe(1);
  });

  it('never lets a rejected tick reach a subscriber', () => {
    // The reason the gate exists: a stale price that reached a subscriber
    // could settle a position against a price that already happened.
    const src = new TestSource();
    const seen = [];
    src.onTick(tk => seen.push(tk.v));
    src.emit(100, 1000);
    src.emit(100, 9999);   // same instant, wildly different price
    expect(seen).toEqual([1000]);
  });
});

describe('FI-8 gate — the alarm half', () => {
  it('reports each rejection with the offending and expected timestamps', () => {
    const src = new TestSource();
    const alarms = [];
    src.onAlarm(info => alarms.push(info));
    src.emit(100);
    src.emit(80);
    expect(alarms).toEqual([{ t: 80, lastT: 100, count: 1 }]);
  });

  it('counts rejections cumulatively across the source lifetime', () => {
    const src = new TestSource();
    const alarms = [];
    src.onAlarm(info => alarms.push(info));
    src.emit(100);
    src.emit(100);
    src.emit(100);
    expect(alarms.map(a => a.count)).toEqual([1, 2]);
    expect(src.rejectedTicks).toBe(2);
  });

  it('counts rejections even with no alarm hook registered', () => {
    // The count is the durable record; the hook is the live channel. A source
    // running without an operator attached must still be auditable afterwards.
    const src = new TestSource();
    src.emit(100);
    src.emit(100);
    expect(src.rejectedTicks).toBe(1);
  });

  it('keeps one alarm sink, replacing any previous one', () => {
    const src = new TestSource();
    const first = [];
    const second = [];
    src.onAlarm(i => first.push(i));
    src.onAlarm(i => second.push(i));
    src.emit(100);
    src.emit(100);
    expect(first).toHaveLength(0);
    expect(second).toHaveLength(1);
  });

  it('does not alarm on an accepted tick', () => {
    const src = new TestSource();
    const alarms = [];
    src.onAlarm(i => alarms.push(i));
    src.emit(100);
    src.emit(200);
    expect(alarms).toHaveLength(0);
  });
});

describe('FI-8 gate — _resetMonotonicity', () => {
  it('forgets the high-water mark so a rewound clock is accepted', () => {
    // The single door out of FI-8, for a source whose clock genuinely
    // restarts — a replay file rewound to its first row. Explicit by design:
    // using it shows up in a diff.
    const src = new TestSource();
    const ticks = collect(src);
    src.emit(500);
    expect(src.emit(100)).toBe(false);

    src._resetMonotonicity();
    expect(src.emit(100)).toBe(true);
    expect(ticks.map(tk => tk.t)).toEqual([500, 100]);
  });

  it('re-arms the gate immediately after the reset', () => {
    const src = new TestSource();
    src.emit(500);
    src._resetMonotonicity();
    src.emit(100);
    expect(src.emit(100)).toBe(false);
    expect(src.rejectedTicks).toBe(1);
  });

  it('does not clear the rejection count — the audit trail survives a rewind', () => {
    const src = new TestSource();
    src.emit(500);
    src.emit(500);
    src._resetMonotonicity();
    expect(src.rejectedTicks).toBe(1);
  });
});
