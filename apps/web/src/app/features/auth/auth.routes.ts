import { Routes } from '@angular/router';
import { guestGuard } from '../../core/guards';

export const authRoutes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    title: $localize`:@@title.login:Sign in · Casino`,
    loadComponent: () => import('./login.page').then((m) => m.LoginPage),
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    title: $localize`:@@title.register:Create account · Casino`,
    loadComponent: () => import('./register.page').then((m) => m.RegisterPage),
  },
  {
    path: 'verify-email',
    title: $localize`:@@title.verifyEmail:Verify email · Casino`,
    loadComponent: () =>
      import('./verify-email.page').then((m) => m.VerifyEmailPage),
  },
  {
    path: 'forgot-password',
    title: $localize`:@@title.forgot:Forgot password · Casino`,
    loadComponent: () =>
      import('./forgot-password.page').then((m) => m.ForgotPasswordPage),
  },
  {
    path: 'reset-password',
    title: $localize`:@@title.reset:Reset password · Casino`,
    loadComponent: () =>
      import('./reset-password.page').then((m) => m.ResetPasswordPage),
  },
  { path: '', pathMatch: 'full', redirectTo: 'login' },
];
