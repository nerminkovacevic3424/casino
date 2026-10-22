import { Injectable, signal } from '@angular/core';

export interface Toast {
  readonly id: number;
  readonly kind: 'info' | 'success' | 'error';
  readonly message: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 1;
  readonly toasts = signal<readonly Toast[]>([]);

  show(message: string, kind: Toast['kind'] = 'info', durationMs = 5000): void {
    const toast: Toast = { id: this.nextId++, kind, message };
    this.toasts.update((list) => [...list.slice(-3), toast]);
    setTimeout(() => this.dismiss(toast.id), durationMs);
  }

  error(message: string): void {
    this.show(message, 'error', 8000);
  }

  success(message: string): void {
    this.show(message, 'success');
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }
}
