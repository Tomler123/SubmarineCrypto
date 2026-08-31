import { describe, expect, it } from 'vitest';
import { createSeededRandom, deriveSeed } from '../src/index.js';

describe('MC-2 — trial-addressed seeded randomness', () => {
  it('derives a stable stream from explicit identifiers', () => {
    const seed = deriveSeed('m1.7-reference-v1', 'simulator', 'random-hold', 42);
    const first = createSeededRandom(seed);
    const second = createSeededRandom(seed);

    expect(Array.from({ length: 8 }, () => first.next()))
      .toEqual(Array.from({ length: 8 }, () => second.next()));
  });

  it('does not alias distinct trials or depend on another stream being consumed', () => {
    const first = createSeededRandom(deriveSeed('seed', 'source', 'model', 1));
    const secondSeed = deriveSeed('seed', 'source', 'model', 2);
    const expectedSecond = createSeededRandom(secondSeed);

    for (let index = 0; index < 100; index += 1) first.next();
    const actualSecond = createSeededRandom(secondSeed);

    expect(actualSecond.next()).toBe(expectedSecond.next());
    expect(deriveSeed('seed', 'source', 'model', 1)).not.toBe(secondSeed);
  });

  it('produces finite half-open uniform values and seeded Gaussian values', () => {
    const random = createSeededRandom(12345);
    const values = Array.from({ length: 1_000 }, () => ({
      uniform: random.next(),
      gaussian: random.gaussian(),
    }));
    expect(values.every(({ uniform }) => uniform >= 0 && uniform < 1)).toBe(true);
    expect(values.every(({ gaussian }) => Number.isFinite(gaussian))).toBe(true);
  });
});
