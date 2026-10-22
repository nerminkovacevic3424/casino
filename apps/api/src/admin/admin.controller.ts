import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import {
  isGameId,
  type AdminActionRow,
  type AdminLedgerRow,
  type AdminOverview,
  type AdminUserDetail,
  type AdminUserRow,
  type CursorPage,
  type Paginated,
} from '@casino/shared-types';
import { AuthUser, CurrentUser, Roles } from '../common/auth-decorators';
import { AdminService } from './admin.service';
import {
  AdjustBalanceDto,
  AuditQueryDto,
  LedgerQueryDto,
  OverviewQueryDto,
  SetGameEnabledDto,
  SetUserStatusDto,
  UserListQueryDto,
} from './dto';

/** Back office. Every route needs the ADMIN role (checked by the global RolesGuard). */
@ApiTags('admin')
@ApiCookieAuth('access_token')
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  overview(@Query() query: OverviewQueryDto): Promise<AdminOverview> {
    return this.admin.overview(query.hours);
  }

  @Put('games/:gameId')
  @HttpCode(204)
  async setGameEnabled(
    @CurrentUser() user: AuthUser,
    @Param('gameId') gameId: string,
    @Body() dto: SetGameEnabledDto,
  ): Promise<void> {
    if (!isGameId(gameId)) throw new BadRequestException('Unknown game');
    await this.admin.setGameEnabled(user.id, gameId, dto.enabled);
  }

  @Get('users')
  users(@Query() query: UserListQueryDto): Promise<Paginated<AdminUserRow>> {
    return this.admin.listUsers(query);
  }

  @Get('users/:id')
  user(@Param('id', ParseUUIDPipe) id: string): Promise<AdminUserDetail> {
    return this.admin.userDetail(id);
  }

  @Patch('users/:id/status')
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetUserStatusDto,
  ): Promise<AdminUserDetail> {
    return this.admin.setUserStatus(user.id, id, dto);
  }

  @Post('users/:id/adjust')
  @HttpCode(200)
  adjust(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustBalanceDto,
  ): Promise<AdminUserDetail> {
    return this.admin.adjustBalance(user.id, id, dto);
  }

  @Get('ledger')
  ledger(@Query() query: LedgerQueryDto): Promise<CursorPage<AdminLedgerRow>> {
    return this.admin.ledger(query);
  }

  @Get('audit')
  audit(@Query() query: AuditQueryDto): Promise<CursorPage<AdminActionRow>> {
    return this.admin.audit(query);
  }
}
