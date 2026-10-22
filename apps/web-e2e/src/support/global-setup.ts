import Redis from 'ioredis';

/**
 * Every local run registers new players from the same IP, which the API
 * (correctly) rate-limits. Clear the throttle counters so repeated runs work.
 * Only touches `throttle:*` keys, and only against a local or explicitly
 * configured Redis.
 */
export default async function globalSetup(): Promise<void> {
  if (process.env['BASE_URL']) return; // never touch a deployed environment
  const redis = new Redis(
    process.env['REDIS_URL'] ?? 'redis://localhost:6379',
    { lazyConnect: true },
  );
  try {
    await redis.connect();
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(
        cursor,
        'MATCH',
        'throttle:*',
        'COUNT',
        500,
      );
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== '0');
  } finally {
    redis.disconnect();
  }
}
