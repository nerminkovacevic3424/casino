import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import Redis from 'ioredis';
import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app/app.module';
import { setupApp } from '../src/app/setup-app';
import { AppConfig } from '../src/config/env';
import { InMemoryMailer, Mailer } from '../src/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { REDIS } from '../src/redis/redis.module';
import { testConfig } from '../src/testing/test-config';

export interface TestApp {
  readonly app: NestExpressApplication;
  readonly config: AppConfig;
  readonly mailer: InMemoryMailer;
  readonly prisma: PrismaService;
  readonly redis: Redis;
  client(): Promise<ApiClient>;
  close(): Promise<void>;
}

/** Boots the real AppModule against the Testcontainers databases, with email captured in memory. */
export async function createTestApp(
  overrides: Parameters<typeof testConfig>[0] = {},
): Promise<TestApp> {
  const config = testConfig({
    DATABASE_URL: required('DATABASE_URL'),
    REDIS_URL: required('REDIS_URL'),
    ...overrides,
  });
  const mailer = new InMemoryMailer();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(config)],
  })
    .overrideProvider(Mailer)
    .useValue(mailer)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bufferLogs: true,
  });
  setupApp(app, config);
  await app.init();

  return {
    app,
    config,
    mailer,
    prisma: app.get(PrismaService),
    redis: app.get<Redis>(REDIS),
    client: () => ApiClient.create(app, config),
    close: () => app.close(),
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(
      `${name} missing: run integration tests through jest.integration.config.cts`,
    );
  return value;
}

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

/**
 * A browser-like client: keeps cookies, sends the CSRF header and Origin like
 * Angular's HttpClient would, and uses its own client IP so rate limits do
 * not leak between tests.
 */
export class ApiClient {
  readonly cookies = new Map<string, string>();
  readonly ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

  private constructor(
    private readonly app: NestExpressApplication,
    private readonly config: AppConfig,
  ) {}

  static async create(
    app: NestExpressApplication,
    config: AppConfig,
  ): Promise<ApiClient> {
    const client = new ApiClient(app, config);
    await client.get('/api/auth/csrf').expect(204);
    return client;
  }

  get(url: string) {
    return this.send('get', url);
  }

  post(url: string, body?: object) {
    return this.send('post', url, body);
  }

  put(url: string, body?: object) {
    return this.send('put', url, body);
  }

  delete(url: string) {
    return this.send('delete', url);
  }

  /** Raw request with explicit headers only (no cookies, CSRF or Origin). */
  raw(method: Method, url: string) {
    return request(this.app.getHttpServer())
      [method](url)
      .set('X-Forwarded-For', this.ip);
  }

  private send(method: Method, url: string, body?: object) {
    const req = request(this.app.getHttpServer())
      [method](url)
      .set('X-Forwarded-For', this.ip)
      .set('X-Request-Id', randomUUID())
      .set('Cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
    if (method !== 'get') {
      req
        .set('Origin', new URL(this.config.APP_URL).origin)
        .set('X-XSRF-TOKEN', this.cookies.get('XSRF-TOKEN') ?? '');
    }
    if (body !== undefined) req.send(body);
    // Capture Set-Cookie from every response, like a browser would.
    return req.on(
      'response',
      (res: { headers: Record<string, string[] | string | undefined> }) =>
        this.store(res.headers['set-cookie']),
    );
  }

  private store(header: string[] | string | undefined): void {
    for (const line of Array.isArray(header)
      ? header
      : header
        ? [header]
        : []) {
      const [pair, ...attrs] = line.split(';').map((p) => p.trim());
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = decodeURIComponent(pair.slice(eq + 1));
      const expired = attrs.some(
        (a) =>
          /^expires=/i.test(a) && new Date(a.slice(8)).getTime() < Date.now(),
      );
      if (!value || expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}

let counter = 0;
export const uniqueEmail = (prefix = 'player') =>
  `${prefix}.${Date.now()}.${counter++}@example.com`;

export const registration = (overrides: Record<string, unknown> = {}) => ({
  email: uniqueEmail(),
  password: 'purple-otter-sings-42',
  displayName: `Player_${counter++}`,
  dateOfBirth: '1990-05-17',
  acceptTerms: true,
  ...overrides,
});
