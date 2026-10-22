import { inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { CanActivateFn, Router } from '@angular/router';
import { filter, map, take } from 'rxjs';
import { AuthStore, AuthStatus } from './auth.store';

/** Waits until the start-up session check has finished. */
function resolvedStatus() {
  const auth = inject(AuthStore);
  return toObservable(auth.status).pipe(
    filter((s): s is Exclude<AuthStatus, 'unknown'> => s !== 'unknown'),
    take(1),
  );
}

export const authGuard: CanActivateFn = (_route, state) => {
  const router = inject(Router);
  return resolvedStatus().pipe(
    map((status) =>
      status === 'authenticated'
        ? true
        : router.createUrlTree(['/auth/login'], {
            queryParams: { returnUrl: state.url },
          }),
    ),
  );
};

export const guestGuard: CanActivateFn = () => {
  const router = inject(Router);
  return resolvedStatus().pipe(
    map((status) =>
      status === 'anonymous' ? true : router.createUrlTree(['/']),
    ),
  );
};

export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthStore);
  const router = inject(Router);
  return resolvedStatus().pipe(
    map(() => (auth.isAdmin() ? true : router.createUrlTree(['/']))),
  );
};

/** Only same-app relative paths are accepted as post-login redirects (no open redirects). */
export function safeReturnUrl(value: string | null | undefined): string {
  return value &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.includes('\\')
    ? value
    : '/';
}
