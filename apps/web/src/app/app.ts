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
import { CreditsPipe } from '@casino/ui';
import { Announcer } from './core/announcer.service';
import { AuthStore } from './core/auth.store';
import { PreferencesStore } from './core/preferences.store';
import { RealtimeService } from './core/realtime.service';
import { ToastService } from './core/toast.service';
import { WalletStore } from './core/wallet.store';

@Component({
  selector: 'cas-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, CreditsPipe],
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
  private readonly router = inject(Router);

  constructor() {
    // Session lifecycle: load the wallet and open the live channel while signed in.
    effect(() => {
      const status = this.auth.status();
      untracked(() => {
        if (status === 'authenticated') {
          this.wallet.load().catch(() => undefined);
          this.realtime.connect();
        } else if (status === 'anonymous') {
          this.wallet.reset();
          this.realtime.disconnect();
        }
      });
    });
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
