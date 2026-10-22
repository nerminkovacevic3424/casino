import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  untracked,
} from '@angular/core';
import {
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { CreditsPipe, ModalComponent } from '@casino/ui';
import { AgeGateComponent } from './core/age-gate.component';
import { SessionWatchService } from './core/session-watch.service';
import { Announcer } from './core/announcer.service';
import { AuthStore } from './core/auth.store';
import { PreferencesStore } from './core/preferences.store';
import { RealtimeService } from './core/realtime.service';
import { ToastService } from './core/toast.service';
import { WalletStore } from './core/wallet.store';

@Component({
  selector: 'cas-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    CreditsPipe,
    ModalComponent,
    AgeGateComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly auth = inject(AuthStore);
  protected readonly wallet = inject(WalletStore);
  protected readonly prefs = inject(PreferencesStore);
  protected readonly announcer = inject(Announcer);
  protected readonly toasts = inject(ToastService);
  private readonly realtime = inject(RealtimeService);
  protected readonly session = inject(SessionWatchService);
  private readonly router = inject(Router);

  constructor() {
    // Session lifecycle: load the wallet and open the live channel while signed in.
    effect(() => {
      const status = this.auth.status();
      untracked(() => {
        if (status === 'authenticated') {
          this.wallet.load().catch(() => undefined);
          this.realtime.connect();
          void this.session.start();
        } else if (status === 'anonymous') {
          this.wallet.reset();
          this.realtime.disconnect();
          this.session.stop();
        }
      });
    });
  }

  /** Ends the session after a reality check or the session limit. */
  protected async endSession(): Promise<void> {
    this.session.stop();
    await this.logout();
  }

  protected async logout(): Promise<void> {
    await this.auth.logout();
    this.announcer.announce(
      $localize`:@@shell.signedOut:You have been signed out.`,
    );
    await this.router.navigateByUrl('/');
  }

  protected focusMain(event: Event): void {
    event.preventDefault();
    document.getElementById('main')?.focus();
  }
}
