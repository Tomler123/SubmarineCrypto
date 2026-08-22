import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  addCents,
  cents,
  clampCents,
  isCents,
  negateCents,
  roundHalfAwayFromZero,
  scaleCents,
  subCents,
} from '../src/index.js';

describe('LG-2 — all amounts are integer minor units end to end', () => {
  it('LG-2: accepts safe integers', () => {
    expect(cents(0)).toBe(0);
    expect(cents(-2500)).toBe(-2500);
    expect(cents(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('LG-2: rejects a float reaching a money field', () => {
    expect(() => cents(12.5)).toThrow(MoneyError);
    expect(() => cents(0.1 + 0.2)).toThrow(MoneyError);
  });

  it('LG-2: rejects NaN, Infinity and values past the safe-integer range', () => {
    expect(() => cents(Number.NaN)).toThrow(MoneyError);
    expect(() => cents(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
    expect(() => cents(Number.NEGATIVE_INFINITY)).toThrow(MoneyError);
    expect(() => cents(Number.MAX_SAFE_INTEGER + 1)).toThrow(MoneyError);
  });

  it('LG-2: isCents agrees with cents() without throwing', () => {
    expect(isCents(5)).toBe(true);
    expect(isCents(5.5)).toBe(false);
    expect(isCents(Number.NaN)).toBe(false);
  });
});

describe('PL-4 — settlement rounds half away from zero, exactly once', () => {
  it('PL-4: rounds .5 away from zero in both directions', () => {
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(roundHalfAwayFromZero(3.5)).toBe(4);
    expect(roundHalfAwayFromZero(-3.5)).toBe(-4);
  });

  it('PL-4: differs from Math.round on negative halves — the recorded defect', () => {
    // Math.round(-2.5) === -2 (half-up). The spec requires -3.
    expect(Math.round(-2.5)).toBe(-2);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
  });

  it('PL-4: is symmetric across zero for every half-integer', () => {
    for (let n = -10.5; n <= 10.5; n += 1) {
      expect(roundHalfAwayFromZero(n)).toBe(-roundHalfAwayFromZero(-n));
    }
  });

  it('PL-4: leaves non-half values on ordinary nearest rounding', () => {
    expect(roundHalfAwayFromZero(2.4)).toBe(2);
    expect(roundHalfAwayFromZero(2.6)).toBe(3);
    expect(roundHalfAwayFromZero(-2.4)).toBe(-2);
    expect(roundHalfAwayFromZero(-2.6)).toBe(-3);
  });

  it('PL-4: never returns negative zero', () => {
    expect(Object.is(roundHalfAwayFromZero(-0.4), 0)).toBe(true);
    expect(Object.is(roundHalfAwayFromZero(-0), 0)).toBe(true);
  });

  it('PL-4: rejects non-finite input rather than producing NaN money', () => {
    expect(() => roundHalfAwayFromZero(Number.NaN)).toThrow(MoneyError);
    expect(() => roundHalfAwayFromZero(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
  });

  it('PL-4: scaleCents is the single float-to-money conversion', () => {
    // $10.00 stake at multiplier 2.5 → $25.00
    expect(scaleCents(cents(1000), 2.5)).toBe(2500);
    // half-cent results round away from zero
    expect(scaleCents(cents(1), 2.5)).toBe(3);
    expect(scaleCents(cents(-1), 2.5)).toBe(-3);
  });
});

describe('LG-1 — arithmetic keeps balances integral', () => {
  it('LG-1: add/sub/negate stay in integer minor units', () => {
    expect(addCents(cents(1000), cents(-250))).toBe(750);
    expect(subCents(cents(1000), cents(250))).toBe(750);
    expect(negateCents(cents(750))).toBe(-750);
  });

  it('LG-1: overflow past the safe-integer range throws rather than losing precision', () => {
    expect(() => addCents(cents(Number.MAX_SAFE_INTEGER), cents(1))).toThrow(MoneyError);
  });
});

describe('PL-4 — payout bounds are clampable', () => {
  it('PL-4: clampCents bounds a payout to [0, cap]', () => {
    const floor = cents(0);
    const cap = cents(1_000_000); // $10,000 max win
    expect(clampCents(cents(-500), floor, cap)).toBe(0);
    expect(clampCents(cents(2_000_000), floor, cap)).toBe(1_000_000);
    expect(clampCents(cents(12_345), floor, cap)).toBe(12_345);
  });

  it('PL-4: inverted clamp bounds are a programming error, not a silent swap', () => {
    expect(() => clampCents(cents(5), cents(10), cents(0))).toThrow(MoneyError);
  });
});
