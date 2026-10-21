import { WalletService } from '../src/wallet/wallet.service';
import { ApiClient, TestApp, createTestApp, registration } from './test-app';

describe('wallet (integration)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  async function newPlayer(
    verified = false,
  ): Promise<{ client: ApiClient; userId: string }> {
    const client = await t.client();
    const res = await client
      .post('/api/auth/register', registration())
      .expect(201);
    if (verified) {
      await t.prisma.user.update({
        where: { id: res.body.user.id },
        data: { emailVerifiedAt: new Date() },
      });
    }
    return { client, userId: res.body.user.id };
  }

  it('starts with the welcome bonus and a matching ledger entry', async () => {
    const { client } = await newPlayer();
    const wallet = await client.get('/api/wallet').expect(200);
    expect(wallet.body).toMatchObject({
      balance: 100_000,
      canClaimDailyBonus: true,
      lastDailyBonusAt: null,
    });

    const tx = await client.get('/api/wallet/transactions').expect(200);
    expect(tx.body).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(tx.body.items[0]).toMatchObject({
      type: 'SIGNUP_BONUS',
      amount: 100_000,
      balanceAfter: 100_000,
    });
  });

  describe('daily bonus', () => {
    it('requires a verified email', async () => {
      const { client } = await newPlayer(false);
      await client.post('/api/wallet/daily-bonus').expect(403);
    });

    it('can be claimed once per 24 hours', async () => {
      const { client } = await newPlayer(true);
      const claimed = await client.post('/api/wallet/daily-bonus').expect(200);
      expect(claimed.body).toMatchObject({
        balance: 110_000,
        canClaimDailyBonus: false,
      });
      await client.post('/api/wallet/daily-bonus').expect(403);
    });

    it('pays exactly once under concurrent claims (row lock)', async () => {
      const { client, userId } = await newPlayer(true);
      const results = await Promise.all(
        Array.from({ length: 8 }, () => client.post('/api/wallet/daily-bonus')),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 403)).toHaveLength(7);
      const bonuses = await t.prisma.ledgerEntry.count({
        where: { userId, type: 'DAILY_BONUS' },
      });
      expect(bonuses).toBe(1);
    });
  });

  describe('transactions', () => {
    it('paginates newest first and filters by type and date', async () => {
      const { client, userId } = await newPlayer(true);
      const wallet = t.app.get(WalletService);
      for (let i = 1; i <= 25; i++) {
        await t.prisma.$transaction((tx) =>
          wallet.applyEntry(tx, {
            userId,
            type: i % 2 ? 'BET' : 'WIN',
            amount: i % 2 ? -100 : 50,
          }),
        );
      }

      const page1 = await client
        .get('/api/wallet/transactions?page=1&pageSize=10')
        .expect(200);
      expect(page1.body.total).toBe(26);
      expect(page1.body.items).toHaveLength(10);
      expect(page1.body.items[0]).toMatchObject({ type: 'BET', amount: -100 });
      const page3 = await client
        .get('/api/wallet/transactions?page=3&pageSize=10')
        .expect(200);
      expect(page3.body.items).toHaveLength(6);
      expect(page3.body.items.at(-1).type).toBe('SIGNUP_BONUS');

      const wins = await client
        .get('/api/wallet/transactions?type=WIN&pageSize=100')
        .expect(200);
      expect(wins.body.total).toBe(12);
      expect(
        wins.body.items.every((e: { type: string }) => e.type === 'WIN'),
      ).toBe(true);

      const future = await client.get(
        `/api/wallet/transactions?from=${new Date(Date.now() + 60_000).toISOString()}`,
      );
      expect(future.body.total).toBe(0);
    });

    it.each([
      'page=0',
      'pageSize=101',
      'type=NOPE',
      'from=yesterday',
      'extra=1',
    ])('rejects query %s', async (q) => {
      const { client } = await newPlayer();
      await client.get(`/api/wallet/transactions?${q}`).expect(400);
    });

    it('only ever shows the caller’s own transactions', async () => {
      const a = await newPlayer();
      const b = await newPlayer();
      const res = await a.client
        .get('/api/wallet/transactions?pageSize=100')
        .expect(200);
      expect(res.body.items).toHaveLength(1);
      const ids = await t.prisma.ledgerEntry.findMany({
        where: { userId: b.userId },
        select: { id: true },
      });
      expect(res.body.items.map((i: { id: string }) => i.id)).not.toContain(
        ids[0].id.toString(),
      );
    });
  });

  describe('ledger integrity', () => {
    it('never lets concurrent debits overdraw the wallet', async () => {
      const { userId } = await newPlayer();
      const wallet = t.app.get(WalletService);
      // 100,000 balance; 30 concurrent debits of 5,000 → exactly 20 can succeed.
      const results = await Promise.allSettled(
        Array.from({ length: 30 }, () =>
          t.prisma.$transaction(
            (tx) =>
              wallet.applyEntry(tx, { userId, type: 'BET', amount: -5_000 }),
            {
              maxWait: 20_000,
              timeout: 20_000,
            },
          ),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(20);
      expect(await wallet.getBalance(userId)).toBe(0);

      const entries = await t.prisma.ledgerEntry.findMany({
        where: { userId },
        orderBy: { id: 'asc' },
      });
      const sum = entries.reduce((s, e) => s + e.amount, 0n);
      expect(sum).toBe(0n);
      // Running balances are consistent in insertion order.
      let running = 0n;
      for (const e of entries) {
        running += e.amount;
        expect(e.balanceAfter).toBe(running);
      }
    });

    it('rejects zero and fractional amounts', async () => {
      const { userId } = await newPlayer();
      const wallet = t.app.get(WalletService);
      await expect(
        t.prisma.$transaction((tx) =>
          wallet.applyEntry(tx, { userId, type: 'WIN', amount: 0 }),
        ),
      ).rejects.toThrow();
      await expect(
        t.prisma.$transaction((tx) =>
          wallet.applyEntry(tx, { userId, type: 'WIN', amount: 1.5 }),
        ),
      ).rejects.toThrow();
    });

    it('makes the ledger append-only at the database level', async () => {
      const { userId } = await newPlayer();
      await expect(
        t.prisma
          .$executeRaw`UPDATE ledger_entries SET amount = 1 WHERE user_id = ${userId}::uuid`,
      ).rejects.toThrow(/append-only/);
      await expect(
        t.prisma
          .$executeRaw`DELETE FROM ledger_entries WHERE user_id = ${userId}::uuid`,
      ).rejects.toThrow(/append-only/);
    });

    it('enforces a non-negative balance at the database level', async () => {
      const { userId } = await newPlayer();
      await expect(
        t.prisma
          .$executeRaw`UPDATE wallets SET balance = -1 WHERE user_id = ${userId}::uuid`,
      ).rejects.toThrow(/wallets_balance_non_negative/);
    });
  });
});
