import { SeededRng } from '../rng/rng';
import { MEGAWAYS } from './configs';
import { playSlot } from './slot-engine';
import { Grid, WaysSlotConfig } from './types';
import {
  createWaysContext,
  evaluateWays,
  playWaysRound,
  tumble,
  waysCount,
} from './ways';

const ctx = createWaysContext(MEGAWAYS);

describe('evaluateWays', () => {
  const grid: Grid = [
    ['ACE', 'NINE'],
    ['ACE', 'WILD', 'TEN'],
    ['ACE', 'ACE', 'KING'],
    ['QUEEN', 'JACK'],
    ['QUEEN', 'JACK'],
    ['QUEEN', 'JACK'],
  ];

  it('multiplies matching cells per reel, with wilds substituting', () => {
    const wins = evaluateWays(ctx, grid, 1, 1);
    expect(wins).toHaveLength(1);
    const [ace] = wins;
    expect(ace).toMatchObject({ symbol: 'ACE', reels: 3, ways: 1 * 2 * 2 });
    expect(ace.win).toBe(MEGAWAYS.paytable['ACE'][3]! * 4);
    expect(ace.cells).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 0],
      [2, 1],
    ]);
  });

  it('scales by bet unit and multiplier', () => {
    expect(evaluateWays(ctx, grid, 5, 3)[0].win).toBe(
      MEGAWAYS.paytable['ACE'][3]! * 4 * 5 * 3,
    );
  });

  it('pays nothing for fewer than three reels', () => {
    const short: Grid = [
      ['NINE'],
      ['WILD'],
      ['TEN'],
      ['TEN'],
      ['TEN'],
      ['TEN'],
    ];
    expect(evaluateWays(ctx, short, 1, 1)).toEqual([]);
  });
});

describe('tumble', () => {
  const config: WaysSlotConfig = {
    ...MEGAWAYS,
    reels: [['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']],
  };

  it('drops survivors and refills from the strip above the window', () => {
    // Window shows strip[2..4] = C, D, E; remove D.
    const tops = [2];
    const next = tumble(
      config,
      [['C', 'D', 'E']],
      [{ symbol: 'D', reels: 1, ways: 1, cells: [[0, 1]], win: 1 }],
      tops,
    );
    expect(next).toEqual([['B', 'C', 'E']]);
    expect(tops).toEqual([1]);
  });

  it('wraps around the top of the strip', () => {
    const tops = [0];
    const cells: [number, number][] = [
      [0, 0],
      [0, 1],
    ];
    const next = tumble(
      config,
      [['A', 'B', 'C']],
      [{ symbol: 'A', reels: 1, ways: 1, cells, win: 1 }],
      tops,
    );
    expect(next).toEqual([['G', 'H', 'C']]);
    expect(tops).toEqual([6]);
  });

  it('leaves untouched reels as they are', () => {
    const column = ['A', 'B'];
    expect(tumble(config, [column], [], [0])[0]).toBe(column);
  });
});

describe('playWaysRound', () => {
  it('cascades with a growing multiplier until no win remains', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = playWaysRound(ctx, 100, new SeededRng(seed));
      expect(r.rows.every((n) => n >= 2 && n <= 7)).toBe(true);
      r.cascades.forEach((c, i) => expect(c.multiplier).toBe(1 + i));
      const last = r.cascades[r.cascades.length - 1];
      if (r.cascades.length <= MEGAWAYS.maxCascades)
        expect(last.wins).toEqual([]);
      expect(r.totalWin).toBe(
        Math.min(
          r.cascades.reduce((a, c) => a + c.win, 0),
          100 * MEGAWAYS.maxWinMultiplier,
        ),
      );
      r.cascades.forEach((c) =>
        c.grid.forEach((col, reel) => expect(col).toHaveLength(r.rows[reel])),
      );
    }
  });

  it('stops after maxCascades and caps the win', () => {
    const config: WaysSlotConfig = {
      ...MEGAWAYS,
      id: 'always-wins',
      symbols: [{ id: 'A', name: 'A', kind: 'regular' }],
      reels: Array.from({ length: 6 }, () => Array(7).fill('A')),
      paytable: { A: { 6: 1 } },
      maxCascades: 3,
      maxWinMultiplier: 50,
    };
    const r = playSlot(config, 100, new SeededRng(1));
    expect(r.kind).toBe('ways');
    if (r.kind !== 'ways') return;
    expect(r.cascades).toHaveLength(4);
    expect(r.cascades.map((c) => c.multiplier)).toEqual([1, 2, 3, 4]);
    expect(r.cascades[3].wins).toHaveLength(1);
    expect(r.capped).toBe(true);
    expect(r.totalWin).toBe(5000);
  });

  it('counts ways', () => {
    expect(waysCount([7, 7, 7, 7, 7, 7])).toBe(117_649);
    expect(waysCount([2, 3])).toBe(6);
  });
});
