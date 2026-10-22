import { z } from 'zod';

const secret = (name: string) =>
  z.string().min(32, `${name} must be at least 32 characters`);

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const minor = z.coerce
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  APP_URL: z.string().url(),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),

  JWT_ACCESS_SECRET: secret('JWT_ACCESS_SECRET'),
  CSRF_SECRET: secret('CSRF_SECRET'),
  TOTP_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'TOTP_ENCRYPTION_KEY must be 64 hex characters'),

  ACCESS_TOKEN_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(3600)
    .default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  COOKIE_SECURE: bool.default(false),

  /** smtp: local Mailpit or any SMTP relay. mailjet: HTTPS API (hosts that block SMTP ports, e.g. Render free). */
  MAIL_PROVIDER: z.enum(['smtp', 'mailjet', 'gmail']).default('smtp'),
  /** Sender, e.g. "Casino <you@example.com>". SMTP_FROM is accepted as the old name. */
  MAIL_FROM: z.string().min(3),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAILJET_API_KEY: z.string().min(1).optional(),
  MAILJET_SECRET_KEY: z.string().min(1).optional(),
  /** Gmail API (OAuth): sends as your own Gmail address. See DEPLOY.md. */
  GMAIL_CLIENT_ID: z.string().min(1).optional(),
  GMAIL_CLIENT_SECRET: z.string().min(1).optional(),
  GMAIL_REFRESH_TOKEN: z.string().min(1).optional(),

  /** Built Angular app to serve from the same origin (production single-service deploys). */
  WEB_DIST_DIR: z.string().min(1).optional(),
  /** Reverse-proxy hops in front of the API (X-Forwarded-For entries to trust). */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),

  SIGNUP_BONUS: minor.default(100_000),
  DAILY_BONUS: minor.default(10_000),
});

export type AppConfig = z.infer<typeof envSchema>;

/** Parses and validates the environment; throws a readable error listing every problem. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // API_PORT keeps the shared .env from also moving other dev servers (Nx loads it for every task);
  // plain PORT still works for platforms that inject it.
  const parsed = envSchema.safeParse({
    ...env,
    PORT: env['API_PORT'] ?? env['PORT'],
    MAIL_FROM: env['MAIL_FROM'] ?? env['SMTP_FROM'],
  });
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  const config = parsed.data;
  const missing = (keys: (keyof AppConfig)[]) =>
    keys.filter((k) => config[k] === undefined);
  const mailRequired: Record<AppConfig['MAIL_PROVIDER'], (keyof AppConfig)[]> =
    {
      smtp: ['SMTP_HOST', 'SMTP_PORT'],
      mailjet: ['MAILJET_API_KEY', 'MAILJET_SECRET_KEY'],
      gmail: ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'],
    };
  const mailMissing = missing(mailRequired[config.MAIL_PROVIDER]);
  if (mailMissing.length > 0) {
    const lines = mailMissing.map(
      (k) => `  - ${k}: required when MAIL_PROVIDER=${config.MAIL_PROVIDER}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  if (config.NODE_ENV === 'production') {
    const problems: string[] = [];
    for (const key of ['JWT_ACCESS_SECRET', 'CSRF_SECRET'] as const) {
      if (config[key].startsWith('change-me'))
        problems.push(`  - ${key} still has its example value`);
    }
    if (/^0+$/.test(config.TOTP_ENCRYPTION_KEY))
      problems.push('  - TOTP_ENCRYPTION_KEY still has its example value');
    if (!config.COOKIE_SECURE)
      problems.push('  - COOKIE_SECURE must be true in production');
    if (problems.length > 0)
      throw new Error(
        `Invalid environment configuration:\n${problems.join('\n')}`,
      );
  }
  return config;
}

/** Injection token for the validated configuration. */
export const APP_CONFIG = Symbol('APP_CONFIG');
