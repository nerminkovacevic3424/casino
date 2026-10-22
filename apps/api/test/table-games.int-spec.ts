import {
  JACKS_OR_BETTER_9_6,
  coveredNumbers,
  evaluatePokerHand,
  replayRound,
  type BlackjackAction,
  type RouletteBet,
} from '@casino/game-engine';
import { randomUUID } from 'node:crypto';
import type { Response } from 'supertest';
import { WalletService } from '../src/wallet/wallet.service';
import { ApiClient, TestApp, createTestApp, registration } from './test-app';

const key = () => randomUUID();

/** Bet endpoints allow 10 requests/second per client; space looping tests accordingly. */
let lastBet = 0;
async function pace(): Promise<void> {
  const wait = lastBet + 110 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastBet = Date.now();
}

describe('table games (integration)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
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

  const balanceOf = (userId: string) =>
    t.app.get(WalletService).getBalance(userId);

  describe('roulette', () => {
    const spin = async (client: ApiClient, bets: unknown[], status = 200) => {
      await pace();
      return client
        .post('/api/games/roulette/spin', { bets })
        .set('Idempotency-Key', key())
        .expect(status);
    };

    it('settles every bet against the winning number', async () => {
      const { client, userId } = await newPlayer();
      const bets: RouletteBet[] = [
        { type: 'red', amount: 100 },
        { type: 'straight', numbers: [17], amount: 50 },
        { type: 'column', index: 2, amount: 30 },
        { type: 'corner', numbers: [0, 1, 2, 3], amount: 20 },
      ];
      const res = await spin(client, bets);
      const { number, bets: settled } = res.body.result;
      expect(number).toBeGreaterThanOrEqual(0);
      expect(number).toBeLessThanOrEqual(36);
      expect(res.body.stake).toBe(200);
      const odds = { red: 1, straight: 35, column: 2, corner: 8 } as const;
      const expected = bets.reduce(
        (sum, b) =>
          sum +
          (coveredNumbers(b).includes(number)
            ? b.amount * (odds[b.type as keyof typeof odds] + 1)
            : 0),
        0,
      );
      expect(res.body.payout).toBe(expected);
      expect(settled).toHaveLength(4);
      expect(await balanceOf(userId)).toBe(100_000 - 200 + expected);
    });

    it.each([
      ['an illegal split', [{ type: 'split', numbers: [3, 4], amount: 100 }]],
      ['an off-chip amount', [{ type: 'red', amount: 15 }]],
      ['a column without index', [{ type: 'column', amount: 100 }]],
      ['an unknown type', [{ type: 'basket', amount: 100 }]],
      ['no bets', []],
    ])('rejects %s', async (_, bets) => {
      const { client } = await newPlayer();
      await spin(client, bets, 400);
    });

    it('keeps the last 20 numbers, newest first', async () => {
      const { client } = await newPlayer();
      const numbers: number[] = [];
      for (let i = 0; i < 3; i++)
        numbers.unshift(
          (await spin(client, [{ type: 'even', amount: 10 }])).body.result
            .number,
        );
      const history = await client
        .get('/api/games/roulette/history')
        .expect(200);
      expect(history.body).toEqual(numbers);
    });
  });

  describe('blackjack', () => {
    const deal = async (client: ApiClient, bet = 100, status = 200) => {
      await pace();
      return client
        .post('/api/games/blackjack/deal', { bet })
        .set('Idempotency-Key', key())
        .expect(status);
    };
    const act = async (
      client: ApiClient,
      roundId: string,
      action: BlackjackAction,
      seq: number,
      status = 200,
    ) => {
      await pace();
      return client
        .post(`/api/games/blackjack/rounds/${roundId}/action`, { action, seq })
        .expect(status);
    };

    /** Plays a hand to the end by standing (and declining insurance). */
    async function playOut(
      client: ApiClient,
      res: Response,
    ): Promise<Response> {
      let current = res;
      let seq = 0;
      while (current.body.result.phase !== 'settled') {
        const action =
          current.body.result.phase === 'insurance' ? 'no-insurance' : 'stand';
        current = await act(client, current.body.roundId, action, seq);
        seq++;
      }
      return current;
    }

    it('deals, hides the hole card, plays to settlement and reconciles the balance', async () => {
      const { client, userId } = await newPlayer();
      const res = await deal(client);
      expect(res.body.stake).toBe(100);
      if (res.body.result.phase !== 'settled') {
        expect(res.body.result.dealer[1]).toBeNull();
        expect(res.body.result).not.toHaveProperty('shoe');
        expect(await balanceOf(userId)).toBe(100_000 - 100);
      }
      const final = await playOut(client, res);
      expect(final.body.result.dealer.every((c: unknown) => c !== null)).toBe(
        true,
      );
      expect(final.body.payout).toBe(final.body.result.totalPayout);
      expect(await balanceOf(userId)).toBe(
        100_000 - final.body.stake + final.body.payout,
      );
      const round = await t.prisma.gameRound.findUniqueOrThrow({
        where: { id: res.body.roundId },
      });
      expect(round.status).toBe('SETTLED');
    });

    it('allows only one open hand, and lets the player resume it', async () => {
      const { client } = await newPlayer();
      // Deal until we get a hand that does not settle immediately (naturals settle at once).
      let res = await deal(client);
      while (res.body.result.phase === 'settled') res = await deal(client);

      const blocked = await deal(client, 100, 409);
      expect(blocked.body.message).toMatch(/Finish your current hand/);
      const open = await client.get('/api/games/blackjack/open').expect(200);
      expect(open.body.roundId).toBe(res.body.roundId);

      // Seeds cannot be rotated (revealed) while a hand is open.
      await client.post('/api/fairness/rotate', {}).expect(409);
      await playOut(client, res);
      expect(
        (await client.get('/api/games/blackjack/open').expect(200)).body,
      ).toEqual({});
    });

    it('treats a retried action as idempotent and rejects stale or illegal ones', async () => {
      const { client, userId } = await newPlayer();
      let res = await deal(client);
      while (res.body.result.phase !== 'player') {
        await playOut(client, res);
        res = await deal(client);
      }
      const id = res.body.roundId;
      await act(client, id, 'insurance', 0, 400); // not offered in the player phase
      await act(client, id, 'stand', 5, 409); // from the future
      const first = await act(client, id, 'stand', 0);
      const retry = await act(client, id, 'stand', 0);
      expect(retry.body.replayed).toBe(true);
      expect(retry.body.result).toEqual(first.body.result);
      await act(client, id, 'hit', 0, 409); // a different decision for an old step
      expect(await balanceOf(userId)).toBe(retry.body.balance);
    });

    it('debits the extra stake when doubling', async () => {
      const { client, userId } = await newPlayer();
      let res = await deal(client, 200);
      while (!(res.body.result.legalActions as string[]).includes('double')) {
        await playOut(client, res);
        res = await deal(client, 200);
      }
      const before = await balanceOf(userId);
      const doubled = await act(client, res.body.roundId, 'double', 0);
      expect(doubled.body.stake).toBe(400);
      expect(doubled.body.result.phase).toBe('settled');
      expect(await balanceOf(userId)).toBe(before - 200 + doubled.body.payout);
    });

    it.each([101, 50, 200_000])('rejects bet %p', async (bet) => {
      const { client } = await newPlayer();
      await deal(client, bet, 400);
    });

    it('another player cannot act on my hand', async () => {
      const a = await newPlayer();
      const b = await newPlayer();
      let res = await deal(a.client);
      while (res.body.result.phase === 'settled') res = await deal(a.client);
      await act(b.client, res.body.roundId, 'stand', 0, 404);
    });
  });

  describe('video poker', () => {
    const deal = (client: ApiClient, coins = 5, coinValue = 25, k = key()) =>
      client
        .post('/api/games/video-poker/deal', { coins, coinValue })
        .set('Idempotency-Key', k);

    it('deals five cards, draws replacements and pays by the 9/6 table', async () => {
      const { client, userId } = await newPlayer();
      const dealt = await deal(client);
      expect(dealt.body.result).toMatchObject({ phase: 'dealt', bet: 125 });
      expect(dealt.body.result.hand).toHaveLength(5);
      expect(dealt.body.result).not.toHaveProperty('deck');
      expect(await balanceOf(userId)).toBe(100_000 - 125);

      const held = [true, false, true, false, false];
      const drawn = await client
        .post(`/api/games/video-poker/rounds/${dealt.body.roundId}/draw`, {
          held,
        })
        .expect(200);
      const result = drawn.body.result;
      expect(result.phase).toBe('settled');
      expect(result.hand[0]).toEqual(dealt.body.result.hand[0]);
      expect(result.hand[2]).toEqual(dealt.body.result.hand[2]);
      expect(result.rank).toBe(evaluatePokerHand(result.hand));
      const pays =
        JACKS_OR_BETTER_9_6[
          result.rank as keyof typeof JACKS_OR_BETTER_9_6
        ][4] * 25;
      expect(drawn.body.payout).toBe(pays);
      expect(await balanceOf(userId)).toBe(100_000 - 125 + pays);

      const retry = await client
        .post(`/api/games/video-poker/rounds/${dealt.body.roundId}/draw`, {
          held,
        })
        .expect(200);
      expect(retry.body.replayed).toBe(true);
      await client
        .post(`/api/games/video-poker/rounds/${dealt.body.roundId}/draw`, {
          held: [true, true, true, true, true],
        })
        .expect(409);
    });

    it.each([
      [0, 25],
      [6, 25],
      [1, 7],
    ])('rejects coins=%p coinValue=%p', async (coins, coinValue) => {
      const { client } = await newPlayer();
      await deal(client, coins, coinValue).expect(400);
    });

    it('validates holds', async () => {
      const { client } = await newPlayer();
      const dealt = await deal(client);
      await client
        .post(`/api/games/video-poker/rounds/${dealt.body.roundId}/draw`, {
          held: [true],
        })
        .expect(400);
      expect(
        (await client.get('/api/games/video-poker/open').expect(200)).body
          .roundId,
      ).toBe(dealt.body.roundId);
    });
  });

  describe('verification of multi-step rounds', () => {
    it('replays blackjack and video poker rounds exactly from the revealed seed', async () => {
      const { client } = await newPlayer();
      let bj = await client
        .post('/api/games/blackjack/deal', { bet: 100 })
        .set('Idempotency-Key', key())
        .expect(200);
      let seq = 0;
      while (bj.body.result.phase !== 'settled') {
        const action =
          bj.body.result.phase === 'insurance' ? 'no-insurance' : 'hit';
        bj = await client
          .post(`/api/games/blackjack/rounds/${bj.body.roundId}/action`, {
            action,
            seq: seq++,
          })
          .expect(200);
      }
      const vp = await client
        .post('/api/games/video-poker/deal', { coins: 1, coinValue: 100 })
        .set('Idempotency-Key', key())
        .expect(200);
      const vpDone = await client
        .post(`/api/games/video-poker/rounds/${vp.body.roundId}/draw`, {
          held: [false, true, false, true, false],
        })
        .expect(200);

      await client.post('/api/fairness/rotate', {}).expect(200);

      const bjDetail = (
        await client.get(`/api/rounds/${bj.body.roundId}`).expect(200)
      ).body;
      const bjReplay = replayRound(
        {
          serverSeed: bjDetail.fairness.serverSeed,
          clientSeed: bjDetail.fairness.clientSeed,
          nonce: bjDetail.fairness.nonce,
        },
        {
          game: 'blackjack',
          bet: bjDetail.input.bet,
          actions: bjDetail.input.actions,
        },
      );
      expect(bjReplay.totalPayout).toBe(bjDetail.payout);
      expect(bjReplay.result).toEqual(bj.body.result);

      const vpDetail = (
        await client.get(`/api/rounds/${vp.body.roundId}`).expect(200)
      ).body;
      const vpReplay = replayRound(
        {
          serverSeed: vpDetail.fairness.serverSeed,
          clientSeed: vpDetail.fairness.clientSeed,
          nonce: vpDetail.fairness.nonce,
        },
        {
          game: 'video-poker',
          coins: 1,
          coinValue: 100,
          held: vpDetail.input.held,
        },
      );
      expect(vpReplay.totalPayout).toBe(vpDone.body.payout);
      expect(vpReplay.result).toEqual(vpDone.body.result);
    });
  });
});
