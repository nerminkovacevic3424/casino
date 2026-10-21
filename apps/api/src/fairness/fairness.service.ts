import { ConflictException, Injectable } from '@nestjs/common';
import { HmacFn, assertClientSeed, hashServerSeed } from '@casino/game-engine';
import { createHmac, randomBytes } from 'node:crypto';
import { PrismaService, Tx } from '../prisma/prisma.service';

/** Native HMAC for bet resolution; the engine's pure-TS version is for browsers. */
export const nodeHmac: HmacFn = (key, message) =>
  new Uint8Array(createHmac('sha256', key).update(message).digest());

export interface ReservedSeed {
  readonly seedPairId: string;
  readonly serverSeed: string;
  readonly serverSeedHash: string;
  readonly clientSeed: string;
  readonly nonce: number;
}

export interface ActiveSeedView {
  serverSeedHash: string;
  clientSeed: string;
  /** Nonce the next round will use. */
  nextNonce: number;
  createdAt: string;
}

export interface RevealedSeedView {
  id: string;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  /** Rounds played with this pair (nonces 0 .. roundsPlayed - 1). */
  roundsPlayed: number;
  createdAt: string;
  revealedAt: string;
}

interface SeedRow {
  id: string;
  server_seed: string;
  server_seed_hash: string;
  client_seed: string;
  next_nonce: number;
  created_at: Date;
}

@Injectable()
export class FairnessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Locks the user's active seed pair (creating one if needed) and consumes
   * the next nonce. Must run inside the bet transaction so a rolled-back bet
   * also returns its nonce. Lock order everywhere: seed pair, then wallet.
   */
  async reserveNonce(tx: Tx, userId: string): Promise<ReservedSeed> {
    const pair = await this.lockActive(tx, userId);
    await tx.seedPair.update({
      where: { id: pair.id },
      data: { nextNonce: { increment: 1 } },
    });
    return {
      seedPairId: pair.id,
      serverSeed: pair.server_seed,
      serverSeedHash: pair.server_seed_hash,
      clientSeed: pair.client_seed,
      nonce: pair.next_nonce,
    };
  }

  async active(userId: string): Promise<ActiveSeedView> {
    const pair = await this.prisma.$transaction((tx) =>
      this.lockActive(tx, userId),
    );
    return toActiveView(pair);
  }

  /**
   * Retires the active pair (revealing its server seed) and starts a new one
   * with the given client seed, or a random one.
   */
  async rotate(
    userId: string,
    clientSeed?: string,
  ): Promise<{ revealed: RevealedSeedView; active: ActiveSeedView }> {
    if (clientSeed !== undefined) assertClientSeed(clientSeed);
    return this.prisma.$transaction(async (tx) => {
      const current = await this.lockActive(tx, userId);
      const open = await tx.gameRound.count({
        where: { seedPairId: current.id, status: 'OPEN' },
      });
      if (open > 0) {
        throw new ConflictException(
          'Finish your open game round before rotating seeds',
        );
      }
      const revealed = await tx.seedPair.update({
        where: { id: current.id },
        data: { active: false, revealedAt: new Date() },
      });
      const next = await tx.seedPair.create({
        data: { userId, ...newSeeds(clientSeed) },
      });
      return {
        revealed: {
          id: revealed.id,
          serverSeed: revealed.serverSeed,
          serverSeedHash: revealed.serverSeedHash,
          clientSeed: revealed.clientSeed,
          roundsPlayed: revealed.nextNonce,
          createdAt: revealed.createdAt.toISOString(),
          revealedAt: (revealed.revealedAt as Date).toISOString(),
        },
        active: {
          serverSeedHash: next.serverSeedHash,
          clientSeed: next.clientSeed,
          nextNonce: next.nextNonce,
          createdAt: next.createdAt.toISOString(),
        },
      };
    });
  }

  async revealedHistory(
    userId: string,
    take = 20,
  ): Promise<RevealedSeedView[]> {
    const pairs = await this.prisma.seedPair.findMany({
      where: { userId, active: false },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return pairs.map((p) => ({
      id: p.id,
      serverSeed: p.serverSeed,
      serverSeedHash: p.serverSeedHash,
      clientSeed: p.clientSeed,
      roundsPlayed: p.nextNonce,
      createdAt: p.createdAt.toISOString(),
      revealedAt: (p.revealedAt as Date).toISOString(),
    }));
  }

  private async lockActive(tx: Tx, userId: string): Promise<SeedRow> {
    const select = () => tx.$queryRaw<SeedRow[]>`
      SELECT id, server_seed, server_seed_hash, client_seed, next_nonce, created_at
      FROM seed_pairs WHERE user_id = ${userId}::uuid AND active FOR UPDATE`;
    const [existing] = await select();
    if (existing) return existing;

    // First bet ever: create the pair. ON CONFLICT handles two first bets racing.
    const seeds = newSeeds();
    await tx.$executeRaw`
      INSERT INTO seed_pairs (id, user_id, server_seed, server_seed_hash, client_seed)
      VALUES (gen_random_uuid(), ${userId}::uuid, ${seeds.serverSeed}, ${seeds.serverSeedHash}, ${seeds.clientSeed})
      ON CONFLICT (user_id) WHERE active DO NOTHING`;
    const [created] = await select();
    return created;
  }
}

function newSeeds(clientSeed?: string) {
  // Server seeds come straight from the OS CSPRNG.
  const serverSeed = randomBytes(32).toString('hex');
  return {
    serverSeed,
    serverSeedHash: hashServerSeed(serverSeed),
    clientSeed: clientSeed ?? randomBytes(12).toString('base64url'),
  };
}

function toActiveView(pair: SeedRow): ActiveSeedView {
  return {
    serverSeedHash: pair.server_seed_hash,
    clientSeed: pair.client_seed,
    nextNonce: pair.next_nonce,
    createdAt: pair.created_at.toISOString(),
  };
}
