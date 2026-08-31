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
| `btcusdt-binance-2021-05-19-flash-crash-100ms.csv` | 2021-05-19 13:20:20–13:22:00 | 1,000 | 0 | `1d9ea391c64557a7709af978a606b08f60c61be160dbbf8d891415f9858fd194` | $35,675.06 → $33,141.61; bucket high $35,888.00, low $33,000.00 (8.05% adverse move in 76.7 s) |
| `btcusdt-binance-2021-05-19-calm-100ms.csv` | 2021-05-19 00:00:00–00:00:30 | 245 | 55 | `59463c347c2a1d5532eb234475b5cd5125e7b51357b8669e67a030f6eae6aefb` | sparse/gapped control interval; no missing bucket is filled |

The flash interval is a documented violent real-market segment, selected from
the same primary archive because it contains a rapid multi-thousand-dollar BTC
move. The fixture itself is the auditable evidence used by the replay tests.

To reproduce either file after downloading the source archive:

```text
node packages/feed/scripts/derive-binance-aggtrades-fixture.mjs \
  data/recordings/BTCUSDT-aggTrades-2021-05-19.csv \
  packages/feed/fixtures/<output>.csv <START_ISO> <END_ISO>
```
