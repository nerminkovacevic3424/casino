import { Inject, Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { toDataURL } from 'qrcode';
import { APP_CONFIG, AppConfig } from '../config/env';
import {
  base32Decode,
  generateTotpSecret,
  hotp,
  otpauthUrl,
  timeStepAt,
} from './totp';

const ISSUER = 'Casino';
/** Accept the previous, current and next 30 s step to absorb clock drift. */
const DRIFT_STEPS = 1;

/** TOTP (RFC 6238) with secrets encrypted at rest using AES-256-GCM. */
@Injectable()
export class TotpService {
  private readonly key: Buffer;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.key = Buffer.from(config.TOTP_ENCRYPTION_KEY, 'hex');
  }

  generateSecret(): string {
    return generateTotpSecret();
  }

  async enrollment(
    secret: string,
    email: string,
  ): Promise<{ otpauthUrl: string; qrCodeDataUrl: string }> {
    const url = otpauthUrl(ISSUER, email, secret);
    return { otpauthUrl: url, qrCodeDataUrl: await toDataURL(url) };
  }

  /**
   * Returns the matched time step, or null. Rejects any step at or before
   * `lastTimeStep` so a code can never be used twice.
   */
  verify(
    secret: string,
    code: string,
    lastTimeStep: number | null,
    now = Date.now(),
  ): number | null {
    if (!/^\d{6}$/.test(code)) return null;
    const key = base32Decode(secret);
    const current = timeStepAt(now / 1000);
    for (
      let step = current - DRIFT_STEPS;
      step <= current + DRIFT_STEPS;
      step++
    ) {
      if (lastTimeStep !== null && step <= lastTimeStep) continue;
      if (timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(code)))
        return step;
    }
    return null;
  }

  encrypt(secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(secret, 'utf8'),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), ciphertext]
      .map((b) => b.toString('base64url'))
      .join('.');
  }

  decrypt(payload: string): string {
    const [iv, tag, ciphertext] = payload
      .split('.')
      .map((p) => Buffer.from(p, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }
}
