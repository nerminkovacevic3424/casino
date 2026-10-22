import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import type { JackpotWin } from '@casino/shared-types';
import { Socket, io } from 'socket.io-client';
import { SessionRefresher } from './session-refresh.interceptor';
import { WalletStore } from './wallet.store';

/** Live balance and jackpot updates. Connected only while signed in. */
@Injectable({ providedIn: 'root' })
export class RealtimeService {
  private readonly wallet = inject(WalletStore);
  private readonly refresher = inject(SessionRefresher);
  private retriedAuth = false;
  private socket: Socket | null = null;
  readonly connected = signal(false);
  readonly jackpot = signal<number | null>(null);
  readonly jackpotWin = signal<JackpotWin | null>(null);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.disconnect());
  }

  connect(): void {
    if (this.socket) return;
    // Same origin: the httpOnly access cookie authenticates the handshake.
    this.socket = io({
      path: '/api/socket.io',
      transports: ['websocket'],
      withCredentials: true,
    });
    // 'ready' is sent by the server once the handshake is authenticated.
    this.socket.on('ready', () => {
      this.connected.set(true);
      this.retriedAuth = false;
    });
    // Access token expired: refresh the session once, then shake hands again.
    this.socket.on('unauthorized', () => {
      if (this.retriedAuth) return this.disconnect();
      this.retriedAuth = true;
      this.refresher.refresh().subscribe({
        next: () => this.reconnect(),
        error: () => this.disconnect(),
      });
    });
    this.socket.on('disconnect', () => this.connected.set(false));
    this.socket.on('balance', (payload: { balance: number }) =>
      this.wallet.setFromPush(payload.balance),
    );
    this.socket.on('jackpot', (payload: { amount: number }) =>
      this.jackpot.set(payload.amount),
    );
    this.socket.on('jackpot-won', (win: JackpotWin) => {
      this.jackpotWin.set(win);
    });
  }

  /** After a token refresh the server needs a fresh handshake to see the new cookie. */
  reconnect(): void {
    this.disconnect();
    this.connect();
  }

  disconnect(): void {
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.connected.set(false);
  }
}
