import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

declare global {
  var __CONTAINERS__:
    [StartedPostgreSqlContainer, StartedRedisContainer] | undefined;
}

const WORKSPACE_ROOT = join(__dirname, '..', '..', '..');

/** Starts real Postgres and Redis once for the whole integration run and applies migrations. */
export default async function globalSetup(): Promise<void> {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('casino')
      .withUsername('casino')
      .withPassword('casino')
      .start(),
    new RedisContainer('redis:7-alpine').start(),
  ]);
  globalThis.__CONTAINERS__ = [postgres, redis];

  // Inherited by the test workers.
  process.env['DATABASE_URL'] = postgres.getConnectionUri();
  process.env['REDIS_URL'] = redis.getConnectionUrl();

  execSync(
    'pnpm exec prisma migrate deploy --config apps/api/prisma.config.ts',
    {
      cwd: WORKSPACE_ROOT,
      env: process.env,
      stdio: 'inherit',
    },
  );
}
