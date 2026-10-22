import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api-error';
import { AuthStore } from '../../core/auth.store';

@Component({
  selector: 'cas-reset-password-page',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth-form.scss',
  template: `
    <section class="auth card" aria-labelledby="reset-title">
      <h1 id="reset-title" i18n="@@reset.title">Choose a new password</h1>
      @if (done()) {
        <div class="alert alert--success" role="status" i18n="@@reset.done">
          Your password has been changed and you have been signed out
          everywhere.
        </div>
        <a
          class="btn btn--primary"
          routerLink="/auth/login"
          i18n="@@reset.signIn"
          >Sign in</a
        >
      } @else {
        @if (error()) {
          <div class="alert alert--error" role="alert">{{ error() }}</div>
        }
        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <div class="field">
            <label for="reset-password" i18n="@@field.newPassword"
              >New password</label
            >
            <input
              id="reset-password"
              type="password"
              formControlName="password"
              autocomplete="new-password"
              aria-describedby="reset-hint"
            />
            <span id="reset-hint" class="hint" i18n="@@field.passwordHint"
              >At least 10 characters. A passphrase of a few words works
              well.</span
            >
          </div>
          <button
            class="btn btn--primary"
            type="submit"
            [disabled]="busy() || !token()"
            i18n="@@reset.submit"
          >
            Save password
          </button>
        </form>
      }
    </section>
  `,
})
export class ResetPasswordPage {
  readonly token = input<string>();
  private readonly auth = inject(AuthStore);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    password: [
      '',
      [
        Validators.required,
        Validators.minLength(10),
        Validators.maxLength(128),
      ],
    ],
  });
  protected readonly busy = signal(false);
  protected readonly done = signal(false);
  protected readonly error = signal('');

  protected async submit(): Promise<void> {
    this.form.markAllAsTouched();
    const token = this.token();
    if (this.form.invalid || !token) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.resetPassword(token, this.form.getRawValue().password);
      this.auth.sessionExpired();
      this.done.set(true);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
