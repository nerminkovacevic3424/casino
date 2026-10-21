import { LinesSlotConfig } from '../types';

/**
 * Classic 3-Reel — 3x3 grid, 5 fixed paylines, fruit symbols and a wild.
 *
 * Math (exact, enumerated over all 32^3 = 32,768 stop combinations):
 *   RTP           96.13%  (0.9613037109375)
 *   Hit frequency 40.77%
 * Pays are multiples of the line bet (total bet / 5). WILD substitutes for
 * every fruit and pays on its own for three in a line.
 */
export const CLASSIC_3_REEL: LinesSlotConfig = {
  kind: 'lines',
  id: 'classic-3-reel',
  name: 'Classic 3-Reel',
  targetRtp: 0.9613,
  symbols: [
    { id: 'CHERRY', name: 'Cherry', kind: 'regular' },
    { id: 'LEMON', name: 'Lemon', kind: 'regular' },
    { id: 'ORANGE', name: 'Orange', kind: 'regular' },
    { id: 'PLUM', name: 'Plum', kind: 'regular' },
    { id: 'BELL', name: 'Bell', kind: 'regular' },
    { id: 'BAR', name: 'Bar', kind: 'regular' },
    { id: 'SEVEN', name: 'Seven', kind: 'regular' },
    { id: 'WILD', name: 'Wild', kind: 'wild' },
  ],
  betOptions: [5, 10, 25, 50, 100, 250, 500, 1000],
  betDivisor: 5,
  maxWinMultiplier: 1000,
  rows: 3,
  // prettier-ignore
  reels: [
    ['CHERRY','LEMON','PLUM','ORANGE','CHERRY','BELL','WILD','LEMON','PLUM','CHERRY','ORANGE','BELL','LEMON','CHERRY','ORANGE','PLUM','BAR','LEMON','CHERRY','ORANGE','PLUM','BELL','CHERRY','LEMON','SEVEN','ORANGE','PLUM','CHERRY','LEMON','BELL','ORANGE','BAR'],
    ['BELL','ORANGE','BAR','CHERRY','LEMON','PLUM','ORANGE','CHERRY','BELL','WILD','LEMON','PLUM','CHERRY','ORANGE','BELL','LEMON','CHERRY','ORANGE','PLUM','BAR','LEMON','CHERRY','ORANGE','PLUM','BELL','CHERRY','LEMON','SEVEN','ORANGE','PLUM','CHERRY','LEMON'],
    ['ORANGE','PLUM','CHERRY','LEMON','BELL','ORANGE','BAR','CHERRY','LEMON','PLUM','ORANGE','CHERRY','BELL','WILD','LEMON','PLUM','CHERRY','ORANGE','BELL','LEMON','CHERRY','ORANGE','PLUM','BAR','LEMON','CHERRY','ORANGE','PLUM','BELL','CHERRY','LEMON','SEVEN'],
  ],
  paylines: [
    [1, 1, 1],
    [0, 0, 0],
    [2, 2, 2],
    [0, 1, 2],
    [2, 1, 0],
  ],
  paytable: {
    CHERRY: {
      '2': 1,
      '3': 10,
    },
    LEMON: {
      '3': 14,
    },
    ORANGE: {
      '3': 15,
    },
    PLUM: {
      '3': 20,
    },
    BELL: {
      '3': 40,
    },
    BAR: {
      '3': 100,
    },
    SEVEN: {
      '3': 300,
    },
    WILD: {
      '3': 1000,
    },
  },
};
