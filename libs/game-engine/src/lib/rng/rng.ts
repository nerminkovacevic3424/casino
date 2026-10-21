/**
 * Source of uniformly distributed integers consumed by every game.
 *
 * Games never touch `Math.random`; they receive an `Rng` so that the same
 * code resolves real bets (provably fair HMAC stream), replays them for
 * verification, and runs fast seeded simulations.
 */
export interface Rng {
  /** Next uniformly distributed unsigned 32-bit integer. */
  nextUint32(): number;
}

const TWO_32 = 0x100000000;

/** Uniform integer in [0, maxExclusive) using rejection sampling (no modulo bias). */
export function randomInt(rng: Rng, maxExclusive: number): number {
  if (
    !Number.isInteger(maxExclusive) ||
    maxExclusive < 1 ||
    maxExclusive > TWO_32
  ) {
    throw new RangeError(
      `maxExclusive must be an integer in [1, 2^32], got ${maxExclusive}`,
    );
  }
  const limit = TWO_32 - (TWO_32 % maxExclusive);
  let value = rng.nextUint32();
  while (value >= limit) value = rng.nextUint32();
  return value % maxExclusive;
}

/** Picks an index with probability proportional to its (non-negative integer) weight. */
export function weightedIndex(rng: Rng, weights: readonly number[]): number {
  let total = 0;
  for (const w of weights) {
    if (!Number.isInteger(w) || w < 0)
      throw new RangeError('Weights must be non-negative integers');
    total += w;
  }
  if (total === 0) throw new RangeError('At least one weight must be positive');
  let r = randomInt(rng, total);
  for (let i = 0; i < weights.length; i++) {
    if (r < weights[i]) return i;
    r -= weights[i];
  }
  /* istanbul ignore next -- unreachable: r < total by construction */
  throw new Error('weightedIndex: unreachable');
}

/** In-place Fisher–Yates shuffle; returns the same array for convenience. */
export function shuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}

/**
 * xoshiro128** — a fast, high-quality, *non-cryptographic* PRNG.
 * Used only for RTP simulations and tests, never for real bets.
 */
export class SeededRng implements Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: number) {
    // SplitMix32 expands the seed so nearby seeds give unrelated streams.
    let x = seed >>> 0;
    const next = (): number => {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.s0 = next();
    this.s1 = next();
    this.s2 = next();
    this.s3 = next();
  }

  nextUint32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    this.s0 >>>= 0;
    this.s1 >>>= 0;
    this.s2 >>>= 0;
    return result;
  }
}

const rotl = (x: number, k: number): number =>
  ((x << k) | (x >>> (32 - k))) >>> 0;

/** Replays a fixed list of values; handy for forcing exact outcomes in tests. */
export class ScriptedRng implements Rng {
  private index = 0;
  constructor(private readonly values: readonly number[]) {}

  nextUint32(): number {
    if (this.index >= this.values.length)
      throw new Error('ScriptedRng exhausted');
    return this.values[this.index++] >>> 0;
  }
}
