import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { testConfig } from '../testing/test-config';
import { assertAdult } from './auth.service';
import { PasswordService } from './password.service';
import { base32Decode, base32Encode, hotp, otpauthUrl, totpCode } from './totp';
import { TotpService } from './totp.service';

describe('assertAdult', () => {
  const now = new Date('2026-10-21T12:00:00Z');

  it('accepts players who turned 18 today or earlier', () => {
    expect(() => assertAdult('2008-10-21', now)).not.toThrow();
    expect(() => assertAdult('1970-01-01', now)).not.toThrow();
  });

  it('rejects players under 18', () => {
    expect(() => assertAdult('2008-10-22', now)).toThrow(ForbiddenException);
    expect(() => assertAdult('2020-01-01', now)).toThrow('at least 18');
  });

  it('treats a 29 February birthday as adult on 1 March in non-leap years', () => {
    expect(() =>
      assertAdult('2008-02-29', new Date('2026-02-28T23:00:00Z')),
    ).toThrow(ForbiddenException);
    expect(() =>
      assertAdult('2008-02-29', new Date('2026-03-01T00:00:00Z')),
    ).not.toThrow();
  });

  it('rejects impossible dates', () => {
    expect(() => assertAdult('1800-01-01', now)).toThrow(BadRequestException);
    expect(() => assertAdult('not-a-date', now)).toThrow(BadRequestException);
  });
});

describe('PasswordService', () => {
  const passwords = new PasswordService();

  it('hashes with argon2id and verifies', async () => {
    const hash = await passwords.hash('correct horse battery');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    await expect(passwords.verify(hash, 'correct horse battery')).resolves.toBe(
      true,
    );
    await expect(passwords.verify(hash, 'wrong')).resolves.toBe(false);
    await expect(passwords.verify('not-a-hash', 'x')).resolves.toBe(false);
    expect(passwords.needsRehash(hash)).toBe(false);
  });

  it('spends time on a dummy hash for unknown accounts', async () => {
    await expect(passwords.verifyDummy('anything')).resolves.toBe(false);
  });

  it.each(['password123', 'aaaaaaaaaaaa', 'me@example.com'])(
    'rejects guessable password %p',
    (pw) => {
      expect(() => passwords.assertAcceptable(pw, 'me@example.com')).toThrow(
        BadRequestException,
      );
    },
  );

  it('accepts a reasonable passphrase', () => {
    expect(() =>
      passwords.assertAcceptable('purple-otter-sings-42', 'me@example.com'),
    ).not.toThrow();
  });
});

describe('TotpService', () => {
  const totp = new TotpService(testConfig());

  it('encrypts secrets with AES-GCM (random IV, tamper-evident)', () => {
    const secret = totp.generateSecret();
    const a = totp.encrypt(secret);
    const b = totp.encrypt(secret);
    expect(a).not.toBe(b);
    expect(a).not.toContain(secret);
    expect(totp.decrypt(a)).toBe(secret);
    const [iv, tag, ct] = a.split('.');
    const tampered = [
      iv,
      tag,
      Buffer.from('x' + ct, 'base64url').toString('base64url'),
    ].join('.');
    expect(() => totp.decrypt(tampered)).toThrow();
  });

  it('verifies codes, tolerates one step of drift and rejects replays', () => {
    const secret = totp.generateSecret();
    const now = Date.now();
    const step = totp.verify(secret, totpCode(secret, now / 1000), null, now);
    expect(step).toEqual(expect.any(Number));
    expect(
      totp.verify(secret, totpCode(secret, now / 1000), step, now),
    ).toBeNull();
    expect(
      totp.verify(secret, totpCode(secret, now / 1000 + 30), step, now),
    ).toBe((step as number) + 1);
    expect(
      totp.verify(secret, totpCode(secret, now / 1000 - 30), null, now),
    ).toBe((step as number) - 1);
  });

  it('rejects malformed, wrong and stale codes', () => {
    const secret = totp.generateSecret();
    const now = Date.now();
    expect(totp.verify(secret, '12345', null, now)).toBeNull();
    expect(totp.verify(secret, 'abcdef', null, now)).toBeNull();
    expect(
      totp.verify(secret, totpCode(secret, now / 1000 - 600), null, now),
    ).toBeNull();
  });

  it('builds an otpauth enrollment with a QR code', async () => {
    const { otpauthUrl, qrCodeDataUrl } = await totp.enrollment(
      totp.generateSecret(),
      'me@example.com',
    );
    expect(otpauthUrl).toMatch(/^otpauth:\/\/totp\/Casino:me%40example\.com\?/);
    expect(qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
  });
});

describe('RFC 6238 TOTP primitives', () => {
  // Appendix B test vectors (SHA-1 seed), truncated to six digits.
  const seed = Buffer.from('12345678901234567890', 'ascii');
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ])('T=%i gives %s', (t, code) => {
    expect(hotp(seed, Math.floor(t / 30))).toBe(code);
    expect(totpCode(base32Encode(seed), t)).toBe(code);
  });

  it('round-trips base32 and rejects invalid characters', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI======').toString()).toBe('foobar');
    expect(() => base32Decode('abc1')).toThrow('Invalid base32');
  });

  it('builds a standard otpauth URL', () => {
    expect(otpauthUrl('Casino', 'a@b.c', 'ABC')).toBe(
      'otpauth://totp/Casino:a%40b.c?secret=ABC&issuer=Casino&algorithm=SHA1&digits=6&period=30',
    );
  });
});
