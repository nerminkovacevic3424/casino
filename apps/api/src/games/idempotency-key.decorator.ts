import {
  BadRequestException,
  ExecutionContext,
  createParamDecorator,
} from '@nestjs/common';
import type { Request } from 'express';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
const FORMAT = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Required on every bet: the client generates one key per intended bet and
 * reuses it on retries, so a network retry can never place the bet twice.
 */
export const IdempotencyKey = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    const value = ctx.switchToHttp().getRequest<Request>().headers[
      IDEMPOTENCY_HEADER
    ];
    if (typeof value !== 'string' || !FORMAT.test(value)) {
      throw new BadRequestException(
        'An Idempotency-Key header (8-64 characters: letters, digits, _ or -) is required',
      );
    }
    return value;
  },
);
