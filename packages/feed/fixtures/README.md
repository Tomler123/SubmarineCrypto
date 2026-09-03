# Recorded BTC fixtures (M1.6)

These are compact, derived fixtures for deterministic replay tests. They are
not synthetic prices and are not intended to represent a complete market
archive.

## Primary source

- Provider: Binance public data archive
- Venue/market: Binance Spot, `BTCUSDT`
- Source file: [`BTCUSDT-aggTrades-2021-05-19.zip`](https://data.binance.vision/data/spot/daily/aggTrades/BTCUSDT/BTCUSDT-aggTrades-2021-05-19.zip)
- Source archive checksum (SHA-256):
  `b6ab8755c94f243f3b3c2ab2daa5a924aed28a093d0d334563f30bce4f5e62c8`
- Source archive checksum was verified against Binance's adjacent `.CHECKSUM`
  file before transformation.
- Source row granularity: Binance aggregate trades, event-time milliseconds;
  each row's price is the aggregate trade price (the archive's second column).

The archive is deliberately not committed. It is staged under the ignored
`data/recordings/` directory when reproducing the derivation.

## Transformation

The committed files use the exact two-column format:

```text
timestamp_ms,price
```

`packages/feed/scripts/derive-binance-aggtrades-fixture.mjs` performs the
transformation. For a UTC interval aligned to 100 ms it:

1. streams the official aggregate-trade CSV;
2. floors each event timestamp to its UTC 100 ms bucket;
3. keeps the last aggregate-trade price observed in that bucket;
4. emits no row for a bucket with no source trade; and
5. preserves the decimal price text from the selected source row.

No price interpolation, forward-fill, or fabricated market event is used.
The resulting 100 ms observation rows are then mapped at replay time by FI-10:
the fixture-start-anchored 125 ms grid selects the latest original row at or
before each boundary, retains its original timestamp and price, and skips all
other rows.

The published index transform starts with `sigma_floor²` and applies FI-1 in
the frozen operation order; see FI-11 and ADR 0006.

## Fixtures

| File | UTC interval | Rows | Empty 100 ms buckets | SHA-256 | Evidence |
|---|---:|---:|---:|---|---|
| `btcusdt-binance-2021-05-19-flash-crash-100ms.csv` | [2021-05-19 13:20:20.000, 13:22:00.000) | 1,000 | 0 | `1d9ea391c64557a7709af978a606b08f60c61be160dbbf8d891415f9858fd194` | 99.9 s first-to-last; $35,675.06 → $33,141.61; bucket high $35,888.00, low $33,000.00 (8.05% adverse move in 76.7 s) |
| `btcusdt-binance-2021-05-19-calm-100ms.csv` | [2021-05-19 00:00:00.000, 00:00:30.000) | 245 | 55 | `59463c347c2a1d5532eb234475b5cd5125e7b51357b8669e67a030f6eae6aefb` | 29.9 s first-to-last; original sparse M1.6 calibration control; no missing bucket is filled |
| `btcusdt-binance-2021-05-19-calm-playable-100ms.csv` | [2021-05-19 00:00:00.000, 00:01:40.000) | 868 | 132 | `c1280e60127ff47fd6f6bbd3e521e54653b9a02b140298e2c1d50fc4d85431a6` | 99.9 s first-to-last; $42,853.52 → $42,700.51; bucket high $43,115.45, low $42,585.53; no missing bucket is filled |

The flash interval is a documented violent real-market segment, selected from
the same primary archive because it contains a rapid multi-thousand-dollar BTC
move. The fixture itself is the auditable evidence used by the replay tests.
The calm-playable fixture extends the original control's source interval to
100 s using the same derivation, official archive and UTC start. The original
30 s file remains unchanged because it is checksum-locked into the M1.7
engineering calibration artifact; it is not offered as a playable client
replay. Both client selections cover the fixed 90 s round without looping or
padding.

Recorded-market client URLs are:

```text
?feed=replay&fixture=flash-crash
?feed=replay&fixture=calm
```

Replay without `fixture`, or with an unrecognised fixture name, uses
`flash-crash`. The normal client default remains the simulator.

## Synthetic QA fixtures

The following files are generated test data, not recorded BTC prices and not
calibration or fairness evidence. Each contains 801 rows at exactly 125 ms
spacing (100.0 s first-to-last), so it covers the full 90 s running phase
without looping. The replay source is dormant during the preceding 8 s waiting
and 1.4 s launching phases; row zero is emitted when `running` starts.

| File | Scenario | SHA-256 |
|---|---|---|
| `synthetic-upper-limit-125ms.csv` | 10 s flat; 7 s rise through the `DEPTH_MIN` index threshold; 7 s retreat; then flat | `4e64dcbd1d194e07343495bfcda80e1fc889695290f5d43af3680e7a7272d3b8` |
| `synthetic-lower-limit-125ms.csv` | maximum permitted index descent through `DEPTH_MAX`; 4 s recovery; then flat | `cf09e03e350867758e68ebe5eff12ea27df690b0d29d233510a39606e189584b` |
| `synthetic-constant-price-125ms.csv` | raw price and transformed index remain constant for timing oxygen and cash-out tests | `736219d8a23cfd23c42735691c86e76e860725955fe9025cc4fffe491c1e4453` |

QA client URLs are:

```text
?feed=replay&fixture=upper-limit
?feed=replay&fixture=lower-limit
?feed=replay&fixture=constant
```

Regenerate all three deterministic files with:

```text
node packages/feed/scripts/generate-synthetic-qa-fixtures.mjs
```

To reproduce any file after downloading the source archive:

```text
node packages/feed/scripts/derive-binance-aggtrades-fixture.mjs \
  data/recordings/BTCUSDT-aggTrades-2021-05-19.csv \
  packages/feed/fixtures/<output>.csv <START_ISO> <END_ISO>
```
