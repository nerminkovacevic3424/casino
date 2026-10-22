import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createFairRng } from '@casino/game-engine';
import type { RoundResponse } from '@casino/shared-types';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { toBigMinor, toMinor } from '../common/money';
import { FairnessService, nodeHmac } from '../fairness/fairness.service';
import { Prisma } from '../generated/prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ResponsibleService } from '../responsible/responsible.service';
import { WalletService } from '../wallet/wallet.service';
import { GameSettingsService } from './game-settings.service';
import { StepGame } from './step-games';

/** Engine validation errors (bad bet, illegal action) become 400s. */
function engine<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof HttpException) throw err;
    throw new BadRequestException((err as Error).message);
  }
}

interface LockedRound {
  id: string;
  user_id: string;
  game_id: string;
  status: 'OPEN' | 'SETTLED';
  input: Prisma.JsonObject;
  nonce: number;
  server_seed: string;
  server_seed_hash: string;
  client_seed: string;
}

/**
 * Multi-request rounds (blackjack, video poker). Every step is one database
 * transaction that locks the round row, rebuilds the state from the seeds,
 * applies the player's decision, debits any extra stake and, when the round
 * ends, credits the payout.
 */
@Injectable()
export class StepRoundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fairness: FairnessService,
    private readonly wallet: WalletService,
    private readonly settings: GameSettingsService,
    private readonly realtime: RealtimeGateway,
    private readonly responsible: ResponsibleService,
  ) {}

  async open<S, V, I extends object>(
    game: StepGame<S, V, I>,
    userId: string,
    idempotencyKey: string,
    input: I,
  ): Promise<RoundResponse<V>> {
    const existing = await this.prisma.gameRound.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
    });
    if (existing) {
      if (existing.gameId !== game.gameId)
        throw new ConflictException(
          'Idempotency-Key was already used for a different request',
        );
      return this.current(game, userId, existing.id, true);
    }
    await this.settings.assertEnabled(game.gameId);
    const open = await this.prisma.gameRound.findFirst({
      where: { userId, gameId: game.gameId, status: 'OPEN' },
      select: { id: true },
    });
    if (open)
      throw new ConflictException({
        message: 'Finish your current hand first',
        roundId: open.id,
      });

    try {
      const response = await this.prisma.$transaction(async (tx) => {
        const seed = await this.fairness.reserveNonce(tx, userId);
        const state = engine(() =>
          game.replay(createFairRng(seed, nodeHmac), input),
        );
        // Responsible-play checks after the per-player (seed) lock.
        await this.responsible.assertCanBet(tx, userId, game.stake(state));
        const roundId = randomUUID();
        const settled = game.settled(state);
        const stake = game.stake(state);
        const payout = settled ? game.payout(state) : 0;
        await tx.gameRound.create({
          data: {
            id: roundId,
            userId,
            gameId: game.gameId,
            seedPairId: seed.seedPairId,
            nonce: seed.nonce,
            status: settled ? 'SETTLED' : 'OPEN',
            stake: toBigMinor(stake),
            payout: toBigMinor(payout),
            input: input as Prisma.InputJsonObject,
            result: game.view(state) as Prisma.InputJsonValue,
            idempotencyKey,
            settledAt: settled ? new Date() : null,
          },
        });
        let { balance } = await this.wallet.applyEntry(tx, {
          userId,
          type: 'BET',
          amount: -stake,
          roundId,
        });
        if (payout > 0) {
          ({ balance } = await this.wallet.applyEntry(tx, {
            userId,
            type: 'WIN',
            amount: payout,
            roundId,
          }));
        }
        return {
          roundId,
          gameId: game.gameId,
          stake,
          payout,
          balance,
          result: game.view(state),
          fairness: {
            serverSeedHash: seed.serverSeedHash,
            clientSeed: seed.clientSeed,
            nonce: seed.nonce,
          },
          replayed: false,
        } satisfies RoundResponse<V>;
      });
      this.realtime.emitBalance(userId, response.balance);
      return response;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return this.open(game, userId, idempotencyKey, input);
      }
      throw err;
    }
  }

  /**
   * Applies one decision. `seq` is how many decisions the client has already
   * seen; a retry of an already-applied step gets the current state back
   * (idempotent), anything else stale is rejected.
   */
  async step<S, V, I extends object>(
    game: StepGame<S, V, I>,
    userId: string,
    roundId: string,
    seq: number,
    next: (input: I) => I,
  ): Promise<RoundResponse<V>> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const round = await this.lock(tx, roundId);
      if (!round || round.user_id !== userId || round.game_id !== game.gameId) {
        throw new NotFoundException('Round not found');
      }
      const input = round.input as unknown as I;
      const done = game.steps(input);
      if (seq < done) {
        // Same decision already applied (network retry or double click): just report the state.
        const wanted = engine(() => next(game.truncate(input, seq)));
        if (isDeepStrictEqual(wanted, game.truncate(input, seq + 1)))
          return { replayed: true as const };
        throw new ConflictException(
          'This hand has already moved on; refresh to continue',
        );
      }
      if (seq > done) throw new ConflictException('Out-of-order action');
      if (round.status === 'SETTLED')
        throw new ConflictException('This round is already settled');

      const rng = () =>
        createFairRng(
          {
            serverSeed: round.server_seed,
            clientSeed: round.client_seed,
            nonce: round.nonce,
          },
          nodeHmac,
        );
      const before = engine(() => game.replay(rng(), input));
      const nextInput = engine(() => next(input));
      const after = engine(() => game.replay(rng(), nextInput));

      const extraStake = game.stake(after) - game.stake(before);
      const settled = game.settled(after);
      const payout = settled ? game.payout(after) : 0;
      let balance: number | null = null;
      if (extraStake > 0) {
        await this.responsible.assertCanBet(tx, userId, extraStake);
        ({ balance } = await this.wallet.applyEntry(tx, {
          userId,
          type: 'BET',
          amount: -extraStake,
          roundId,
        }));
      }
      await tx.gameRound.update({
        where: { id: roundId },
        data: {
          input: nextInput as Prisma.InputJsonObject,
          stake: toBigMinor(game.stake(after)),
          payout: toBigMinor(payout),
          status: settled ? 'SETTLED' : 'OPEN',
          settledAt: settled ? new Date() : null,
          result: game.view(after) as Prisma.InputJsonValue,
        },
      });
      if (payout > 0) {
        ({ balance } = await this.wallet.applyEntry(tx, {
          userId,
          type: 'WIN',
          amount: payout,
          roundId,
        }));
      }
      return { replayed: false as const, balance };
    });
    if (!outcome.replayed && outcome.balance !== null)
      this.realtime.emitBalance(userId, outcome.balance);
    return this.current(game, userId, roundId, outcome.replayed);
  }

  /** The player's unfinished round for this game, if any (resume after reload). */
  async openRound<S, V, I extends object>(
    game: StepGame<S, V, I>,
    userId: string,
  ): Promise<RoundResponse<V> | null> {
    const open = await this.prisma.gameRound.findFirst({
      where: { userId, gameId: game.gameId, status: 'OPEN' },
      select: { id: true },
    });
    return open ? this.current(game, userId, open.id, true) : null;
  }

  private async current<S, V, I extends object>(
    game: StepGame<S, V, I>,
    userId: string,
    roundId: string,
    replayed: boolean,
  ): Promise<RoundResponse<V>> {
    const round = await this.prisma.gameRound.findFirst({
      where: { id: roundId, userId, gameId: game.gameId },
      include: { seedPair: true },
    });
    if (!round) throw new NotFoundException('Round not found');
    const seed = {
      serverSeed: round.seedPair.serverSeed,
      clientSeed: round.seedPair.clientSeed,
      nonce: round.nonce,
    };
    const state = game.replay(
      createFairRng(seed, nodeHmac),
      round.input as unknown as I,
    );
    return {
      roundId: round.id,
      gameId: game.gameId,
      stake: toMinor(round.stake),
      payout: toMinor(round.payout),
      balance: await this.wallet.getBalance(userId),
      result: game.view(state),
      fairness: {
        serverSeedHash: round.seedPair.serverSeedHash,
        clientSeed: seed.clientSeed,
        nonce: round.nonce,
      },
      replayed,
    };
  }

  private async lock(
    tx: Tx,
    roundId: string,
  ): Promise<LockedRound | undefined> {
    const rows = await tx.$queryRaw<LockedRound[]>`
      SELECT r.id, r.user_id, r.game_id, r.status, r.input, r.nonce,
             s.server_seed, s.server_seed_hash, s.client_seed
      FROM game_rounds r JOIN seed_pairs s ON s.id = r.seed_pair_id
      WHERE r.id = ${roundId}::uuid
      FOR UPDATE OF r`;
    return rows[0];
  }
}
