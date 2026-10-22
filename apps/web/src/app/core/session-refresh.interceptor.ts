import {
  HttpClient,
  HttpErrorResponse,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  Observable,
  catchError,
  finalize,
  map,
  of,
  shareReplay,
  switchMap,
  throwError,
} from 'rxjs';
import { AuthStore } from './auth.store';

/** Endpoints where a 401 means "wrong credentials", not "access token expired". */
const NO_REFRESH = [
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/register',
  '/api/auth/logout',
  '/api/auth/me',
];

/** Single-flight refresh: concurrent 401s share one POST /api/auth/refresh. */
@Injectable({ providedIn: 'root' })
export class SessionRefresher {
  private readonly http = inject(HttpClient);
  private inFlight: Observable<void> | null = null;

  refresh(): Observable<void> {
    this.inFlight ??= this.http.post<void>('/api/auth/refresh', {}).pipe(
      // 409: another tab rotated the session a moment ago; its new cookies already apply here.
      catchError((err: unknown) =>
        err instanceof HttpErrorResponse && err.status === 409
          ? of(undefined)
          : throwError(() => err),
      ),
      map(() => undefined),
      finalize(() => (this.inFlight = null)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    return this.inFlight;
  }
}

const shouldRefresh = (req: HttpRequest<unknown>, err: unknown): boolean =>
  err instanceof HttpErrorResponse &&
  err.status === 401 &&
  req.url.startsWith('/api/') &&
  !NO_REFRESH.some((path) => req.url.startsWith(path));

export const sessionRefreshInterceptor: HttpInterceptorFn = (req, next) => {
  const refresher = inject(SessionRefresher);
  const auth = inject(AuthStore);
  return next(req).pipe(
    catchError((err: unknown) => {
      if (!shouldRefresh(req, err)) return throwError(() => err);
      return refresher.refresh().pipe(
        catchError(() => {
          auth.sessionExpired();
          return throwError(() => err);
        }),
        switchMap(() => next(req)),
      );
    }),
  );
};
