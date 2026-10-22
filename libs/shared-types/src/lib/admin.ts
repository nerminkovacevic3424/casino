import type { GameCategory, GameId } from './games';

/** Admin panel contracts. Amounts are integer minor units. */

export const LEDGER_TYPES = [
  'SIGNUP_BONUS',
  'DAILY_BONUS',
  'BET',
  'WIN',
  'REFUND',
  'ADJUSTMENT',
  'JACKPOT',
] as const;
export type LedgerTypeName = (typeof LEDGER_TYPES)[number];

export type UserStatusName = 'ACTIVE' | 'SUSPENDED';
export type RoleName = 'PLAYER' | 'ADMIN';

/** Live performance of one game over a window, against its theoretical RTP. */
export interface AdminGameStats {
  readonly gameId: GameId;
  readonly name: string;
  readonly category: GameCategory;
  readonly enabled: boolean;
  readonly targetRtp: number;
  readonly rounds: number;
  readonly staked: number;
  readonly paid: number;
  /** paid / staked, or null with no stakes. */
  readonly observedRtp: number | null;
  readonly players: number;
}

export interface AdminOverview {
  /** Window the game figures cover, in hours. */
  readonly windowHours: number;
  readonly users: {
    readonly total: number;
    readonly active24h: number;
    readonly new24h: number;
    readonly suspended: number;
  };
  readonly totals: {
    readonly rounds: number;
    readonly staked: number;
    readonly paid: number;
    /** Sum of all player balances. */
    readonly creditsInCirculation: number;
  };
  readonly jackpot: number;
  readonly games: readonly AdminGameStats[];
}

export interface AdminUserRow {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: RoleName;
  readonly status: UserStatusName;
  readonly balance: number;
  readonly emailVerified: boolean;
  readonly selfExcludedUntil: string | null;
  readonly coolOffUntil: string | null;
  readonly createdAt: string;
}

export interface AdminLedgerRow {
  readonly id: string;
  readonly userId: string;
  readonly email: string;
  readonly type: LedgerTypeName;
  readonly amount: number;
  readonly balanceAfter: number;
  readonly roundId: string | null;
  readonly description: string | null;
  readonly createdAt: string;
}

export interface AdminActionRow {
  readonly id: string;
  readonly adminId: string;
  readonly adminEmail: string | null;
  readonly action: string;
  readonly targetUser: string | null;
  readonly targetGame: string | null;
  readonly details: Record<string, unknown>;
  readonly createdAt: string;
}

export interface AdminUserDetail extends AdminUserRow {
  readonly twoFactorEnabled: boolean;
  readonly lockedUntil: string | null;
  readonly limits: Record<string, number | null>;
  readonly stats: {
    readonly rounds: number;
    readonly staked: number;
    readonly paid: number;
  };
  readonly recentLedger: readonly AdminLedgerRow[];
  readonly actions: readonly AdminActionRow[];
}

/** Cursor-paged list (newest first). */
export interface CursorPage<T> {
  readonly items: readonly T[];
  /** Pass as `before` to fetch the next (older) page; null at the end. */
  readonly nextCursor: string | null;
}

/** Largest single manual balance adjustment (100,000.00 credits). */
export const MAX_ADJUSTMENT = 10_000_000;
