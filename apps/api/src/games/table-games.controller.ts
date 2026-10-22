import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiHeader,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  BlackjackPublicView,
  RouletteBet,
  RouletteRoundResult,
  playRoulette,
  validateRouletteBets,
} from '@casino/game-engine';
import type { RoundResponse } from '@casino/shared-types';
import { AuthUser, CurrentUser } from '../common/auth-decorators';
import { PrismaService } from '../prisma/prisma.service';
import {
  BlackjackActionDto,
  BlackjackDealDto,
  RouletteSpinDto,
  VideoPokerDealDto,
  VideoPokerDrawDto,
} from './dto/table-games.dto';
import { IdempotencyKey } from './idempotency-key.decorator';
import { RoundsService } from './rounds.service';
import { BET_THROTTLE } from './slots.controller';
import { BLACKJACK, VIDEO_POKER, VideoPokerView } from './step-games';
import { StepRoundsService } from './step-rounds.service';

const IDEMPOTENCY = {
  name: 'Idempotency-Key',
  required: true,
  description: 'Unique per bet; reuse it on retries',
};

@ApiTags('table games')
@ApiCookieAuth('access_token')
@Controller('games')
export class TableGamesController {
  constructor(
    private readonly rounds: RoundsService,
    private readonly steps: StepRoundsService,
    private readonly prisma: PrismaService,
  ) {}

  // ------------------------------------------------------------------ roulette

  @Post('roulette/spin')
  @HttpCode(200)
  @Throttle(BET_THROTTLE)
  @ApiHeader(IDEMPOTENCY)
  @ApiOkResponse({
    description: 'Winning number and the settlement of every bet',
  })
  spinRoulette(
    @CurrentUser() user: AuthUser,
    @Body() dto: RouletteSpinDto,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<RoundResponse<RouletteRoundResult>> {
    const bets = dto.bets.map(toEngineBet);
    let stake: number;
    try {
      stake = validateRouletteBets(bets);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    return this.rounds.playInstant<RouletteRoundResult>({
      userId: user.id,
      gameId: 'roulette',
      idempotencyKey,
      input: { bets: bets as unknown as object[] },
      stake,
      resolve: (rng) => {
        const result = playRoulette(bets, rng);
        return { payout: result.totalPayout, result };
      },
    });
  }

  /** The player's last 20 winning numbers, newest first (history strip and hot/cold stats). */
  @Get('roulette/history')
  async rouletteHistory(@CurrentUser() user: AuthUser): Promise<number[]> {
    const rounds = await this.prisma.gameRound.findMany({
      where: { userId: user.id, gameId: 'roulette', status: 'SETTLED' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { result: true },
    });
    return rounds.map((r) => (r.result as { number: number }).number);
  }

  // ------------------------------------------------------------------ blackjack

  @Post('blackjack/deal')
  @HttpCode(200)
  @Throttle(BET_THROTTLE)
  @ApiHeader(IDEMPOTENCY)
  dealBlackjack(
    @CurrentUser() user: AuthUser,
    @Body() dto: BlackjackDealDto,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<RoundResponse<BlackjackPublicView>> {
    return this.steps.open(BLACKJACK, user.id, idempotencyKey, {
      bet: dto.bet,
      actions: [],
    });
  }

  @Post('blackjack/rounds/:id/action')
  @HttpCode(200)
  @Throttle(BET_THROTTLE)
  blackjackAction(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: BlackjackActionDto,
  ): Promise<RoundResponse<BlackjackPublicView>> {
    return this.steps.step(BLACKJACK, user.id, id, dto.seq, (input) => ({
      ...input,
      actions: [...input.actions, dto.action],
    }));
  }

  @Get('blackjack/open')
  openBlackjack(
    @CurrentUser() user: AuthUser,
  ): Promise<RoundResponse<BlackjackPublicView> | null> {
    return this.steps.openRound(BLACKJACK, user.id);
  }

  // ------------------------------------------------------------------ video poker

  @Post('video-poker/deal')
  @HttpCode(200)
  @Throttle(BET_THROTTLE)
  @ApiHeader(IDEMPOTENCY)
  dealVideoPoker(
    @CurrentUser() user: AuthUser,
    @Body() dto: VideoPokerDealDto,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<RoundResponse<VideoPokerView>> {
    return this.steps.open(VIDEO_POKER, user.id, idempotencyKey, {
      coins: dto.coins,
      coinValue: dto.coinValue,
    });
  }

  @Post('video-poker/rounds/:id/draw')
  @HttpCode(200)
  @Throttle(BET_THROTTLE)
  drawVideoPoker(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VideoPokerDrawDto,
  ): Promise<RoundResponse<VideoPokerView>> {
    return this.steps.step(VIDEO_POKER, user.id, id, 0, (input) => ({
      ...input,
      held: dto.held,
    }));
  }

  @Get('video-poker/open')
  openVideoPoker(
    @CurrentUser() user: AuthUser,
  ): Promise<RoundResponse<VideoPokerView> | null> {
    return this.steps.openRound(VIDEO_POKER, user.id);
  }
}

function toEngineBet(dto: RouletteSpinDto['bets'][number]): RouletteBet {
  switch (dto.type) {
    case 'straight':
    case 'split':
    case 'street':
    case 'corner':
    case 'sixline':
      return { type: dto.type, numbers: dto.numbers ?? [], amount: dto.amount };
    case 'column':
    case 'dozen':
      if (dto.index === undefined)
        throw new BadRequestException(`${dto.type} bets need an index`);
      return { type: dto.type, index: dto.index, amount: dto.amount };
    default:
      return { type: dto.type, amount: dto.amount };
  }
}
