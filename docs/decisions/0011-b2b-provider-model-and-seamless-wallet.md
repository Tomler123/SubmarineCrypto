# 0011 — The B2B provider model and the seamless wallet

**Status:** accepted · **Date:** 2026-09-02 · **Milestone:** M2.3 / M2.4 / M2.5 / M3.1

## Context

Every plan revision through Rev. 10 assumed a **B2C operator model**: Crush Depth
registers its own players, holds their money, verifies their identity, and
enforces their limits. That assumption is visible throughout the specifications —
LG-1's "house account", EN-3's atomic stake debit, RP-2's "player-set loss
limit", M2.5's "accounts, sessions, house risk", M3.1's single operator licence.

The commercial model is now **B2B: Crush Depth is a game provider**, integrated
into licensed casino operators. That is not a deployment detail. It moves the
single most regulated component in the system — custody of player funds — out of
this codebase entirely, and it changes what the provider is certified for, what
it may enforce, and what it is even permitted to know about a player.

Getting this wrong in either direction is expensive. Building fund custody that
the operator already owns is wasted work carrying maximal regulatory liability.
Omitting the internal ledger because "the operator owns the money" leaves the
provider unable to answer a dispute, reconcile a discrepancy, or produce
certification evidence about its own game.

## Decisions

### 1. The operator owns the player; the provider owns the game

**The casino operator owns**: player registration, KYC/AML, deposits,
withdrawals, **player balance authority**, geofencing, and the primary
responsible-gambling account controls (self-exclusion, deposit limits, cooling-off
periods, reality-check policy, age verification).

**The provider owns**: the index, the round, the engine, settlement determination,
the game's internal ledger, and the game-level risk controls (RK-1's directional
exposure cap, the kill switch).

The dividing line is **custody**, not information. The provider still receives
and enforces everything it needs to run a compliant round; it simply never holds
the money, and it never becomes the system of record for a player's identity or
balance.

### 2. Seamless wallet, not transfer wallet

Two integration patterns exist in this market. **Transfer wallet** moves funds
into a provider-held session balance before play and back afterwards. **Seamless
wallet** leaves the balance at the operator and has the provider call the
operator per-transaction.

**We recommend and adopt seamless wallet.** Under transfer wallet the provider
holds player funds — even briefly, even in a session balance — which is precisely
the custody the B2B model exists to avoid, and which drags fund-safeguarding
obligations back into scope. Seamless is also the pattern operators overwhelmingly
expect from a provider, so it is the lower-friction commercial path.

The cost is honest and must be designed for: **the operator's wallet is now on
the critical path of every entry**, and a wallet call can be slow, fail, or
succeed with a lost response. That is why decision 4 exists.

### 3. The provider keeps an internal double-entry ledger anyway

The provider **does not custody player funds** and **does** keep a complete
internal double-entry game ledger. These are not in tension: the internal ledger
records the *game's* view of every stake, settlement, refund and void, against
provider-internal accounts, and is reconciled against the operator's wallet
rather than being the wallet.

It exists for four reasons that survive the loss of custody:

- **Dispute resolution** — when a player disputes a round, the provider must be
  able to reconstruct it completely (BO-1, BO-4).
- **Reconciliation** — the provider must be able to prove its view of the money
  matches the operator's, and to detect divergence quickly rather than at
  month-end.
- **Certification** — a test lab examines the provider's own records; "ask the
  operator" is not an evidence bundle.
- **Correctness** — LG-1's continuously-checked invariant is how settlement bugs
  surface at all.

M2.3 therefore stays in the plan at close to its full scope. What changes is that
its accounts are internal game accounts and an operator-receivable, not custody
accounts, and that it gains reconciliation as a first-class output rather than a
"nightly job" footnote.

### 4. The wallet contract is idempotent debit / credit / refund / rollback

The provider calls the operator with four operations, each carrying a
provider-generated **idempotency key** and the full LG-4 context:

