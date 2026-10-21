import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { AuthUser } from '../common/auth-decorators';
import { randomToken, sha256Hex } from '../common/crypto';
import { APP_CONFIG, AppConfig } from '../config/env';
import { Role } from '../generated/prisma/enums';
import { REDIS } from '../redis/redis.module';

const ISSUER = 'casino-api';
const AUDIENCE = 'casino-web';
const MFA_TOKEN_TTL_SECONDS = 300;
/** A token rotated less than this long ago is a concurrent refresh (another tab), not theft. */
const ROTATION_GRACE_MS = 20_000;

interface AccessClaims {
  sub: string;
  role: Role;
  typ: 'access';
}

interface MfaClaims {
  sub: string;
  typ: 'mfa';
}

export interface SessionMeta {
  readonly ip?: string;
  readonly userAgent?: string;
}

export type RotateResult =
  | {
      readonly status: 'rotated';
      readonly userId: string;
      readonly refreshToken: string;
    }
  | { readonly status: 'conflict' };

/**
 * Atomically rotates a session's refresh token.
 * Returns {1, userId} rotated | {2} concurrent refresh in grace | {0} unknown | {-1} reuse (session revoked).
 */
const ROTATE_SCRIPT = `
local key, userSetPrefix = KEYS[1], KEYS[2]
local current = redis.call('HGET', key, 'hash')
if not current then return {0} end
if current == ARGV[1] then
  redis.call('HSET', key, 'hash', ARGV[2], 'prev', ARGV[1], 'rotatedAt', ARGV[3])
  return {1, redis.call('HGET', key, 'userId')}
end
local prev = redis.call('HGET', key, 'prev')
local rotatedAt = tonumber(redis.call('HGET', key, 'rotatedAt') or '0')
if prev == ARGV[1] and tonumber(ARGV[3]) - rotatedAt < tonumber(ARGV[4]) then return {2} end
local userId = redis.call('HGET', key, 'userId')
redis.call('DEL', key)
redis.call('SREM', userSetPrefix .. userId, ARGV[5])
return {-1}
`;

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private readonly refreshTtlMs: number;

  constructor(
    private readonly jwt: JwtService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.refreshTtlMs = config.REFRESH_TOKEN_TTL_DAYS * 86_400_000;
  }

  get refreshTtlSeconds(): number {
    return this.refreshTtlMs / 1000;
  }

  // ------------------------------------------------------------------ access tokens

  signAccess(user: AuthUser): Promise<string> {
    const claims: AccessClaims = {
      sub: user.id,
      role: user.role,
      typ: 'access',
    };
    return this.jwt.signAsync(claims, {
      expiresIn: this.config.ACCESS_TOKEN_TTL_SECONDS,
      issuer: ISSUER,
      audience: AUDIENCE,
    });
  }

  async verifyAccess(token: string): Promise<AuthUser> {
    try {
      const claims = await this.jwt.verifyAsync<AccessClaims>(token, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      if (claims.typ !== 'access') throw new Error('wrong token type');
      return { id: claims.sub, role: claims.role };
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }

  /** Short-lived proof that the password step succeeded, exchanged for a session after TOTP. */
  signMfa(userId: string): Promise<string> {
    const claims: MfaClaims = { sub: userId, typ: 'mfa' };
    return this.jwt.signAsync(claims, {
      expiresIn: MFA_TOKEN_TTL_SECONDS,
      issuer: ISSUER,
      audience: 'casino-mfa',
    });
  }

  async verifyMfa(token: string): Promise<string> {
    try {
      const claims = await this.jwt.verifyAsync<MfaClaims>(token, {
        issuer: ISSUER,
        audience: 'casino-mfa',
        algorithms: ['HS256'],
      });
      if (claims.typ !== 'mfa') throw new Error('wrong token type');
      return claims.sub;
    } catch {
      throw new UnauthorizedException(
        'The sign-in attempt expired; please sign in again',
      );
    }
  }

  // ------------------------------------------------------------------ refresh sessions (Redis)

  /** Starts a session (a refresh-token family); returns the opaque refresh token `<sessionId>.<secret>`. */
  async createSession(userId: string, meta: SessionMeta): Promise<string> {
    const sessionId = randomUUID();
    const secret = randomToken();
    await this.redis
      .multi()
      .hset(this.sessionKey(sessionId), {
        userId,
        hash: sha256Hex(secret),
        createdAt: Date.now(),
        ip: meta.ip ?? '',
        userAgent: (meta.userAgent ?? '').slice(0, 200),
      })
      // Absolute lifetime: rotation does not extend it.
      .pexpire(this.sessionKey(sessionId), this.refreshTtlMs)
      .sadd(this.userSessionsKey(userId), sessionId)
      .pexpire(this.userSessionsKey(userId), this.refreshTtlMs)
      .exec();
    return `${sessionId}.${secret}`;
  }

  async rotate(refreshToken: string): Promise<RotateResult> {
    const parsed = this.parse(refreshToken);
    if (!parsed) throw new UnauthorizedException('Invalid refresh token');
    const nextSecret = randomToken();
    const result = (await this.redis.eval(
      ROTATE_SCRIPT,
      2,
      this.sessionKey(parsed.sessionId),
      'user-sessions:',
      sha256Hex(parsed.secret),
      sha256Hex(nextSecret),
      Date.now(),
      ROTATION_GRACE_MS,
      parsed.sessionId,
    )) as [number, string?];

    switch (result[0]) {
      case 1:
        return {
          status: 'rotated',
          userId: result[1] as string,
          refreshToken: `${parsed.sessionId}.${nextSecret}`,
        };
      case 2:
        return { status: 'conflict' };
      case -1:
        this.logger.warn(
          { sessionId: parsed.sessionId },
          'Refresh token reuse detected; session revoked',
        );
        throw new UnauthorizedException('Session revoked');
      default:
        throw new UnauthorizedException('Session expired');
    }
  }

  async revokeSession(refreshToken: string): Promise<void> {
    const parsed = this.parse(refreshToken);
    if (!parsed) return;
    const key = this.sessionKey(parsed.sessionId);
    const userId = await this.redis.hget(key, 'userId');
    await this.redis.del(key);
    if (userId)
      await this.redis.srem(this.userSessionsKey(userId), parsed.sessionId);
  }

  /** Signs the user out everywhere (password reset, suspension, 2FA changes). */
  async revokeAllSessions(userId: string): Promise<void> {
    const ids = await this.redis.smembers(this.userSessionsKey(userId));
    const pipeline = this.redis.pipeline();
    for (const id of ids) pipeline.del(this.sessionKey(id));
    pipeline.del(this.userSessionsKey(userId));
    await pipeline.exec();
  }

  private parse(token: string): { sessionId: string; secret: string } | null {
    const [sessionId, secret, extra] = token.split('.');
    if (extra !== undefined || !sessionId || !secret) return null;
    if (
      !/^[0-9a-f-]{36}$/.test(sessionId) ||
      !/^[A-Za-z0-9_-]{20,}$/.test(secret)
    )
      return null;
    return { sessionId, secret };
  }

  private sessionKey(id: string): string {
    return `session:${id}`;
  }

  private userSessionsKey(userId: string): string {
    return `user-sessions:${userId}`;
  }
}
