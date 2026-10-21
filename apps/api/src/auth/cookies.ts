import type { CookieOptions, Response } from 'express';
import type { AppConfig } from '../config/env';

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';
/** The refresh token is only ever sent to the auth endpoints. */
export const REFRESH_COOKIE_PATH = '/api/auth';

const base = (config: AppConfig): CookieOptions => ({
  httpOnly: true,
  secure: config.COOKIE_SECURE,
  sameSite: 'strict',
});

export function setAuthCookies(
  res: Response,
  config: AppConfig,
  tokens: { accessToken: string; refreshToken: string },
): void {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base(config),
    path: '/api',
    maxAge: config.ACCESS_TOKEN_TTL_SECONDS * 1000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base(config),
    path: REFRESH_COOKIE_PATH,
    maxAge: config.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  });
}

export function clearAuthCookies(res: Response, config: AppConfig): void {
  res.clearCookie(ACCESS_COOKIE, { ...base(config), path: '/api' });
  res.clearCookie(REFRESH_COOKIE, {
    ...base(config),
    path: REFRESH_COOKIE_PATH,
  });
}
