import { HttpClient } from '@angular/common/http';
import { computed, inject } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withState,
} from '@ngrx/signals';
import type { UserProfile } from '@casino/shared-types';
import { firstValueFrom } from 'rxjs';

export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  dateOfBirth: string;
  acceptTerms: boolean;
}

export type LoginResult =
  { kind: 'signed-in' } | { kind: 'mfa'; mfaToken: string };

interface AuthResponse {
  user?: UserProfile;
  mfaRequired?: boolean;
  mfaToken?: string;
}

/** Session state. The tokens themselves live in httpOnly cookies the app can never read. */
export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState({
    user: null as UserProfile | null,
    status: 'unknown' as AuthStatus,
  }),
  withComputed(({ user, status }) => ({
    isAuthenticated: computed(() => status() === 'authenticated'),
    isAdmin: computed(() => user()?.role === 'ADMIN'),
  })),
  withMethods((store, http = inject(HttpClient)) => {
    const signedIn = (user: UserProfile) =>
      patchState(store, { user, status: 'authenticated' });

    return {
      /** Resolves the session on start-up (also obtains the CSRF cookie). */
      async init(): Promise<void> {
        try {
          signedIn(await firstValueFrom(http.get<UserProfile>('/api/auth/me')));
        } catch {
          patchState(store, { user: null, status: 'anonymous' });
        }
      },

      async login(email: string, password: string): Promise<LoginResult> {
        const res = await firstValueFrom(
          http.post<AuthResponse>('/api/auth/login', { email, password }),
        );
        if (res.mfaRequired && res.mfaToken)
          return { kind: 'mfa', mfaToken: res.mfaToken };
        signedIn(res.user as UserProfile);
        return { kind: 'signed-in' };
      },

      async completeMfa(mfaToken: string, code: string): Promise<void> {
        const res = await firstValueFrom(
          http.post<AuthResponse>('/api/auth/login/mfa', { mfaToken, code }),
        );
        signedIn(res.user as UserProfile);
      },

      async register(input: RegisterInput): Promise<void> {
        const res = await firstValueFrom(
          http.post<AuthResponse>('/api/auth/register', input),
        );
        signedIn(res.user as UserProfile);
      },

      async logout(): Promise<void> {
        try {
          await firstValueFrom(http.post('/api/auth/logout', {}));
        } finally {
          patchState(store, { user: null, status: 'anonymous' });
        }
      },

      async verifyEmail(token: string): Promise<void> {
        const user = await firstValueFrom(
          http.post<UserProfile>('/api/auth/verify-email', { token }),
        );
        if (store.status() === 'authenticated') signedIn(user);
      },

      resendVerification(): Promise<unknown> {
        return firstValueFrom(http.post('/api/auth/resend-verification', {}));
      },

      forgotPassword(email: string): Promise<unknown> {
        return firstValueFrom(
          http.post('/api/auth/forgot-password', { email }),
        );
      },

      resetPassword(token: string, password: string): Promise<unknown> {
        return firstValueFrom(
          http.post('/api/auth/reset-password', { token, password }),
        );
      },

      setUser(user: UserProfile): void {
        signedIn(user);
      },

      /** Called by the HTTP layer when the session can no longer be refreshed. */
      sessionExpired(): void {
        patchState(store, { user: null, status: 'anonymous' });
      },
    };
  }),
);
