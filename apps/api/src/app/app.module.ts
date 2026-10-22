import {
  DynamicModule,
  MiddlewareConsumer,
  Module,
  NestModule,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import Redis from 'ioredis';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { AuthModule } from '../auth/auth.module';
import { AccessTokenGuard, RolesGuard } from '../auth/guards';
import { CsrfMiddleware } from '../common/csrf';
import { RedisThrottlerStorage } from '../common/redis-throttler.storage';
import { ConfigModule } from '../config/config.module';
import { AppConfig, loadConfig } from '../config/env';
import { GamesModule } from '../games/games.module';
import { HealthController } from '../health/health.controller';
import { MailModule } from '../mail/mail.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { PlayerModule } from '../responsible/player.module';
import { REDIS, RedisModule } from '../redis/redis.module';
import { WalletModule } from '../wallet/wallet.module';

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

@Module({})
export class AppModule implements NestModule {
  static forRoot(config: AppConfig = loadConfig()): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(config),
        LoggerModule.forRoot({
          pinoHttp: {
            level: config.LOG_LEVEL,
            // Reuse a well-formed incoming id (e.g. from the load balancer) so logs correlate end to end.
            genReqId: (req: IncomingMessage) => {
              const incoming = req.headers['x-request-id'];
              return typeof incoming === 'string' && REQUEST_ID.test(incoming)
                ? incoming
                : randomUUID();
            },
            customProps: (req) => ({
              userId: (req as IncomingMessage & { user?: { id: string } }).user
                ?.id,
            }),
            redact: {
              paths: [
                'req.headers.cookie',
                'req.headers.authorization',
                'req.headers["x-xsrf-token"]',
                'res.headers["set-cookie"]',
              ],
              censor: '[redacted]',
            },
            autoLogging: {
              ignore: (req) => req.url?.startsWith('/api/health') ?? false,
            },
            transport:
              config.NODE_ENV === 'development'
                ? { target: 'pino-pretty', options: { singleLine: true } }
                : undefined,
          },
        }),
        PrismaModule,
        RedisModule,
        MailModule,
        ThrottlerModule.forRootAsync({
          inject: [REDIS],
          useFactory: (redis: Redis) => ({
            // Generous global ceiling per client IP; sensitive routes set tighter limits.
            throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
            storage: new RedisThrottlerStorage(redis),
          }),
        }),
        AuthModule,
        WalletModule,
        RealtimeModule,
        PlayerModule,
        GamesModule,
      ],
      controllers: [HealthController],
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useExisting: AccessTokenGuard },
        { provide: APP_GUARD, useExisting: RolesGuard },
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CsrfMiddleware).forRoutes('*path');
  }
}
