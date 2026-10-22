import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  LIMIT_KEYS,
  type Activity,
  type LimitKey,
  type LimitValues,
  type ResponsibleState,
  type Usage,
} from '@casino/shared-types';
import { toBigMinor, toMinor } from '../common/money';
import type { PlayerLimits } from '../generated/prisma/client';
import { Prisma } from '../generated/prisma/client';
import { PasswordService } from '../auth/password.service';
import { TokenService } from '../auth/token.service';
import { PrismaService, Tx } from '../prisma/prisma.service';

/** Loosening a limit only takes effect after this delay. */
export const COOLING_PERIOD_MS = 24 * 3_600_000;
const DAY = 86_400_000;

export const COOL_OFF_PERIODS = {
  '24h': DAY,
  '7d': 7 * DAY,
  '30d': 30 * DAY,
} as const;
export const EXCLUSION_PERIODS = {
  '6m': 182 * DAY,
  '1y': 365 * DAY,
  '5y': 5 * 365 * DAY,
  permanent: null,
} as const;
export type CoolOffPeriod = keyof typeof COOL_OFF_PERIODS;
export type ExclusionPeriod = keyof typeof EXCLUSION_PERIODS;
/** "Permanent" self-exclusion is stored as a date far in the future. */
const PERMANENT = new Date('9999-12-31T00:00:00Z');

@Injectable()
export class ResponsibleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  async state(userId: string): Promise<ResponsibleState> {
    const limits = await this.applyDuePending(userId);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { coolOffUntil: true, selfExcludedUntil: true },
    });
    const now = Date.now();
    return {
      limits: toValues(limits),
      pending: (limits?.pending as Partial<LimitValues> | null) ?? null,
      pendingEffectiveAt: limits?.pendingEffectiveAt?.toISOString() ?? null,
      coolOffUntil:
        user.coolOffUntil && user.coolOffUntil.getTime() > now
          ? user.coolOffUntil.toISOString()
          : null,
      selfExcludedUntil:
        user.selfExcludedUntil && user.selfExcludedUntil.getTime() > now
          ? user.selfExcludedUntil.toISOString()
          : null,
      usage: await this.usage(this.prisma, userId),
    };
  }

  /**
   * Tighter limits (new, or lower) apply immediately. Looser ones (higher or
   * removed) are queued and apply after the cooling period.
   */
  async updateLimits(
    userId: string,
    requested: Partial<LimitValues>,
  ): Promise<ResponsibleState> {
    const current = toValues(await this.applyDuePending(userId));
    const existing = await this.prisma.playerLimits.findUnique({
      where: { userId },
    });
    const pending: Partial<LimitValues> = {
      ...((existing?.pending as Partial<LimitValues> | null) ?? {}),
    };
    const immediate: Partial<LimitValues> = {};
    let loosened = false;

    for (const key of LIMIT_KEYS) {
      if (requested[key] === undefined) continue;
      const next = requested[key] ?? null;
      const now = current[key];
      if (next === now) {
        delete pending[key];
      } else if (isTighter(now, next)) {
        immediate[key] = next;
        delete pending[key];
      } else {
        pending[key] = next;
        loosened = true;
      }
    }

    const hasPending = Object.keys(pending).length > 0;
    const data = {
      ...toColumns(immediate),
      pending: hasPending ? (pending as Prisma.InputJsonObject) : Prisma.DbNull,
      // Every new loosening restarts the full cooling period (it never shortens it).
      pendingEffectiveAt: !hasPending
        ? null
        : loosened || !existing?.pendingEffectiveAt
          ? new Date(Date.now() + COOLING_PERIOD_MS)
          : existing.pendingEffectiveAt,
    };
    await this.prisma.playerLimits.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return this.state(userId);
  }

  async coolOff(
    userId: string,
    period: CoolOffPeriod,
  ): Promise<ResponsibleState> {
    const until = new Date(Date.now() + COOL_OFF_PERIODS[period]);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { coolOffUntil: true },
    });
    // A break can be extended but never shortened.
    if (!user.coolOffUntil || user.coolOffUntil < until) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { coolOffUntil: until },
      });
    }
    return this.state(userId);
  }

  /** Closes the account for play (and sign-in) and signs out everywhere. Cannot be reversed early. */
  async selfExclude(
    userId: string,
    period: ExclusionPeriod,
    password: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    if (!(await this.passwords.verify(user.passwordHash, password))) {
      throw new UnauthorizedException('Password is incorrect');
    }
    const duration = EXCLUSION_PERIODS[period];
    const until =
      duration === null ? PERMANENT : new Date(Date.now() + duration);
    if (!user.selfExcludedUntil || user.selfExcludedUntil < until) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { selfExcludedUntil: until },
      });
    }
    await this.tokens.revokeAllSessions(userId);
  }

  /**
   * Throws when this stake is not allowed. Call inside the bet transaction
   * after the per-player lock, so concurrent bets cannot both slip under a limit.
   */
  async assertCanBet(tx: Tx, userId: string, stake: number): Promise<void> {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { coolOffUntil: true, selfExcludedUntil: true },
    });
    const now = Date.now();
    if (user.selfExcludedUntil && user.selfExcludedUntil.getTime() > now) {
      throw new ForbiddenException('Your account is self-excluded from play');
    }
    if (user.coolOffUntil && user.coolOffUntil.getTime() > now) {
      throw new ForbiddenException(
        `You are taking a break until ${user.coolOffUntil.toISOString()}`,
      );
    }
    const limits = toValues(await this.applyDuePending(userId, tx));
    if (Object.values(limits).every((v) => v === null)) return;
    const usage = await this.usage(tx, userId);
    const checks: [number | null, number, string][] = [
      [limits.dailyLossLimit, usage.lossDay, 'daily loss limit'],
      [limits.weeklyLossLimit, usage.lossWeek, 'weekly loss limit'],
      [limits.monthlyLossLimit, usage.lossMonth, 'monthly loss limit'],
    ];
    for (const [limit, used, name] of checks) {
      if (limit !== null && used + stake > limit)
        throw new ForbiddenException(`This bet would exceed your ${name}`);
    }
    if (
      limits.dailyWagerLimit !== null &&
      usage.wagerDay + stake > limits.dailyWagerLimit
    ) {
      throw new ForbiddenException(
        'This bet would exceed your daily wager limit',
      );
    }
  }

  /** Stakes, wins and net result since a moment (reality check). */
  async activity(userId: string, since: Date): Promise<Activity> {
    const agg = await this.prisma.gameRound.aggregate({
      where: { userId, createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { stake: true, payout: true },
    });
    const staked = toMinor(agg._sum.stake ?? 0n);
    const won = toMinor(agg._sum.payout ?? 0n);
    return { rounds: agg._count._all, staked, won, net: won - staked };
  }

  private async usage(db: Tx | PrismaService, userId: string): Promise<Usage> {
    const now = Date.now();
    const [day, week, month] = await Promise.all(
      [DAY, 7 * DAY, 30 * DAY].map((ms) =>
        db.gameRound.aggregate({
          where: { userId, createdAt: { gte: new Date(now - ms) } },
          _sum: { stake: true, payout: true },
        }),
      ),
    );
    // Losses = stakes minus winnings (open hands count their stake, nothing back yet). Never negative.
    const loss = (a: typeof day) =>
      Math.max(0, toMinor((a._sum.stake ?? 0n) - (a._sum.payout ?? 0n)));
    return {
      lossDay: loss(day),
      lossWeek: loss(week),
      lossMonth: loss(month),
      wagerDay: toMinor(day._sum.stake ?? 0n),
    };
  }

  /** Applies queued loosening changes whose cooling period has passed. */
  private async applyDuePending(
    userId: string,
    db: Tx | PrismaService = this.prisma,
  ): Promise<PlayerLimits | null> {
    const limits = await db.playerLimits.findUnique({ where: { userId } });
    if (
      !limits?.pending ||
      !limits.pendingEffectiveAt ||
      limits.pendingEffectiveAt.getTime() > Date.now()
    )
      return limits;
    return db.playerLimits.update({
      where: { userId },
      data: {
        ...toColumns(limits.pending as Partial<LimitValues>),
        pending: Prisma.DbNull,
        pendingEffectiveAt: null,
      },
    });
  }
}

