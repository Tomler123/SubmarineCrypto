export interface SeededRandom {
  next(): number;
  gaussian(): number;
}

/** FNV-1a tuple hashing, frozen as `fnv1a32/mulberry32-v1` by MC-2. */
export function deriveSeed(...parts: readonly (string | number)[]): number {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    const value = `${String(part)}\u001f`;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return hash >>> 0;
}

/** Small deterministic PRNG with a Box-Muller Gaussian adapter. */
export function createSeededRandom(seed: number): SeededRandom {
  let state = seed >>> 0;
  let spareGaussian: number | null = null;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };

  const gaussian = (): number => {
    if (spareGaussian !== null) {
      const value = spareGaussian;
      spareGaussian = null;
      return value;
    }
    let first = next();
    while (first === 0) first = next();
    const second = next();
    const magnitude = Math.sqrt(-2 * Math.log(first));
    const angle = 2 * Math.PI * second;
    spareGaussian = magnitude * Math.sin(angle);
    return magnitude * Math.cos(angle);
  };

  return { next, gaussian };
}

export function uniformIndex(random: SeededRandom, count: number): number {
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new RangeError('uniform index count must be a positive safe integer');
  }
  return Math.floor(random.next() * count);
}
