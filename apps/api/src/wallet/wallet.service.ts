import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Paginated } from '@casino/shared-types';
import { toBigMinor, toMinor } from '../common/money';
import { APP_CONFIG, AppConfig } from '../config/env';
import { LedgerType } from '../generated/prisma/enums';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { TransactionQueryDto } from './dto/wallet.dto';

export const DAILY_BONUS_INTERVAL_MS = 24 * 3_600_000;

export class InsufficientBalanceException extends UnprocessableEntityException {
  constructor() {
    super('Insufficient balance');
  }
}

export interface LedgerInput {
  readonly userId: string;
  readonly type: LedgerType;
  /** Signed minor units: negative debits, positive credits. Never zero. */
  readonly amount: number;
  readonly roundId?: string;
  readonly description?: string;
}

export interface WalletSummary {
  balance: number;
  dailyBonusAmount: number;
  lastDailyBonusAt: string | null;
  nextDailyBonusAt: string | null;
  canClaimDailyBonus: boolean;
}

export interface TransactionView {
  id: string;
  type: LedgerType;
  amount: number;
  balanceAfter: number;
  roundId: string | null;
  description: string | null;
  createdAt: string;
}

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * The only way balances change. Must run inside a transaction: locks the
   * wallet row (SELECT ... FOR UPDATE) so concurrent bets serialise, refuses to
   * go negative, updates the balance and appends an immutable ledger entry.
   */
  async applyEntry(
    tx: Tx,
    input: LedgerInput,
  ): Promise<{ balance: number; entryId: string }> {
    if (!Number.isSafeInteger(input.amount) || input.amount === 0) {
      throw new RangeError('Ledger amount must be a non-zero safe integer');
    }
    const rows = await tx.$queryRaw<{ id: string; balance: bigint }[]>`
      SELECT id, balance FROM wallets WHERE user_id = ${input.userId}::uuid FOR UPDATE`;
    const wallet = rows[0];
    if (!wallet) throw new NotFoundException('Wallet not found');

    const balanceAfter = wallet.balance + toBigMinor(input.amount);
    if (balanceAfter < 0n) throw new InsufficientBalanceException();

    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: balanceAfter },
    });
    const entry = await tx.ledgerEntry.create({
      data: {
        walletId: wallet.id,
        userId: input.userId,
        type: input.type,
        amount: toBigMinor(input.amount),
        balanceAfter,
        roundId: input.roundId,
        description: input.description,
      },
      select: { id: true },
    });
    return { balance: toMinor(balanceAfter), entryId: entry.id.toString() };
  }

  /** Creates the wallet for a new user and credits the signup bonus. */
  async createWallet(tx: Tx, userId: string): Promise<void> {
    await tx.wallet.create({ data: { userId } });
    if (this.config.SIGNUP_BONUS > 0) {
      await this.applyEntry(tx, {
        userId,
        type: 'SIGNUP_BONUS',
        amount: this.config.SIGNUP_BONUS,
        description: 'Welcome bonus',
      });
    }
  }

  async getSummary(userId: string): Promise<WalletSummary> {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) throw new NotFoundException('Wallet not found');
    return this.summarise(wallet.balance, wallet.lastDailyBonusAt);
  }

  async getBalance(userId: string): Promise<number> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { balance: true },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');
    return toMinor(wallet.balance);
  }

  /** Once every 24 hours, for verified accounts. Safe against double-claims via the row lock. */
  async claimDailyBonus(userId: string): Promise<WalletSummary> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { emailVerifiedAt: true },
      });
      if (!user?.emailVerifiedAt)
        throw new ForbiddenException(
          'Verify your email address to claim the daily bonus',
        );

      const [wallet] = await tx.$queryRaw<
        { last_daily_bonus_at: Date | null }[]
      >`
        SELECT last_daily_bonus_at FROM wallets WHERE user_id = ${userId}::uuid FOR UPDATE`;
      if (!wallet) throw new NotFoundException('Wallet not found');
      const last = wallet.last_daily_bonus_at;
      if (last && Date.now() - last.getTime() < DAILY_BONUS_INTERVAL_MS) {
        throw new ForbiddenException(
          'The daily bonus has already been claimed',
        );
      }

      const { balance } = await this.applyEntry(tx, {
        userId,
        type: 'DAILY_BONUS',
        amount: this.config.DAILY_BONUS,
        description: 'Daily free credits',
      });
      const now = new Date();
      await tx.wallet.update({
        where: { userId },
        data: { lastDailyBonusAt: now },
      });
      return this.summarise(toBigMinor(balance), now);
    });
  }

  async listTransactions(
    userId: string,
    query: TransactionQueryDto,
  ): Promise<Paginated<TransactionView>> {
    const where = {
      userId,
      ...(query.type ? { type: query.type } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.ledgerEntry.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.ledgerEntry.count({ where }),
    ]);
    return {
      items: items.map((e) => ({
        id: e.id.toString(),
        type: e.type,
        amount: toMinor(e.amount),
        balanceAfter: toMinor(e.balanceAfter),
        roundId: e.roundId,
        description: e.description,
        createdAt: e.createdAt.toISOString(),
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  private summarise(balance: bigint, last: Date | null): WalletSummary {
    const next = last
      ? new Date(last.getTime() + DAILY_BONUS_INTERVAL_MS)
      : null;
    return {
      balance: toMinor(balance),
      dailyBonusAmount: this.config.DAILY_BONUS,
      lastDailyBonusAt: last?.toISOString() ?? null,
      nextDailyBonusAt: next?.toISOString() ?? null,
      canClaimDailyBonus: !next || next.getTime() <= Date.now(),
    };
  }
}
