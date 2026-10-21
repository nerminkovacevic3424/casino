import {
  Rng,
  ScriptedRng,
  SeededRng,
  randomInt,
  shuffle,
  weightedIndex,
} from './rng';

describe('randomInt', () => {
  it('maps values into range', () => {
    expect(randomInt(new ScriptedRng([7]), 10)).toBe(7);
    expect(randomInt(new ScriptedRng([17]), 10)).toBe(7);
    expect(randomInt(new ScriptedRng([0xffffffff]), 1)).toBe(0);
  });

  it('rejects values in the biased tail instead of using modulo', () => {
    // For max = 3, limit = 2^32 - (2^32 % 3) = 4294967295; 0xffffffff must be rejected.
    const rng = new ScriptedRng([0xffffffff, 5]);
    expect(randomInt(rng, 3)).toBe(2);
    expect(() => rng.nextUint32()).toThrow('exhausted');
  });

  it.each([0, -1, 1.5, 2 ** 32 + 1, Number.NaN])('rejects max %p', (max) => {
    expect(() => randomInt(new SeededRng(1), max)).toThrow(RangeError);
  });

  it('accepts the full 2^32 range', () => {
    expect(randomInt(new ScriptedRng([0xffffffff]), 2 ** 32)).toBe(0xffffffff);
  });

  it('is roughly uniform (chi-square sanity check)', () => {
    const rng = new SeededRng(42);
    const buckets = new Array(10).fill(0);
    const n = 100_000;
    for (let i = 0; i < n; i++) buckets[randomInt(rng, 10)]++;
    const expected = n / 10;
    const chi = buckets.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
    expect(chi).toBeLessThan(27.88); // p = 0.001 for 9 degrees of freedom
  });
});

describe('weightedIndex', () => {
  it('selects by cumulative weight', () => {
    const weights = [1, 0, 3];
    expect(weightedIndex(new ScriptedRng([0]), weights)).toBe(0);
    expect(weightedIndex(new ScriptedRng([1]), weights)).toBe(2);
    expect(weightedIndex(new ScriptedRng([3]), weights)).toBe(2);
  });

  it('validates weights', () => {
    expect(() => weightedIndex(new SeededRng(1), [0, 0])).toThrow('positive');
    expect(() => weightedIndex(new SeededRng(1), [1, -1])).toThrow(
      'non-negative',
    );
    expect(() => weightedIndex(new SeededRng(1), [0.5])).toThrow(
      'non-negative',
    );
  });
});

describe('shuffle', () => {
  it('produces a permutation of the input', () => {
    const items = Array.from({ length: 52 }, (_, i) => i);
    const shuffled = shuffle(new SeededRng(7), [...items]);
    expect(shuffled).not.toEqual(items);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
  });

  it('gives every permutation of 3 items equal probability', () => {
    const rng = new SeededRng(3);
    const counts = new Map<string, number>();
    for (let i = 0; i < 60_000; i++) {
      const key = shuffle(rng, ['a', 'b', 'c']).join('');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    for (const c of counts.values())
      expect(Math.abs(c - 10_000)).toBeLessThan(500);
  });
});

describe('SeededRng', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const take = (rng: Rng) =>
      Array.from({ length: 5 }, () => rng.nextUint32());
    expect(take(new SeededRng(1))).toEqual(take(new SeededRng(1)));
    expect(take(new SeededRng(1))).not.toEqual(take(new SeededRng(2)));
  });

  it('returns unsigned 32-bit integers', () => {
    const rng = new SeededRng(99);
    for (let i = 0; i < 1000; i++) {
      const v = rng.nextUint32();
      expect(Number.isInteger(v) && v >= 0 && v <= 0xffffffff).toBe(true);
    }
  });
});
