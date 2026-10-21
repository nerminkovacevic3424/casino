import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type {
  FairnessState,
  GameSummary,
  Paginated,
  RevealedSeed,
  RoundDetail,
  RoundSummary,
} from '@casino/shared-types';
import { AuthUser, CurrentUser, Public } from '../common/auth-decorators';
import { FairnessService } from '../fairness/fairness.service';
import { RotateSeedDto, RoundQueryDto } from './dto/games.dto';
import { GameSettingsService } from './game-settings.service';
import { RoundsService } from './rounds.service';

@ApiTags('games')
@Controller()
export class GamesController {
  constructor(
    private readonly settings: GameSettingsService,
    private readonly rounds: RoundsService,
    private readonly fairness: FairnessService,
  ) {}

  @Public()
  @Get('games')
  @ApiOkResponse({ description: 'Game catalog with availability' })
  games(): Promise<GameSummary[]> {
    return this.settings.list();
  }

  @Get('rounds')
  @ApiCookieAuth('access_token')
  listRounds(
    @CurrentUser() user: AuthUser,
    @Query() query: RoundQueryDto,
  ): Promise<Paginated<RoundSummary>> {
    return this.rounds.list(user.id, query);
  }

  @Get('rounds/:id')
  @ApiCookieAuth('access_token')
  round(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<RoundDetail> {
    return this.rounds.detail(user.id, id);
  }

  // ------------------------------------------------------------------ provably fair seeds

  @Get('fairness')
  @ApiCookieAuth('access_token')
  @ApiOkResponse({
    description: 'Hash of the active server seed, client seed and next nonce',
  })
  activeSeed(@CurrentUser() user: AuthUser): Promise<FairnessState> {
    return this.fairness.active(user.id);
  }

  @Post('fairness/rotate')
  @HttpCode(200)
  @ApiCookieAuth('access_token')
  @ApiOkResponse({
    description: 'Reveals the old server seed and commits to a new one',
  })
  rotate(
    @CurrentUser() user: AuthUser,
    @Body() dto: RotateSeedDto,
  ): Promise<{ revealed: RevealedSeed; active: FairnessState }> {
    return this.fairness.rotate(user.id, dto.clientSeed);
  }

  @Get('fairness/revealed')
  @ApiCookieAuth('access_token')
  revealed(@CurrentUser() user: AuthUser): Promise<RevealedSeed[]> {
    return this.fairness.revealedHistory(user.id);
  }
}
