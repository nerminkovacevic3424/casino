import { Injectable, inject } from '@angular/core';
import type { SlotSpinResponse } from '@casino/shared-types';
import { GameApi } from '../../core/game-api.service';

@Injectable({ providedIn: 'root' })
export class SlotApi {
  private readonly api = inject(GameApi);

  spin(gameId: string, totalBet: number): Promise<SlotSpinResponse> {
    return this.api.bet(`/api/games/slots/${encodeURIComponent(gameId)}/spin`, {
      totalBet,
    });
  }
}
