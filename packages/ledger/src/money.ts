/**
 * Integer minor units (US cents) — the only money representation in this repo.
 *
 * Spec: CLAUDE.md invariant 4, acceptance criteria LG-2.
 * `Cents` is a branded integer. A plain `number` is not assignable to it, so a
 * float that reached a money-typed field is a compile error rather than a
 * rounding bug found in production.
 */

declare const CENTS: unique symbol;

/** A signed amount of money in integer minor units (cents). */
export type Cents = number & { readonly [CENTS]: true };

/** Thrown when a value that must be integer cents is not. */
export class MoneyError extends Error {
  override readonly name = 'MoneyError';
}

/** True when `n` is a safe integer and therefore representable as `Cents`. */
export function isCents(n: number): boolean {
  return Number.isSafeInteger(n);
}

/**
 * Assert an already-integral `number` is `Cents`.
 * Throws on floats, NaN, Infinity, and values beyond 2^53−1 — a fail-fast
 * boundary check, per the input-validation rule.
 */
export function cents(n: number): Cents {
  if (!isCents(n)) {
    throw new MoneyError(`not integer minor units: ${n}`);
  }
  return n as Cents;
}

/** Zero, as `Cents`. */
export const ZERO: Cents = 0 as Cents;

/**
 * Round half away from zero — the rule fixed by PL-4.
 *
 * JavaScript's `Math.round` is half-UP (`Math.round(-2.5) === -2`), which is
 * asymmetric across zero and is the LG-2/PL-4 defect recorded in the roadmap
 * gap list. This rounds -2.5 to -3 and 2.5 to 3, so a long position and its
 * mirrored short round identically in magnitude.
 *
 * This is the single conversion point from multiplier floats to money, and
 * per PL-4 settlement must call it exactly once.
 */
export function roundHalfAwayFromZero(value: number): Cents {
  if (!Number.isFinite(value)) {
    throw new MoneyError(`cannot round non-finite value: ${value}`);
  }
  const rounded = value < 0 ? -Math.round(-value) : Math.round(value);
  // `Math.round` returns -0 for inputs in [-0.5, -0]; normalise so that
  // Object.is(payout, 0) holds and ledger sums never carry a signed zero.
  return cents(rounded === 0 ? 0 : rounded);
}

/** Add amounts. Overflow past the safe-integer range throws rather than silently losing precision. */
export function addCents(a: Cents, b: Cents): Cents {
  return cents(a + b);
}

/** Subtract `b` from `a`. */
export function subCents(a: Cents, b: Cents): Cents {
  return cents(a - b);
}

/** Negate an amount. */
export function negateCents(a: Cents): Cents {
  return cents(-a);
}

/**
 * Multiply an amount by a dimensionless float factor (e.g. a multiplier `M`)
 * and round once, half away from zero. The only sanctioned float→money path.
 */
export function scaleCents(amount: Cents, factor: number): Cents {
  return roundHalfAwayFromZero(amount * factor);
}

/** Clamp to a range, both bounds inclusive. */
export function clampCents(value: Cents, min: Cents, max: Cents): Cents {
  if (min > max) {
    throw new MoneyError(`clamp bounds inverted: min=${min} max=${max}`);
  }
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
