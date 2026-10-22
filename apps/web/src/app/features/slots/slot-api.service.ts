import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { SlotSpinResponse } from '@casino/shared-types';
import { firstValueFrom } from 'rxjs';

/** Network failure or gateway errors; 503 means the game is switched off, so no retry. */
const RETRYABLE = new Set([0, 502, 504]);

@Injectable({ providedIn: 'root' })
export class SlotApi {
  private readonly http = inject(HttpClient);

  /**
   * One key per intended spin, reused on every retry: if the first attempt
   * actually reached the server, the retry returns that same round instead
   * of betting again.
   */
  async spin(
    gameId: string,
    totalBet: number,
    attempts = 3,
  ): Promise<SlotSpinResponse> {
    const key = crypto.randomUUID();
    for (let attempt = 1; ; attempt++) {
      try {
        return await firstValueFrom(
          this.http.post<SlotSpinResponse>(
            `/api/games/slots/${encodeURIComponent(gameId)}/spin`,
            { totalBet },
            { headers: { 'Idempotency-Key': key } },
          ),
        );
      } catch (err) {
        const retryable =
          err instanceof HttpErrorResponse && RETRYABLE.has(err.status);
        if (!retryable || attempt >= attempts) throw err;
        await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
      }
    }
  }
}
