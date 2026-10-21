/** Contracts shared by the API and the web client. Amounts are integer minor units. */

export const GAME_IDS = [
  'classic-3-reel',
  'video-5-reel',
  'megaways',
  'roulette',
  'blackjack',
  'video-poker',
] as const;
export type GameId = (typeof GAME_IDS)[number];

export type GameCategory = 'slots' | 'table' | 'cards';

export interface GameSummary {
  readonly id: GameId;
  readonly name: string;
  readonly category: GameCategory;
  /** Theoretical return to player, e.g. 0.96. */
  readonly rtp: number;
  readonly enabled: boolean;
}

export const isGameId = (value: string): value is GameId =>
  (GAME_IDS as readonly string[]).includes(value);
