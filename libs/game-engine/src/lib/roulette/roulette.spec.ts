import { ScriptedRng, SeededRng } from '../rng/rng';
import {
  DEFAULT_ROULETTE_LIMITS,
  InvalidRouletteBetError,
  PAYOUT_ODDS,
  RED_NUMBERS,
  RouletteBet,
  WHEEL_ORDER,
  coveredNumbers,
  expandRacetrack,
  hotColdStats,
  playRoulette,
  pocketColor,
  settleRoulette,
  spinWheel,
  validateRouletteBets,
} from './roulette';

const inside = (
  type: 'straight' | 'split' | 'street' | 'corner' | 'sixline',
  numbers: number[],
  amount = 100,
) => ({ type, numbers, amount }) as RouletteBet;

/** One representative bet of every type. */
const ALL_BET_TYPES: RouletteBet[] = [
  inside('straight', [17]),
  inside('split', [17, 20]),
  inside('street', [16, 17, 18]),
  inside('corner', [17, 18, 20, 21]),
  inside('sixline', [13, 14, 15, 16, 17, 18]),
  { type: 'column', index: 2, amount: 100 },
  { type: 'dozen', index: 2, amount: 100 },
  { type: 'red', amount: 100 },
  { type: 'black', amount: 100 },
  { type: 'odd', amount: 100 },
  { type: 'even', amount: 100 },
  { type: 'low', amount: 100 },
  { type: 'high', amount: 100 },
];

describe('wheel', () => {
  it('has each of the 37 pockets exactly once', () => {
    expect(WHEEL_ORDER).toHaveLength(37);
    expect([...WHEEL_ORDER].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 37 }, (_, i) => i),
    );
  });

  it('colours 18 red, 18 black and zero green', () => {
    expect(RED_NUMBERS.size).toBe(18);
    expect(pocketColor(0)).toBe('green');
    expect(pocketColor(1)).toBe('red');
    expect(pocketColor(2)).toBe('black');
    expect(
      WHEEL_ORDER.slice(1).every(
        (n, i) => pocketColor(n) === (i % 2 === 0 ? 'red' : 'black'),
      ),
    ).toBe(true);
  });

  it('spins a number in 0..36 from the rng', () => {
    expect(spinWheel(new ScriptedRng([36]))).toBe(36);
    expect(spinWheel(new ScriptedRng([37]))).toBe(0);
  });
});

describe('bet coverage and payouts', () => {
  it.each(ALL_BET_TYPES.map((b) => [b.type, b] as const))(
    '%s returns 36/37 of the stake on average',
    (_, bet) => {
      // Exhaustive over all 37 pockets: every European bet has a house edge of exactly 1/37.
      const returned = Array.from(
        { length: 37 },
        (_, n) => settleRoulette([bet], n).totalPayout,
      ).reduce((a, b) => a + b);
      expect(returned).toBe(36 * bet.amount);
    },
  );

  it.each([
    ['straight', 1, 35],
    ['split', 2, 17],
    ['street', 3, 11],
    ['corner', 4, 8],
    ['sixline', 6, 5],
    ['column', 12, 2],
    ['dozen', 12, 2],
    ['red', 18, 1],
    ['black', 18, 1],
    ['odd', 18, 1],
    ['even', 18, 1],
    ['low', 18, 1],
    ['high', 18, 1],
  ] as const)('%s covers %i numbers and pays %i:1', (type, size, odds) => {
    const bet = ALL_BET_TYPES.find((b) => b.type === type)!;
    expect(coveredNumbers(bet)).toHaveLength(size);
    expect(PAYOUT_ODDS[type]).toBe(odds);
    const winner = coveredNumbers(bet)[0];
    expect(settleRoulette([bet], winner).bets[0]).toEqual({
      bet,
      won: true,
      payout: 100 * (odds + 1),
    });
  });

  it('loses every even-money bet on zero', () => {
    const outside = ALL_BET_TYPES.filter((b) => !('numbers' in b));
    expect(settleRoulette(outside, 0).totalPayout).toBe(0);
  });

  it('maps columns and dozens correctly', () => {
    expect(coveredNumbers({ type: 'column', index: 1, amount: 10 })).toEqual([
      1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34,
    ]);
    expect(coveredNumbers({ type: 'column', index: 3, amount: 10 })[0]).toBe(3);
    expect(coveredNumbers({ type: 'dozen', index: 3, amount: 10 })).toEqual(
      Array.from({ length: 12 }, (_, i) => 25 + i),
    );
  });

  it('totals a mixed slip', () => {
    const r = settleRoulette(
      [
        inside('straight', [5]),
        { type: 'red', amount: 50 },
        { type: 'even', amount: 30 },
      ],
      5,
    );
    expect(r).toMatchObject({
      number: 5,
      color: 'red',
      totalBet: 180,
      totalPayout: 3600 + 100,
    });
  });
});

