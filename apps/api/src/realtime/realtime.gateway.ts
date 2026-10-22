import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { ACCESS_COOKIE } from '../auth/cookies';
import { TokenService } from '../auth/token.service';

export const userRoom = (userId: string) => `user:${userId}`;

/** Server → client events. */
export interface ServerEvents {
  balance: (payload: { balance: number }) => void;
  jackpot: (payload: { amount: number }) => void;
}

/**
 * Authenticated push channel. The handshake carries the httpOnly access
 * cookie; each socket joins its user's room so balance updates reach every
 * open tab (and, via the Redis adapter, every API instance).
 */
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly tokens: TokenService) {}

  async handleConnection(socket: Socket): Promise<void> {
    try {
      const token = readCookie(socket.handshake.headers.cookie, ACCESS_COOKIE);
      if (!token) throw new Error('no access token');
      const user = await this.tokens.verifyAccess(token);
      socket.data['userId'] = user.id;
      await socket.join(userRoom(user.id));
      socket.emit('ready');
    } catch {
      socket.emit('unauthorized');
      socket.disconnect(true);
    }
  }

  emitBalance(userId: string, balance: number): void {
    this.server?.to(userRoom(userId)).emit('balance', { balance });
  }

  broadcastJackpot(amount: number): void {
    this.server?.emit('jackpot', { amount });
  }

  get connectedCount(): number {
    return this.server?.engine?.clientsCount ?? 0;
  }
}

export function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}
