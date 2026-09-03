# Business context and open commercial questions

**Last updated:** 2026-09-03

Non-technical context that shapes technical decisions. The specs say *what* to
build; this says *who it is for* and *what is not yet known*. Read it before
planning a milestone, and update it whenever the owner learns something new from
the client.

Its purpose is continuity: it exists so the context below never has to be
re-explained from scratch at the start of a session.

---

## The commercial model

Crush Depth is a **B2B game provider** product. The intended shape is the same
one Spribe has with Aviator: the provider builds and runs the game, licensed
casino operators embed it in their platforms, and players play it from their
**existing casino balance** — exactly as they would a slot.

- The **operator** owns the player: registration, KYC/AML, deposits,
  withdrawals, and **balance authority**.
- The **provider** (us) owns the game: the index, the round, the settlement
  maths, and the evidence that all three are correct.
- **We never hold player funds.** See ADR 0011 for the full consequences.

The owner's client is driving distribution and states he has established casino
connections and will handle operator introductions.

### One correction to the Spribe analogy

Aviator is **RNG-driven** with a provably-fair seed. Crush Depth settles on the
**real BTC price**. The integration shape is identical; the *regulatory* shape is
not. A price-settled outcome raises a "is this gambling or a financial
derivative?" question that an RNG crash game never has to answer. It is the
single largest unresolved risk in the project.

---

## Money: what is and is not crypto

**Settled with the owner, 2026-09-03. This has been ambiguous in conversation
before, so it is written down explicitly.**

- **Crypto is the price feed, and nothing else.** BTC/USDT prices from exchanges
  drive the submarine's depth. That is the entire role of crypto in this product.
- **Money is ordinary casino balance** — the same fiat balance a player uses on
  any other game on the operator's platform.
- There is **no crypto deposit, no crypto withdrawal, and no custody of crypto**
  anywhere in this system, and none is planned.

If a future conversation suggests otherwise, treat it as a **material scope
change** and confirm before building: it would add custody, AML and licensing
obligations that this architecture deliberately does not carry.

> The client has offered access to "someone who can help with crypto stuff if
> needed." That is a **resource offer, not a dependency** — nothing in the plan
> waits on it.

---

## What is known, and what is not

| Question | Status |
|---|---|
| Commercial model (B2B provider, operator holds funds) | **settled** — ADR 0011 |
| Crypto is price-feed only, money is casino fiat balance | **settled** — 2026-09-03 |
| Target casinos | **unknown** — client has specific operators in mind, names not yet shared |
| Target region / jurisdiction | **unknown** — blocks all legal work |
| Exchange market-data rights (incl. sublicensing) | **not started** — see below |
| Gambling-vs-derivative legal opinion | **not started** — existential |
| Lab certification and provider licensing | **not started** |
| Internal wallet contract (WL-1…WL-8) | **shape known, unvalidated** — see below |
| Timeline / deadline | **none** — owner works at own pace, prefers early |

---

## Open questions for the client

Ordered by how much they unblock. Agreed 2026-09-03; the owner will raise them
in parallel with M2.1/M2.2 engineering work.

1. **Which region or jurisdiction are the casinos in?** One word unblocks the
   entire legal thread — licensing route, test lab, and the
   gambling-vs-derivative question, all of which are answered differently per
   country. Highest value per unit of effort of anything on this list.
2. **Which casinos, by name?** Decides whether we design the wallet adapter
   against a real operator API or a generic shape.
3. **Who obtains the exchange market-data licences — the client or us?** The
   critical clause is **sublicensing**: the right to pass venue data through to
   the operator's players, not merely to consume it ourselves. A licence without
   it looks adequate on paper and makes the model unshippable.
4. **Has anyone taken a legal opinion on whether a BTC-price-settled game is
   gambling or a financial product** in the target region? Existential — it can
   void the licensing route entirely.
5. **Who pays for and manages lab certification and provider licensing?**
6. **Is there an operator he has already spoken to whose wallet API we could
   design the first adapter against?**

### Terminology to keep straight when asking

Two different counterparties, two different processes, easily conflated:

- **Exchanges** (Binance, Coinbase, OKX, Bybit, Kraken) → a commercial
  **market-data licence**, negotiated, with a sublicensing clause.
- **Regulator and test lab** → **certification** and **provider licensing**,
  jurisdiction-specific.

