import {
  CLASSIC_3_REEL,
  replayRound,
  verifyServerSeed,
} from '@casino/game-engine';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { io, Socket } from 'socket.io-client';
import { WalletService } from '../src/wallet/wallet.service';
import { ApiClient, TestApp, createTestApp, registration } from './test-app';

const SPIN = '/api/games/slots/classic-3-reel/spin';
const key = () => randomUUID();

describe('games (integration)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
    await t.app.listen(0);
  });

  afterAll(async () => {
    await t.close();
  });

  async function newPlayer(): Promise<{ client: ApiClient; userId: string }> {
    const client = await t.client();
    const res = await client
      .post('/api/auth/register', registration())
      .expect(201);
    return { client, userId: res.body.user.id };
  }

  const spin = (
    client: ApiClient,
    totalBet: number,
    idempotencyKey: string = key(),
  ) => client.post(SPIN, { totalBet }).set('Idempotency-Key', idempotencyKey);

  describe('validation', () => {
    it('rejects missing or malformed Idempotency-Key, unknown games and disallowed bets', async () => {
      const { client } = await newPlayer();
      await client.post(SPIN, { totalBet: 100 }).expect(400);
      await spin(client, 100, 'short').expect(400);
      await client
        .post('/api/games/slots/nope/spin', { totalBet: 100 })
        .set('Idempotency-Key', key())
        .expect(400);
      await spin(client, 7).expect(400);
      await spin(client, -100).expect(400);
      await client
        .post(SPIN, { totalBet: 100, cheat: true })
        .set('Idempotency-Key', key())
        .expect(400);
    });

    it('requires authentication', async () => {
      const client = await t.client();
      await spin(client, 100).expect(401);
    });
  });

  describe('a spin', () => {
    it('settles atomically: debit, credit, ledger and round record agree', async () => {
      const { client, userId } = await newPlayer();
      const res = await spin(client, 100).expect(200);
      const body = res.body;

      expect(body).toMatchObject({
        gameId: 'classic-3-reel',
        stake: 100,
        replayed: false,
      });
      expect(body.result.kind).toBe('lines');
      expect(body.payout).toBe(body.result.totalWin);
      expect(body.balance).toBe(100_000 - 100 + body.payout);
      expect(body.fairness).toMatchObject({
        nonce: 0,
        serverSeedHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      });

      const ledger = await t.prisma.ledgerEntry.findMany({
        where: { userId, roundId: body.roundId },
        orderBy: { id: 'asc' },
      });
      expect(ledger.map((e) => [e.type, Number(e.amount)])).toEqual(
        body.payout > 0
          ? [
              ['BET', -100],
              ['WIN', body.payout],
            ]
          : [['BET', -100]],
      );
      const round = await t.prisma.gameRound.findUniqueOrThrow({
        where: { id: body.roundId },
      });
      expect(round).toMatchObject({
        status: 'SETTLED',
        nonce: 0,
        input: { totalBet: 100 },
      });

      const next = await spin(client, 100).expect(200);
      expect(next.body.fairness.nonce).toBe(1);
      expect(next.body.fairness.serverSeedHash).toBe(
        body.fairness.serverSeedHash,
      );
    });

    it('replays an identical request with the same Idempotency-Key instead of betting twice', async () => {
      const { client, userId } = await newPlayer();
      const k = key();
      const first = await spin(client, 250, k).expect(200);
      const again = await spin(client, 250, k).expect(200);
      expect(again.body).toMatchObject({
        roundId: first.body.roundId,
        payout: first.body.payout,
        result: first.body.result,
        replayed: true,
      });
      expect(await t.prisma.gameRound.count({ where: { userId } })).toBe(1);
      await spin(client, 500, k).expect(409);
    });

    it('places exactly one bet when the same key races', async () => {
      const { client, userId } = await newPlayer();
      const k = key();
      const results = await Promise.all(
        Array.from({ length: 5 }, () => spin(client, 100, k)),
      );
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(new Set(results.map((r) => r.body.roundId)).size).toBe(1);
      expect(
        await t.prisma.ledgerEntry.count({ where: { userId, type: 'BET' } }),
      ).toBe(1);
    });

    it('serialises parallel spins: unique sequential nonces and a consistent balance', async () => {
      const { client, userId } = await newPlayer();
      const results = await Promise.all(
        Array.from({ length: 8 }, () => spin(client, 100)),
      );
      expect(results.every((r) => r.status === 200)).toBe(true);
      const nonces = results
        .map((r) => r.body.fairness.nonce)
        .sort((a, b) => a - b);
      expect(nonces).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      const won = results.reduce((s, r) => s + r.body.payout, 0);
      expect(await t.app.get(WalletService).getBalance(userId)).toBe(
        100_000 - 800 + won,
      );
    });

    it('rejects a bet larger than the balance without consuming a nonce', async () => {
      const { client, userId } = await newPlayer();
      const wallet = t.app.get(WalletService);
      await t.prisma.$transaction((tx) =>
        wallet.applyEntry(tx, { userId, type: 'ADJUSTMENT', amount: -99_950 }),
      );
      await spin(client, 100).expect(422);
      const fairness = await client.get('/api/fairness').expect(200);
      expect(fairness.body.nextNonce).toBe(0);
      expect(await t.prisma.gameRound.count({ where: { userId } })).toBe(0);
      expect(await wallet.getBalance(userId)).toBe(50);
    });

    it('refuses bets on a disabled game', async () => {
      const { client } = await newPlayer();
      await t.prisma.gameSetting.update({
        where: { gameId: 'classic-3-reel' },
        data: { enabled: false },
      });
      try {
        await spin(client, 100).expect(503);
        const games = await client.get('/api/games').expect(200);
        expect(
          games.body.find((g: { id: string }) => g.id === 'classic-3-reel')
            .enabled,
        ).toBe(false);
      } finally {
        await t.prisma.gameSetting.update({
          where: { gameId: 'classic-3-reel' },
          data: { enabled: true },
        });
      }
    });
  });

  describe('provably fair verification', () => {
    it('reveals the server seed on rotation and every past round replays exactly', async () => {
      const { client } = await newPlayer();
      const before = await client.get('/api/fairness').expect(200);
      const spins = [];
      for (let i = 0; i < 5; i++) spins.push((await spin(client, 100)).body);

      // Not revealed yet.
      const hidden = await client
        .get(`/api/rounds/${spins[0].roundId}`)
        .expect(200);
      expect(hidden.body.fairness.serverSeed).toBeNull();

      const rotated = await client
        .post('/api/fairness/rotate', { clientSeed: 'my-lucky-seed' })
        .expect(200);
      expect(rotated.body.revealed).toMatchObject({
        serverSeedHash: before.body.serverSeedHash,
        clientSeed: before.body.clientSeed,
        roundsPlayed: 5,
      });
      expect(
        verifyServerSeed(
          rotated.body.revealed.serverSeed,
          before.body.serverSeedHash,
        ),
      ).toBe(true);
      expect(rotated.body.active).toMatchObject({
        clientSeed: 'my-lucky-seed',
        nextNonce: 0,
      });
      expect(rotated.body.active.serverSeedHash).not.toBe(
        before.body.serverSeedHash,
      );

      for (const s of spins) {
        const detail = await client.get(`/api/rounds/${s.roundId}`).expect(200);
        const { serverSeed, clientSeed, nonce } = detail.body.fairness;
        expect(serverSeed).toBe(rotated.body.revealed.serverSeed);
        const replay = replayRound(
          { serverSeed, clientSeed, nonce },
          {
            game: 'slot',
            gameId: CLASSIC_3_REEL.id,
            totalBet: detail.body.input.totalBet,
          },
        );
        expect(replay.totalPayout).toBe(s.payout);
        expect(replay.result).toEqual(s.result);
      }

      const history = await client.get('/api/fairness/revealed').expect(200);
      expect(history.body[0].serverSeed).toBe(rotated.body.revealed.serverSeed);
    });

    it('validates client seeds', async () => {
      const { client } = await newPlayer();
      await client
        .post('/api/fairness/rotate', { clientSeed: 'has space' })
        .expect(400);
      await client
        .post('/api/fairness/rotate', { clientSeed: 'x'.repeat(65) })
        .expect(400);
      const random = await client.post('/api/fairness/rotate', {}).expect(200);
      expect(random.body.active.clientSeed).toMatch(/^[A-Za-z0-9_-]{16}$/);
    });

    it('only shows a player their own rounds', async () => {
      const a = await newPlayer();
      const b = await newPlayer();
      const mine = (await spin(a.client, 100)).body.roundId;
      await b.client.get(`/api/rounds/${mine}`).expect(404);
      await a.client.get('/api/rounds/not-a-uuid').expect(400);
      const list = await a.client
        .get('/api/rounds?gameId=classic-3-reel')
        .expect(200);
      expect(list.body).toMatchObject({
        total: 1,
        items: [{ id: mine, gameId: 'classic-3-reel', stake: 100 }],
      });
    });
  });

  describe('realtime balance', () => {
    const url = () =>
      `http://127.0.0.1:${(t.app.getHttpServer().address() as AddressInfo).port}`;

    function connect(
      cookie: string | undefined,
      origin: string | undefined,
    ): Socket {
      return io(url(), {
        path: '/api/socket.io',
        transports: ['websocket'],
        reconnection: false,
        extraHeaders: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(origin ? { Origin: origin } : {}),
        },
      });
    }

    it('pushes the new balance to the player’s sockets after a spin', async () => {
      const { client } = await newPlayer();
      const socket = connect(
        `access_token=${client.cookies.get('access_token')}`,
        t.config.APP_URL,
      );
      try {
        await new Promise<void>((resolve, reject) => {
          socket.on('ready', () => resolve());
          socket.on('connect_error', reject);
        });
        const received = new Promise<{ balance: number }>((resolve) =>
          socket.on('balance', resolve),
        );
        const res = await spin(client, 100).expect(200);
        await expect(received).resolves.toEqual({ balance: res.body.balance });
      } finally {
        socket.close();
      }
    });

    it('rejects sockets from foreign origins and without a session', async () => {
      const foreign = connect('access_token=x', 'https://evil.example');
      await expect(
        new Promise((resolve, reject) => {
          foreign.on('connect', () => resolve('connected'));
          foreign.on('connect_error', reject);
        }),
      ).rejects.toThrow();
      foreign.close();

      const anonymous = connect(undefined, t.config.APP_URL);
      await expect(
        new Promise<string>((resolve) =>
          anonymous.on('unauthorized', () => resolve('unauthorized')),
        ),
      ).resolves.toBe('unauthorized');
      anonymous.close();
    });
  });
});
