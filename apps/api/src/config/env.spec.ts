import { testConfig } from '../testing/test-config';
import { loadConfig } from './env';

describe('loadConfig', () => {
  it('parses and coerces a valid environment', () => {
    const config = testConfig({
      CORS_ORIGINS: 'http://a.test, http://b.test',
      COOKIE_SECURE: 'true',
    });
    expect(config.PORT).toBe(3000);
    expect(config.SMTP_PORT).toBe(1025);
    expect(config.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
    expect(config.COOKIE_SECURE).toBe(true);
    expect(config.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
  });

  it('lists every problem at once', () => {
    expect(() =>
      loadConfig({ JWT_ACCESS_SECRET: 'short', TOTP_ENCRYPTION_KEY: 'nope' }),
    ).toThrow(
      /DATABASE_URL[\s\S]*JWT_ACCESS_SECRET must be at least 32 characters[\s\S]*TOTP_ENCRYPTION_KEY/,
    );
  });

  it('refuses example secrets and insecure cookies in production', () => {
    expect(() =>
      testConfig({
        NODE_ENV: 'production',
        COOKIE_SECURE: 'true',
        JWT_ACCESS_SECRET: 'change-me-change-me-change-me-change-me',
      }),
    ).toThrow('JWT_ACCESS_SECRET still has its example value');
    expect(() =>
      testConfig({
        NODE_ENV: 'production',
        COOKIE_SECURE: 'true',
        TOTP_ENCRYPTION_KEY: '0'.repeat(64),
      }),
    ).toThrow('TOTP_ENCRYPTION_KEY still has its example value');
    expect(() => testConfig({ NODE_ENV: 'production' })).toThrow(
      'COOKIE_SECURE must be true',
    );
    expect(
      testConfig({ NODE_ENV: 'production', COOKIE_SECURE: 'true' }).NODE_ENV,
    ).toBe('production');
  });

  it('rejects negative bonuses', () => {
    expect(() => testConfig({ SIGNUP_BONUS: '-1' })).toThrow('SIGNUP_BONUS');
  });
});
