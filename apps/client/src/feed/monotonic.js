/* ================================================================
   FI-8 — THE MONOTONICITY GATE, at the feed seam.

   "Tick timestamps are server-clock, monotonic; a tick with a
   non-increasing timestamp is rejected and alarmed." (FI-8)

   This lives at the seam rather than inside SimulatedIndexSource on purpose.
   The simulator is safe only by accident of `performance.now()` being
   monotonic within a document; a `WsIndexSource` reading a timestamp off the
   wire has no such guarantee, and `ReplayIndexSource` reads timestamps out of
   a file. Putting the guard in the base class means every implementation
   inherits rejection without restating it — and cannot opt out, because the
   only way a source emits is through `_emit`.

   Rejection is silent-to-subscribers and loud-to-operators: the tick never
   reaches a subscriber (so it can never reach a settlement), and the source
   counts it and reports it through the `onAlarm` hook. A dropped tick is a
   feed fault, not a game event — MF-1 SIGNAL LOST is the round-level response
   and is decided by the round machine, not here.

   ASSUMPTION: rejection is per-source-lifetime, not per-round. `resetRound()`
   re-bases the index but not the clock, so the timestamp series is continuous
   across a round boundary and the high-water mark carries over. This is what
   makes FEED-F3's boundary duplicate a rejectable event rather than an
   invisible one.
================================================================ */

/**
 * The base every IndexSource extends. It owns the subscriber list, the
 * timestamp high-water mark, and the only emit path.
 *
 * Subclasses supply values; they never touch `subs` or stamp their own ticks
 * outside `_emit`.
 */
export class IndexSourceBase {
  constructor(){
    this.subs = [];
    /* High-water mark of every timestamp accepted so far. `-Infinity` rather
       than 0 so a source whose clock legitimately starts at 0 is not rejected
       on its own first tick. */
    this._lastT = -Infinity;
    /* FI-8's "and alarmed" half. Counted always; reported if a hook is set. */
    this.rejectedTicks = 0;
    this._alarm = null;
  }

  /** Subscribe to accepted ticks. Delivery is in subscription order. */
  onTick(fn){ this.subs.push(fn); }

  /**
   * Register the FI-8 alarm sink. One hook, replacing any previous one — the
   * feed has a single operator channel, not a fan-out.
   * @param {(info: {t: number, lastT: number, count: number}) => void} fn
   */
  onAlarm(fn){ this._alarm = fn; }

  /**
   * The single emit path. Returns true if the tick was published, false if
   * FI-8 rejected it.
   *
   * Every field is validated, not only ordering: a NaN timestamp compares
   * false against everything and would otherwise slip past a bare `<=` check
   * and poison `InterpBuffer`'s `(q.t - p.t)` divisor just as surely as a
   * duplicate would.
   */
  _publish(tk){
    if (!Number.isFinite(tk.t) || tk.t <= this._lastT){
      this.rejectedTicks++;
      if (this._alarm){
        this._alarm({ t: tk.t, lastT: this._lastT, count: this.rejectedTicks });
      }
      return false;
    }
    this._lastT = tk.t;
    for (const f of this.subs) f(tk);
    return true;
  }

  /**
   * Forget the high-water mark. Only for a source whose clock genuinely
   * restarts — a replay file rewound to its first row, say. A live source must
   * never call this: it is the one door out of FI-8, and it is deliberately
   * explicit so that using it shows up in a diff.
   */
  _resetMonotonicity(){ this._lastT = -Infinity; }
}
