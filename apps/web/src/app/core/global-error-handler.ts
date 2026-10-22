import { HttpErrorResponse } from '@angular/common/http';
import { ErrorHandler, Injectable, inject } from '@angular/core';
import { ToastService } from './toast.service';

/**
 * Last line of defence for errors nobody handled. HTTP errors are surfaced by
 * the features that made the call, so only unexpected client errors reach the
 * player here, as a generic toast (details stay in the console / telemetry).
 */
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private readonly toasts = inject(ToastService);
  private lastShown = 0;

  handleError(error: unknown): void {
    const cause = (error as { rejection?: unknown })?.rejection ?? error;
    console.error(cause);
    if (cause instanceof HttpErrorResponse) return;
    // Avoid toast storms when something fails in a render loop.
    if (Date.now() - this.lastShown < 5000) return;
    this.lastShown = Date.now();
    this.toasts.error(
      $localize`:@@error.unexpected:An unexpected error occurred. If it keeps happening, reload the page.`,
    );
  }
}