/** A new value restricts more when it adds a limit or lowers one. */
export function isTighter(
  current: number | null,
  next: number | null,
): boolean {
  if (next === null) return false;
  return current === null || next < current;
}

function toValues(limits: PlayerLimits | null): LimitValues {
  const values = {} as LimitValues;
  for (const key of LIMIT_KEYS) {
    const v = limits?.[key] ?? null;
    values[key] = v === null ? null : typeof v === 'bigint' ? toMinor(v) : v;
  }
  return values;
}

interface LimitColumns {
  dailyLossLimit?: bigint | null;
  weeklyLossLimit?: bigint | null;
  monthlyLossLimit?: bigint | null;
  dailyWagerLimit?: bigint | null;
  sessionLimitMinutes?: number | null;
  realityCheckMinutes?: number | null;
}

function toColumns(values: Partial<LimitValues>): LimitColumns {
  const money = (v: number | null | undefined) =>
    v === undefined ? undefined : v === null ? null : toBigMinor(v);
  const data: LimitColumns = {
    dailyLossLimit: money(values.dailyLossLimit),
    weeklyLossLimit: money(values.weeklyLossLimit),
    monthlyLossLimit: money(values.monthlyLossLimit),
    dailyWagerLimit: money(values.dailyWagerLimit),
    sessionLimitMinutes: values.sessionLimitMinutes,
    realityCheckMinutes: values.realityCheckMinutes,
  };
  // Leave untouched columns out of the update entirely.
  for (const key of Object.keys(data) as (keyof LimitColumns)[])
    if (data[key] === undefined) delete data[key];
  return data;
}

export type { Activity, LimitValues, ResponsibleState };
