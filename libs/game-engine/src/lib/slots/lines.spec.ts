import { Rng, ScriptedRng, SeededRng } from '../rng/rng';
import { exactLinesBaseRtp } from '../simulation/simulate';
import { CLASSIC_3_REEL, VIDEO_5_REEL } from './configs';
import {
  createLinesContext,
  evaluateLine,
  evaluateSpin,
  findSymbolCells,
  gridFromStops,
  isBonusTriggered,
  playLinesRound,
  playPickBonus,
} from './lines';
import { playSlot } from './slot-engine';
import { Grid, LinesSlotConfig, PickBonusFeature } from './types';

/** Feeds scripted values first, then falls back to a seeded stream. */
class PrefixRng implements Rng {
  private readonly fallback = new SeededRng(1);
  private i = 0;
  constructor(private readonly prefix: number[]) {}
  nextUint32(): number {
    return this.i < this.prefix.length
      ? this.prefix[this.i++]
      : this.fallback.nextUint32();
  }
}

/** Stop index that places `symbol` on `row` of the given reel. */
function stopFor(
  config: LinesSlotConfig,
  reel: number,
  symbol: string,
  row = 0,
): number {
  const strip = config.reels[reel];
  const idx = strip.indexOf(symbol);
  if (idx < 0) throw new Error(`${symbol} not on reel ${reel}`);
  return (idx - row + strip.length) % strip.length;
}

/** Column-major grid from row-major rows, which reads more naturally in tests. */
const rowsToGrid = (rows: string[][]): Grid =>
  rows[0].map((_, reel) => rows.map((r) => r[reel]));

const classic = createLinesContext(CLASSIC_3_REEL);

describe('classic 3-reel math', () => {
  it('has an exact base RTP of 96.13% and 40.77% hit frequency', () => {
    const { rtp, hitFrequency, combinations } =
      exactLinesBaseRtp(CLASSIC_3_REEL);
    expect(combinations).toBe(32 ** 3);
    expect(rtp).toBeCloseTo(0.9613037109375, 12);
    expect(Math.abs(rtp - CLASSIC_3_REEL.targetRtp)).toBeLessThan(0.005);
    expect(hitFrequency).toBeCloseTo(0.40771484375, 12);
  });
});

describe('evaluateLine', () => {
  const lineBet = 10;
  const middle = (a: string, b: string, c: string): Grid =>
    rowsToGrid([
      ['LEMON', 'PLUM', 'BELL'],
      [a, b, c],
      ['PLUM', 'BELL', 'LEMON'],
    ]);

  it.each([
    ['three of a kind', ['BELL', 'BELL', 'BELL'], 'BELL', 3, 40],
    [
      'wild substitutes in the middle',
      ['CHERRY', 'WILD', 'CHERRY'],
      'CHERRY',
      3,
      10,
    ],
    ['leading wilds substitute', ['WILD', 'WILD', 'SEVEN'], 'SEVEN', 3, 300],
    [
      'three wilds pay the wild prize',
      ['WILD', 'WILD', 'WILD'],
      'WILD',
      3,
      1000,
    ],
    ['two cherries pay', ['CHERRY', 'CHERRY', 'LEMON'], 'CHERRY', 2, 1],
    [
      'wild plus cherry counts as two cherries',
      ['WILD', 'CHERRY', 'BAR'],
      'CHERRY',
      2,
      1,
    ],
  ])('%s', (_, [a, b, c], symbol, count, pay) => {
    const win = evaluateLine(classic, middle(a, b, c), 0, lineBet, 1);
    expect(win).toMatchObject({ line: 0, symbol, count, win: pay * lineBet });
    expect(win?.cells).toEqual(
      Array.from({ length: count }, (_, reel) => [reel, 1]),
    );
  });

  it.each([
    ['no match', ['LEMON', 'LEMON', 'CHERRY']],
    ['match not starting on reel 1', ['LEMON', 'BELL', 'BELL']],
    ['two lemons do not pay', ['LEMON', 'WILD', 'BAR']],
  ])('returns null for %s', (_, [a, b, c]) => {
    expect(evaluateLine(classic, middle(a, b, c), 0, lineBet, 1)).toBeNull();
  });

  it('applies the multiplier', () => {
    expect(
      evaluateLine(classic, middle('BELL', 'BELL', 'BELL'), 0, lineBet, 2)?.win,
    ).toBe(800);
  });

  it('does not let scatters complete a line', () => {
    const video = createLinesContext(VIDEO_5_REEL);
    const grid = rowsToGrid([
      ['TEN', 'JACK', 'QUEEN', 'KING', 'ACE'],
      ['STAR', 'STAR', 'STAR', 'TEN', 'TEN'],
      ['JACK', 'QUEEN', 'KING', 'ACE', 'TEN'],
    ]);
    expect(evaluateLine(video, grid, 0, 1, 1)).toBeNull();
    const wildThenScatter = rowsToGrid([
      ['TEN', 'JACK', 'QUEEN', 'KING', 'ACE'],
      ['WILD', 'STAR', 'TEN', 'TEN', 'TEN'],
      ['JACK', 'QUEEN', 'KING', 'ACE', 'TEN'],
    ]);
    expect(evaluateLine(video, wildThenScatter, 0, 1, 1)).toBeNull();
  });
});

