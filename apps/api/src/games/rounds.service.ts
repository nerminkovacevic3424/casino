import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Rng, createFairRng } from '@casino/game-engine';
import type {
  FairnessInfo,
  GameId,
  Paginated,
  RoundDetail,
  RoundResponse,
  RoundSummary,
} from '@casino/shared-types';
import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import { toBigMinor, toMinor } from '../common/money';
import { FairnessService, nodeHmac } from '../fairness/fairness.service';
import { Prisma } from '../generated/prisma/client';
import type { GameRound } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { WalletService } from '../wallet/wallet.service';
import { GameSettingsService } from './game-settings.service';

export interface InstantRoundRequest<R> {
  readonly userId: string;
  readonly gameId: GameId;
  readonly idempotencyKey: string;
  /** Player choices; stored with the round so it can be replayed and verified. */
  readonly input: Prisma.InputJsonObject;
  readonly stake: number;
  /** Pure outcome function driven only by the provably fair RNG. */
  readonly resolve: (rng: Rng) => { payout: number; result: R };
}

@Injectable()
export class RoundsService {
  private readonly logger = new Logger(RoundsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fairness: FairnessService,
    private readonly wallet: WalletService,
    private readonly settings: GameSettingsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * Resolves a single-step round (slot spin, roulette spin) as ONE database
   * transaction: reserve nonce (seed row lock) → resolve → record round →
   * debit stake → credit win (wallet row lock). Either all of it happens or
   * none of it does.
   */
  async playInstant<R>(req: InstantRoundRequest<R>): Promise<RoundResponse<R>> {
    const replay = await this.findReplay<R>(req);
    if (replay) return replay;
    await this.settings.assertEnabled(req.gameId);

    try {
      const response = await this.prisma.$transaction(async (tx) => {
        const seed = await this.fairness.reserveNonce(tx, req.userId);
        const rng = createFairRng(seed, nodeHmac);
        const { payout, result } = req.resolve(rng);

        const roundId = randomUUID();
        await tx.gameRound.create({
          data: {
            id: roundId,
            userId: req.userId,
            gameId: req.gameId,
            seedPairId: seed.seedPairId,
            nonce: seed.nonce,
            status: 'SETTLED',
            stake: toBigMinor(req.stake),
            payout: toBigMinor(payout),
            input: req.input,
            result: result as Prisma.InputJsonValue,
            idempotencyKey: req.idempotencyKey,
            settledAt: new Date(),
          },
        });
        let { balance } = await this.wallet.applyEntry(tx, {
          userId: req.userId,
          type: 'BET',
          amount: -req.stake,
          roundId,
        });
        if (payout > 0) {
          ({ balance } = await this.wallet.applyEntry(tx, {
            userId: req.userId,
            type: 'WIN',
            amount: payout,
            roundId,
          }));
        }
        return {
          roundId,
          gameId: req.gameId,
          stake: req.stake,
          payout,
          balance,
          result,
          fairness: {
            serverSeedHash: seed.serverSeedHash,
            clientSeed: seed.clientSeed,
            nonce: seed.nonce,
          },
          replayed: false,
        } satisfies RoundResponse<R>;
      });
      this.realtime.emitBalance(req.userId, response.balance);
      return response;
    } catch (err) {
      // A concurrent retry with the same key won the race: return its result.
      if (isUniqueViolation(err)) {
        const winner = await this.findReplay<R>(req);
        if (winner) return winner;
      }
      throw err;
    }
  }

  async list(
    userId: string,
    query: { page: number; pageSize: number; gameId?: GameId },
  ): Promise<Paginated<RoundSummary>> {
    const where = { userId, ...(query.gameId ? { gameId: query.gameId } : {}) };
    const [rounds, total] = await this.prisma.$transaction([
      this.prisma.gameRound.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.gameRound.count({ where }),
    ]);
    return {
      items: rounds.map(toSummary),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  /** Full round incl. inputs; the server seed is included only once it has been revealed. */
  async detail(userId: string, roundId: string): Promise<RoundDetail> {
    const round = await this.prisma.gameRound.findFirst({
      where: { id: roundId, userId },
      include: { seedPair: true },
    });
    if (!round) throw new NotFoundException('Round not found');
    return {
      ...toSummary(round),
      input: round.input,
      result: round.status === 'SETTLED' ? round.result : null,
      fairness: {
        serverSeedHash: round.seedPair.serverSeedHash,
        clientSeed: round.seedPair.clientSeed,
        nonce: round.nonce,
        serverSeed: round.seedPair.revealedAt
          ? round.seedPair.serverSeed
          : null,
      },
    };
  }

  private async findReplay<R>(
    req: InstantRoundRequest<R>,
  ): Promise<RoundResponse<R> | null> {
    const existing = await this.prisma.gameRound.findUnique({
      where: {
        userId_idempotencyKey: {
          userId: req.userId,
          idempotencyKey: req.idempotencyKey,
        },
      },
      include: { seedPair: true },
    });
    if (!existing) return null;
    if (
      existing.gameId !== req.gameId ||
      !isDeepStrictEqual(existing.input, req.input)
    ) {
      throw new ConflictException(
        'Idempotency-Key was already used for a different request',
      );
    }
    this.logger.log({ roundId: existing.id }, 'Idempotent replay');
    const fairness: FairnessInfo = {
      serverSeedHash: existing.seedPair.serverSeedHash,
      clientSeed: existing.seedPair.clientSeed,
      nonce: existing.nonce,
    };
    return {
      roundId: existing.id,
      gameId: existing.gameId as GameId,
      stake: toMinor(existing.stake),
      payout: toMinor(existing.payout),
      balance: await this.wallet.getBalance(req.userId),
      result: existing.result as R,
      fairness,
      replayed: true,
    };
  }
}

function toSummary(round: GameRound): RoundSummary {
  return {
    id: round.id,
    gameId: round.gameId as GameId,
    status: round.status,
    stake: toMinor(round.stake),
    payout: toMinor(round.payout),
    nonce: round.nonce,
    createdAt: round.createdAt.toISOString(),
  };
}

const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
