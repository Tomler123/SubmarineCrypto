/* ================================================================
   THE IndexSource CONTRACT SUITE — the deliverable of RUN 6.

   Invariant 2 says the feed boundary is sacred: "the simulator and the future
   WebSocket source are drop-in swaps." A drop-in swap is only real if there is
   a single executable definition of what being an IndexSource means. That is
   this file.

   Usage — M1.6's ReplayIndexSource runs through it unchanged:

     import { describeIndexSourceContract } from './support/index-source-contract.js';
     describeIndexSourceContract('ReplayIndexSource', {
       create: () => new ReplayIndexSource(FIXTURE),
       advance: (src, ticks) => vi.advanceTimersByTime(ticks * CFG.TICK_MS),
     });

   The suite asserts only what the contract promises, never how a source
   produces values: no assertion here may reference the simulator's LCG, its
   squalls, or a replay file's contents. Anything implementation-specific
   belongs in that implementation's own test file — keeping this file
   implementation-blind is what makes it reusable.

   FEED-F5 — the surface is settled. An IndexSource is:

     onTick(fn) → {t, v, ret} . resetRound() . halt() . onAlarm(fn)

   and nothing else. A source self-starts whatever machinery it needs (a
   timer, a socket, a file handle) in its constructor and stays dormant until
   `resetRound()` opens a round; `halt()` closes one. There is no
   start()/stop() pair: it was documented in one comment, never implemented,
   and never called by any consumer — `core/round.js` drives resetRound/halt.
   Reconciled in favour of the implementation and of ARCHITECTURE.md section 1,
   which already named this surface, BEFORE the second implementation is
   written against the wrong shape.

   `harness` fields:
     create()             → a fresh source, not yet emitting
     advance(src, ticks)  → drive exactly `ticks` authoritative ticks
     replayStale(src)     → optional; re-emit an already-used timestamp
                             through the source's own emit path, so FI-8
                             rejection is testable without this suite knowing
                             how the source stamps. Omit it and the rejection
                             tests are skipped.
================================================================ */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

/**
 * Collect every tick a source emits, so a test asserts on a series rather
 * than on a callback firing.
 */
export function record(src){
  const ticks = [];
  src.onTick(tk => ticks.push(tk));
  return ticks;
}

/** Every tick object a source emits must have exactly this shape. */
export function expectWellFormedTick(tk){
  expect(tk, 'tick must be an object').toBeTypeOf('object');
  expect(tk).not.toBeNull();
  expect(Object.keys(tk).sort()).toEqual(['ret', 't', 'v']);
  expect(Number.isFinite(tk.t), `t must be finite, got ${tk.t}`).toBe(true);
  expect(Number.isFinite(tk.v), `v must be finite, got ${tk.v}`).toBe(true);
  expect(Number.isFinite(tk.ret), `ret must be finite, got ${tk.ret}`).toBe(true);
  // v is a price index: strictly positive, always. A source that emits a
  // non-positive index has broken the depth map and every crush line with it.
  expect(tk.v, 'index must be strictly positive').toBeGreaterThan(0);
}

/**
 * @param {string} name  the implementation under test, for test titles
 * @param {{create: () => object, advance: (src: object, ticks: number) => void,
 *          replayStale?: (src: object) => void}} harness
 */