| Operation | When | Money |
|---|---|---|
| **debit** | stake, at entry execution | player → operator house |
| **credit** | settlement payout > 0 | operator house → player |
| **refund** | EN-6 unexecuted entry, MF-2 voided position | reverses a specific debit |
| **rollback** | debit whose outcome is unknown or whose round was voided | reverses a specific debit |

Every operation is **idempotent by key** and **replay-safe**: a retried call
returns the original result rather than moving money twice. This is not optional
politeness — a timeout on a debit is indistinguishable from a lost response, and
without idempotency the only safe behaviour is to leave the player's money in an
unknown state.

Three rules make the seam survivable:

- **The debit resolves before the position exists.** EN-3's atomicity is
  preserved by ordering: request the debit, and create the position only on a
  confirmed debit. An unconfirmed debit yields `NO_PRICE`-style rejection at
  worst and a rollback at best; it never yields a position the player did not pay
  for, nor a debit without a position.
- **Rollback is the recovery path for unknown outcomes**, and it is keyed to the
  original debit. MF-2's crash recovery becomes: any position lacking a
  settlement record is voided, and its debit is rolled back at the operator.
- **A wallet failure is never resolved by guessing.** The provider retries with
  the same key, and escalates to a reconciliation exception rather than
  synthesising a balance.

**This contract must be agreed before M2.3 and M2.4 are finalised.** It is listed
as a required decision rather than an implementation detail because its shape
determines the ledger's account structure, the entry path's failure modes, and
the round server's latency budget — all three of which are expensive to change
afterwards. Different operators expose different wallet APIs; the provider needs
one internal contract with per-operator adapters, and that internal contract is
what M2.3 builds against.

### 5. M2.5 is operator integration, not account ownership

M2.5 was "accounts, sessions, house risk engine". Under this model the provider
builds **no registration, no KYC, no deposits, no withdrawals, no password
reset** — building any of them would duplicate the operator's regulated systems.

What M2.5 becomes:

- **Operator authentication and session integration** — the operator launches the
  game with a session token; the provider validates it against the operator,
  resolves it to an opaque operator-scoped player reference, and binds the
  session. The provider stores no identity documents and no PII beyond that
  reference.
- **Server-side enforcement of operator-supplied eligibility and restrictions** —
  the operator is authoritative on whether a player may play, and the provider
  **enforces** what it is told: self-exclusion, cooling-off, jurisdictional
  blocks, deposit-limit-derived states, and any operator-set play restriction. The
  engine already accepts `lossLocked` as state, which is the seam this arrives
  through.
- **Game-session responsible play** — the session clock (RP-1), the reality check
  (RP-3), and any game-level limits remain the provider's to display and enforce
  *within a session*, configured by operator policy rather than invented by the
  provider.

The rule: **the operator decides eligibility; the provider enforces it and never
overrides it.** A provider that lets a self-excluded player open a position is a
compliance incident regardless of which system made the mistake, so enforcement
is server-side and un-bypassable exactly as before — only the source of truth
moved.

RP-2's loss limit is now dual: an operator-supplied restriction the provider must
honour, plus an optional in-session limit the provider may offer where operator
policy permits. Where they conflict, **the stricter binds**.

### 6. FI-20: rights may come via a vendor, with a documented chain

FI-20 required market-data rights direct from each venue. That was too narrow: a
**licensed commercial data vendor** is a normal and often preferable route, and
some venues will only license through one.

Rights may therefore be held **either** directly from each `VENUE_SET_V1` venue
**or** through an authorised commercial data vendor — provided the **chain of
rights is documented end to end**, from the venue through every intermediary to
the party exercising each right. An undocumented chain is treated as no rights at
all, because that is how a regulator or test lab will treat it.

**Who needs which right is now explicit**, because the B2B split means the
provider and the operator exercise different ones:

