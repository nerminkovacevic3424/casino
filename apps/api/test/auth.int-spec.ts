import { totpCode } from '../src/auth/totp';
import { TestApp, createTestApp, registration, uniqueEmail } from './test-app';

const tokenFrom = (text: string): string => {
  const match = /token=([^\s&]+)/.exec(text);
  if (!match) throw new Error('No token in email');
  return decodeURIComponent(match[1]);
};

describe('auth (integration)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  describe('registration', () => {
    it('creates the account, credits the welcome bonus, signs in and sends a verification email', async () => {
      const client = await t.client();
      const body = registration();
      const res = await client.post('/api/auth/register', body).expect(201);

      expect(res.body.user).toMatchObject({
        email: body.email,
        emailVerified: false,
        twoFactorEnabled: false,
        role: 'PLAYER',
      });
      expect(res.body.user).not.toHaveProperty('passwordHash');
      expect(client.cookies.has('access_token')).toBe(true);
      expect(client.cookies.has('refresh_token')).toBe(true);

      const setCookie = String(res.headers['set-cookie']);
      expect(setCookie).toMatch(
        /access_token=[^;]+; Max-Age=900; Path=\/api; Expires=[^;]+; HttpOnly; SameSite=Strict/,
      );
      expect(setCookie).toMatch(
        /refresh_token=[^;]+; Max-Age=\d+; Path=\/api\/auth; Expires=[^;]+; HttpOnly; SameSite=Strict/,
      );

      await client
        .get('/api/auth/me')
        .expect(200)
        .expect((r) => expect(r.body.email).toBe(body.email));
      await client
        .get('/api/wallet')
        .expect(200)
        .expect((r) => expect(r.body.balance).toBe(t.config.SIGNUP_BONUS));

      const mail = t.mailer.outbox.find((m) => m.to === body.email);
      expect(mail?.subject).toBe('Confirm your email address');
      expect(mail?.text).toContain(
        `${t.config.APP_URL}/auth/verify-email?token=`,
      );
    });

    it('normalises email case and rejects duplicates', async () => {
      const client = await t.client();
      const body = registration();
      await client.post('/api/auth/register', body).expect(201);
      const again = await (
        await t.client()
      )
        .post('/api/auth/register', {
          ...body,
          email: `  ${body.email.toUpperCase()} `,
        })
        .expect(409);
      expect(again.body).toMatchObject({
        statusCode: 409,
        message: 'An account with this email already exists',
      });
      expect(again.body.requestId).toEqual(expect.any(String));
    });

    it.each([
      [
        'an under-18 player',
        {
          dateOfBirth: new Date(Date.now() - 17 * 365 * 86_400_000)
            .toISOString()
            .slice(0, 10),
        },
        403,
      ],
      ['unaccepted terms', { acceptTerms: false }, 400],
      ['a short password', { password: 'short' }, 400],
      ['a common password', { password: 'password123' }, 400],
      ['an invalid email', { email: 'nope' }, 400],
      ['unknown fields', { role: 'ADMIN' }, 400],
      ['a bad display name', { displayName: '<script>' }, 400],
    ])('rejects %s', async (_, overrides, status) => {
      const client = await t.client();
      await client
        .post('/api/auth/register', registration(overrides))
        .expect(status);
    });
  });

  describe('login', () => {
    it('signs in with the right password and rejects the wrong one generically', async () => {
      const body = registration();
      await (await t.client()).post('/api/auth/register', body).expect(201);

      const client = await t.client();
      const wrong = await client
        .post('/api/auth/login', {
          email: body.email,
          password: 'wrong-password',
        })
        .expect(401);
      const unknown = await client
        .post('/api/auth/login', {
          email: uniqueEmail(),
          password: 'whatever-123',
        })
        .expect(401);
      expect(wrong.body.message).toBe(unknown.body.message);

      const ok = await client
        .post('/api/auth/login', { email: body.email, password: body.password })
        .expect(200);
      expect(ok.body.user.email).toBe(body.email);
      await client.get('/api/auth/me').expect(200);
    });

    it('locks the account after five failed attempts', async () => {
      const body = registration();
      await (await t.client()).post('/api/auth/register', body).expect(201);
      const client = await t.client();
      for (let i = 0; i < 5; i++) {
        await client
          .post('/api/auth/login', {
            email: body.email,
            password: 'wrong-password',
          })
          .expect(401);
      }
      await client
        .post('/api/auth/login', { email: body.email, password: body.password })
        .expect(429);
      const user = await t.prisma.user.findUniqueOrThrow({
        where: { email: body.email },
      });
      expect(user.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
    });

    it('rate-limits credential endpoints per client', async () => {
      const client = await t.client();
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) {
        const res = await client.post('/api/auth/login', {
          email: uniqueEmail(),
          password: 'whatever-123',
        });
        statuses.push(res.status);
      }
      expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
      expect(statuses.slice(10)).toEqual([429, 429]);
    });

    it('rejects suspended accounts', async () => {
      const body = registration();
      await (await t.client()).post('/api/auth/register', body).expect(201);
      await t.prisma.user.update({
        where: { email: body.email },
        data: { status: 'SUSPENDED' },
      });
      await (
        await t.client()
      )
        .post('/api/auth/login', { email: body.email, password: body.password })
        .expect(403);
    });
  });

  describe('CSRF and authentication', () => {
    it('requires an access token on protected routes', async () => {
      const client = await t.client();
      await client.get('/api/auth/me').expect(401);
      await client
        .raw('get', '/api/wallet')
        .set('Authorization', 'Bearer not-a-jwt')
        .expect(401);
    });

    it('rejects state-changing requests without the CSRF header or from foreign origins', async () => {
      const client = await t.client();
      await client
        .raw('post', '/api/auth/login')
        .send({ email: uniqueEmail(), password: 'x' })
        .expect(403);
      await client
        .raw('post', '/api/auth/login')
        .set('Origin', 'https://evil.example')
        .set('Cookie', `XSRF-TOKEN=${client.cookies.get('XSRF-TOKEN')}`)
        .set('X-XSRF-TOKEN', client.cookies.get('XSRF-TOKEN') ?? '')
        .send({ email: uniqueEmail(), password: 'x' })
        .expect(403);
    });

    it('sets security headers', async () => {
      const res = await (await t.client()).get('/api/health/live').expect(200);
      expect(res.headers['content-security-policy']).toContain(
        "default-src 'none'",
      );
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('refresh tokens', () => {
    it('rotates the refresh token and detects reuse of an old one', async () => {
      const client = await t.client();
      await client.post('/api/auth/register', registration()).expect(201);
      const first = client.cookies.get('refresh_token') as string;

      await client.post('/api/auth/refresh').expect(204);
      const second = client.cookies.get('refresh_token') as string;
      expect(second).not.toBe(first);
      await client.post('/api/auth/refresh').expect(204);

      // Replaying the very first token (two rotations ago) is theft: the whole session dies.
      client.cookies.set('refresh_token', first);
      await client.post('/api/auth/refresh').expect(401);
      expect(client.cookies.has('refresh_token')).toBe(false);
    });

    it('treats an immediate replay of the previous token as a concurrent refresh', async () => {
      const client = await t.client();
      await client.post('/api/auth/register', registration()).expect(201);
      const first = client.cookies.get('refresh_token') as string;
      await client.post('/api/auth/refresh').expect(204);
      const current = client.cookies.get('refresh_token') as string;

      client.cookies.set('refresh_token', first);
      await client.post('/api/auth/refresh').expect(409);
      client.cookies.set('refresh_token', current);
      await client.post('/api/auth/refresh').expect(204);
    });

    it('logout revokes the session', async () => {
      const client = await t.client();
      await client.post('/api/auth/register', registration()).expect(201);
      const token = client.cookies.get('refresh_token') as string;
      await client.post('/api/auth/logout').expect(204);
      expect(client.cookies.has('access_token')).toBe(false);
      client.cookies.set('refresh_token', token);
      await client.post('/api/auth/refresh').expect(401);
    });

    it('rejects garbage refresh tokens', async () => {
      const client = await t.client();
      client.cookies.set('refresh_token', 'garbage');
      await client.post('/api/auth/refresh').expect(401);
      client.cookies.delete('refresh_token');
      await client.post('/api/auth/refresh').expect(401);
    });
  });

  describe('email verification', () => {
    it('verifies with the emailed token exactly once', async () => {
      const client = await t.client();
      const body = registration();
      await client.post('/api/auth/register', body).expect(201);
      const token = tokenFrom(
        t.mailer.outbox.filter((m) => m.to === body.email).at(-1)?.text ?? '',
      );

      const res = await client
        .post('/api/auth/verify-email', { token })
        .expect(200);
      expect(res.body.emailVerified).toBe(true);
      await client.post('/api/auth/verify-email', { token }).expect(400);
      await client.post('/api/auth/resend-verification').expect(409);
    });

    it('invalidates earlier links when a new one is sent', async () => {
      const client = await t.client();
      const body = registration();
      await client.post('/api/auth/register', body).expect(201);
      const first = tokenFrom(
        t.mailer.outbox.filter((m) => m.to === body.email).at(-1)?.text ?? '',
      );
      await client.post('/api/auth/resend-verification').expect(204);
      const second = tokenFrom(
        t.mailer.outbox.filter((m) => m.to === body.email).at(-1)?.text ?? '',
      );
      await client.post('/api/auth/verify-email', { token: first }).expect(400);
      await client
        .post('/api/auth/verify-email', { token: second })
        .expect(200);
    });
  });

  describe('password reset and change', () => {
    it('does not reveal whether an account exists', async () => {
      const before = t.mailer.outbox.length;
      await (
        await t.client()
      )
        .post('/api/auth/forgot-password', { email: uniqueEmail() })
        .expect(204);
      expect(t.mailer.outbox.length).toBe(before);
    });

    it('resets the password, revokes every session and clears a lockout', async () => {
      const body = registration();
      const original = await t.client();
      await original.post('/api/auth/register', body).expect(201);
      await t.prisma.user.update({
        where: { email: body.email },
        data: { lockedUntil: new Date(Date.now() + 60_000) },
      });

      const other = await t.client();
      await other
        .post('/api/auth/forgot-password', { email: body.email })
        .expect(204);
      const mail = t.mailer.outbox.filter((m) => m.to === body.email).at(-1);
      expect(mail?.subject).toBe('Reset your password');
      const token = tokenFrom(mail?.text ?? '');

      await other
        .post('/api/auth/reset-password', {
          token,
          password: 'brand-new-passphrase-7',
        })
        .expect(204);
      await other
        .post('/api/auth/reset-password', {
          token,
          password: 'another-passphrase-8',
        })
        .expect(400);
      await original.post('/api/auth/refresh').expect(401);

      await other
        .post('/api/auth/login', { email: body.email, password: body.password })
        .expect(401);
      await other
        .post('/api/auth/login', {
          email: body.email,
          password: 'brand-new-passphrase-7',
        })
        .expect(200);
    });

    it('changes the password with the current one and signs out everywhere', async () => {
      const body = registration();
      const client = await t.client();
      await client.post('/api/auth/register', body).expect(201);
      await client
        .post('/api/auth/change-password', {
          currentPassword: 'nope-nope-nope',
          newPassword: 'fresh-passphrase-99',
        })
        .expect(401);
      await client
        .post('/api/auth/change-password', {
          currentPassword: body.password,
          newPassword: 'fresh-passphrase-99',
        })
        .expect(204);
      await client.get('/api/auth/me').expect(401);
      await client
        .post('/api/auth/login', {
          email: body.email,
          password: 'fresh-passphrase-99',
        })
        .expect(200);
    });
  });

  describe('two-factor authentication', () => {
    const secretFrom = (otpauthUrl: string): string =>
      new URL(otpauthUrl).searchParams.get('secret') as string;

    it('enrols, requires a code at sign-in, rejects replays and can be disabled', async () => {
      const body = registration();
      const client = await t.client();
      await client.post('/api/auth/register', body).expect(201);

      const setup = await client.post('/api/auth/2fa/setup').expect(200);
      expect(setup.body.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
      const secret = secretFrom(setup.body.otpauthUrl);
      const stored = await t.prisma.user.findUniqueOrThrow({
        where: { email: body.email },
      });
      expect(stored.totpSecret).not.toContain(secret);

      await client.post('/api/auth/2fa/enable', { code: '000000' }).expect(400);
      const now = Date.now() / 1000;
      const enabled = await client
        .post('/api/auth/2fa/enable', { code: totpCode(secret, now) })
        .expect(200);
      expect(enabled.body.twoFactorEnabled).toBe(true);

      const login = await (
        await t.client()
      )
        .post('/api/auth/login', { email: body.email, password: body.password })
        .expect(200);
      expect(login.body).toEqual({
        mfaRequired: true,
        mfaToken: expect.any(String),
      });
      expect(login.body.user).toBeUndefined();

      const second = await t.client();
      // The code used to enable 2FA cannot be replayed.
      await second
        .post('/api/auth/login/mfa', {
          mfaToken: login.body.mfaToken,
          code: totpCode(secret, now),
        })
        .expect(401);
      const next = totpCode(secret, now + 30);
      await second
        .post('/api/auth/login/mfa', {
          mfaToken: login.body.mfaToken,
          code: next,
        })
        .expect(200);
      await second.get('/api/auth/me').expect(200);
      await second
        .post('/api/auth/login/mfa', {
          mfaToken: login.body.mfaToken,
          code: next,
        })
        .expect(401);

      await second
        .post('/api/auth/2fa/disable', {
          password: 'wrong-password',
          code: totpCode(secret, now + 60),
        })
        .expect(401);
      // Steps now and now+30 are spent; move the server clock to the next window.
      const realNow = Date.now();
      const clock = jest.spyOn(Date, 'now').mockReturnValue(realNow + 60_000);
      try {
        const disabled = await second
          .post('/api/auth/2fa/disable', {
            password: body.password,
            code: totpCode(secret, now + 60),
          })
          .expect(200);
        expect(disabled.body.twoFactorEnabled).toBe(false);
      } finally {
        clock.mockRestore();
      }
    });

    it('rejects forged MFA tokens', async () => {
      await (
        await t.client()
      )
        .post('/api/auth/login/mfa', { mfaToken: 'forged', code: '123456' })
        .expect(401);
    });
  });

  describe('health', () => {
    it('reports readiness of Postgres and Redis', async () => {
      const res = await (await t.client()).get('/api/health/ready').expect(200);
      expect(res.body).toEqual({
        status: 'ok',
        checks: { database: 'up', redis: 'up' },
      });
    });
  });

  describe('OpenAPI', () => {
    it('serves the generated spec', async () => {
      const res = await (await t.client()).get('/api/docs-json').expect(200);
      expect(res.body.paths).toHaveProperty('/api/auth/register');
      expect(res.body.paths).toHaveProperty('/api/wallet/transactions');
    });
  });
});
