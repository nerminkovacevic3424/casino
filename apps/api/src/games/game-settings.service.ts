import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { GAME_CATALOG, GameId, GameSummary } from '@casino/shared-types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class GameSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<GameSummary[]> {
    const settings = await this.prisma.gameSetting.findMany();
    const enabled = new Map(settings.map((s) => [s.gameId, s.enabled]));
    return GAME_CATALOG.map((g) => ({
      ...g,
      enabled: enabled.get(g.id) ?? true,
    }));
  }

  /** Feature flag check before any bet (games can be switched off from the admin panel). */
  async assertEnabled(gameId: GameId): Promise<void> {
    const setting = await this.prisma.gameSetting.findUnique({
      where: { gameId },
    });
    if (setting && !setting.enabled) {
      throw new ServiceUnavailableException(
        'This game is temporarily unavailable',
      );
    }
  }
}
