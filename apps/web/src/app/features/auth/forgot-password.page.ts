import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api-error';
import { AuthStore } from '../../core/auth.store';

@Component({
  selector: 'cas-forgot-password-page',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth-form.scss',
  template: `
    <section class="auth card" aria-labelledby="forgot-title">
      <h1 id="forgot-title" i18n="@@forgot.title">Reset your password</h1>
      @if (sent()) {
        <div class="alert alert--success" role="status" i18n="@@forgot.sent">
          If an account exists for that address, a reset link is on its way. It
          is valid for one hour.
        </div>
      } @else {
        <p class="lead" i18n="@@forgot.lead">
          We will email you a link to choose a new password.
        </p>
        @if (error()) {
          <div class="alert alert--error" role="alert">{{ error() }}</div>
        }
        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <div class="field">
            <label for="forgot-email" i18n="@@field.email">Email</label>
            <input
              id="forgot-email"
              type="email"
              formControlName="email"
              autocomplete="email"
            />
          </div>
          <button
            class="btn btn--primary"
            type="submit"
            [disabled]="busy()"
            i18n="@@forgot.submit"
          >
            Send reset link
          </button>
        </form>
      }
      <div class="links">
        <a routerLink="/auth/login" i18n="@@forgot.back">Back to sign in</a>
      </div>
    </section>
  `,
})
export class ForgotPasswordPage {
  private readonly auth = inject(AuthStore);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });
  protected readonly busy = signal(false);
  protected readonly sent = signal(false);
  protected readonly error = signal('');

  protected async submit(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.busy.set(true);
    try {
      await this.auth.forgotPassword(this.form.getRawValue().email);
      this.sent.set(true);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
