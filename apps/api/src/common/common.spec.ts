import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '../generated/prisma/client';
import { testConfig } from '../testing/test-config';
import { safeEqual } from './crypto';
import {
  CSRF_COOKIE,
  CsrfMiddleware,
  isValidCsrfToken,
  issueCsrfToken,
} from './csrf';
import { HttpExceptionFilter } from './http-exception.filter';
import { toBigMinor, toMinor } from './money';

describe('money conversion', () => {
  it('round-trips safe integers', () => {
    expect(toMinor(123n)).toBe(123);
    expect(toBigMinor(-5)).toBe(-5n);
  });

  it('refuses precision loss', () => {
    expect(() => toMinor(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(
      RangeError,
    );
    expect(() => toBigMinor(1.5)).toThrow(RangeError);
  });
});

describe('safeEqual', () => {
  it('compares in constant time and handles length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('CSRF', () => {
  const config = testConfig();
  const middleware = new CsrfMiddleware(config);
  const token = issueCsrfToken(config.CSRF_SECRET);

  const run = (req: Partial<Request>) => {
    const res = { cookie: jest.fn() } as unknown as Response;
    const next: NextFunction = jest.fn();
    middleware.use(
      { headers: {}, cookies: {}, method: 'GET', ...req } as Request,
      res,
      next,
    );
    return { res, next };
  };

  it('signs tokens with the server secret', () => {
    expect(isValidCsrfToken(config.CSRF_SECRET, token)).toBe(true);
    expect(
      isValidCsrfToken('another-secret-another-secret-another', token),
    ).toBe(false);
    expect(isValidCsrfToken(config.CSRF_SECRET, 'forged.token')).toBe(false);
    expect(isValidCsrfToken(config.CSRF_SECRET, 'nodot')).toBe(false);
  });

  it('issues a cookie when missing and lets safe methods through', () => {
    const { res, next } = run({ method: 'GET' });
    expect(res.cookie).toHaveBeenCalledWith(
      CSRF_COOKIE,
      expect.any(String),
      expect.objectContaining({ httpOnly: false }),
    );
    expect(next).toHaveBeenCalled();
  });

  it('accepts a matching header from an allowed origin', () => {
    const { res, next } = run({
      method: 'POST',
      cookies: { [CSRF_COOKIE]: token },
      headers: { origin: 'http://localhost:4200', 'x-xsrf-token': token },
    });
    expect(res.cookie).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it('falls back to the Referer origin', () => {
    const { next } = run({
      method: 'DELETE',
      cookies: { [CSRF_COOKIE]: token },
      headers: {
        referer: 'http://localhost:4200/wallet',
        'x-xsrf-token': token,
      },
    });
    expect(next).toHaveBeenCalled();
  });

  it.each([
    ['no origin', { 'x-xsrf-token': token }],
    ['foreign origin', { origin: 'https://evil.test', 'x-xsrf-token': token }],
    ['bad referer', { referer: 'not a url', 'x-xsrf-token': token }],
    ['missing header', { origin: 'http://localhost:4200' }],
    [
      'mismatched header',
      {
        origin: 'http://localhost:4200',
        'x-xsrf-token': issueCsrfToken(config.CSRF_SECRET),
      },
    ],
  ])('rejects unsafe requests with %s', (_, headers) => {
    expect(() =>
      run({ method: 'POST', cookies: { [CSRF_COOKIE]: token }, headers }),
    ).toThrow(ForbiddenException);
  });

  it('rejects a forged cookie/header pair', () => {
    expect(() =>
      run({
        method: 'POST',
        cookies: { [CSRF_COOKIE]: 'a.b' },
        headers: { origin: 'http://localhost:4200', 'x-xsrf-token': 'a.b' },
      }),
    ).toThrow(ForbiddenException);
  });
});

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  function respond(exception: unknown) {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ id: 'req-1', url: '/x' }),
      }),
    } as unknown as ArgumentsHost;
    filter.catch(exception, host);
    return {
      status: (status.mock.calls[0] as unknown[])[0],
      body: (json.mock.calls[0] as unknown[])[0],
    };
  }

  it('keeps HTTP exception status and joins validation messages', () => {
    expect(
      respond(new BadRequestException(['a must be set', 'b is too long'])),
    ).toEqual({
      status: 400,
      body: {
        statusCode: 400,
        error: 'BAD_REQUEST',
        message: 'a must be set; b is too long',
        requestId: 'req-1',
      },
    });
    expect(respond(new NotFoundException('nope')).body).toMatchObject({
      statusCode: 404,
      message: 'nope',
    });
  });

  it('maps Prisma unique violations to 409', () => {
    const err = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
    });
    expect(respond(err)).toMatchObject({
      status: 409,
      body: { message: 'Resource already exists' },
    });
  });

  it('hides internal errors', () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { status, body } = respond(new Error('secret stack detail'));
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});
