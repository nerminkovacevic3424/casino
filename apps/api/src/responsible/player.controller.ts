import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { GAME_CATALOG, isGameId, type GameId } from '@casino/shared-types';
import type { Response } from 'express';
import { clearAuthCookies } from '../auth/cookies';
import { AuthUser, CurrentUser, Public } from '../common/auth-decorators';
import { toMinor } from '../common/money';
import { APP_CONFIG, AppConfig } from '../config/env';
import { JackpotService, JackpotWin } from '../jackpot/jackpot.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ActivityQueryDto,
  CoolOffDto,
  SelfExcludeDto,
  UpdateLimitsDto,
} from './dto';
import {
  Activity,
  ResponsibleService,
  ResponsibleState,
} from './responsible.service';

export interface GameStats {
  gameId: GameId;
  rounds: number;
  staked: number;
  won: number;
}

export interface ProfileStats {
  totalRounds: number;
  totalStaked: number;
  totalWon: number;
  biggestWin: number;
  favouriteGame: GameId | null;
  byGame: GameStats[];
}

@ApiTags('player')
@Controller()
export class PlayerController {
  constructor(
    private readonly responsible: ResponsibleService,
    private readonly jackpot: JackpotService,
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ------------------------------------------------------------------ responsible play

  @Get('responsible')
  @ApiCookieAuth('access_token')
  state(@CurrentUser() user: AuthUser): Promise<ResponsibleState> {
    return this.responsible.state(user.id);
  }

  @Put('responsible/limits')
  @ApiCookieAuth('access_token')
  @ApiOkResponse({
    description: 'Tighter limits apply now; looser ones after 24 hours',
  })
  updateLimits(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateLimitsDto,
  ): Promise<ResponsibleState> {
    return this.responsible.updateLimits(user.id, dto);
  }

  @Post('responsible/cool-off')
  @HttpCode(200)
  @ApiCookieAuth('access_token')
  coolOff(
    @CurrentUser() user: AuthUser,
    @Body() dto: CoolOffDto,
  ): Promise<ResponsibleState> {
    return this.responsible.coolOff(user.id, dto.period);
  }

  @Post('responsible/self-exclude')
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiCookieAuth('access_token')
  async selfExclude(
    @CurrentUser() user: AuthUser,
    @Body() dto: SelfExcludeDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.responsible.selfExclude(user.id, dto.period, dto.password);
    clearAuthCookies(res, this.config);
  }

  @Get('responsible/activity')
  @ApiCookieAuth('access_token')
  activity(
    @CurrentUser() user: AuthUser,
    @Query() query: ActivityQueryDto,
  ): Promise<Activity> {
    return this.responsible.activity(user.id, new Date(query.since));
  }

  // ------------------------------------------------------------------ lobby personalisation

  @Get('favourites')
  @ApiCookieAuth('access_token')
  async favourites(@CurrentUser() user: AuthUser): Promise<string[]> {
    const rows = await this.prisma.favourite.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => r.gameId);
  }

  @Put('favourites/:gameId')
  @HttpCode(204)
  @ApiCookieAuth('access_token')
  async addFavourite(
    @CurrentUser() user: AuthUser,
    @Param('gameId') gameId: string,
  ): Promise<void> {
    if (!isGameId(gameId)) throw new BadRequestException('Unknown game');
    await this.prisma.favourite.upsert({
      where: { userId_gameId: { userId: user.id, gameId } },
      create: { userId: user.id, gameId },
      update: {},
    });
  }

  @Delete('favourites/:gameId')
  @HttpCode(204)
  @ApiCookieAuth('access_token')
  async removeFavourite(
    @CurrentUser() user: AuthUser,
    @Param('gameId') gameId: string,
  ): Promise<void> {
    await this.prisma.favourite.deleteMany({
      where: { userId: user.id, gameId },
    });
  }

  @Get('games/recent')
  @ApiCookieAuth('access_token')
  async recent(
    @CurrentUser() user: AuthUser,
  ): Promise<{ gameId: string; lastPlayedAt: string }[]> {
    const rows = await this.prisma.gameRound.groupBy({
      by: ['gameId'],
      where: { userId: user.id },
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: 'desc' } },
      take: 6,
    });
    return rows.map((r) => ({
      gameId: r.gameId,
      lastPlayedAt: (r._max.createdAt as Date).toISOString(),
    }));
  }

  @Get('profile/stats')
  @ApiCookieAuth('access_token')
  async stats(@CurrentUser() user: AuthUser): Promise<ProfileStats> {
    const [byGame, biggest] = await Promise.all([
      this.prisma.gameRound.groupBy({
        by: ['gameId'],
        where: { userId: user.id },
        _count: { _all: true },
        _sum: { stake: true, payout: true },
      }),
      this.prisma.gameRound.aggregate({
        where: { userId: user.id },
        _max: { payout: true },
      }),
    ]);
    const games: GameStats[] = byGame
      .filter((g) => isGameId(g.gameId))
      .map((g) => ({
        gameId: g.gameId as GameId,
        rounds: g._count._all,
        staked: toMinor(g._sum.stake ?? 0n),
        won: toMinor(g._sum.payout ?? 0n),
      }))
      .sort((a, b) => b.rounds - a.rounds);
    const order = new Map(GAME_CATALOG.map((g, i) => [g.id, i]));
    return {
      totalRounds: games.reduce((s, g) => s + g.rounds, 0),
      totalStaked: games.reduce((s, g) => s + g.staked, 0),
      totalWon: games.reduce((s, g) => s + g.won, 0),
      biggestWin: toMinor(biggest._max.payout ?? 0n),
      favouriteGame: games[0]?.gameId ?? null,
      byGame: [...games].sort(
        (a, b) => (order.get(a.gameId) ?? 0) - (order.get(b.gameId) ?? 0),
      ),
    };
  }

  // ------------------------------------------------------------------ jackpot (public)

  @Public()
  @Get('jackpot')
  async jackpotState(): Promise<{
    amount: number;
    lastWin: JackpotWin | null;
  }> {
    return {
      amount: await this.jackpot.amount(),
      lastWin: await this.jackpot.lastWin(),
    };
  }
}
