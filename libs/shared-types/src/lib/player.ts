import type { GameId } from './games';

/** Responsible-play limits; money in minor units, durations in minutes. `null` = no limit. */
export const LIMIT_KEYS = [
  'dailyLossLimit',
  'weeklyLossLimit',
  'monthlyLossLimit',
  'dailyWagerLimit',
  'sessionLimitMinutes',
  'realityCheckMinutes',
] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];
export type LimitValues = Record<LimitKey, number | null>;

export const COOL_OFF_OPTIONS = ['24h', '7d', '30d'] as const;
export type CoolOffPeriod = (typeof COOL_OFF_OPTIONS)[number];
export const EXCLUSION_OPTIONS = ['6m', '1y', '5y', 'permanent'] as const;
export type ExclusionPeriod = (typeof EXCLUSION_OPTIONS)[number];

export interface Usage {
  readonly lossDay: number;
  readonly lossWeek: number;
  readonly lossMonth: number;
  readonly wagerDay: number;
}

export interface ResponsibleState {
  readonly limits: LimitValues;
  /** Loosening changes waiting for the 24-hour cooling period. */
  readonly pending: Partial<LimitValues> | null;
  readonly pendingEffectiveAt: string | null;
  readonly coolOffUntil: string | null;
  readonly selfExcludedUntil: string | null;
  readonly usage: Usage;
}

export interface Activity {
  readonly rounds: number;
  readonly staked: number;
  readonly won: number;
  readonly net: number;
}

export interface GameStats {
  readonly gameId: GameId;
  readonly rounds: number;
  readonly staked: number;
  readonly won: number;
}

export interface ProfileStats {
  readonly totalRounds: number;
  readonly totalStaked: number;
  readonly totalWon: number;
  readonly biggestWin: number;
  readonly favouriteGame: GameId | null;
  readonly byGame: readonly GameStats[];
}

export interface JackpotWin {
  readonly amount: number;
  readonly displayName: string;
  readonly wonAt: string;
}

export interface JackpotState {
  readonly amount: number;
  readonly lastWin: JackpotWin | null;
}

export interface RecentGame {
  readonly gameId: string;
  readonly lastPlayedAt: string;
}
