import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCookieAuth,
  ApiHeader,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  SLOT_CONFIGS,
  SlotRoundResult,
  assertSlotBet,
  playSlot,
} from '@casino/game-engine';
import type { SlotGameId, SlotSpinResponse } from '@casino/shared-types';
import { AuthUser, CurrentUser } from '../common/auth-decorators';
import { SpinDto, SpinResponseDto } from './dto/games.dto';
import { IdempotencyKey } from './idempotency-key.decorator';
import { RoundsService } from './rounds.service';

/** Per-client bet rate: generous for turbo autoplay, tight enough to stop scripted floods. */
export const BET_THROTTLE = { default: { limit: 10, ttl: 1_000 } };

@ApiTags('slots')
@ApiCookieAuth('access_token')
@Controller('games/slots')
export class SlotsController {
  constructor(private readonly rounds: RoundsService) {}

  @Post(':gameId/spin')
  @HttpCode(200)
  @Throttle(BET_THROTTLE)
  @ApiParam({ name: 'gameId', enum: Object.keys(SLOT_CONFIGS) })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Unique per bet; reuse it on retries',
  })
  @ApiOkResponse({ type: SpinResponseDto })
  @ApiBadRequestResponse({ description: 'Unknown game or bet not allowed' })
  @ApiUnprocessableEntityResponse({ description: 'Insufficient balance' })
  spin(
    @CurrentUser() user: AuthUser,
    @Param('gameId') gameId: string,
    @Body() dto: SpinDto,
    @IdempotencyKey() idempotencyKey: string,
  ): Promise<SlotSpinResponse> {
    const config = Object.hasOwn(SLOT_CONFIGS, gameId)
      ? SLOT_CONFIGS[gameId]
      : undefined;
    if (!config) throw new BadRequestException('Unknown slot game');
    try {
      assertSlotBet(config, dto.totalBet);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }

    return this.rounds.playInstant<SlotRoundResult>({
      userId: user.id,
      gameId: gameId as SlotGameId,
      idempotencyKey,
      input: { totalBet: dto.totalBet },
      stake: dto.totalBet,
      jackpot: true,
      resolve: (rng) => {
        const result = playSlot(config, dto.totalBet, rng);
        return { payout: result.totalWin, result };
      },
    });
  }
}
