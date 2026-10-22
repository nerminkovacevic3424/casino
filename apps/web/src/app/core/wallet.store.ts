import { HttpClient, HttpParams } from '@angular/common/http';
import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import type {
  LedgerItem,
  LedgerType,
  Paginated,
  WalletState,
} from '@casino/shared-types';
import { firstValueFrom } from 'rxjs';

export interface TransactionFilter {
  page: number;
  pageSize: number;
  type?: LedgerType;
  from?: string;
  to?: string;
}

interface WalletStoreState {
  summary: WalletState | null;
  /** Live balance; updated by bet responses and pushed over the socket. */
  balance: number | null;
  /**
   * While a game is revealing a result, pushed balances are held back so the
   * header does not show a win before the reels do; the game sets the final
   * balance itself when the reveal ends.
   */
  holds: number;
  /** Pushed balance received while held, applied on release. */
  heldBalance: number | null;
}

export const WalletStore = signalStore(
  { providedIn: 'root' },
  withState<WalletStoreState>({
    summary: null,
    balance: null,
    holds: 0,
    heldBalance: null,
  }),
  withMethods((store, http = inject(HttpClient)) => ({
    async load(): Promise<void> {
      const summary = await firstValueFrom(
        http.get<WalletState>('/api/wallet'),
      );
      patchState(store, { summary, balance: summary.balance });
    },

    async claimDailyBonus(): Promise<WalletState> {
      const summary = await firstValueFrom(
        http.post<WalletState>('/api/wallet/daily-bonus', {}),
      );
      patchState(store, { summary, balance: summary.balance });
      return summary;
    },

    transactions(filter: TransactionFilter): Promise<Paginated<LedgerItem>> {
      let params = new HttpParams()
        .set('page', filter.page)
        .set('pageSize', filter.pageSize);
      if (filter.type) params = params.set('type', filter.type);
      if (filter.from) params = params.set('from', filter.from);
      if (filter.to) params = params.set('to', filter.to);
      return firstValueFrom(
        http.get<Paginated<LedgerItem>>('/api/wallet/transactions', { params }),
      );
    },

    /** Shows a balance chosen by the game (e.g. stake deducted at spin start, final after the reveal). */
    setBalance(balance: number): void {
      patchState(store, { balance, heldBalance: null });
    },

    /** Balance pushed by the server (other tab, bonus, admin adjustment). */
    setFromPush(balance: number): void {
      if (store.holds() > 0) patchState(store, { heldBalance: balance });
      else patchState(store, { balance });
    },

    hold(): void {
      patchState(store, { holds: store.holds() + 1 });
    },

    release(): void {
      const holds = Math.max(0, store.holds() - 1);
      const held = store.heldBalance();
      patchState(
        store,
        holds === 0 && held !== null
          ? { holds, balance: held, heldBalance: null }
          : { holds },
      );
    },

    reset(): void {
      patchState(store, {
        summary: null,
        balance: null,
        holds: 0,
        heldBalance: null,
      });
    },
  })),
);
