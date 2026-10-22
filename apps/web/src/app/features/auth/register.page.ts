import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { errorMessage } from '../../core/api-error';
import { AuthStore } from '../../core/auth.store';

const MINIMUM_AGE = 18;

/** Client-side mirror of the server's 18+ rule (the server is authoritative). */
export function adultValidator(
  control: AbstractControl<string>,
): ValidationErrors | null {
  if (!control.value) return null;
  const dob = new Date(`${control.value}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return { date: true };
  const adultOn = Date.UTC(
    dob.getUTCFullYear() + MINIMUM_AGE,
    dob.getUTCMonth(),
    dob.getUTCDate(),
  );
  return adultOn > Date.now() ? { underage: true } : null;
}

@Component({
  selector: 'cas-register-page',
  imports: [ReactiveFormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './auth-form.scss',
  template: `
    <section class="auth card" aria-labelledby="register-title">
      <h1 id="register-title" i18n="@@register.title">Create your account</h1>
      <p class="lead" i18n="@@register.lead">
        Get 1,000 free credits to start. Credits have no cash value.
      </p>
      @if (error()) {
        <div class="alert alert--error" role="alert">{{ error() }}</div>
      }
      <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <div class="field">
          <label for="reg-email" i18n="@@field.email">Email</label>
          <input
            id="reg-email"
            type="email"
            formControlName="email"
            autocomplete="email"
            [attr.aria-invalid]="invalid('email')"
            aria-describedby="reg-email-error"
          />
          @if (invalid('email')) {
            <span id="reg-email-error" class="error" i18n="@@field.emailInvalid"
              >Enter a valid email address.</span
            >
          }
        </div>
        <div class="field">
          <label for="reg-name" i18n="@@field.displayName">Display name</label>
          <input
            id="reg-name"
            formControlName="displayName"
            autocomplete="nickname"
            [attr.aria-invalid]="invalid('displayName')"
            aria-describedby="reg-name-hint"
          />
          <span
            id="reg-name-hint"
            class="hint"
            [class.error]="invalid('displayName')"
            i18n="@@field.displayNameHint"
          >
            3–24 letters, digits, dots, dashes or underscores.
          </span>
        </div>
        <div class="field">
          <label for="reg-password" i18n="@@field.password">Password</label>
          <input
            id="reg-password"
            type="password"
            formControlName="password"
            autocomplete="new-password"
            [attr.aria-invalid]="invalid('password')"
            aria-describedby="reg-password-hint"
          />
          <span
            id="reg-password-hint"
            class="hint"
            [class.error]="invalid('password')"
            i18n="@@field.passwordHint"
          >
            At least 10 characters. A passphrase of a few words works well.
          </span>
        </div>
        <div class="field">
          <label for="reg-dob" i18n="@@field.dob">Date of birth</label>
          <input
            id="reg-dob"
            type="date"
            formControlName="dateOfBirth"
            autocomplete="bday"
            [max]="today"
            [attr.aria-invalid]="invalid('dateOfBirth')"
            aria-describedby="reg-dob-error"
          />
          @if (
            form.controls.dateOfBirth.hasError('underage') &&
            form.controls.dateOfBirth.touched
          ) {
            <span id="reg-dob-error" class="error" i18n="@@field.underage"
              >You must be at least 18 years old to play.</span
            >
          }
        </div>
        <div class="checkbox">
          <input
            id="reg-terms"
            type="checkbox"
            formControlName="acceptTerms"
            [attr.aria-invalid]="invalid('acceptTerms')"
          />
          <label for="reg-terms" i18n="@@field.terms">
            I am 18 or older and accept that this site is for entertainment
            only, using virtual credits with no cash value.
          </label>
        </div>
        <button
          class="btn btn--primary"
          type="submit"
          [disabled]="busy()"
          data-testid="register-submit"
          i18n="@@register.submit"
        >
          Create account
        </button>
      </form>
      <div class="links">
        <span i18n="@@register.haveAccount">Already have an account?</span>
        <a routerLink="/auth/login" i18n="@@register.signIn">Sign in</a>
      </div>
    </section>
  `,
})
export class RegisterPage {
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly today = new Date().toISOString().slice(0, 10);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected readonly form = this.fb.group({
    email: [
      '',
      [Validators.required, Validators.email, Validators.maxLength(254)],
    ],
    displayName: [
      '',
      [Validators.required, Validators.pattern(/^[A-Za-z0-9_.-]{3,24}$/)],
    ],
    password: [
      '',
      [
        Validators.required,
        Validators.minLength(10),
        Validators.maxLength(128),
      ],
    ],
    dateOfBirth: ['', [Validators.required, adultValidator]],
    acceptTerms: [false, Validators.requiredTrue],
  });

  protected invalid(name: keyof typeof this.form.controls): boolean {
    const control = this.form.controls[name];
    return control.invalid && control.touched;
  }

  protected async submit(): Promise<void> {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.register(this.form.getRawValue());
      await this.router.navigateByUrl('/');
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
