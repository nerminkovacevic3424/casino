import { coveredNumbers, validateRouletteBets } from '@casino/game-engine';
import {
  betKey,
  numberAt,
  outsideSpots,
  tableSpots,
  withAmount,
} from './table-layout';

describe('roulette table layout', () => {
  const spots = tableSpots();

  it('places the numbers in the standard layout (3, 6 … 36 on top)', () => {
    expect(numberAt(0, 0)).toBe(3);
    expect(numberAt(0, 2)).toBe(1);
    expect(numberAt(11, 0)).toBe(36);
    const straights = spots
      .filter((s) => s.spec.type === 'straight')
      .map((s) => (s.spec as { numbers: number[] }).numbers[0]);
    expect(straights.sort((a, b) => a - b)).toEqual(
      Array.from({ length: 37 }, (_, i) => i),
    );
  });

  it('has every legal inside bet exactly once', () => {
    const count = (type: string) =>
      spots.filter((s) => s.spec.type === type).length;
    // 57 splits (incl. 3 with zero), 12 streets + 2 trios, 22 corners + first four, 11 six lines, 3 columns.
    expect(count('split')).toBe(60);
    expect(count('street')).toBe(14);
    expect(count('corner')).toBe(23);
    expect(count('sixline')).toBe(11);
    expect(count('column')).toBe(3);
    expect(new Set(spots.map((s) => s.key)).size).toBe(spots.length);
  });

  it('only produces bets the engine accepts, covering what the spot highlights', () => {
    const all = [
      ...spots.map((s) => ({ spec: s.spec, covers: s.covers })),
      ...outsideSpots(),
    ];
    for (const { spec, covers } of all) {
      const bet = withAmount(spec, 10);
      expect(() => validateRouletteBets([bet])).not.toThrow();
      expect([...coveredNumbers(bet)].sort((a, b) => a - b)).toEqual(
        [...covers].sort((a, b) => a - b),
      );
    }
  });

  it('keys bets independently of number order', () => {
    expect(betKey({ type: 'split', numbers: [20, 17] })).toBe(
      betKey({ type: 'split', numbers: [17, 20] }),
    );
    expect(betKey({ type: 'dozen', index: 2 })).toBe('dozen:2');
    expect(betKey({ type: 'red' })).toBe('red');
  });
});
