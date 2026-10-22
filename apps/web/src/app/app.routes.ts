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
    path: 'profile',
    canActivate: [authGuard],
    title: $localize`:@@title.profile:Profile · Casino`,
    loadComponent: () =>
      import('./features/profile/profile.page').then((m) => m.ProfilePage),
  },
  {
    path: 'games/roulette',
    canActivate: [authGuard],
    title: $localize`:@@title.roulette:European Roulette · Casino`,
    loadComponent: () =>
      import('./features/roulette/roulette.page').then((m) => m.RoulettePage),
  },
  {
    path: 'games/blackjack',
    canActivate: [authGuard],
    title: $localize`:@@title.blackjack:Blackjack · Casino`,
    loadComponent: () =>
      import('./features/blackjack/blackjack.page').then(
        (m) => m.BlackjackPage,
      ),
  },
  {
    path: 'games/video-poker',
    canActivate: [authGuard],
    title: $localize`:@@title.videoPoker:Jacks or Better · Casino`,
    loadComponent: () =>
      import('./features/video-poker/video-poker.page').then(
        (m) => m.VideoPokerPage,
      ),
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
