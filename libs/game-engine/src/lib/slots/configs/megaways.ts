import { WaysSlotConfig } from '../types';

/**
 * Megaways-style "Temple Tumble" — 6 reels with 2-7 rows each (up to
 * 117,649 ways), wilds on reels 2-5, cascading wins and a multiplier that
 * grows by +1 after every cascade (x1, x2, ... up to x7).
 *
 * Math (simulated, see `pnpm nx run game-engine:simulate`):
 *   RTP 95.99% ± 0.28% (40M spins), hit frequency ≈ 27.3%
 *   Volatility (σ of return per spin) ≈ 9.0 — high; max observed win ≈ 1,900x
 * Pays are per way, in multiples of the bet unit (total bet / 100).
 */
export const MEGAWAYS: WaysSlotConfig = {
  kind: 'ways',
  id: 'megaways',
  name: 'Temple Tumble',
  targetRtp: 0.96,
  symbols: [
    { id: 'NINE', name: '9', kind: 'regular' },
    { id: 'TEN', name: '10', kind: 'regular' },
    { id: 'JACK', name: 'Jack', kind: 'regular' },
    { id: 'QUEEN', name: 'Queen', kind: 'regular' },
    { id: 'KING', name: 'King', kind: 'regular' },
    { id: 'ACE', name: 'Ace', kind: 'regular' },
    { id: 'SCARAB', name: 'Scarab', kind: 'regular' },
    { id: 'ANKH', name: 'Ankh', kind: 'regular' },
    { id: 'EYE', name: 'Eye of Horus', kind: 'regular' },
    { id: 'FALCON', name: 'Falcon', kind: 'regular' },
    { id: 'MASK', name: 'Golden mask', kind: 'regular' },
    { id: 'WILD', name: 'Wild', kind: 'wild' },
  ],
  betOptions: [100, 200, 500, 1000, 2000, 5000],
  betDivisor: 100,
  maxWinMultiplier: 5000,
  // prettier-ignore
  reels: [
    ['JACK','JACK','TEN','TEN','NINE','NINE','SCARAB','SCARAB','MASK','MASK','QUEEN','QUEEN','ACE','ACE','FALCON','FALCON','JACK','JACK','TEN','TEN','NINE','NINE','KING','KING','ANKH','ANKH','QUEEN','QUEEN','SCARAB','SCARAB','ACE','ACE','JACK','JACK','TEN','TEN','NINE','NINE','KING','KING','EYE','EYE','QUEEN','QUEEN','FALCON','FALCON','SCARAB','SCARAB','JACK','JACK','TEN','TEN','NINE','NINE','ACE','ACE','ANKH','ANKH','QUEEN','QUEEN','KING','KING','EYE','EYE'],
    ['SCARAB','SCARAB','NINE','NINE','ACE','ACE','ANKH','ANKH','QUEEN','QUEEN','KING','KING','EYE','EYE','JACK','JACK','TEN','TEN','SCARAB','SCARAB','NINE','NINE','WILD','ACE','ACE','QUEEN','QUEEN','FALCON','FALCON','JACK','JACK','TEN','TEN','KING','KING','NINE','NINE','ANKH','ANKH','SCARAB','SCARAB','QUEEN','QUEEN','EYE','EYE','JACK','JACK','TEN','TEN','ACE','ACE','NINE','NINE','KING','KING','FALCON','FALCON','QUEEN','QUEEN','MASK','MASK','JACK','JACK','TEN','TEN'],
    ['NINE','NINE','KING','KING','FALCON','FALCON','QUEEN','QUEEN','MASK','MASK','JACK','JACK','TEN','TEN','SCARAB','SCARAB','NINE','NINE','ACE','ACE','ANKH','ANKH','QUEEN','QUEEN','KING','KING','EYE','EYE','JACK','JACK','TEN','TEN','SCARAB','SCARAB','NINE','NINE','WILD','ACE','ACE','QUEEN','QUEEN','FALCON','FALCON','JACK','JACK','TEN','TEN','KING','KING','NINE','NINE','ANKH','ANKH','SCARAB','SCARAB','QUEEN','QUEEN','EYE','EYE','JACK','JACK','TEN','TEN','ACE','ACE'],
    ['ANKH','ANKH','SCARAB','SCARAB','QUEEN','QUEEN','EYE','EYE','JACK','JACK','TEN','TEN','ACE','ACE','NINE','NINE','KING','KING','FALCON','FALCON','QUEEN','QUEEN','MASK','MASK','JACK','JACK','TEN','TEN','SCARAB','SCARAB','NINE','NINE','ACE','ACE','ANKH','ANKH','QUEEN','QUEEN','KING','KING','EYE','EYE','JACK','JACK','TEN','TEN','SCARAB','SCARAB','NINE','NINE','WILD','ACE','ACE','QUEEN','QUEEN','FALCON','FALCON','JACK','JACK','TEN','TEN','KING','KING','NINE','NINE'],
    ['ACE','ACE','QUEEN','QUEEN','FALCON','FALCON','JACK','JACK','TEN','TEN','KING','KING','NINE','NINE','ANKH','ANKH','SCARAB','SCARAB','QUEEN','QUEEN','EYE','EYE','JACK','JACK','TEN','TEN','ACE','ACE','NINE','NINE','KING','KING','FALCON','FALCON','QUEEN','QUEEN','MASK','MASK','JACK','JACK','TEN','TEN','SCARAB','SCARAB','NINE','NINE','ACE','ACE','ANKH','ANKH','QUEEN','QUEEN','KING','KING','EYE','EYE','JACK','JACK','TEN','TEN','SCARAB','SCARAB','NINE','NINE','WILD'],
    ['QUEEN','QUEEN','KING','KING','EYE','EYE','JACK','JACK','TEN','TEN','NINE','NINE','SCARAB','SCARAB','MASK','MASK','QUEEN','QUEEN','ACE','ACE','FALCON','FALCON','JACK','JACK','TEN','TEN','NINE','NINE','KING','KING','ANKH','ANKH','QUEEN','QUEEN','SCARAB','SCARAB','ACE','ACE','JACK','JACK','TEN','TEN','NINE','NINE','KING','KING','EYE','EYE','QUEEN','QUEEN','FALCON','FALCON','SCARAB','SCARAB','JACK','JACK','TEN','TEN','NINE','NINE','ACE','ACE','ANKH','ANKH'],
  ],
  minRows: 2,
  maxRows: 7,
  rowWeights: [10, 15, 20, 20, 20, 15],
  paytable: {
    NINE: {
      '3': 2,
      '4': 4,
      '5': 6,
      '6': 10,
    },
    TEN: {
      '3': 2,
      '4': 4,
      '5': 6,
      '6': 10,
    },
    JACK: {
      '3': 2,
      '4': 4,
      '5': 7,
      '6': 14,
    },
    QUEEN: {
      '3': 3,
      '4': 6,
      '5': 8,
      '6': 17,
    },
    KING: {
      '3': 3,
      '4': 6,
      '5': 10,
      '6': 21,
    },
    ACE: {
      '3': 3,
      '4': 7,
      '5': 14,
      '6': 28,
    },
    SCARAB: {
      '3': 4,
      '4': 8,
      '5': 17,
      '6': 35,
    },
    ANKH: {
      '3': 6,
      '4': 10,
      '5': 21,
      '6': 41,
    },
    EYE: {
      '3': 7,
      '4': 14,
      '5': 28,
      '6': 55,
    },
    FALCON: {
      '3': 8,
      '4': 17,
      '5': 35,
      '6': 69,
    },
    MASK: {
      '3': 10,
      '4': 21,
      '5': 52,
      '6': 103,
    },
  },
  multiplierStep: 1,
  maxCascades: 6,
};