export function describeIndexSourceContract(name, harness){
  describe(`IndexSource contract — ${name}`, () => {
    let src;

    beforeEach(() => { vi.useFakeTimers(); src = harness.create(); });
    afterEach(() => { src?.halt?.(); vi.useRealTimers(); });

    describe('surface', () => {
      it('exposes onTick, resetRound, halt and onAlarm', () => {
        expect(src.onTick).toBeTypeOf('function');
        expect(src.resetRound).toBeTypeOf('function');
        expect(src.halt).toBeTypeOf('function');
        expect(src.onAlarm).toBeTypeOf('function');
      });

      it('exposes no start/stop pair — the surface is resetRound/halt (FEED-F5)', () => {
        // Asserted as absence, not merely left untested. A source that grew a
        // start()/stop() alongside resetRound()/halt() would give consumers two
        // ways to open a round and no rule about which one the engine trusts.
        expect(src.start).toBeUndefined();
        expect(src.stop).toBeUndefined();
      });
    });

    describe('onTick', () => {
      it('emits nothing before resetRound opens the round', () => {
        const ticks = record(src);
        harness.advance(src, 20);
        expect(ticks).toHaveLength(0);
      });

      it('emits well-formed {t, v, ret} ticks and nothing else', () => {
        const ticks = record(src);
        src.resetRound();
        harness.advance(src, 40);
        expect(ticks.length).toBeGreaterThan(1);
        for (const tk of ticks) expectWellFormedTick(tk);
      });

      it('fans out to every subscriber, in subscription order', () => {
        const order = [];
        src.onTick(() => order.push('a'));
        src.onTick(() => order.push('b'));
        src.resetRound();
        harness.advance(src, 3);
        expect(order.length).toBeGreaterThanOrEqual(2);
        // Each emission must hit a then b — a source may not reorder or drop
        // one subscriber's delivery.
        for (let i = 0; i < order.length; i += 2){
          expect(order.slice(i, i + 2)).toEqual(['a', 'b']);
        }
      });

      it('accepts a subscriber added mid-round and delivers from the next tick', () => {
        src.resetRound();
        harness.advance(src, 5);
        const late = [];
        src.onTick(tk => late.push(tk));
        harness.advance(src, 5);
        expect(late.length).toBeGreaterThan(0);
        for (const tk of late) expectWellFormedTick(tk);
      });
    });

    describe('resetRound', () => {
      it('emits an opening tick synchronously', () => {
        const ticks = record(src);
        src.resetRound();
        expect(ticks).toHaveLength(1);
        expectWellFormedTick(ticks[0]);
      });

      it('opens the round with ret = 0 — the first tick is a level, not a move', () => {
        const ticks = record(src);
        src.resetRound();
        expect(ticks[0].ret).toBe(0);
      });

      it('restarts a round from the same opening index every time', () => {
        const ticks = record(src);
        src.resetRound();
        const firstOpen = ticks[0].v;
        harness.advance(src, 60);
        src.resetRound();
        const reopened = ticks.at(-1);
        expect(reopened.ret).toBe(0);
        expect(reopened.v).toBe(firstOpen);
      });
    });

    describe('halt', () => {
      it('stops emission and resetRound resumes it', () => {
        const ticks = record(src);
        src.resetRound();
        harness.advance(src, 10);
        const afterRound = ticks.length;
        expect(afterRound).toBeGreaterThan(1);

        src.halt();
        harness.advance(src, 20);
        expect(ticks).toHaveLength(afterRound);

        src.resetRound();
        harness.advance(src, 10);
        expect(ticks.length).toBeGreaterThan(afterRound + 1);
      });
    });

    describe('FI-8 — timestamps are monotonic and strictly increasing', () => {
      it('never emits a non-increasing timestamp across a round', () => {
        const ticks = record(src);
        src.resetRound();
        harness.advance(src, 400);
        expect(ticks.length).toBeGreaterThan(100);
        for (let i = 1; i < ticks.length; i++){
          expect(
            ticks[i].t,
            `tick ${i} t=${ticks[i].t} must exceed tick ${i - 1} t=${ticks[i - 1].t}`,
          ).toBeGreaterThan(ticks[i - 1].t);
        }
      });

      /**
       * The contract has now decided: a boundary duplicate is NOT permitted
       * (FEED-F3), so the rule lives here and every implementation inherits it
       * rather than each one re-deciding. Kept alongside the whole-series
       * assertion below because a per-round check localises a failure to the
       * round it happened in.
       */
      it('keeps timestamps increasing within each round across a boundary', () => {
        const first = [];
        const second = [];
        let sink = first;
        src.onTick(tk => sink.push(tk));

        src.resetRound();
        harness.advance(src, 30);
        src.halt();

        sink = second;
        harness.advance(src, 10);
        src.resetRound();
        harness.advance(src, 30);

        for (const round of [first, second]){
          expect(round.length).toBeGreaterThan(10);
          for (let i = 1; i < round.length; i++){
            expect(round[i].t).toBeGreaterThan(round[i - 1].t);
          }
        }
      });

      /**
       * FEED-F3, as a contract rule. The boundary is the one place two
       * emissions can land inside a single clock reading, and `InterpBuffer`
       * divides by `(q.t - p.t)`, so a duplicate there is a division by zero
       * for any consumer that interpolates across the pair.
       *
       * Asserted across the UNBROKEN series — every tick of every round,
       * not per-round — because that is the series a consumer stores.
       */
      it('never repeats a timestamp across a round boundary (FEED-F3)', () => {
        const ticks = record(src);
        for (let r = 0; r < 20; r++){
          src.resetRound();
          harness.advance(src, 60);
          src.halt();
        }

        expect(ticks.length).toBeGreaterThan(1000);
        let duplicates = 0;
        for (let i = 1; i < ticks.length; i++){
          if (ticks[i].t <= ticks[i - 1].t) duplicates++;
        }
        expect(duplicates, 'a boundary duplicate is a zero divisor downstream').toBe(0);
      });

      /**
       * FI-8's second half: "rejected and alarmed". Ordering being correct in
       * practice is not the same as a bad tick being refused — the simulator
       * satisfied the first half by accident of its clock while having no
       * rejection at all (FEED-F2). A replay source reading timestamps from a
       * file, and a ws source reading them off the wire, have no such accident.
       */
      it.runIf(harness.replayStale)('rejects a non-increasing timestamp and alarms (FEED-F2)', () => {
        const ticks = record(src);
        const alarms = [];
        src.onAlarm(info => alarms.push(info));
        src.resetRound();
        harness.advance(src, 10);

        const seen = ticks.length;
        const stale = ticks.at(-1).t;
        harness.replayStale(src);

        // Rejected: no subscriber saw it, so it can never reach a settlement.
        expect(ticks).toHaveLength(seen);
        expect(ticks.at(-1).t).toBe(stale);
        // Alarmed: an operator can see the feed fault.
        expect(alarms).toHaveLength(1);
        expect(alarms[0].count).toBe(1);
        expect(src.rejectedTicks).toBe(1);
      });

      it.runIf(harness.replayStale)('keeps emitting normally after a rejection', () => {
        const ticks = record(src);
        src.resetRound();
        harness.advance(src, 10);
        harness.replayStale(src);
        const afterReject = ticks.length;

        // A rejected tick drops that tick, not the feed. Money stops moving
        // only when the round machine says SIGNAL LOST (MF-1) — never here.
        harness.advance(src, 10);
        expect(ticks.length).toBeGreaterThan(afterReject);
        for (let i = 1; i < ticks.length; i++){
          expect(ticks[i].t).toBeGreaterThan(ticks[i - 1].t);
        }
      });
    });
  });
}
