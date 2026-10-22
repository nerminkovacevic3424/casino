import { RED_NUMBERS, type RouletteBet } from '@casino/game-engine';

/** A bet without its amount. */
export type BetSpec =
  | {
      readonly type: 'straight' | 'split' | 'street' | 'corner' | 'sixline';
      readonly numbers: readonly number[];
    }
  | { readonly type: 'column' | 'dozen'; readonly index: 1 | 2 | 3 }
  | { readonly type: 'red' | 'black' | 'odd' | 'even' | 'low' | 'high' };

/**
 * A clickable spot on the felt, placed on a CSS grid:
 *   column 1 = zero, 2 = gap after zero, then for number column c (0-11)
 *   3+2c = numbers, 4+2c = gap; 27 = "2 to 1" column bets.
 *   rows 1/3/5 = number rows (top row holds 3, 6, ... 36), 2/4 = gaps, 6 = street edge.
 */
export interface Spot {
  readonly key: string;
  readonly spec: BetSpec;
  readonly label: string;
  readonly gridColumn: number;
  readonly gridRow: number;
  readonly kind: 'number' | 'zero' | 'between' | 'edge' | 'column';
  /** Numbers to highlight when hovering the spot. */
  readonly covers: readonly number[];
}

/** Number at layout column c (0-11), row r (0 = top). */
export const numberAt = (c: number, r: number): number => 3 * c + (3 - r);

export function betKey(spec: BetSpec): string {
  if ('numbers' in spec)
    return `${spec.type}:${[...spec.numbers].sort((a, b) => a - b).join('-')}`;
  if ('index' in spec) return `${spec.type}:${spec.index}`;
  return spec.type;
}

const inside = (
  type: 'straight' | 'split' | 'street' | 'corner' | 'sixline',
  numbers: number[],
): BetSpec => ({
  type,
  numbers,
});

function spot(
  spec: BetSpec,
  label: string,
  gridColumn: number,
  gridRow: number,
  kind: Spot['kind'],
  covers: number[],
): Spot {
  return { key: betKey(spec), spec, label, gridColumn, gridRow, kind, covers };
}

const list = (ns: readonly number[]) => ns.join(', ');