describe('evaluateSpin', () => {
  it('sums every winning payline', () => {
    const grid = rowsToGrid([
      ['BELL', 'BELL', 'BELL'],
      ['BELL', 'BELL', 'BELL'],
      ['BELL', 'BELL', 'BELL'],
    ]);
    const spin = evaluateSpin(classic, [0, 0, 0], grid, 50, 1);
    expect(spin.lineWins).toHaveLength(5);
    expect(spin.win).toBe(5 * 40 * 10);
    expect(spin.scatterWin).toBeNull();
  });

  it('pays scatters anywhere as a multiple of the total bet', () => {
    const video = createLinesContext(VIDEO_5_REEL);
    const grid = rowsToGrid([
      ['STAR', 'TEN', 'JACK', 'QUEEN', 'STAR'],
      ['TEN', 'JACK', 'STAR', 'KING', 'ACE'],
      ['JACK', 'QUEEN', 'KING', 'ACE', 'TEN'],
    ]);
    const spin = evaluateSpin(video, [0, 0, 0, 0, 0], grid, 100, 1);
    expect(spin.scatterWin).toMatchObject({
      symbol: 'STAR',
      count: 3,
      win: 200,
    });
    expect(spin.scatterWin?.cells).toEqual([
      [0, 0],
      [2, 1],
      [4, 0],
    ]);
  });
});

describe('grid helpers', () => {
  it('wraps around the end of the strip', () => {
    const last = CLASSIC_3_REEL.reels[0].length - 1;
    const grid = gridFromStops(CLASSIC_3_REEL, [last, 0, 0]);
    expect(grid[0]).toEqual([
      CLASSIC_3_REEL.reels[0][last],
      CLASSIC_3_REEL.reels[0][0],
      CLASSIC_3_REEL.reels[0][1],
    ]);
  });

  it('finds symbol cells', () => {
    expect(
      findSymbolCells(
        [
          ['A', 'B'],
          ['B', 'A'],
        ],
        'A',
      ),
    ).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });
});

