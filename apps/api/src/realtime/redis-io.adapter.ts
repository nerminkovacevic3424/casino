import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { IncomingMessage } from 'node:http';
import Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
import { AppConfig } from '../config/env';
import { REDIS } from '../redis/redis.module';

export const SOCKET_PATH = '/api/socket.io';

/**
 * Socket.IO with a Redis pub/sub adapter (rooms work across API instances)
 * and an Origin check on the handshake: cookies are sent with WebSocket
 * upgrades, so without it any site could open an authenticated socket.
 */
export class RedisIoAdapter extends IoAdapter {
  private pub?: Redis;
  private sub?: Redis;

  constructor(
    private readonly app: INestApplicationContext,
    private readonly config: AppConfig,
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const origins = new Set([
      new URL(this.config.APP_URL).origin,
      ...this.config.CORS_ORIGINS,
    ]);
    const server: Server = super.createIOServer(port, {
      ...options,
      path: SOCKET_PATH,
      serveClient: false,
      cors: { origin: [...origins], credentials: true },
      allowRequest: (
        req: IncomingMessage,
        callback: (err: string | null | undefined, success: boolean) => void,
      ) => {
        const origin = req.headers.origin;
        callback(null, origin !== undefined && origins.has(origin));
      },
    });
    const redis = this.app.get<Redis>(REDIS);
    this.pub = redis.duplicate();
    this.sub = redis.duplicate();
    server.adapter(createAdapter(this.pub, this.sub));
    return server;
  }

  override async close(server: Server): Promise<void> {
    await super.close(server);
    await Promise.all(
      [this.pub, this.sub].map((c) => c?.quit().catch(() => c.disconnect())),
    );
  }
}
