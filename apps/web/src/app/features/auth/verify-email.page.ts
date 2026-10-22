import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api-error';
import { AuthStore } from '../../core/auth.store';

@Component({
  selector: 'cas-verify-email-page',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth-form.scss',
  template: `
    <section
      class="auth card"
      aria-labelledby="verify-title"
      aria-live="polite"
    >
      <h1 id="verify-title" i18n="@@verifyEmail.title">Email verification</h1>
      @switch (state()) {
        @case ('working') {
          <p i18n="@@verifyEmail.working">Confirming your email address…</p>
        }
        @case ('done') {
          <div class="alert alert--success" i18n="@@verifyEmail.done">
            Your email address is confirmed. Daily bonuses are now unlocked.
          </div>
          <a class="btn btn--primary" routerLink="/" i18n="@@verifyEmail.play"
            >Start playing</a
          >
        }
        @case ('error') {
          <div class="alert alert--error" role="alert">{{ error() }}</div>
          <a routerLink="/wallet" i18n="@@verifyEmail.resend"
            >Request a new link from your wallet page</a
          >
        }
      }
    </section>
  `,
})
export class VerifyEmailPage implements OnInit {
  readonly token = input<string>();
  private readonly auth = inject(AuthStore);
  protected readonly state = signal<'working' | 'done' | 'error'>('working');
  protected readonly error = signal('');

  async ngOnInit(): Promise<void> {
    const token = this.token();
    if (!token) {
      this.error.set(
        $localize`:@@verifyEmail.missing:This link is incomplete.`,
      );
      this.state.set('error');
      return;
    }
    try {
      await this.auth.verifyEmail(token);
      this.state.set('done');
    } catch (err) {
      this.error.set(errorMessage(err));
      this.state.set('error');
    }
  }
}