describe('video 5-reel features', () => {
  const ctx = createLinesContext(VIDEO_5_REEL);

  it('triggers 10 free spins at 2x on three scatters', () => {
    const stops = [0, 1, 2].map((reel) => stopFor(VIDEO_5_REEL, reel, 'STAR'));
    const result = playLinesRound(ctx, 100, new PrefixRng([...stops, 0, 0]));
    expect(
      findSymbolCells(result.base.grid, 'STAR').length,
    ).toBeGreaterThanOrEqual(3);
    expect(result.freeSpins).not.toBeNull();
    const fs = result.freeSpins!;
    expect(fs.awarded % 10).toBe(0);
    expect(fs.awarded).toBeGreaterThanOrEqual(10);
    expect(fs.spins).toHaveLength(fs.awarded);
    expect(fs.spins.every((s) => s.multiplier === 2)).toBe(true);
    expect(fs.win).toBe(fs.spins.reduce((a, s) => a + s.win, 0));
    expect(result.totalWin).toBe(
      result.base.win + fs.win + (result.bonus?.win ?? 0),
    );
  });

  it('triggers the pick bonus with chests on reels 1, 3 and 5', () => {
    const stops = [
      stopFor(VIDEO_5_REEL, 0, 'CHEST'),
      0,
      stopFor(VIDEO_5_REEL, 2, 'CHEST'),
      0,
      stopFor(VIDEO_5_REEL, 4, 'CHEST'),
    ];
    const result = playLinesRound(ctx, 100, new PrefixRng(stops));
    expect(isBonusTriggered(result.base.grid, VIDEO_5_REEL.pickBonus!)).toBe(
      true,
    );
    expect(result.bonus).not.toBeNull();
    expect(result.bonus!.picks[0].prize).not.toBe('collect');
    expect(result.bonus!.win).toBe(
      result.bonus!.picks.reduce((a, p) => a + p.win, 0),
    );
  });

  it('does not trigger the bonus when a trigger reel lacks a chest', () => {
    const grid = rowsToGrid([
      ['CHEST', 'TEN', 'CHEST', 'TEN', 'TEN'],
      ['TEN', 'TEN', 'TEN', 'TEN', 'TEN'],
      ['TEN', 'TEN', 'TEN', 'TEN', 'TEN'],
    ]);
    expect(isBonusTriggered(grid, VIDEO_5_REEL.pickBonus!)).toBe(false);
  });

  it('plays deterministic rounds for the same rng seed', () => {
    expect(playSlot(VIDEO_5_REEL, 100, new SeededRng(5))).toEqual(
      playSlot(VIDEO_5_REEL, 100, new SeededRng(5)),
    );
  });
});

describe('pick bonus', () => {
  const bonus: PickBonusFeature = {
    symbol: 'CHEST',
    triggerReels: [0],
    boxes: 3,
    guaranteedPicks: 1,
    prizes: [
      { weight: 1, prize: 2 },
      { weight: 1, prize: 'collect' },
    ],
  };

  it('never collects on guaranteed picks and stops at collect', () => {
    const picks = playPickBonus(bonus, 50, new ScriptedRng([0, 1]));
    expect(picks).toEqual([
      { prize: 2, win: 100 },
      { prize: 'collect', win: 0 },
    ]);
  });

  it('ends when every box is opened', () => {
    expect(playPickBonus(bonus, 50, new ScriptedRng([0, 0, 0]))).toHaveLength(
      3,
    );
  });
});

describe('caps and retriggers', () => {
  const base: LinesSlotConfig = {
    kind: 'lines',
    id: 'test',
    name: 'Test',
    targetRtp: 0.95,
    symbols: [
      { id: 'A', name: 'A', kind: 'regular' },
      { id: 'W', name: 'Wild', kind: 'wild' },
      { id: 'S', name: 'Scatter', kind: 'scatter' },
    ],
    betOptions: [10],
    betDivisor: 1,
    maxWinMultiplier: 3,
    rows: 1,
    reels: [['A'], ['A'], ['A']],
    paylines: [[0, 0, 0]],
    paytable: { A: { 3: 100 } },
  };

  it('caps the total win at maxWinMultiplier x bet', () => {
    const r = playSlot(base, 10, new SeededRng(1));
    expect(r.totalWin).toBe(30);
    expect(r.capped).toBe(true);
  });

  it('stops retriggering at maxTotalSpins', () => {
    const config: LinesSlotConfig = {
      ...base,
      id: 'retrigger',
      maxWinMultiplier: 1000,
      reels: [['S'], ['S'], ['S']],
      paytable: {},
      scatter: {
        symbol: 'S',
        pays: { 3: 1 },
        freeSpins: {
          minCount: 3,
          spins: 10,
          multiplier: 2,
          retriggerSpins: 10,
          maxTotalSpins: 35,
        },
      },
    };
    const r = playSlot(config, 10, new SeededRng(1));
    expect(r.kind === 'lines' && r.freeSpins?.awarded).toBe(35);
    expect(r.kind === 'lines' && r.freeSpins?.spins).toHaveLength(35);
    // base scatter 1x + 35 free spins paying 1x at 2x multiplier
    expect(r.totalWin).toBe(10 + 35 * 20);
  });
});