Neither covers the other.

---

## The wallet contract, in plain terms

`WL-1`…`WL-8` are the least self-explanatory criteria in the project, so:

The player's money lives at the casino. When a player stakes $5, our server
**asks the operator** to debit $5 from that player; when they win $12, we ask it
to credit $12. We never move money ourselves — we ask, and we record what we
asked for, so the two sides can be reconciled later.

The undecided part is not "where does the money live" — that is settled. It is
**what happens when the call fails**:

- We send "debit $5" and the network times out. Did it land? Retrying naively
  debits twice. Hence every operation carries an **idempotency key**.
- The debit succeeds but position creation then fails — the player has paid for
  nothing, so it must be **rolled back**.
- The round aborts mid-flight (feed outage) — everyone who paid needs a
  **refund keyed to their original debit**.

Four operations, all idempotent: **debit, credit, refund, rollback.**

**Sequencing (revised 2026-09-03).** This was previously described as blocking
M2.1 and M2.3. It is less blocking than that: every operator has a different
API, so the internal contract cannot be finalised in the abstract — it is
validated by the **first real integration**, and per-operator adapters map onto
it. Define the internal shape now; expect the first real operator's API to
correct it. M2.1 and M2.3 proceed meanwhile.

---

## Market-data rights: why this one is different

Most legal work gates **launch**. This one can invalidate **work already done**,
which is why it is called out separately.

Settling real money on five exchanges' prices requires commercial market-data
rights, including the right to **sublicense** — our data reaches the operator's
players, not just us.

If a venue refuses, the venue set changes (`VENUE_SET_V1` → `V2`, ADR 0010) and
any certification evidence recorded under the old set cannot lawfully be used.

**What follows for engineering (decided 2026-09-03):**

- The **aggregation logic is rights-agnostic**. Median, 0.5 % outlier exclusion
  and the 3-live-feed floor are identical for five venues or four. A refusal
  changes a versioned list, not the algorithm. So M2.1 and M2.2 proceed now on
  the exchanges' free public feeds.
- **The permanent tick archive waits.** Recording for development and testing is
  fine. Retaining the archive we intend to hand a regulator as certification
  evidence should not begin until the rights position is known — that specific
  artifact is what becomes unusable. It is a switch flipped late in M2.2, not a
  design constraint on what gets built.

### If venues refuse — how far can we degrade?

Asked and answered 2026-09-03:

- **5 venues** — the specified set (`VENUE_SET_V1`).
- **3–4 venues** — fine. Version the venue set and regenerate evidence. Three is
  the floor already in the spec: a median needs three samples to exclude an
  outlier, and FI-5 aborts the round below three live feeds.
- **1–2 venues** — **not a config change; do not do it quietly.** A single
  exchange can be manipulated or print badly, and payouts would follow it
  directly. It also destroys the "provably market-driven" claim the whole design
  rests on, which a test lab will probe. If it ever comes to this, it is a
  design decision to re-open with the owner, not a parameter to lower.

---

## The simulator's fate

Confirmed with the owner 2026-09-03, since "remove the random ticks" could be
read two ways:

- **The game** stops being driven by the simulator entirely. Real BTC data only.
  This is the goal of M2.1/M2.2.
- **The codebase keeps `SimulatedIndexSource` as a test fixture.** A large part
  of the suite needs deterministic, reproducible series — a test that needs "a
  series that crushes a 25× position at tick 20" cannot call a live exchange
  without becoming slow, flaky and internet-dependent, and `@crush/sim` cannot
  run 20,000 calibration positions against live BTC.

Same status the replay fixtures already hold. Deleting it would take a large
part of the test suite with it.

---

## Agreed sequencing

Settled 2026-09-03. The owner's own proposal, and it is sound:

1. **Engineering proceeds now** on M2.1 (the pure aggregator) and M2.2 (live
   venue transport), on free public exchange feeds, with the archive in
   development mode.
2. **Commercial and legal work runs in parallel**, on the client's side, driven
   by the open-questions list above.
3. **The venue set adjusts** if any exchange refuses, per ADR 0010's versioning.

The reasoning: none of the engineering depends on knowing the casino, the region
or the licence, and the legal thread is slow, so starting it late costs more
than running it alongside. Neither thread blocks the other.
