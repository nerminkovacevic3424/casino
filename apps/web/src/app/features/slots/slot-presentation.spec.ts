import {
  CLASSIC_3_REEL,
  SeededRng,
  playSlot,
  type LinesRoundResult,
  type SlotRoundResult,
} from '@casino/game-engine';
import {
  AutoplayProgress,
  autoplayStopReason,
  countUpMs,
  describeGrid,
  describeOutcome,
  winTier,
} from './slot-presentation';

describe('winTier', () => {
  it.each([
    [0, 'none'],
    [10, 'small'],
    [199, 'small'],
    [200, 'medium'],
    [999, 'medium'],
    [1000, 'big'],
    [4999, 'big'],
    [5000, 'mega'],
  ] as const)('%i on a 100 bet is %s', (win, tier) => {
    expect(winTier(win, 100)).toBe(tier);
  });
});

describe('countUpMs', () => {
  it('scales with the tier, is shorter in turbo and instant with reduced motion', () => {
    expect(countUpMs('small', false, false)).toBe(0);
    expect(countUpMs('mega', false, false)).toBeGreaterThan(
      countUpMs('big', false, false),
    );
    expect(countUpMs('big', false, true)).toBeLessThan(
      countUpMs('big', false, false),
    );
    expect(countUpMs('mega', true, false)).toBe(0);
  });
});

describe('screen reader descriptions', () => {
  it('reads the grid row by row with symbol names', () => {
    const grid = [
      ['CHERRY', 'BELL', 'BAR'],
      ['WILD', 'SEVEN', 'PLUM'],
      ['LEMON', 'ORANGE', 'CHERRY'],
    ];
    expect(describeGrid(CLASSIC_3_REEL, grid)).toBe(
      'Row 1: Cherry, Wild, Lemon. Row 2: Bell, Seven, Orange. Row 3: Bar, Plum, Cherry',
    );
  });

  it('summarises wins and losses', () => {
    const rng = new SeededRng(4);
    let win: LinesRoundResult | null = null;
    let loss: LinesRoundResult | null = null;
    for (let i = 0; i < 200 && (!win || !loss); i++) {
      const r = playSlot(CLASSIC_3_REEL, 100, rng) as LinesRoundResult;
      if (r.totalWin > 0 && r.base.lineWins.length > 0) win ??= r;
      else if (r.totalWin === 0) loss ??= r;
    }
    expect(describeOutcome(CLASSIC_3_REEL, loss as LinesRoundResult)).toBe(
      'No win.',
    );
    const text = describeOutcome(CLASSIC_3_REEL, win as LinesRoundResult);
    expect(text).toMatch(/^You won [\d.,]+ credits: \d .+ on line \d/);
  });
});

describe('autoplayStopReason', () => {
  const settings = {
    spins: 10,
    lossLimit: 1000,
    singleWinLimit: 5000,
    stopOnFeature: true,
  };
  const progress = (played: number): AutoplayProgress => ({
    settings,
    played,
    startBalance: 10_000,
  });
  const lines = (totalWin: number, extra: Partial<LinesRoundResult> = {}) =>
    ({
      kind: 'lines',
      totalWin,
      freeSpins: null,
      bonus: null,
      ...extra,
    }) as unknown as SlotRoundResult;

  it('keeps going inside every limit', () => {
    expect(autoplayStopReason(progress(3), lines(0), 9_700, 100)).toBeNull();
  });

  it.each([
    ['done', progress(10), lines(0), 9_500],
    ['loss-limit', progress(5), lines(0), 9_000],
    ['single-win', progress(5), lines(6000), 15_000],
    [
      'feature',
      progress(5),
      lines(100, { freeSpins: { awarded: 10, spins: [], win: 0 } }),
      9_900,
    ],
    ['balance', { ...progress(5), startBalance: 120 }, lines(0), 50],
  ] as const)('stops for %s', (reason, p, result, balance) => {
    expect(autoplayStopReason(p, result, balance, 100)).toBe(reason);
  });

  it('ignores the single-win limit when not set', () => {
    const p = {
      ...progress(1),
      settings: { ...settings, singleWinLimit: null },
    };
    expect(autoplayStopReason(p, lines(1_000_000), 1_010_000, 100)).toBeNull();
  });
});
