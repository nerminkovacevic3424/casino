import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { JACKPOT_SEED, jackpotContribution } from '@casino/game-engine';
import type { JackpotWin } from '@casino/shared-types';
import Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const POOL_KEY = 'jackpot:pool';
const LAST_WIN_KEY = 'jackpot:last-win';
const BROADCAST_EVERY_MS = 1_000;

/** Atomically takes the whole pool and restarts it at the seed amount. */
const CLAIM_SCRIPT = `
local pool = tonumber(redis.call('GET', KEYS[1]) or ARGV[1])
redis.call('SET', KEYS[1], ARGV[1])
return pool
`;

/**
 * Community jackpot pool, shared by every API instance through Redis. Grows
 * by a house-funded 1% of each slot stake; hits are decided by the provably
 * fair round stream (see rollJackpot in the game engine).
 */
@Injectable()
export class JackpotService implements OnModuleDestroy {
  private broadcastTimer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly realtime: RealtimeGateway,
  ) {}

  async amount(): Promise<number> {
    const value = await this.redis.get(POOL_KEY);
    if (value === null) {
      await this.redis.set(POOL_KEY, JACKPOT_SEED, 'NX');
      return JACKPOT_SEED;
    }
    return Number(value);
  }

  async lastWin(): Promise<JackpotWin | null> {
    const raw = await this.redis.get(LAST_WIN_KEY);
    return raw ? (JSON.parse(raw) as JackpotWin) : null;
  }

  async contribute(stake: number): Promise<void> {
    const amount = jackpotContribution(stake);
    if (amount <= 0) return;
    await this.amount(); // ensure seeded
    await this.redis.incrby(POOL_KEY, amount);
    this.scheduleBroadcast();
  }

  /** Takes the pool for a winning round. */
  async claim(): Promise<number> {
    return Number(
      await this.redis.eval(CLAIM_SCRIPT, 1, POOL_KEY, JACKPOT_SEED),
    );
  }

  /** Puts a claimed amount back if the winning round's transaction failed. */
  async restore(amount: number): Promise<void> {
    await this.redis.incrby(POOL_KEY, amount - JACKPOT_SEED);
  }

  async announceWin(displayName: string, amount: number): Promise<void> {
    const win: JackpotWin = {
      amount,
      displayName,
      wonAt: new Date().toISOString(),
    };
    await this.redis.set(LAST_WIN_KEY, JSON.stringify(win));
    this.realtime.server?.emit('jackpot-won', win);
    this.scheduleBroadcast();
  }

  onModuleDestroy(): void {
    if (this.broadcastTimer) clearTimeout(this.broadcastTimer);
  }

  /** Coalesces pool updates into at most one broadcast per second. */
  private scheduleBroadcast(): void {
    if (this.broadcastTimer) return;
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      this.amount()
        .then((amount) => this.realtime.broadcastJackpot(amount))
        .catch(() => undefined); // a missed tick is harmless; the next update re-broadcasts
    }, BROADCAST_EVERY_MS);
  }
}