describe('inside bet validation', () => {
  it.each([
    ['straight', [0]],
    ['straight', [36]],
    ['split', [1, 2]],
    ['split', [2, 3]],
    ['split', [1, 4]],
    ['split', [33, 36]],
    ['split', [0, 1]],
    ['split', [0, 2]],
    ['split', [0, 3]],
    ['street', [1, 2, 3]],
    ['street', [34, 35, 36]],
    ['street', [0, 1, 2]],
    ['street', [0, 2, 3]],
    ['corner', [1, 2, 4, 5]],
    ['corner', [32, 33, 35, 36]],
    ['corner', [0, 1, 2, 3]],
    ['sixline', [1, 2, 3, 4, 5, 6]],
    ['sixline', [31, 32, 33, 34, 35, 36]],
  ] as const)('accepts %s %j', (type, numbers) => {
    expect(validateRouletteBets([inside(type, [...numbers])])).toBe(100);
  });

  it.each([
    ['straight', [37]],
    ['straight', [-1]],
    ['straight', [1.5]],
    ['straight', [1, 2]],
    ['split', [3, 4]], // across rows
    ['split', [1, 5]],
    ['split', [0, 4]],
    ['split', [2, 2]],
    ['street', [2, 3, 4]],
    ['street', [0, 1, 3]],
    ['corner', [3, 4, 6, 7]], // wraps across the table edge
    ['corner', [34, 35, 37, 38]],
    ['corner', [0, 1, 2, 4]],
    ['corner', [1, 2, 3, 4]],
    ['sixline', [2, 3, 4, 5, 6, 7]],
    ['sixline', [34, 35, 36, 37, 38, 39]],
  ] as const)('rejects %s %j', (type, numbers) => {
    expect(() => validateRouletteBets([inside(type, [...numbers])])).toThrow(
      InvalidRouletteBetError,
    );
  });

  it('rejects inside bets without numbers', () => {
    expect(() =>
      validateRouletteBets([
        { type: 'split', amount: 100 } as unknown as RouletteBet,
      ]),
    ).toThrow('Invalid split bet');
  });
});

describe('slip validation', () => {
  it.each<[string, RouletteBet[], string]>([
    ['empty slip', [], 'No bets'],
    [
      'unknown type',
      [{ type: 'toString', amount: 100 } as unknown as RouletteBet],
      'Unknown bet type',
    ],
    ['zero amount', [{ type: 'red', amount: 0 }], 'greater than zero'],
    ['float amount', [{ type: 'red', amount: 10.5 }], 'safe integer'],
    ['off-chip amount', [{ type: 'red', amount: 15 }], 'multiple of 10'],
    [
      'bad column',
      [{ type: 'column', index: 4, amount: 10 } as unknown as RouletteBet],
      'Invalid column index',
    ],
    ['inside limit', [inside('straight', [1], 10_010)], 'inside limit'],
    ['outside limit', [{ type: 'red', amount: 50_010 }], 'outside limit'],
    [
      'table limit',
      Array.from(
        { length: 5 },
        () => ({ type: 'red', amount: 50_000 }) as RouletteBet,
      ),
      'table limit',
    ],
    [
      'too many bets',
      Array.from({ length: 151 }, () => inside('straight', [1], 10)),
      'Too many bets',
    ],
  ])('rejects %s', (_, bets, message) => {
    expect(() => validateRouletteBets(bets, DEFAULT_ROULETTE_LIMITS)).toThrow(
      message,
    );
  });

  it('validates then settles in playRoulette', () => {
    const r = playRoulette([{ type: 'black', amount: 100 }], new SeededRng(1));
    expect(r.number).toBeGreaterThanOrEqual(0);
    expect(r.totalPayout).toBe(pocketColor(r.number) === 'black' ? 200 : 0);
    expect(() => playRoulette([], new SeededRng(1))).toThrow(
      InvalidRouletteBetError,
    );
  });
});

describe('racetrack bets', () => {
  const chips = (bets: RouletteBet[]) =>
    bets.reduce((a, b) => a + b.amount, 0) / 10;
  const covered = (bets: RouletteBet[]) =>
    [...new Set(bets.flatMap(coveredNumbers))].sort((a, b) => a - b);

  it('voisins du zéro: 9 chips over the 17 numbers around zero', () => {
    const bets = expandRacetrack('voisins', 10);
    expect(chips(bets)).toBe(9);
    expect(covered(bets)).toEqual([
      0, 2, 3, 4, 7, 12, 15, 18, 19, 21, 22, 25, 26, 28, 29, 32, 35,
    ]);
  });

  it('tiers du cylindre: 6 splits over 12 numbers', () => {
    const bets = expandRacetrack('tiers', 10);
    expect(chips(bets)).toBe(6);
    expect(covered(bets)).toEqual([
      5, 8, 10, 11, 13, 16, 23, 24, 27, 30, 33, 36,
    ]);
  });

  it('orphelins: 5 chips over the remaining 8 numbers', () => {
    const bets = expandRacetrack('orphelins', 10);
    expect(chips(bets)).toBe(5);
    expect(covered(bets)).toEqual([1, 6, 9, 14, 17, 20, 31, 34]);
  });

  it('together the three sections cover the whole wheel', () => {
    const all = (['voisins', 'tiers', 'orphelins'] as const).flatMap((n) =>
      expandRacetrack(n, 10),
    );
    expect(covered(all)).toEqual(Array.from({ length: 37 }, (_, i) => i));
    expect(() => validateRouletteBets(all)).not.toThrow();
  });
});

describe('hot/cold stats', () => {
  it('ranks numbers by frequency', () => {
    const stats = hotColdStats([7, 7, 7, 0, 32, 32, 2], 2);
    expect(stats.hot).toEqual([
      { number: 7, count: 3 },
      { number: 32, count: 2 },
    ]);
    expect(stats.cold).toEqual([
      { number: 1, count: 0 },
      { number: 3, count: 0 },
    ]);
    expect(stats).toMatchObject({ red: 5, black: 1, green: 1 });
  });

  it('handles an empty history', () => {
    const stats = hotColdStats([]);
    expect(stats.hot).toEqual([]);
    expect(stats.cold).toHaveLength(5);
  });
});
