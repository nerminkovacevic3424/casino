import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import Redis from 'ioredis';
import { Public } from '../common/auth-decorators';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS } from '../redis/redis.module';

type CheckStatus = 'up' | 'down';

@ApiTags('health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Liveness: the process is running. Never checks dependencies (avoids restart storms). */
  @Get('live')
  @ApiOkResponse()
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: dependencies are reachable, so the instance can take traffic. */
  @Get('ready')
  @ApiOkResponse()
  @ApiServiceUnavailableResponse()
  async ready(): Promise<{
    status: 'ok';
    checks: Record<string, CheckStatus>;
  }> {
    const [database, redis] = await Promise.all([
      this.check(() => this.prisma.$queryRaw`SELECT 1`),
      this.check(() => this.redis.ping()),
    ]);
    const checks = { database, redis };
    if (database === 'down' || redis === 'down') {
      throw new ServiceUnavailableException({
        message: 'Dependencies unavailable',
        checks,
      });
    }
    return { status: 'ok', checks };
  }

  private async check(probe: () => Promise<unknown>): Promise<CheckStatus> {
    try {
      await Promise.race([
        probe(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 2000),
        ),
      ]);
      return 'up';
    } catch {
      return 'down';
    }
  }
}
