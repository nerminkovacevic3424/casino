import { Minor, assertPositiveMinor, mulMinor } from '../money';
import { Rng, randomInt } from '../rng/rng';

/** European single-zero wheel, clockwise from zero. */
export const WHEEL_ORDER: readonly number[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24,
  16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];

export const RED_NUMBERS: ReadonlySet<number> = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export type PocketColor = 'green' | 'red' | 'black';

export const pocketColor = (n: number): PocketColor =>
  n === 0 ? 'green' : RED_NUMBERS.has(n) ? 'red' : 'black';

export type InsideBetType =
  'straight' | 'split' | 'street' | 'corner' | 'sixline';
export type DozenColumnBetType = 'column' | 'dozen';
export type EvenMoneyBetType =
  'red' | 'black' | 'odd' | 'even' | 'low' | 'high';
export type RouletteBetType =
  InsideBetType | DozenColumnBetType | EvenMoneyBetType;

export type RouletteBet =
  | {
      readonly type: InsideBetType;
      readonly numbers: readonly number[];
      readonly amount: Minor;
    }
  | {
      readonly type: DozenColumnBetType;
      readonly index: 1 | 2 | 3;
      readonly amount: Minor;
    }
  | { readonly type: EvenMoneyBetType; readonly amount: Minor };

/** Payout odds ("x to 1") by bet type. */
export const PAYOUT_ODDS: Readonly<Record<RouletteBetType, number>> = {
  straight: 35,
  split: 17,
  street: 11,
  corner: 8,
  sixline: 5,
  column: 2,
  dozen: 2,
  red: 1,
  black: 1,
  odd: 1,
  even: 1,
  low: 1,
  high: 1,
};

const INSIDE_SIZES: Readonly<Record<InsideBetType, number>> = {
  straight: 1,
  split: 2,
  street: 3,
  corner: 4,
  sixline: 6,
};

const sameSet = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length &&
  [...a]
    .sort((x, y) => x - y)
    .every((v, i) => v === [...b].sort((x, y) => x - y)[i]);

/** Table layout: rows of three (1-2-3, 4-5-6, ...); column = (n - 1) % 3. */
function isValidInside(
  type: InsideBetType,
  numbers: readonly number[],
): boolean {
  if (numbers.length !== INSIDE_SIZES[type]) return false;
  if (new Set(numbers).size !== numbers.length) return false;
  if (numbers.some((n) => !Number.isInteger(n) || n < 0 || n > 36))
    return false;
  const sorted = [...numbers].sort((a, b) => a - b);
  const [a] = sorted;
  switch (type) {
    case 'straight':
      return true;
    case 'split': {
      const b = sorted[1];
      if (a === 0) return b >= 1 && b <= 3;
      const horizontal = b === a + 1 && a % 3 !== 0;
      const vertical = b === a + 3;
      return horizontal || vertical;
    }
    case 'street':
      // Regular street, or the two zero "trios" 0-1-2 and 0-2-3.
      if (a === 0)
        return sameSet(sorted, [0, 1, 2]) || sameSet(sorted, [0, 2, 3]);
      return a % 3 === 1 && sameSet(sorted, [a, a + 1, a + 2]);
    case 'corner':
      // Regular corner, or "first four" 0-1-2-3.
      if (a === 0) return sameSet(sorted, [0, 1, 2, 3]);
      return (
        a % 3 !== 0 && a <= 32 && sameSet(sorted, [a, a + 1, a + 3, a + 4])
      );
    case 'sixline':
      return (
        a % 3 === 1 &&
        a <= 31 &&
        sameSet(sorted, [a, a + 1, a + 2, a + 3, a + 4, a + 5])
      );
  }
}

/** All numbers a bet covers. */
export function coveredNumbers(bet: RouletteBet): number[] {
  const all = Array.from({ length: 36 }, (_, i) => i + 1);
  switch (bet.type) {
    case 'straight':
    case 'split':
    case 'street':
    case 'corner':
    case 'sixline':
      return [...bet.numbers];
    case 'column':
      return all.filter((n) => (n - 1) % 3 === bet.index - 1);
    case 'dozen':
      return all.filter((n) => Math.ceil(n / 12) === bet.index);
    case 'red':
      return all.filter((n) => RED_NUMBERS.has(n));
    case 'black':
      return all.filter((n) => !RED_NUMBERS.has(n));
    case 'odd':
      return all.filter((n) => n % 2 === 1);
    case 'even':
      return all.filter((n) => n % 2 === 0);
    case 'low':
      return all.filter((n) => n <= 18);
    case 'high':
      return all.filter((n) => n >= 19);
  }
}

export interface RouletteLimits {
  readonly minChip: Minor;
  readonly maxInside: Minor;
  readonly maxOutside: Minor;
  readonly maxTotal: Minor;
  readonly maxBets: number;
}

export const DEFAULT_ROULETTE_LIMITS: RouletteLimits = {
  minChip: 10,
  maxInside: 10_000,
  maxOutside: 50_000,
  maxTotal: 200_000,
  maxBets: 150,
};

export const CHIP_DENOMINATIONS: readonly Minor[] = [
  10, 50, 100, 500, 1_000, 5_000,
];

export class InvalidRouletteBetError extends Error {
  override readonly name = 'InvalidRouletteBetError';
}

