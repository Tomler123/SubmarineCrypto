# M1.6 manual/test plan — ReplayIndexSource

## Scope

This checklist verifies the replay seam and evidence bundle. It does not start
M1.7 RTP calibration, Close Calls, or the PixiJS port.

## Preconditions

- Build the repository with Node 22+ and `npm install`.
- Use the committed fixtures and `packages/feed/fixtures/README.md` provenance.
- Keep the normal client URL unchanged for simulator-default checks.

## Automated evidence

| Check | Expected result | Criteria |
|---|---|---|
| `packages/feed/test/replay-index-source.test.ts` | mapping, malformed rows, gaps, EOF, restart, transform and scheduler tests green | FI-9–FI-13 |
| `packages/feed/test/replay-engine.test.ts` | two fresh runs and different scheduler batches serialize identically | FI-15 |
| `apps/client/test/replay-index-source.test.js` | shared source contract passes with explicit replay rewind behavior | FI-8, FI-12 |
| `apps/client/test/feed-selection.test.js` | default is simulator; `?feed=replay` is selected only in `feed/index.js` | FI-13 |
| `apps/client/test/feed-purity.test.js` and simulator suite | no money-path source leak; simulator RNG and statistical bounds unchanged | FI-7, FI-3, FI-6 |

## Manual browser smoke

1. Run `npm run dev` and open the default client URL. Confirm the normal
   simulated round still launches, ticks, and settles.
2. Open the same client with `?feed=replay`. Confirm the feed seam selects the
   recorded source, the first tick is synchronous at the fixture's first UTC
   timestamp, and no future rows appear before their deterministic boundary.
3. Halt and reset the replay source through the feed seam in a test harness.
   Confirm EOF is quiet and reset starts at the same first fixture timestamp;
   the explicit rewind is expected for a finite fixture.
4. Repeat the replay with a deliberately different scheduler interval. Compare
   serialized tick/event/settlement artifacts; they must be byte-identical.
5. Inspect the flash fixture run: the scripted 25× Surface position begins its
   500 ms ascent immediately before the violent drop and settles at the later
   authoritative tick with the reduced multiplier. It must not settle from an
   interpolated frame.

## Provenance review

Recompute the two fixture SHA-256 values and compare them to the fixture README.
If the source archive is available, verify its Binance `.CHECKSUM` before
running the derivation script. Any changed row, interval, transform constant,
or mapping rule requires an acceptance-criteria and ADR update.
