import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** URL-safe random token with `bytes` bytes of entropy. */
export const randomToken = (bytes = 32): string =>
  randomBytes(bytes).toString('base64url');

export const sha256Hex = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

export const hmacHex = (key: string, value: string): string =>
  createHmac('sha256', key).update(value).digest('hex');

/** Constant-time string comparison (false for different lengths). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