/** Validates the whole bet slip and returns the total stake. Throws on the first problem. */
export function validateRouletteBets(
  bets: readonly RouletteBet[],
  limits = DEFAULT_ROULETTE_LIMITS,
): Minor {
  if (bets.length === 0) throw new InvalidRouletteBetError('No bets placed');
  if (bets.length > limits.maxBets)
    throw new InvalidRouletteBetError('Too many bets');
  let total = 0;
  for (const bet of bets) {
    if (!Object.hasOwn(PAYOUT_ODDS, bet.type))
      throw new InvalidRouletteBetError(`Unknown bet type`);
    assertPositiveMinor(bet.amount, 'bet amount');
    if (bet.amount < limits.minChip || bet.amount % limits.minChip !== 0) {
      throw new InvalidRouletteBetError(
        `Bet amount must be a multiple of ${limits.minChip}`,
      );
    }
    const inside = Object.hasOwn(INSIDE_SIZES, bet.type);
    if (
      inside &&
      !(
        'numbers' in bet &&
        Array.isArray(bet.numbers) &&
        isValidInside(bet.type, bet.numbers)
      )
    ) {
      throw new InvalidRouletteBetError(`Invalid ${bet.type} bet`);
    }
    if (
      (bet.type === 'column' || bet.type === 'dozen') &&
      ![1, 2, 3].includes(bet.index)
    ) {
      throw new InvalidRouletteBetError(`Invalid ${bet.type} index`);
    }
    if (bet.amount > (inside ? limits.maxInside : limits.maxOutside)) {
      throw new InvalidRouletteBetError(
        `Bet exceeds the ${inside ? 'inside' : 'outside'} limit`,
      );
    }
    total += bet.amount;
  }
  if (total > limits.maxTotal)
    throw new InvalidRouletteBetError('Total stake exceeds the table limit');
  return total;
}

export interface RouletteBetResult {
  readonly bet: RouletteBet;
  readonly won: boolean;
  /** Amount returned to the player (stake + winnings) for this bet; 0 if lost. */
  readonly payout: Minor;
}

export interface RouletteRoundResult {
  readonly number: number;
  readonly color: PocketColor;
  readonly totalBet: Minor;
  readonly totalPayout: Minor;
  readonly bets: RouletteBetResult[];
}

export function settleRoulette(
  bets: readonly RouletteBet[],
  winning: number,
): RouletteRoundResult {
  const results = bets.map((bet): RouletteBetResult => {
    const won = coveredNumbers(bet).includes(winning);
    return {
      bet,
      won,
      payout: won ? mulMinor(bet.amount, PAYOUT_ODDS[bet.type] + 1) : 0,
    };
  });
  return {
    number: winning,
    color: pocketColor(winning),
    totalBet: bets.reduce((s, b) => s + b.amount, 0),
    totalPayout: results.reduce((s, r) => s + r.payout, 0),
    bets: results,
  };
}

export const spinWheel = (rng: Rng): number => randomInt(rng, 37);

export function playRoulette(
  bets: readonly RouletteBet[],
  rng: Rng,
  limits = DEFAULT_ROULETTE_LIMITS,
): RouletteRoundResult {
  validateRouletteBets(bets, limits);
  return settleRoulette(bets, spinWheel(rng));
}

// ----------------------------------------------------------------- racetrack

export type RacetrackBet = 'voisins' | 'tiers' | 'orphelins';

/** Expands a French announced bet into its standard chip placements, `unit` per chip. */
export function expandRacetrack(
  name: RacetrackBet,
  unit: Minor,
): RouletteBet[] {
  const split = (a: number, b: number): RouletteBet => ({
    type: 'split',
    numbers: [a, b],
    amount: unit,
  });
  switch (name) {
    case 'voisins': // 9 chips: 0-2-3 trio x2, 4/7, 12/15, 18/21, 19/22, 32/35, 25-29 corner x2
      return [
        { type: 'street', numbers: [0, 2, 3], amount: unit * 2 },
        split(4, 7),
        split(12, 15),
        split(18, 21),
        split(19, 22),
        split(32, 35),
        { type: 'corner', numbers: [25, 26, 28, 29], amount: unit * 2 },
      ];
    case 'tiers': // 6 chips
      return [
        split(5, 8),
        split(10, 11),
        split(13, 16),
        split(23, 24),
        split(27, 30),
        split(33, 36),
      ];
    case 'orphelins': // 5 chips
      return [
        { type: 'straight', numbers: [1], amount: unit },
        split(6, 9),
        split(14, 17),
        split(17, 20),
        split(31, 34),
      ];
  }
}

// ----------------------------------------------------------------- statistics

export interface HotColdStats {
  /** Most frequent numbers, most frequent first. */
  readonly hot: { number: number; count: number }[];
  /** Least frequent numbers (including never seen), least frequent first. */
  readonly cold: { number: number; count: number }[];
  readonly red: number;
  readonly black: number;
  readonly green: number;
}

export function hotColdStats(
  history: readonly number[],
  size = 5,
): HotColdStats {
  const counts = new Array<number>(37).fill(0);
  for (const n of history) counts[n]++;
  const ranked = counts.map((count, number) => ({ number, count }));
  const hot = [...ranked]
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || a.number - b.number);
  const cold = [...ranked].sort(
    (a, b) => a.count - b.count || a.number - b.number,
  );
  return {
    hot: hot.slice(0, size),
    cold: cold.slice(0, size),
    red: history.filter((n) => pocketColor(n) === 'red').length,
    black: history.filter((n) => pocketColor(n) === 'black').length,
    green: history.filter((n) => n === 0).length,
  };
}