| Right | Provider | Operator |
|---|---|---|
| Commercial outcome determination | **Required** — the provider computes the index and settles | Required *for its licensed offering* — the operator runs the game commercially |
| Archival for the LG-4 period | **Required** — the provider holds the tick archive | Not required if the provider archives |
| Certification / lab access | **Required** — the lab examines the provider's evidence | Required where the operator's own certification references it |
| **Publication of VR-1 data** | **Required, with sublicensing** — the provider serves verification data and must be able to pass that right to every operator | **Required** — the operator's players are the ones verifying |

The **sublicensing right is the critical one and the one most likely to be
missed**. A provider integrated into ten operators must be able to extend
publication rights to all ten and their players. A licence permitting the
provider to publish, but not to sublicense, blocks the entire B2B model while
looking adequate on paper. This must be explicit in the agreement, not inferred.

### 7. M3.1 covers provider licensing, per-game approval, and early lab
pre-assessment

M3.1 was scoped to "the operator's licence". Under a B2B model the provider has
its own regulatory obligations, and they are additive rather than alternative:

- **Supplier / software-supplier licensing.** Most regulated markets license the
  *supplier* of gaming software separately from the operator. The provider needs
  its own licence or registration in each target market.
- **Per-game approval.** Beyond licensing the company, individual games are
  typically submitted and approved market by market. Crush Depth is one game
  requiring approval in each jurisdiction it is offered.
- **The classification question is unchanged and still existential.** Whether a
  BTC-price-driven outcome is gaming or a financial derivative determines whether
  any of this is licensable at all.

**A laboratory / regulatory pre-assessment is added, before production M2.2
completes.** Not full certification — a paid early engagement with a recognised
test lab and, where possible, an informal regulator view, on the specific
question of a real-market-price-settled outcome and the evidence model that
supports it.

The reason this lands *before* M2.2 rather than in Phase 3 is that M2.2 is where
the evidence model becomes concrete and expensive: the tick archive's contents,
the VR-1 payload shape, and the re-derivation tooling. If a lab tells us the
archive needs a field we are not capturing, or that the verification model does
not satisfy the fairness argument, that is cheap to hear while the archive is
being designed and very expensive to hear after months of ticks have been written
in the wrong shape. A pre-assessment converts the largest unknown in the plan
into a design input.

## Consequences

- **Nothing in `@crush/engine` changes.** The engine already treats the wallet as
  state handed to it, and settlement as a pure result. That the balance is
  mirrored from an operator rather than owned is invisible to it — which is the
  payoff of the M1.3 purity rule.
- **M2.3's shape shifts**: internal double-entry against game accounts and an
  operator-receivable, plus reconciliation. Custody is out; the invariant,
  idempotency, immutability and LG-4 retention all stay.
- **M2.4 gains a wallet dependency on its critical path**, with the latency,
  failure and rollback handling that implies. The single-writer authority from
  ADR 0010 is unchanged.
- **M2.5 shrinks in build scope and does not shrink in compliance scope.**
  Less code, same enforcement obligation.
- **A new required decision** — the internal wallet contract — gates the
  finalisation of M2.3 and M2.4.
- **Acceptance criteria affected**: `LG-1`, `LG-4`, `EN-3`, `EN-6`, `MF-2`,
  `MF-3`, `RP-2`, `RP-4`, `BO-4`, `FI-20`. A new `WL` (wallet integration) group
  covers the operator seam.
- **ADR 0010 is unaffected** in its venue, liveness, PF-3 and topology decisions.
  Only FI-20's rights-sourcing clause is widened here.

## What this does not establish

No operator is signed, and no operator's wallet API has been reviewed. The
internal contract in decision 4 is the shape we build to; the first real
integration will test whether it survives contact, and the per-operator adapter
layer exists precisely because it may not survive unchanged.

The pre-assessment in decision 7 is a plan, not a result. Nothing here indicates
that a lab or regulator has accepted a price-settled outcome.