/** Every inside bet and the column bets, positioned on the layout grid. */
export function tableSpots(): Spot[] {
  const spots: Spot[] = [];
  spots.push(
    spot(
      inside('straight', [0]),
      $localize`:@@roulette.spot.zero:Straight up 0`,
      1,
      1,
      'zero',
      [0],
    ),
  );

  for (let c = 0; c < 12; c++) {
    for (let r = 0; r < 3; r++) {
      const n = numberAt(c, r);
      const colour = RED_NUMBERS.has(n)
        ? $localize`:@@roulette.red:red`
        : $localize`:@@roulette.black:black`;
      spots.push(
        spot(
          inside('straight', [n]),
          $localize`:@@roulette.spot.straight:Straight up ${n}:n: (${colour}:colour:)`,
          3 + 2 * c,
          1 + 2 * r,
          'number',
          [n],
        ),
      );
      // Split with the number below (same column).
      if (r < 2) {
        const ns = [n, numberAt(c, r + 1)];
        spots.push(
          spot(
            inside('split', ns),
            $localize`:@@roulette.spot.split:Split ${list(ns)}:numbers:`,
            3 + 2 * c,
            2 + 2 * r,
            'between',
            ns,
          ),
        );
      }
      // Split with the number to the right (next column).
      if (c < 11) {
        const ns = [n, numberAt(c + 1, r)];
        spots.push(
          spot(
            inside('split', ns),
            $localize`:@@roulette.spot.split:Split ${list(ns)}:numbers:`,
            4 + 2 * c,
            1 + 2 * r,
            'between',
            ns,
          ),
        );
      }
      // Corner with the numbers below and to the right.
      if (c < 11 && r < 2) {
        const ns = [
          n,
          numberAt(c, r + 1),
          numberAt(c + 1, r),
          numberAt(c + 1, r + 1),
        ];
        spots.push(
          spot(
            inside('corner', ns),
            $localize`:@@roulette.spot.corner:Corner ${list(ns)}:numbers:`,
            4 + 2 * c,
            2 + 2 * r,
            'between',
            ns,
          ),
        );
      }
    }
    const street = [3 * c + 1, 3 * c + 2, 3 * c + 3];
    spots.push(
      spot(
        inside('street', street),
        $localize`:@@roulette.spot.street:Street ${list(street)}:numbers:`,
        3 + 2 * c,
        6,
        'edge',
        street,
      ),
    );
    if (c < 11) {
      const six = [...street, 3 * c + 4, 3 * c + 5, 3 * c + 6];
      spots.push(
        spot(
          inside('sixline', six),
          $localize`:@@roulette.spot.six:Six line ${list(six)}:numbers:`,
          4 + 2 * c,
          6,
          'edge',
          six,
        ),
      );
    }
  }

  // Bets touching zero.
  for (let r = 0; r < 3; r++) {
    const ns = [0, numberAt(0, r)];
    spots.push(
      spot(
        inside('split', ns),
        $localize`:@@roulette.spot.split:Split ${list(ns)}:numbers:`,
        2,
        1 + 2 * r,
        'between',
        ns,
      ),
    );
  }
  for (let r = 0; r < 2; r++) {
    const ns = [0, numberAt(0, r), numberAt(0, r + 1)];
    spots.push(
      spot(
        inside('street', ns),
        $localize`:@@roulette.spot.trio:Trio ${list(ns)}:numbers:`,
        2,
        2 + 2 * r,
        'between',
        ns,
      ),
    );
  }
  spots.push(
    spot(
      inside('corner', [0, 1, 2, 3]),
      $localize`:@@roulette.spot.firstFour:First four 0, 1, 2, 3`,
      2,
      6,
      'edge',
      [0, 1, 2, 3],
    ),
  );

  // Column bets ("2 to 1") at the right end of each row.
  for (let r = 0; r < 3; r++) {
    const index = (3 - r) as 1 | 2 | 3;
    const covers = Array.from({ length: 12 }, (_, c) => numberAt(c, r));
    spots.push(
      spot(
        { type: 'column', index },
        $localize`:@@roulette.spot.column:Column ${index}:index: (pays 2 to 1)`,
        27,
        1 + 2 * r,
        'column',
        covers,
      ),
    );
  }
  return spots;
}

/** Outside bets shown below the grid. */
export function outsideSpots(): {
  spec: BetSpec;
  key: string;
  label: string;
  covers: number[];
}[] {
  const all = Array.from({ length: 36 }, (_, i) => i + 1);
  const make = (spec: BetSpec, label: string, covers: number[]) => ({
    spec,
    key: betKey(spec),
    label,
    covers,
  });
  return [
    make(
      { type: 'dozen', index: 1 },
      $localize`:@@roulette.dozen1:1st 12`,
      all.slice(0, 12),
    ),
    make(
      { type: 'dozen', index: 2 },
      $localize`:@@roulette.dozen2:2nd 12`,
      all.slice(12, 24),
    ),
    make(
      { type: 'dozen', index: 3 },
      $localize`:@@roulette.dozen3:3rd 12`,
      all.slice(24),
    ),
    make({ type: 'low' }, $localize`:@@roulette.low:1 to 18`, all.slice(0, 18)),
    make(
      { type: 'even' },
      $localize`:@@roulette.even:Even`,
      all.filter((n) => n % 2 === 0),
    ),
    make(
      { type: 'red' },
      $localize`:@@roulette.redBet:Red`,
      all.filter((n) => RED_NUMBERS.has(n)),
    ),
    make(
      { type: 'black' },
      $localize`:@@roulette.blackBet:Black`,
      all.filter((n) => !RED_NUMBERS.has(n)),
    ),
    make(
      { type: 'odd' },
      $localize`:@@roulette.odd:Odd`,
      all.filter((n) => n % 2 === 1),
    ),
    make({ type: 'high' }, $localize`:@@roulette.high:19 to 36`, all.slice(18)),
  ];
}

export function withAmount(spec: BetSpec, amount: number): RouletteBet {
  return {
    ...spec,
    ...('numbers' in spec ? { numbers: [...spec.numbers] } : {}),
    amount,
  } as RouletteBet;
}
