import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiErrorBody } from '@casino/shared-types';
import type { Response } from 'express';
import { Prisma } from '../generated/prisma/client';
import type { AuthenticatedRequest } from './auth-decorators';

/** Turns every error into the shared `ApiErrorBody` shape; internals never leak to clients. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<AuthenticatedRequest & { id?: string }>();
    const { status, message } = this.describe(exception);

    if (status >= 500) {
      this.logger.error(
        { err: exception, path: req.url, requestId: req.id },
        'Unhandled error',
      );
    }

    const body: ApiErrorBody = {
      statusCode: status,
      error: HttpStatus[status] ?? 'Error',
      message,
      requestId: typeof req.id === 'string' ? req.id : undefined,
    };
    res.status(status).json(body);
  }

  private describe(exception: unknown): { status: number; message: string } {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const raw =
        typeof response === 'string'
          ? response
          : (response as { message?: unknown }).message;
      const message = Array.isArray(raw)
        ? raw.join('; ')
        : typeof raw === 'string'
          ? raw
          : exception.message;
      return { status: exception.getStatus(), message };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002')
        return {
          status: HttpStatus.CONFLICT,
          message: 'Resource already exists',
        };
      if (exception.code === 'P2025')
        return { status: HttpStatus.NOT_FOUND, message: 'Resource not found' };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    };
  }
}
