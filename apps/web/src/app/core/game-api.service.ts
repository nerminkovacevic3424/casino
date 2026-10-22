import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Network failure or gateway errors; 503 means the game is switched off, so no retry. */
const RETRYABLE = new Set([0, 502, 504]);

/**
 * HTTP for game actions. Every request is safe to retry: new bets carry an
 * Idempotency-Key that is reused on each attempt, and in-round actions carry
 * a sequence number the server uses to recognise repeats.
 */
@Injectable({ providedIn: 'root' })
export class GameApi {
  private readonly http = inject(HttpClient);

  /** Places a new bet (opens a round). */
  bet<T>(url: string, body: object): Promise<T> {
    const key = crypto.randomUUID();
    return this.withRetry(() =>
      firstValueFrom(
        this.http.post<T>(url, body, { headers: { 'Idempotency-Key': key } }),
      ),
    );
  }

  /** Acts inside an open round (hit, stand, draw...). */
  act<T>(url: string, body: object): Promise<T> {
    return this.withRetry(() => firstValueFrom(this.http.post<T>(url, body)));
  }

  get<T>(url: string): Promise<T> {
    return firstValueFrom(this.http.get<T>(url));
  }

  private async withRetry<T>(
    request: () => Promise<T>,
    attempts = 3,
  ): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await request();
      } catch (err) {
        const retryable =
          err instanceof HttpErrorResponse && RETRYABLE.has(err.status);
        if (!retryable || attempt >= attempts) throw err;
        await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
      }
    }
  }
}
