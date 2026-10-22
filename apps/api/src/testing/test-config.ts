import { AppConfig, loadConfig } from '../config/env';

/** A complete, valid configuration for tests; override fields as needed. */
export function testConfig(
  overrides: Partial<Record<keyof AppConfig, string>> = {},
): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgresql://casino:casino@localhost:5432/casino',
    REDIS_URL: 'redis://localhost:6379',
    APP_URL: 'http://localhost:4200',
    CORS_ORIGINS: 'http://localhost:4200',
    JWT_ACCESS_SECRET: 'test-access-secret-test-access-secret-0001',
    CSRF_SECRET: 'test-csrf-secret-test-csrf-secret-000002',
    TOTP_ENCRYPTION_KEY: 'ab'.repeat(32),
    SMTP_HOST: 'localhost',
    SMTP_PORT: '1025',
    MAIL_FROM: 'Casino <no-reply@casino.test>',
    SIGNUP_BONUS: '100000',
    DAILY_BONUS: '10000',
    ...overrides,
  });
}
