import { Route } from '@angular/router';
import { authGuard } from './core/guards';

/** Every feature is lazy-loaded; the initial bundle is just the shell. */
export const appRoutes: Route[] = [
  {
    path: '',
    pathMatch: 'full',
    title: $localize`:@@title.lobby:Lobby · Casino`,
    loadComponent: () =>
      import('./features/lobby/lobby.page').then((m) => m.LobbyPage),
  },
  {
    path: 'auth',
    loadChildren: () =>
      import('./features/auth/auth.routes').then((m) => m.authRoutes),
  },
  {
    path: 'wallet',
    canActivate: [authGuard],
    title: $localize`:@@title.wallet:Wallet · Casino`,
    loadComponent: () =>
      import('./features/wallet/wallet.page').then((m) => m.WalletPage),
  },
  {
    path: 'games/slots/:gameId',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/slots/slot.page').then((m) => m.SlotPage),
  },
  {
    path: 'verify',
    title: $localize`:@@title.verify:Verify a bet · Casino`,
    loadComponent: () =>
      import('./features/verify/verify.page').then((m) => m.VerifyPage),
  },
  {
    path: '**',
    title: $localize`:@@title.notFound:Not found · Casino`,
    loadComponent: () =>
      import('./features/not-found.page').then((m) => m.NotFoundPage),
  },
];
