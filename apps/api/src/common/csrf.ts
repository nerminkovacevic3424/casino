import {
  ForbiddenException,
  Inject,
  Injectable,
  NestMiddleware,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { APP_CONFIG, AppConfig } from '../config/env';
import { hmacHex, randomToken, safeEqual } from './crypto';

/** Names match Angular's HttpClient XSRF defaults, so the web app needs no custom code. */
export const CSRF_COOKIE = 'XSRF-TOKEN';
export const CSRF_HEADER = 'x-xsrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function issueCsrfToken(secret: string): string {
  const nonce = randomToken(24);
  return `${nonce}.${hmacHex(secret, nonce)}`;
}

export function isValidCsrfToken(secret: string, token: string): boolean {
  const [nonce, sig] = token.split('.');
  return Boolean(nonce && sig) && safeEqual(sig, hmacHex(secret, nonce));
}

/**
 * CSRF defence in depth for cookie-authenticated requests:
 *  1. Unsafe requests must carry an allowed Origin (or Referer) — OWASP's primary check.
 *  2. Signed double-submit token: header must equal the readable cookie and carry our HMAC.
 * Auth cookies are additionally SameSite=Strict.
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  private readonly origins: Set<string>;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.origins = new Set([
      new URL(config.APP_URL).origin,
      ...config.CORS_ORIGINS.map((o) => new URL(o).origin),
    ]);
  }

  use(req: Request, res: Response, next: NextFunction): void {
    const cookie: string | undefined = req.cookies?.[CSRF_COOKIE];
    if (!cookie || !isValidCsrfToken(this.config.CSRF_SECRET, cookie)) {
      res.cookie(CSRF_COOKIE, issueCsrfToken(this.config.CSRF_SECRET), {
        httpOnly: false,
        sameSite: 'strict',
        secure: this.config.COOKIE_SECURE,
        path: '/',
      });
    }
    if (SAFE_METHODS.has(req.method)) return next();

    const origin = req.headers.origin ?? refererOrigin(req.headers.referer);
    if (!origin || !this.origins.has(origin))
      throw new ForbiddenException('Cross-site request rejected');

    const header = req.headers[CSRF_HEADER];
    if (
      typeof header !== 'string' ||
      !cookie ||
      !safeEqual(header, cookie) ||
      !isValidCsrfToken(this.config.CSRF_SECRET, header)
    ) {
      throw new ForbiddenException('Missing or invalid CSRF token');
    }
    next();
  }
}

function refererOrigin(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return undefined;
  }
}
