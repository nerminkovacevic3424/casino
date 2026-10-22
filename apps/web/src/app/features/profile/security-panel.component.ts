import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import type { UserProfile } from '@casino/shared-types';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../../core/api-error';
import { AuthStore } from '../../core/auth.store';
import { ToastService } from '../../core/toast.service';

interface TotpSetup {
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

@Component({
  selector: 'cas-security-panel',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h3 i18n="@@security.passwordTitle">Change password</h3>
    <form [formGroup]="passwordForm" (ngSubmit)="changePassword()" novalidate>
      <div class="field">
        <label for="sec-current" i18n="@@security.current"
          >Current password</label
        >
        <input
          id="sec-current"
          type="password"
          formControlName="currentPassword"
          autocomplete="current-password"
        />
      </div>
      <div class="field">
        <label for="sec-new" i18n="@@security.new">New password</label>
        <input
          id="sec-new"
          type="password"
          formControlName="newPassword"
          autocomplete="new-password"
          aria-describedby="sec-new-hint"
        />
        <span id="sec-new-hint" class="hint" i18n="@@field.passwordHint"
          >At least 10 characters. A passphrase of a few words works well.</span
        >
      </div>
      <button
        type="submit"
        class="btn"
        [disabled]="busy()"
        i18n="@@security.change"
      >
        Change password
      </button>
      <p class="hint" i18n="@@security.signOutNote">
        You will be signed out on every device.
      </p>
    </form>

    <h3 i18n="@@security.twoFactor">Two-factor authentication</h3>
    @if (auth.user()?.twoFactorEnabled) {
      <p class="ok" i18n="@@security.enabled">
        ✓ Two-factor authentication is on.
      </p>
      <form
        [formGroup]="disableForm"
        (ngSubmit)="disable()"
        novalidate
        class="row"
      >
        <div class="field">
          <label for="sec-dis-pw" i18n="@@field.password">Password</label>
          <input
            id="sec-dis-pw"
            type="password"
            formControlName="password"
            autocomplete="current-password"
          />
        </div>
        <div class="field">
          <label for="sec-dis-code" i18n="@@login.code"
            >Authentication code</label
          >
          <input
            id="sec-dis-code"
            formControlName="code"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
          />
        </div>
        <button
          type="submit"
          class="btn"
          [disabled]="busy()"
          i18n="@@security.disable"
        >
          Turn off
        </button>
      </form>
    } @else if (setup(); as s) {
      <p i18n="@@security.scan">
        Scan this code with an authenticator app, then enter the 6-digit code it
        shows.
      </p>
      <img
        [src]="s.qrCodeDataUrl"
        width="180"
        height="180"
        i18n-alt="@@security.qrAlt"
        alt="QR code for your authenticator app"
      />
      <details>
        <summary i18n="@@security.manual">
          Can’t scan? Enter the key manually
        </summary>
        <code class="secret">{{ secret(s.otpauthUrl) }}</code>
      </details>
      <form
        [formGroup]="enableForm"
        (ngSubmit)="enable()"
        novalidate
        class="row"
      >
        <div class="field">
          <label for="sec-code" i18n="@@login.code">Authentication code</label>
          <input
            id="sec-code"
            formControlName="code"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
          />
        </div>
        <button
          type="submit"
          class="btn btn--primary"
          [disabled]="busy()"
          i18n="@@security.enable"
        >
          Turn on
        </button>
      </form>
    } @else {
      <p i18n="@@security.offLead">
        Protect your account with a code from an authenticator app when you sign
        in.
      </p>
      <button
        type="button"
        class="btn"
        (click)="startSetup()"
        [disabled]="busy()"
        i18n="@@security.setup"
      >
        Set up two-factor authentication
      </button>
    }
  `,
  styles: `
    h3 {
      margin-top: var(--space-5);
      font-size: var(--font-size-lg);
    }
    h3:first-child {
      margin-top: 0;
    }
    .hint {
      color: var(--color-text-muted);
      font-size: var(--font-size-sm);
    }
    .ok {
      color: var(--color-success);
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
      align-items: flex-end;
    }
    .row .field {
      margin-bottom: 0;
    }
    img {
      background: #fff;
      padding: 8px;
      border-radius: var(--radius-md);
    }
    .secret {
      display: block;
      margin: var(--space-2) 0;
      font-family: var(--font-mono);
      word-break: break-all;
    }
    details {
      margin-bottom: var(--space-3);
    }
  `,
})
export class SecurityPanelComponent {
  protected readonly auth = inject(AuthStore);
  private readonly http = inject(HttpClient);
  private readonly toasts = inject(ToastService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder).nonNullable;

  protected readonly busy = signal(false);
  protected readonly setup = signal<TotpSetup | null>(null);
  protected readonly passwordForm = this.fb.group({
    currentPassword: ['', Validators.required],
    newPassword: [
      '',
      [
        Validators.required,
        Validators.minLength(10),
        Validators.maxLength(128),
      ],
    ],
  });
  protected readonly enableForm = this.fb.group({
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });
  protected readonly disableForm = this.fb.group({
    password: ['', Validators.required],
    code: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]],
  });

  protected secret(otpauthUrl: string): string {
    return new URL(otpauthUrl).searchParams.get('secret') ?? '';
  }

  protected async changePassword(): Promise<void> {
    if (this.passwordForm.invalid) return this.passwordForm.markAllAsTouched();
    await this.run(async () => {
      await firstValueFrom(
        this.http.post(
          '/api/auth/change-password',
          this.passwordForm.getRawValue(),
        ),
      );
      this.auth.sessionExpired();
      this.toasts.success(
        $localize`:@@security.changed:Password changed. Please sign in again.`,
      );
      await this.router.navigateByUrl('/auth/login');
    });
  }

  protected async startSetup(): Promise<void> {
    await this.run(async () =>
      this.setup.set(
        await firstValueFrom(
          this.http.post<TotpSetup>('/api/auth/2fa/setup', {}),
        ),
      ),
    );
  }

  protected async enable(): Promise<void> {
    if (this.enableForm.invalid) return this.enableForm.markAllAsTouched();
    await this.run(async () => {
      const user = await firstValueFrom(
        this.http.post<UserProfile>(
          '/api/auth/2fa/enable',
          this.enableForm.getRawValue(),
        ),
      );
      this.auth.setUser(user);
      this.setup.set(null);
      this.enableForm.reset();
      this.toasts.success(
        $localize`:@@security.enabledToast:Two-factor authentication is on.`,
      );
    });
  }

  protected async disable(): Promise<void> {
    if (this.disableForm.invalid) return this.disableForm.markAllAsTouched();
    await this.run(async () => {
      const user = await firstValueFrom(
        this.http.post<UserProfile>(
          '/api/auth/2fa/disable',
          this.disableForm.getRawValue(),
        ),
      );
      this.auth.setUser(user);
      this.disableForm.reset();
      this.toasts.success(
        $localize`:@@security.disabledToast:Two-factor authentication is off.`,
      );
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
    } catch (err) {
      this.toasts.error(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
