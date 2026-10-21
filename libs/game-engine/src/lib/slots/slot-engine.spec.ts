import { SeededRng } from '../rng/rng';
import {
  CLASSIC_3_REEL,
  MEGAWAYS,
  SLOT_CONFIGS,
  VIDEO_5_REEL,
  getSlotConfig,
} from './configs';
import {
  InvalidBetError,
  assertSlotBet,
  playSlot,
  validateSlotConfig,
} from './slot-engine';
import { LinesSlotConfig, SlotConfig, WaysSlotConfig } from './types';

describe('shipped slot configs', () => {
  it.each(Object.values(SLOT_CONFIGS).map((c) => [c.id, c] as const))(
    '%s is valid',
    (_, config) => {
      expect(validateSlotConfig(config)).toEqual([]);
    },
  );

  it('documents a target RTP around 96%', () => {
    for (const c of Object.values(SLOT_CONFIGS))
      expect(Math.abs(c.targetRtp - 0.96)).toBeLessThan(0.01);
  });

  it('looks up configs by id', () => {
    expect(getSlotConfig('megaways')).toBe(MEGAWAYS);
    expect(() => getSlotConfig('nope')).toThrow('Unknown slot game');
  });
});

describe('validateSlotConfig', () => {
  const lines = (patch: Partial<LinesSlotConfig>): SlotConfig => ({
    ...CLASSIC_3_REEL,
    ...patch,
  });
  const ways = (patch: Partial<WaysSlotConfig>): SlotConfig => ({
    ...MEGAWAYS,
    ...patch,
  });

  it.each<[string, SlotConfig, string]>([
    [
      'duplicate ids',
      lines({
        symbols: [...CLASSIC_3_REEL.symbols, CLASSIC_3_REEL.symbols[0]],
      }),
      'duplicate symbol ids',
    ],
    [
      'two wilds',
      lines({
        symbols: [
          ...CLASSIC_3_REEL.symbols,
          { id: 'W2', name: 'W2', kind: 'wild' },
        ],
      }),
      'at most one wild',
    ],
    ['bad rtp', lines({ targetRtp: 1.2 }), 'targetRtp'],
    ['no bets', lines({ betOptions: [] }), 'betOptions must not be empty'],
    ['indivisible bet', lines({ betOptions: [7] }), 'bet option 7'],
    [
      'empty reel',
      lines({ reels: [[], ...CLASSIC_3_REEL.reels.slice(1)] }),
      'reel 0 is empty',
    ],
    [
      'unknown reel symbol',
      lines({ reels: [['NOPE'], ...CLASSIC_3_REEL.reels.slice(1)] }),
      'unknown symbol NOPE',
    ],
    [
      'unknown paytable symbol',
      lines({ paytable: { NOPE: { 3: 1 } } }),
      'paytable references unknown symbol',
    ],
    [
      'fractional pay',
      lines({ paytable: { CHERRY: { 3: 1.5 } } }),
      'non-negative integer',
    ],
    [
      'divisor mismatch',
      lines({ betDivisor: 3, betOptions: [3] }),
      'betDivisor must equal',
    ],
    [
      'short payline',
      lines({ paylines: [[1, 1]], betDivisor: 1, betOptions: [1] }),
      'must cover every reel',
    ],
    [
      'bad payline row',
      lines({ paylines: [[1, 1, 3]], betDivisor: 1, betOptions: [1] }),
      'out-of-range row',
    ],
    [
      'unknown scatter',
      lines({ scatter: { symbol: 'NOPE', pays: {} } }),
      'unknown scatter symbol',
    ],
    [
      'bonus without collect',
      {
        ...VIDEO_5_REEL,
        pickBonus: {
          ...VIDEO_5_REEL.pickBonus!,
          prizes: [{ weight: 1, prize: 1 }],
        },
      },
      'collect outcome',
    ],
    [
      'unknown bonus symbol',
      {
        ...VIDEO_5_REEL,
        pickBonus: { ...VIDEO_5_REEL.pickBonus!, symbol: 'NOPE' },
      },
      'unknown bonus symbol',
    ],
    [
      'too many guaranteed picks',
      {
        ...VIDEO_5_REEL,
        pickBonus: { ...VIDEO_5_REEL.pickBonus!, guaranteedPicks: 12 },
      },
      'guaranteedPicks',
    ],
    [
      'bonus reel out of range',
      {
        ...VIDEO_5_REEL,
        pickBonus: { ...VIDEO_5_REEL.pickBonus!, triggerReels: [7] },
      },
      'trigger reel out of range',
    ],
    ['row weight count', ways({ rowWeights: [1] }), 'rowWeights'],
    [
      'short ways reel',
      ways({ reels: [['NINE'], ...MEGAWAYS.reels.slice(1)] }),
      'shorter than maxRows',
    ],
  ])('reports %s', (_, config, message) => {
    expect(validateSlotConfig(config).join('\n')).toContain(message);
  });

  it('refuses to play an invalid config', () => {
    expect(() =>
      playSlot(lines({ id: 'broken', targetRtp: 2 }), 5, new SeededRng(1)),
    ).toThrow('Invalid slot config');
  });
});

describe('bets', () => {
  it.each([0, -5, 3, 7.5, 1_000_000])('rejects bet %p', (bet) => {
    expect(() => assertSlotBet(CLASSIC_3_REEL, bet)).toThrow();
  });

  it('throws InvalidBetError for amounts outside the bet options', () => {
    expect(() => playSlot(CLASSIC_3_REEL, 15, new SeededRng(1))).toThrow(
      InvalidBetError,
    );
  });

  it('only ever produces integer, non-negative wins', () => {
    const rng = new SeededRng(11);
    for (const config of Object.values(SLOT_CONFIGS)) {
      for (const bet of config.betOptions) {
        const r = playSlot(config, bet, rng);
        expect(Number.isSafeInteger(r.totalWin) && r.totalWin >= 0).toBe(true);
      }
    }
  });
});
