import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  GAME_CATALOG,
  type AdminActionRow,
  type AdminGameStats,
  type AdminLedgerRow,
  type AdminOverview,
  type AdminUserDetail,
  type AdminUserRow,
  type CursorPage,
  type GameId,
  type Paginated,
} from '@casino/shared-types';
import { TokenService } from '../auth/token.service';
import { toMinor } from '../common/money';
import type { Prisma } from '../generated/prisma/client';
import { JackpotService } from '../jackpot/jackpot.service';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { toValues } from '../responsible/responsible.service';
import { WalletService } from '../wallet/wallet.service';
import {
  AdjustBalanceDto,
  AuditQueryDto,
  LedgerQueryDto,
  SetUserStatusDto,
  UserListQueryDto,
} from './dto';

const HOUR_MS = 3_600_000;

type UserWithWallet = Prisma.UserGetPayload<{
  include: { wallet: { select: { balance: true } } };
}>;

type LedgerWithUser = Prisma.LedgerEntryGetPayload<{
  include: { user: { select: { email: true } } };
}>;

/**
 * Back-office operations. Every change is written to the append-only
 * admin_actions table in the same transaction as the change itself.
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly tokens: TokenService,
    private readonly jackpot: JackpotService,
    private readonly realtime: RealtimeGateway,
  ) {}

  // ------------------------------------------------------------------ overview & games

  async overview(hours: number): Promise<AdminOverview> {
    const now = Date.now();
    const since = new Date(now - hours * HOUR_MS);
    const dayAgo = new Date(now - 24 * HOUR_MS);

    const [total, new24h, suspended, active, perGame, circulation, settings] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { createdAt: { gte: dayAgo } } }),
        this.prisma.user.count({ where: { status: 'SUSPENDED' } }),
        this.prisma.$queryRaw<{ n: bigint }[]>`
          SELECT COUNT(DISTINCT user_id) AS n FROM game_rounds WHERE created_at >= ${dayAgo}`,
        this.prisma.$queryRaw<
          {
            game_id: string;
            rounds: bigint;
            staked: bigint | null;
            paid: bigint | null;
            players: bigint;
          }[]
        >`
          SELECT game_id,
                 COUNT(*) AS rounds,
                 SUM(stake) AS staked,
                 SUM(payout) AS paid,
                 COUNT(DISTINCT user_id) AS players
          FROM game_rounds
          WHERE status = 'SETTLED' AND created_at >= ${since}
          GROUP BY game_id`,
        this.prisma.wallet.aggregate({ _sum: { balance: true } }),
        this.prisma.gameSetting.findMany(),
      ]);

    const enabled = new Map(settings.map((s) => [s.gameId, s.enabled]));
    const byGame = new Map(perGame.map((r) => [r.game_id, r]));
    const games: AdminGameStats[] = GAME_CATALOG.map((g) => {
      const row = byGame.get(g.id);
      const staked = row?.staked ? toMinor(row.staked) : 0;
      const paid = row?.paid ? toMinor(row.paid) : 0;
      return {
        gameId: g.id,
        name: g.name,
        category: g.category,
        enabled: enabled.get(g.id) ?? true,
        targetRtp: g.rtp,
        rounds: row ? Number(row.rounds) : 0,
        staked,
        paid,
        observedRtp: staked > 0 ? paid / staked : null,
        players: row ? Number(row.players) : 0,
      };
    });

    return {
      windowHours: hours,
      users: {
        total,
        active24h: Number(active[0]?.n ?? 0n),
        new24h,
        suspended,
      },
      totals: {
        rounds: games.reduce((a, g) => a + g.rounds, 0),
        staked: games.reduce((a, g) => a + g.staked, 0),
        paid: games.reduce((a, g) => a + g.paid, 0),
        creditsInCirculation: toMinor(circulation._sum.balance ?? 0n),
      },
      jackpot: await this.jackpot.amount(),
      games,
    };
  }

  async setGameEnabled(
    adminId: string,
    gameId: GameId,
    enabled: boolean,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.gameSetting.upsert({
        where: { gameId },
        create: { gameId, enabled },
        update: { enabled },
      });
      await this.record(tx, adminId, 'GAME_TOGGLE', {
        targetGame: gameId,
        details: { enabled },
      });
    });
    this.logger.log({ adminId, gameId, enabled }, 'Game availability changed');
  }

  // ------------------------------------------------------------------ users

  async listUsers(query: UserListQueryDto): Promise<Paginated<AdminUserRow>> {
    const where: Prisma.UserWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { email: { contains: query.q, mode: 'insensitive' } },
              { displayName: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        include: { wallet: { select: { balance: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      items: users.map(toUserRow),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async userDetail(userId: string): Promise<AdminUserDetail> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { wallet: { select: { balance: true } }, limits: true },
    });
    if (!user) throw new NotFoundException('User not found');
    const [stats, ledger, actions] = await Promise.all([
      this.prisma.gameRound.aggregate({
        where: { userId, status: 'SETTLED' },
        _count: true,
        _sum: { stake: true, payout: true },
      }),
      this.prisma.ledgerEntry.findMany({
        where: { userId },
        include: { user: { select: { email: true } } },
        orderBy: { id: 'desc' },
        take: 20,
      }),
      this.auditRows({ targetUser: userId }, 20),
    ]);
    return {
      ...toUserRow(user),
      twoFactorEnabled: user.totpEnabledAt !== null,
      lockedUntil:
        user.lockedUntil && user.lockedUntil.getTime() > Date.now()
          ? user.lockedUntil.toISOString()
          : null,
      limits: toValues(user.limits),
      stats: {
        rounds: stats._count,
        staked: toMinor(stats._sum.stake ?? 0n),
        paid: toMinor(stats._sum.payout ?? 0n),
      },
      recentLedger: ledger.map(toLedgerRow),
      actions,
    };
  }

  /** Suspending signs the user out everywhere and blocks bets immediately. */
  async setUserStatus(
    adminId: string,
    userId: string,
    dto: SetUserStatusDto,
  ): Promise<AdminUserDetail> {
    if (userId === adminId) {
      throw new ForbiddenException('You cannot change your own status');
    }
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');
      if (user.role === 'ADMIN') {
        throw new ForbiddenException('Admin accounts cannot be suspended here');
      }
      if (user.status === dto.status) return;
      await tx.user.update({
        where: { id: userId },
        data: { status: dto.status },
      });
      await this.record(tx, adminId, 'USER_STATUS', {
        targetUser: userId,
        details: { from: user.status, to: dto.status, reason: dto.reason },
      });
    });
    if (dto.status === 'SUSPENDED') await this.tokens.revokeAllSessions(userId);
    this.logger.log(
      { adminId, userId, status: dto.status },
      'User status changed',
    );
    return this.userDetail(userId);
  }

  /** Manual correction: a new ADJUSTMENT ledger entry (the ledger is never edited). */
  async adjustBalance(
    adminId: string,
    userId: string,
    dto: AdjustBalanceDto,
  ): Promise<AdminUserDetail> {
    if (userId === adminId) {
      throw new ForbiddenException('You cannot adjust your own balance');
    }
    const { balance } = await this.prisma.$transaction(async (tx) => {
      const exists = await tx.user.count({ where: { id: userId } });
      if (!exists) throw new NotFoundException('User not found');
      const result = await this.wallet.applyEntry(tx, {
        userId,
        type: 'ADJUSTMENT',
        amount: dto.amount,
        description: dto.reason,
      });
      await this.record(tx, adminId, 'BALANCE_ADJUST', {
        targetUser: userId,
        details: {
          amount: dto.amount,
          reason: dto.reason,
          ledgerEntryId: result.entryId,
          balanceAfter: result.balance,
        },
      });
      return result;
    });
    this.realtime.emitBalance(userId, balance);
    this.logger.log(
      { adminId, userId, amount: dto.amount },
      'Balance adjusted',
    );
    return this.userDetail(userId);
  }

  // ------------------------------------------------------------------ audit

  async ledger(query: LedgerQueryDto): Promise<CursorPage<AdminLedgerRow>> {
    const rows = await this.prisma.ledgerEntry.findMany({
      where: {
        ...(query.userId ? { userId: query.userId } : {}),
        ...(query.roundId ? { roundId: query.roundId } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.before ? { id: { lt: BigInt(query.before) } } : {}),
      },
      include: { user: { select: { email: true } } },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
    });
    return page(rows.map(toLedgerRow), query.limit);
  }

  async audit(query: AuditQueryDto): Promise<CursorPage<AdminActionRow>> {
    const rows = await this.auditRows(
      query.before ? { id: { lt: BigInt(query.before) } } : {},
      query.limit + 1,
    );
    return page(rows, query.limit);
  }

  private async auditRows(
    where: Prisma.AdminActionWhereInput,
    take: number,
  ): Promise<AdminActionRow[]> {
    const rows = await this.prisma.adminAction.findMany({
      where,
      orderBy: { id: 'desc' },
      take,
    });
    const admins = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.adminId))] } },
      select: { id: true, email: true },
    });
    const emails = new Map(admins.map((a) => [a.id, a.email]));
    return rows.map((r) => ({
      id: r.id.toString(),
      adminId: r.adminId,
      adminEmail: emails.get(r.adminId) ?? null,
      action: r.action,
      targetUser: r.targetUser,
      targetGame: r.targetGame,
      details: r.details as Record<string, unknown>,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  private async record(
    tx: Tx,
    adminId: string,
    action: string,
    data: {
      targetUser?: string;
      targetGame?: string;
      details: Prisma.InputJsonObject;
    },
  ): Promise<void> {
    await tx.adminAction.create({ data: { adminId, action, ...data } });
  }
}

function toUserRow(user: UserWithWallet): AdminUserRow {
  const now = Date.now();
  const future = (d: Date | null) =>
    d && d.getTime() > now ? d.toISOString() : null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    balance: toMinor(user.wallet?.balance ?? 0n),
    emailVerified: user.emailVerifiedAt !== null,
    selfExcludedUntil: future(user.selfExcludedUntil),
    coolOffUntil: future(user.coolOffUntil),
    createdAt: user.createdAt.toISOString(),
  };
}

function toLedgerRow(e: LedgerWithUser): AdminLedgerRow {
  return {
    id: e.id.toString(),
    userId: e.userId,
    email: e.user.email,
    type: e.type,
    amount: toMinor(e.amount),
    balanceAfter: toMinor(e.balanceAfter),
    roundId: e.roundId,
    description: e.description,
    createdAt: e.createdAt.toISOString(),
  };
}

function page<T extends { id: string }>(
  rows: T[],
  limit: number,
): CursorPage<T> {
  const items = rows.slice(0, limit);
  return {
    items,
    nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null,
  };
}
