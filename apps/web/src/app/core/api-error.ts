import { HttpErrorResponse } from '@angular/common/http';
import type { ApiErrorBody } from '@casino/shared-types';

/** A human-readable message for any failed API call. */
export function errorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as Partial<ApiErrorBody> | null;
    if (body && typeof body.message === 'string') return body.message;
    if (err.status === 0)
      return $localize`:@@error.network:Cannot reach the server. Check your connection and try again.`;
    if (err.status === 429)
      return $localize`:@@error.rateLimit:Too many requests. Please slow down.`;
  }
  return $localize`:@@error.generic:Something went wrong. Please try again.`;
}

export const isStatus = (err: unknown, status: number): boolean =>
  err instanceof HttpErrorResponse && err.status === status;
