import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser } from '../common/auth-decorators';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import {
  TransactionPageDto,
  TransactionQueryDto,
  WalletSummaryDto,
} from './dto/wallet.dto';
import {
  TransactionView,
  WalletService,
  WalletSummary,
} from './wallet.service';
import type { Paginated } from '@casino/shared-types';

@ApiTags('wallet')
@ApiCookieAuth('access_token')
@Controller('wallet')
export class WalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly realtime: RealtimeGateway,
  ) {}

  @Get()
  @ApiOkResponse({ type: WalletSummaryDto })
  summary(@CurrentUser() user: AuthUser): Promise<WalletSummary> {
    return this.wallet.getSummary(user.id);
  }

  @Post('daily-bonus')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOkResponse({ type: WalletSummaryDto })
  async claimDailyBonus(@CurrentUser() user: AuthUser): Promise<WalletSummary> {
    const summary = await this.wallet.claimDailyBonus(user.id);
    this.realtime.emitBalance(user.id, summary.balance);
    return summary;
  }

  @Get('transactions')
  @ApiOkResponse({ type: TransactionPageDto })
  transactions(
    @CurrentUser() user: AuthUser,
    @Query() query: TransactionQueryDto,
  ): Promise<Paginated<TransactionView>> {
    return this.wallet.listTransactions(user.id, query);
  }
}
