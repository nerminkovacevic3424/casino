import { LinesSlotConfig } from '../types';

/**
 * Video 5-Reel "Gem Vault" — 5x3 grid, 20 paylines, wilds (reels 2-4),
 * STAR scatters (3+ anywhere → 10 free spins at 2x, retrigger +10, max 50)
 * and CHEST bonus symbols (on reels 1, 3 and 5 → pick-me bonus).
 *
 * Math (simulated, see `pnpm nx run game-engine:simulate`):
 *   RTP 96.00% ± 0.24% (10M spins) ≈ base 67.5% + free spins 21.6% + pick bonus 6.9%
 *   Hit frequency ≈ 34%, free spins ≈ 1 in 73, bonus ≈ 1 in 283
 *   Volatility (σ of return per spin) ≈ 3.8 — medium
 * Line pays are multiples of the line bet (total bet / 20); scatter and bonus
 * prizes are multiples of the total bet.
 */
export const VIDEO_5_REEL: LinesSlotConfig = {
  kind: 'lines',
  id: 'video-5-reel',
  name: 'Gem Vault',
  targetRtp: 0.96,
  symbols: [
    { id: 'TEN', name: '10', kind: 'regular' },
    { id: 'JACK', name: 'Jack', kind: 'regular' },
    { id: 'QUEEN', name: 'Queen', kind: 'regular' },
    { id: 'KING', name: 'King', kind: 'regular' },
    { id: 'ACE', name: 'Ace', kind: 'regular' },
    { id: 'RUBY', name: 'Ruby', kind: 'regular' },
    { id: 'EMERALD', name: 'Emerald', kind: 'regular' },
    { id: 'SAPPHIRE', name: 'Sapphire', kind: 'regular' },
    { id: 'DIAMOND', name: 'Diamond', kind: 'regular' },
    { id: 'WILD', name: 'Wild', kind: 'wild' },
    { id: 'STAR', name: 'Star (scatter)', kind: 'scatter' },
    { id: 'CHEST', name: 'Treasure chest (bonus)', kind: 'bonus' },
  ],
  betOptions: [20, 40, 100, 200, 400, 1000, 2000],
  betDivisor: 20,
  maxWinMultiplier: 5000,
  rows: 3,
  // prettier-ignore
  reels: [
    ['JACK','QUEEN','TEN','RUBY','ACE','KING','JACK','SAPPHIRE','TEN','QUEEN','SAPPHIRE','EMERALD','CHEST','JACK','KING','TEN','QUEEN','ACE','RUBY','JACK','DIAMOND','TEN','KING','STAR','QUEEN','ACE','JACK','EMERALD','TEN','KING','RUBY','CHEST','JACK','QUEEN','TEN','ACE','KING','EMERALD','DIAMOND'],
    ['ACE','TEN','DIAMOND','KING','EMERALD','SAPPHIRE','JACK','QUEEN','TEN','RUBY','ACE','KING','JACK','STAR','QUEEN','TEN','WILD','EMERALD','DIAMOND','JACK','KING','TEN','QUEEN','ACE','RUBY','SAPPHIRE','JACK','KING','TEN','WILD','QUEEN','ACE','JACK','EMERALD','STAR','TEN','KING','RUBY','QUEEN','JACK'],
    ['EMERALD','KING','RUBY','CHEST','QUEEN','TEN','JACK','ACE','SAPPHIRE','KING','EMERALD','DIAMOND','TEN','QUEEN','JACK','RUBY','ACE','KING','TEN','SAPPHIRE','QUEEN','STAR','JACK','EMERALD','CHEST','TEN','KING','ACE','QUEEN','RUBY','JACK','DIAMOND','TEN','KING','STAR','WILD','QUEEN','ACE','TEN','JACK'],
    ['TEN','WILD','QUEEN','ACE','JACK','EMERALD','STAR','TEN','KING','RUBY','QUEEN','JACK','ACE','TEN','DIAMOND','KING','EMERALD','SAPPHIRE','JACK','QUEEN','TEN','RUBY','ACE','KING','JACK','STAR','QUEEN','TEN','WILD','EMERALD','DIAMOND','JACK','KING','TEN','QUEEN','ACE','RUBY','SAPPHIRE','JACK','KING'],
    ['TEN','QUEEN','ACE','RUBY','JACK','DIAMOND','TEN','KING','STAR','QUEEN','ACE','JACK','EMERALD','TEN','KING','RUBY','CHEST','JACK','QUEEN','TEN','ACE','KING','EMERALD','DIAMOND','JACK','QUEEN','TEN','RUBY','ACE','KING','JACK','SAPPHIRE','TEN','QUEEN','SAPPHIRE','EMERALD','CHEST','JACK','KING'],
  ],
  paylines: [
    [1, 1, 1, 1, 1],
    [0, 0, 0, 0, 0],
    [2, 2, 2, 2, 2],
    [0, 1, 2, 1, 0],
    [2, 1, 0, 1, 2],
    [0, 0, 1, 2, 2],
    [2, 2, 1, 0, 0],
    [1, 0, 0, 0, 1],
    [1, 2, 2, 2, 1],
    [1, 0, 1, 2, 1],
    [1, 2, 1, 0, 1],
    [0, 1, 1, 1, 0],
    [2, 1, 1, 1, 2],
    [0, 1, 0, 1, 0],
    [2, 1, 2, 1, 2],
    [1, 1, 0, 1, 1],
    [1, 1, 2, 1, 1],
    [0, 0, 2, 0, 0],
    [2, 2, 0, 2, 2],
    [0, 2, 2, 2, 0],
  ],
  paytable: {
    TEN: {
      '3': 10,
      '4': 40,
      '5': 125,
    },
    JACK: {
      '3': 10,
      '4': 40,
      '5': 150,
    },
    QUEEN: {
      '3': 10,
      '4': 50,
      '5': 200,
    },
    KING: {
      '3': 20,
      '4': 60,
      '5': 250,
    },
    ACE: {
      '3': 20,
      '4': 75,
      '5': 300,
    },
    RUBY: {
      '3': 40,
      '4': 125,
      '5': 500,
    },
    EMERALD: {
      '3': 50,
      '4': 150,
      '5': 600,
    },
    SAPPHIRE: {
      '3': 60,
      '4': 250,
      '5': 1000,
    },
    DIAMOND: {
      '3': 125,
      '4': 500,
      '5': 2500,
    },
    WILD: {
      '3': 250,
      '4': 1250,
      '5': 5000,
    },
  },
  scatter: {
    symbol: 'STAR',
    pays: {
      '3': 2,
      '4': 10,
      '5': 50,
    },
    freeSpins: {
      minCount: 3,
      spins: 10,
      multiplier: 2,
      retriggerSpins: 10,
      maxTotalSpins: 50,
    },
  },
  pickBonus: {
    symbol: 'CHEST',
    triggerReels: [0, 2, 4],
    boxes: 12,
    guaranteedPicks: 1,
    prizes: [
      { weight: 30, prize: 2 },
      { weight: 25, prize: 3 },
      { weight: 15, prize: 5 },
      { weight: 10, prize: 8 },
      { weight: 4, prize: 15 },
      { weight: 1, prize: 50 },
      { weight: 25, prize: 'collect' },
    ],
  },
};
