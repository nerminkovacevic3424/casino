import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api-error';
import { AuthStore } from '../../core/auth.store';
import { safeReturnUrl } from '../../core/guards';

@Component({
  selector: 'cas-login-page',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth-form.scss',
  template: `
    <section class="auth card" aria-labelledby="login-title">
      @if (mfaToken()) {
        <h1 id="login-title" i18n="@@login.mfaTitle">
          Two-factor authentication
        </h1>
        <p class="lead" i18n="@@login.mfaLead">
          Enter the 6-digit code from your authenticator app.
        </p>
        @if (error()) {
          <div class="alert alert--error" role="alert">{{ error() }}</div>
        }
        <form [formGroup]="mfaForm" (ngSubmit)="submitMfa()" novalidate>
          <div class="field">
            <label for="mfa-code" i18n="@@login.code"
              >Authentication code</label
            >
            <input
              id="mfa-code"
              formControlName="code"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="6"
              [attr.aria-invalid]="
                mfaForm.controls.code.invalid && mfaForm.controls.code.touched
              "
            />
          </div>
          <button
            class="btn btn--primary"
            type="submit"
            [disabled]="busy()"
            i18n="@@login.verify"
          >
            Verify
          </button>
        </form>
      } @else {
        <h1 id="login-title" i18n="@@login.title">Sign in</h1>
        @if (error()) {
          <div class="alert alert--error" role="alert">{{ error() }}</div>
        }
        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <div class="field">
            <label for="login-email" i18n="@@field.email">Email</label>
            <input
              id="login-email"
              type="email"
              formControlName="email"
              autocomplete="email"
              [attr.aria-invalid]="invalid('email')"
              aria-describedby="login-email-error"
            />
            @if (invalid('email')) {
              <span
                id="login-email-error"
                class="error"
                i18n="@@field.emailInvalid"
                >Enter a valid email address.</span
              >
            }
          </div>
          <div class="field">
            <label for="login-password" i18n="@@field.password">Password</label>
            <input
              id="login-password"
              type="password"
              formControlName="password"
              autocomplete="current-password"
              [attr.aria-invalid]="invalid('password')"
            />
          </div>
          <button
            class="btn btn--primary"
            type="submit"
            [disabled]="busy()"
            data-testid="login-submit"
            i18n="@@login.submit"
          >
            Sign in
          </button>
        </form>
        <div class="links">
          <a routerLink="/auth/forgot-password" i18n="@@login.forgot"
            >Forgot password?</a
          >
          <a routerLink="/auth/register" i18n="@@login.register"
            >Create an account</a
          >
        </div>
      }
    </section>
  `,
})
export class LoginPage {
  /** Bound from the query string by the router. */
  readonly returnUrl = input<string>();
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly mfaToken = signal<string | null>(null);

  protected readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });
  protected readonly mfaForm = this.fb.group({
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });

  protected invalid(name: 'email' | 'password'): boolean {
    const control = this.form.controls[name];
    return control.invalid && control.touched;
  }

  protected async submit(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    await this.run(async () => {
      const { email, password } = this.form.getRawValue();
      const result = await this.auth.login(email, password);
      if (result.kind === 'mfa') this.mfaToken.set(result.mfaToken);
      else await this.done();
    });
  }

  protected async submitMfa(): Promise<void> {
    this.mfaForm.markAllAsTouched();
    const token = this.mfaToken();
    if (this.mfaForm.invalid || !token) return;
    await this.run(async () => {
      await this.auth.completeMfa(token, this.mfaForm.getRawValue().code);
      await this.done();
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await action();
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private done(): Promise<boolean> {
    return this.router.navigateByUrl(safeReturnUrl(this.returnUrl()));
  }
}
