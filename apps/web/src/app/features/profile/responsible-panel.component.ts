import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import {
  COOL_OFF_OPTIONS,
  EXCLUSION_OPTIONS,
  LIMIT_KEYS,
  type CoolOffPeriod,
  type ExclusionPeriod,
  type LimitKey,
  type LimitValues,
  type ResponsibleState,
} from '@casino/shared-types';
import { CreditsPipe } from '@casino/ui';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../../core/api-error';
import { AuthStore } from '../../core/auth.store';
import { ToastService } from '../../core/toast.service';
import { SessionWatchService } from '../../core/session-watch.service';

const MONEY: ReadonlySet<LimitKey> = new Set([
  'dailyLossLimit',
  'weeklyLossLimit',
  'monthlyLossLimit',
  'dailyWagerLimit',
]);

@Component({
  selector: 'cas-responsible-panel',
  imports: [ReactiveFormsModule, CreditsPipe, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './responsible-panel.component.html',
  styleUrl: './responsible-panel.component.scss',
})
export class ResponsiblePanelComponent {
  private readonly http = inject(HttpClient);
  private readonly toasts = inject(ToastService);
  private readonly auth = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly session = inject(SessionWatchService);
  private readonly fb = inject(FormBuilder);

  protected readonly keys = LIMIT_KEYS;
  protected readonly coolOffs = COOL_OFF_OPTIONS;
  protected readonly exclusions = EXCLUSION_OPTIONS;
  protected readonly state = signal<ResponsibleState | null>(null);
  protected readonly busy = signal(false);
  protected readonly confirmCoolOff = signal<CoolOffPeriod | null>(null);

  private readonly money = [Validators.min(0.01), Validators.max(10_000_000)];
  private readonly minutes = [Validators.min(5), Validators.max(1440)];
  protected readonly limitsForm = this.fb.group({
    dailyLossLimit: [null as number | null, this.money],
    weeklyLossLimit: [null as number | null, this.money],
    monthlyLossLimit: [null as number | null, this.money],
    dailyWagerLimit: [null as number | null, this.money],
    sessionLimitMinutes: [null as number | null, this.minutes],
    realityCheckMinutes: [
      null as number | null,
      [Validators.min(5), Validators.max(240)],
    ],
  });
  protected readonly excludeForm = this.fb.nonNullable.group({
    period: ['6m' as ExclusionPeriod, Validators.required],
    password: ['', Validators.required],
    understood: [false, Validators.requiredTrue],
  });

  constructor() {
    void this.load();
  }

  protected isMoney(key: LimitKey): boolean {
    return MONEY.has(key);
  }

  protected label(key: LimitKey): string {
    switch (key) {
      case 'dailyLossLimit':
        return $localize`:@@rg.dailyLoss:Daily loss limit (credits)`;
      case 'weeklyLossLimit':
        return $localize`:@@rg.weeklyLoss:Weekly loss limit (credits)`;
      case 'monthlyLossLimit':
        return $localize`:@@rg.monthlyLoss:Monthly loss limit (credits)`;
      case 'dailyWagerLimit':
        return $localize`:@@rg.dailyWager:Daily wager limit (credits)`;
      case 'sessionLimitMinutes':
        return $localize`:@@rg.session:Session time limit (minutes)`;
      case 'realityCheckMinutes':
        return $localize`:@@rg.reality:Reality check every (minutes)`;
    }
  }

  protected usageFor(key: LimitKey): number | null {
    const usage = this.state()?.usage;
    if (!usage) return null;
    switch (key) {
      case 'dailyLossLimit':
        return usage.lossDay;
      case 'weeklyLossLimit':
        return usage.lossWeek;
      case 'monthlyLossLimit':
        return usage.lossMonth;
      case 'dailyWagerLimit':
        return usage.wagerDay;
      default:
        return null;
    }
  }

  protected pendingText(key: LimitKey): string | null {
    const pending = this.state()?.pending;
    if (!pending || !(key in pending)) return null;
    const value = pending[key];
    return value === null || value === undefined
      ? $localize`:@@rg.pendingRemove:removal pending`
      : $localize`:@@rg.pendingChange:change to ${this.display(key, value)}:value: pending`;
  }

  protected display(key: LimitKey, value: number): string {
    return MONEY.has(key) ? (value / 100).toFixed(2) : String(value);
  }

  protected async saveLimits(): Promise<void> {
    if (this.limitsForm.invalid) return this.limitsForm.markAllAsTouched();
    const current = this.state()?.limits;
    const raw = this.limitsForm.getRawValue() as Record<
      LimitKey,
      number | null | string
    >;
    const body: Partial<LimitValues> = {};
    for (const key of LIMIT_KEYS) {
      const v = raw[key];
      const value =
        v === null || v === ''
          ? null
          : MONEY.has(key)
            ? Math.round(Number(v) * 100)
            : Math.round(Number(v));
      if (current && value !== current[key]) body[key] = value;
    }
    if (Object.keys(body).length === 0) return;
    await this.run(async () => {
      const state = await firstValueFrom(
        this.http.put<ResponsibleState>('/api/responsible/limits', body),
      );
      this.apply(state);
      this.session.configure(state.limits);
      this.toasts.success(
        state.pending
          ? $localize`:@@rg.savedPending:Saved. Stricter limits apply now; relaxed ones take effect in 24 hours.`
          : $localize`:@@rg.saved:Your limits are saved.`,
      );
    });
  }

  protected async coolOff(period: CoolOffPeriod): Promise<void> {
    this.confirmCoolOff.set(null);
    await this.run(async () => {
      this.apply(
        await firstValueFrom(
          this.http.post<ResponsibleState>('/api/responsible/cool-off', {
            period,
          }),
        ),
      );
      this.toasts.success(
        $localize`:@@rg.coolOffDone:Your break has started. You can still view your account.`,
      );
    });
  }

  protected async selfExclude(): Promise<void> {
    if (this.excludeForm.invalid) return this.excludeForm.markAllAsTouched();
    const { period, password } = this.excludeForm.getRawValue();
    await this.run(async () => {
      await firstValueFrom(
        this.http.post('/api/responsible/self-exclude', { period, password }),
      );
      this.auth.sessionExpired();
      await this.router.navigateByUrl('/');
      this.toasts.show(
        $localize`:@@rg.excluded:Your account is now closed for play. Take care of yourself.`,
        'info',
        12_000,
      );
    });
  }

  protected periodLabel(period: CoolOffPeriod | ExclusionPeriod): string {
    const labels: Record<string, string> = {
      '24h': $localize`:@@rg.24h:24 hours`,
      '7d': $localize`:@@rg.7d:7 days`,
      '30d': $localize`:@@rg.30d:30 days`,
      '6m': $localize`:@@rg.6m:6 months`,
      '1y': $localize`:@@rg.1y:1 year`,
      '5y': $localize`:@@rg.5y:5 years`,
      permanent: $localize`:@@rg.permanent:Permanently`,
    };
    return labels[period];
  }

  private async load(): Promise<void> {
    try {
      this.apply(
        await firstValueFrom(
          this.http.get<ResponsibleState>('/api/responsible'),
        ),
      );
    } catch (err) {
      this.toasts.error(errorMessage(err));
    }
  }

  private apply(state: ResponsibleState): void {
    this.state.set(state);
    const values = Object.fromEntries(
      LIMIT_KEYS.map((k) => {
        const v = state.limits[k];
        return [k, v === null ? null : MONEY.has(k) ? v / 100 : v];
      }),
    );
    this.limitsForm.reset(values);
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
