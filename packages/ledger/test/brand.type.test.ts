/**
 * LG-2 as a *compile-time* property — RUN 3.
 *
 * LG-2 says "a float in any money-typed field fails the type system (branded
 * types) and CI". A runtime `expect(() => cents(1.5)).toThrow()` does not prove
 * that: it proves the guard function throws, not that the type system refuses.
 * The two are different defences and only one of them is what LG-2 names.
 *
 * Every `@ts-expect-error` below is an assertion in its own right. TypeScript
 * reports "Unused '@ts-expect-error' directive" — an *error* — when the line it
 * marks compiles cleanly. So if the brand were removed from `Cents`, making a
 * plain `number` assignable, these directives would become unused and
 * `npm run typecheck` would fail. That is the test: it is inverted, and it is
 * checked by `tsconfig.tests.json`, which since M1.4 typechecks every package's
 * test directory.
 *
 * The file also runs under Vitest so it appears in the suite, but its assertions
 * are the directives, not the `expect` calls.
 */

import { describe, expect, it } from 'vitest';
import { type Cents, addCents, cents, clampCents, scaleCents, subCents } from '../src/index.js';

/** A money-typed field, standing in for `Wallet.balance` / `Position.stake`. */
interface MoneyHolder {
  readonly amount: Cents;
}

describe('LG-2 (compile-time) — the Cents brand rejects a plain number', () => {
  it('LG-2: a float literal is not assignable to a money-typed field', () => {
    // @ts-expect-error LG-2: a float must not be assignable to Cents.
    const floatField: MoneyHolder = { amount: 12.5 };

    // @ts-expect-error LG-2: not even an integer literal — every value must go
    // through `cents()`, so there is exactly one validation boundary.
    const intField: MoneyHolder = { amount: 1250 };

    // @ts-expect-error LG-2: nor a computed float.
    const computed: MoneyHolder = { amount: 0.1 + 0.2 };

    // The values are unused by design — the directives above are the assertion.
    // Referencing them keeps `noUnusedLocals` quiet without weakening anything.
    expect([floatField, intField, computed]).toHaveLength(3);
  });

  it('LG-2: a plain number is not assignable to a Cents variable', () => {
    // @ts-expect-error LG-2: number is not Cents.
    const a: Cents = 500;
    // @ts-expect-error LG-2: a float is certainly not Cents.
    const b: Cents = 5.5;
    expect([a, b]).toHaveLength(2);
  });

  it('LG-2: money arithmetic refuses unbranded arguments', () => {
    const real = cents(1000);

    // @ts-expect-error LG-2: addCents takes Cents, not number.
    addCents(real, 250);
    // @ts-expect-error LG-2: subCents takes Cents, not number.
    subCents(1000, real);
    // @ts-expect-error LG-2: scaleCents' amount is Cents; only the factor is a float.
    scaleCents(1000, 2.5);
    // @ts-expect-error LG-2: clamp bounds are money too.
    clampCents(real, 0, 100_000);

    expect(real).toBe(1000);
  });

  it('LG-2: the sanctioned constructor produces an assignable value', () => {
    // The positive control. Without it, the file would still pass if `Cents`
    // became `never` — which would reject floats for the wrong reason and break
    // every real call site.
    const ok: MoneyHolder = { amount: cents(1250) };
    const scaled: Cents = scaleCents(ok.amount, 2.5);
    const summed: Cents = addCents(ok.amount, scaled);
    expect(summed).toBe(4375);
  });

  it('LG-2: a Cents value is still usable as a number for comparisons', () => {
    // The brand must not make money unusable in the arithmetic the engine
    // genuinely needs — comparisons and the multiplier product.
    const a = cents(1000);
    const b = cents(250);
    expect(a > b).toBe(true);
    expect(a * 2.5).toBe(2500);
  });
});
