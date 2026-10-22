import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  linkedSignal,
  resource,
  signal,
} from '@angular/core';
import type { LedgerType } from '@casino/shared-types';
import { CreditsPipe } from '@casino/ui';
import { errorMessage } from '../../core/api-error';
import { Announcer } from '../../core/announcer.service';
import { AuthStore } from '../../core/auth.store';
import { ToastService } from '../../core/toast.service';
import { TransactionFilter, WalletStore } from '../../core/wallet.store';

const PAGE_SIZE = 20;

@Component({
  selector: 'cas-wallet-page',
  imports: [CreditsPipe, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './wallet.page.html',
  styleUrl: './wallet.page.scss',
})
export class WalletPage {
  protected readonly wallet = inject(WalletStore);
  protected readonly auth = inject(AuthStore);
  private readonly toasts = inject(ToastService);
  private readonly announcer = inject(Announcer);

  protected readonly types: readonly {
    value: LedgerType | '';
    label: string;
  }[] = [
    { value: '', label: $localize`:@@wallet.type.all:All types` },
    { value: 'BET', label: $localize`:@@wallet.type.bet:Bets` },
    { value: 'WIN', label: $localize`:@@wallet.type.win:Wins` },
    {
      value: 'DAILY_BONUS',
      label: $localize`:@@wallet.type.daily:Daily bonus`,
    },
    {
      value: 'SIGNUP_BONUS',
      label: $localize`:@@wallet.type.signup:Welcome bonus`,
    },
    { value: 'REFUND', label: $localize`:@@wallet.type.refund:Refunds` },
    {
      value: 'ADJUSTMENT',
      label: $localize`:@@wallet.type.adjustment:Adjustments`,
    },
  ];

  protected readonly type = signal<LedgerType | ''>('');
  protected readonly from = signal('');
  protected readonly to = signal('');
  /** Resets to page 1 whenever a filter changes. */
  protected readonly page = linkedSignal({
    source: () => [this.type(), this.from(), this.to()],
    computation: () => 1,
  });
  protected readonly claiming = signal(false);
  protected readonly resent = signal(false);

  protected readonly history = resource({
    params: (): TransactionFilter => ({
      page: this.page(),
      pageSize: PAGE_SIZE,
      type: this.type() || undefined,
      from: this.from()
        ? new Date(`${this.from()}T00:00:00`).toISOString()
        : undefined,
      to: this.to()
        ? new Date(`${this.to()}T23:59:59.999`).toISOString()
        : undefined,
    }),
    loader: ({ params }) => this.wallet.transactions(params),
  });

  protected pageCount(): number {
    const total = this.history.value()?.total ?? 0;
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
  }

  protected typeLabel(type: LedgerType): string {
    return this.types.find((t) => t.value === type)?.label ?? type;
  }

  protected async claim(): Promise<void> {
    this.claiming.set(true);
    try {
      const summary = await this.wallet.claimDailyBonus();
      const message = $localize`:@@wallet.claimed:Daily bonus added. Your balance is now ${(summary.balance / 100).toFixed(2)}:balance: credits.`;
      this.toasts.success(message);
      this.announcer.announce(message);
      this.history.reload();
    } catch (err) {
      this.toasts.error(errorMessage(err));
    } finally {
      this.claiming.set(false);
    }
  }

  protected async resend(): Promise<void> {
    try {
      await this.auth.resendVerification();
      this.resent.set(true);
    } catch (err) {
      this.toasts.error(errorMessage(err));
    }
  }
}
