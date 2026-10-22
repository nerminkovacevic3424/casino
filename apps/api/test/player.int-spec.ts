import { JACKPOT_SEED } from '@casino/game-engine';
import { randomUUID } from 'node:crypto';
import { JackpotService } from '../src/jackpot/jackpot.service';
import { ApiClient, TestApp, createTestApp, registration } from './test-app';

const SPIN = '/api/games/slots/classic-3-reel/spin';

describe('player features (integration)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  async function newPlayer(): Promise<{
    client: ApiClient;
    userId: string;
    password: string;
    email: string;
  }> {
    const client = await t.client();
    const body = registration();
    const res = await client.post('/api/auth/register', body).expect(201);
    return {
      client,
      userId: res.body.user.id,
      password: body.password,
      email: body.email,
    };
  }

  const spin = (client: ApiClient, totalBet = 100) =>
    client.post(SPIN, { totalBet }).set('Idempotency-Key', randomUUID());

  describe('limits', () => {
    it('applies a new limit immediately and enforces the daily wager limit', async () => {
      const { client } = await newPlayer();
      const res = await client
        .put('/api/responsible/limits', { dailyWagerLimit: 250 })
        .expect(200);
      expect(res.body.limits.dailyWagerLimit).toBe(250);
      expect(res.body.pending).toBeNull();
      await spin(client).expect(200);
      await spin(client).expect(200);
      const blocked = await spin(client).expect(403);
      expect(blocked.body.message).toMatch(/daily wager limit/);
      const state = await client.get('/api/responsible').expect(200);
      expect(state.body.usage.wagerDay).toBe(200);
    });

    it('enforces loss limits against stakes minus winnings', async () => {
      const { client, userId } = await newPlayer();
      await client
        .put('/api/responsible/limits', { dailyLossLimit: 100 })
        .expect(200);
      // Spin until a bet would push net losses past 1.00 credit.
      let blocked = false;
      for (let i = 0; i < 40 && !blocked; i++) {
        await new Promise((r) => setTimeout(r, 110)); // bet endpoints allow 10/s
        const res = await spin(client);
        blocked = res.status === 403;
        if (blocked) expect(res.body.message).toMatch(/daily loss limit/);
        else expect(res.status).toBe(200);
      }
      expect(blocked).toBe(true);
      const agg = await t.prisma.gameRound.aggregate({
        where: { userId },
        _sum: { stake: true, payout: true },
      });
      expect(
        Number((agg._sum.stake ?? 0n) - (agg._sum.payout ?? 0n)),
      ).toBeLessThanOrEqual(100);
    });

    it('delays loosening by 24 hours but tightens at once', async () => {
      const { client, userId } = await newPlayer();
      await client
        .put('/api/responsible/limits', {
          dailyLossLimit: 1000,
          sessionLimitMinutes: 60,
        })
        .expect(200);

      const raised = await client
        .put('/api/responsible/limits', { dailyLossLimit: 5000 })
        .expect(200);
      expect(raised.body.limits.dailyLossLimit).toBe(1000);
      expect(raised.body.pending).toEqual({ dailyLossLimit: 5000 });
      const effective = new Date(raised.body.pendingEffectiveAt).getTime();
      expect(effective - Date.now()).toBeGreaterThan(23.9 * 3_600_000);

      const removed = await client
        .put('/api/responsible/limits', { sessionLimitMinutes: null })
        .expect(200);
      expect(removed.body.limits.sessionLimitMinutes).toBe(60);
      expect(removed.body.pending).toEqual({
        dailyLossLimit: 5000,
        sessionLimitMinutes: null,
      });

      const lowered = await client
        .put('/api/responsible/limits', { dailyLossLimit: 500 })
        .expect(200);
      expect(lowered.body.limits.dailyLossLimit).toBe(500);
      expect(lowered.body.pending).toEqual({ sessionLimitMinutes: null });

      // Once the cooling period has passed, pending changes apply.
      await t.prisma.playerLimits.update({
        where: { userId },
        data: { pendingEffectiveAt: new Date(Date.now() - 1000) },
      });
      const later = await client.get('/api/responsible').expect(200);
      expect(later.body.limits.sessionLimitMinutes).toBeNull();
      expect(later.body.pending).toBeNull();
    });

    it.each([
      { dailyLossLimit: 0 },
      { realityCheckMinutes: 1 },
      { dailyLossLimit: 1.5 },
      { unknown: 5 },
    ])('rejects %p', async (body) => {
      const { client } = await newPlayer();
      await client.put('/api/responsible/limits', body).expect(400);
    });
  });

  describe('breaks', () => {
    it('a cool-off blocks betting and cannot be shortened', async () => {
      const { client } = await newPlayer();
      const week = await client
        .post('/api/responsible/cool-off', { period: '7d' })
        .expect(200);
      const until = new Date(week.body.coolOffUntil).getTime();
      expect(until - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
      const day = await client
        .post('/api/responsible/cool-off', { period: '24h' })
        .expect(200);
      expect(new Date(day.body.coolOffUntil).getTime()).toBe(until);
      const blocked = await spin(client).expect(403);
      expect(blocked.body.message).toMatch(/taking a break/);
      await client
        .post('/api/games/blackjack/deal', { bet: 100 })
        .set('Idempotency-Key', randomUUID())
        .expect(403);
      // Still able to browse the account.
      await client.get('/api/wallet').expect(200);
    });

    it('self-exclusion needs the password, signs out and blocks sign-in', async () => {
      const { client, email, password } = await newPlayer();
      await client
        .post('/api/responsible/self-exclude', {
          period: '6m',
          password: 'wrong-password',
        })
        .expect(401);
      const refreshToken = client.cookies.get('refresh_token') as string;
      await client
        .post('/api/responsible/self-exclude', { period: '6m', password })
        .expect(204);
      expect(client.cookies.has('access_token')).toBe(false);

      client.cookies.set('refresh_token', refreshToken);
      await client.post('/api/auth/refresh').expect(401);
      const login = await (
        await t.client()
      )
        .post('/api/auth/login', { email, password })
        .expect(403);
      expect(login.body.message).toMatch(/self-excluded/);
    });
  });

  describe('activity, favourites, recent games and stats', () => {
    it('reports session activity for the reality check', async () => {
      const { client } = await newPlayer();
      const since = new Date(Date.now() - 1000).toISOString();
      const spins = [
        await spin(client).expect(200),
        await spin(client, 250).expect(200),
      ];
      const res = await client
        .get(`/api/responsible/activity?since=${encodeURIComponent(since)}`)
        .expect(200);
      const won = spins.reduce((s, r) => s + r.body.payout, 0);
      expect(res.body).toEqual({ rounds: 2, staked: 350, won, net: won - 350 });
      await client.get('/api/responsible/activity?since=nope').expect(400);
    });

    it('manages favourites', async () => {
      const { client } = await newPlayer();
      await client.put('/api/favourites/roulette', {}).expect(204);
      await client.put('/api/favourites/megaways', {}).expect(204);
      await client.put('/api/favourites/roulette', {}).expect(204);
      expect((await client.get('/api/favourites').expect(200)).body).toEqual([
        'roulette',
        'megaways',
      ]);
      await client.delete('/api/favourites/roulette').expect(204);
      expect((await client.get('/api/favourites').expect(200)).body).toEqual([
        'megaways',
      ]);
      await client.put('/api/favourites/poker', {}).expect(400);
    });

    it('lists recently played games and profile stats', async () => {
      const { client } = await newPlayer();
      await spin(client).expect(200);
      await client
        .post('/api/games/roulette/spin', {
          bets: [{ type: 'red', amount: 100 }],
        })
        .set('Idempotency-Key', randomUUID())
        .expect(200);
      const recent = await client.get('/api/games/recent').expect(200);
      expect(recent.body.map((r: { gameId: string }) => r.gameId)).toEqual([
        'roulette',
        'classic-3-reel',
      ]);
      const stats = await client.get('/api/profile/stats').expect(200);
      expect(stats.body).toMatchObject({ totalRounds: 2, totalStaked: 200 });
      expect(
        stats.body.byGame.map((g: { gameId: string }) => g.gameId),
      ).toEqual(['classic-3-reel', 'roulette']);
    });
  });

  describe('jackpot', () => {
    it('grows by 1% of every slot stake and is public', async () => {
      const { client } = await newPlayer();
      const before = (await client.get('/api/jackpot').expect(200)).body.amount;
      expect(before).toBeGreaterThanOrEqual(JACKPOT_SEED);
      await spin(client, 1000).expect(200);
      const after = (await (await t.client()).get('/api/jackpot').expect(200))
        .body.amount;
      // Another test may also have spun; at least our 10.00 stake added 0.10.
      expect(after).toBeGreaterThanOrEqual(before + 10);
    });

    it('claims the whole pool atomically and can restore it', async () => {
      const jackpot = t.app.get(JackpotService);
      const pool = await jackpot.amount();
      const claimed = await jackpot.claim();
      expect(claimed).toBe(pool);
      expect(await jackpot.amount()).toBe(JACKPOT_SEED);
      await jackpot.restore(claimed);
      expect(await jackpot.amount()).toBe(pool);
    });
  });
});
