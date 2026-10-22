import {
  CLASSIC_3_REEL,
  MEGAWAYS,
  VIDEO_5_REEL,
  type SlotRoundResult,
} from '@casino/game-engine';

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
export type SlotGameId = 'classic-3-reel' | 'video-5-reel' | 'megaways';

export type GameCategory = 'slots' | 'table' | 'cards';

export interface GameCatalogEntry {
  readonly id: GameId;
  readonly name: string;
  readonly category: GameCategory;
  /** Theoretical return to player, e.g. 0.96. */
  readonly rtp: number;
  /** Route segment under /games. */
  readonly route: string;
}

export const GAME_CATALOG: readonly GameCatalogEntry[] = [
  {
    id: 'classic-3-reel',
    name: CLASSIC_3_REEL.name,
    category: 'slots',
    rtp: CLASSIC_3_REEL.targetRtp,
    route: 'slots/classic-3-reel',
  },
  {
    id: 'video-5-reel',
    name: VIDEO_5_REEL.name,
    category: 'slots',
    rtp: VIDEO_5_REEL.targetRtp,
    route: 'slots/video-5-reel',
  },
  {
    id: 'megaways',
    name: MEGAWAYS.name,
    category: 'slots',
    rtp: MEGAWAYS.targetRtp,
    route: 'slots/megaways',
  },
  {
    id: 'roulette',
    name: 'European Roulette',
    category: 'table',
    rtp: 36 / 37,
    route: 'roulette',
  },
  {
    id: 'blackjack',
    name: 'Blackjack',
    category: 'cards',
    rtp: 0.995,
    route: 'blackjack',
  },
  {
    id: 'video-poker',
    name: 'Jacks or Better',
    category: 'cards',
    rtp: 0.9954,
    route: 'video-poker',
  },
];

export interface GameSummary extends GameCatalogEntry {
  readonly enabled: boolean;
}

export const isGameId = (value: string): value is GameId =>
  (GAME_IDS as readonly string[]).includes(value);

/** What the player needs to verify a round later. */
export interface FairnessInfo {
  readonly serverSeedHash: string;
  readonly clientSeed: string;
  readonly nonce: number;
}

export interface RoundResponse<R> {
  readonly roundId: string;
  readonly gameId: GameId;
  readonly stake: number;
  readonly payout: number;
  /** Wallet balance after the round settled. */
  readonly balance: number;
  readonly result: R;
  readonly fairness: FairnessInfo;
  /** True when this is a replay of an earlier request with the same Idempotency-Key. */
  readonly replayed: boolean;
  /** Community jackpot won by this round (minor units), credited on top of the payout. */
  readonly jackpot?: number;
}

export type SlotSpinResponse = RoundResponse<SlotRoundResult>;

export interface SpinRequest {
  readonly totalBet: number;
}

export interface RoundSummary {
  readonly id: string;
  readonly gameId: GameId;
  readonly status: 'OPEN' | 'SETTLED';
  readonly stake: number;
  readonly payout: number;
  readonly nonce: number;
  readonly createdAt: string;
}

export interface RoundDetail<R = unknown> extends RoundSummary {
  readonly input: unknown;
  readonly result: R | null;
  readonly fairness: FairnessInfo & {
    /** Revealed only after the seed pair has been rotated. */
    readonly serverSeed: string | null;
  };
}

export interface FairnessState {
  readonly serverSeedHash: string;
  readonly clientSeed: string;
  readonly nextNonce: number;
  readonly createdAt: string;
}

export interface RevealedSeed {
  readonly id: string;
  readonly serverSeed: string;
  readonly serverSeedHash: string;
  readonly clientSeed: string;
  readonly roundsPlayed: number;
  readonly createdAt: string;
  readonly revealedAt: string;
}

export interface UserProfile {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: 'PLAYER' | 'ADMIN';
  readonly emailVerified: boolean;
  readonly twoFactorEnabled: boolean;
  readonly createdAt: string;
}

export interface WalletState {
  readonly balance: number;
  readonly dailyBonusAmount: number;
  readonly lastDailyBonusAt: string | null;
  readonly nextDailyBonusAt: string | null;
  readonly canClaimDailyBonus: boolean;
}

export type LedgerType =
  'SIGNUP_BONUS' | 'DAILY_BONUS' | 'BET' | 'WIN' | 'REFUND' | 'ADJUSTMENT';

export interface LedgerItem {
  readonly id: string;
  readonly type: LedgerType;
  readonly amount: number;
  readonly balanceAfter: number;
  readonly roundId: string | null;
  readonly description: string | null;
  readonly createdAt: string;
}
