import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthUser, CurrentUser, Public } from '../common/auth-decorators';
import { APP_CONFIG, AppConfig } from '../config/env';
import { AuthService } from './auth.service';
import { REFRESH_COOKIE, clearAuthCookies, setAuthCookies } from './cookies';
import {
  AuthResponseDto,
  ChangePasswordDto,
  DisableTotpDto,
  EmailDto,
  LoginDto,
  MfaLoginDto,
  RegisterDto,
  ResetPasswordDto,
  TokenDto,
  TotpCodeDto,
  TotpSetupDto,
  UserDto,
} from './dto/auth.dto';
import { SessionMeta } from './token.service';

/** Strict limits on credential endpoints (per client IP), on top of per-account lockout. */
const AUTH_LIMIT = {
  default: { limit: 10, ttl: 60_000, blockDuration: 5 * 60_000 },
};

const meta = (req: Request): SessionMeta => ({
  ip: req.ip,
  userAgent: req.headers['user-agent'],
});

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60 * 60_000 } })
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiConflictResponse({ description: 'Email already registered' })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const session = await this.auth.register(dto, meta(req));
    setAuthCookies(res, this.config, session);
    return { user: session.user };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle(AUTH_LIMIT)
  @ApiOkResponse({
    type: AuthResponseDto,
    description: 'Signed in, or `mfaRequired` with an `mfaToken`',
  })
  @ApiTooManyRequestsResponse()
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const outcome = await this.auth.login(dto.email, dto.password, meta(req));
    if (outcome.kind === 'mfa')
      return { mfaRequired: true, mfaToken: outcome.mfaToken };
    setAuthCookies(res, this.config, outcome);
    return { user: outcome.user };
  }

  @Public()
  @Post('login/mfa')
  @HttpCode(200)
  @Throttle(AUTH_LIMIT)
  @ApiOkResponse({ type: AuthResponseDto })
  async loginMfa(
    @Body() dto: MfaLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponseDto> {
    const session = await this.auth.completeMfaLogin(
      dto.mfaToken,
      dto.code,
      meta(req),
    );
    setAuthCookies(res, this.config, session);
    return { user: session.user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(204)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiNoContentResponse({
    description: 'New access and refresh cookies issued',
  })
  @ApiConflictResponse({
    description:
      'Another tab refreshed at the same moment; retry the original request',
  })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token: string | undefined = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedException('No session');
    try {
      const result = await this.auth.refresh(token);
      if (result === 'conflict')
        throw new ConflictException(
          'Session was refreshed concurrently; retry',
        );
      setAuthCookies(res, this.config, result);
    } catch (err) {
      if (err instanceof UnauthorizedException)
        clearAuthCookies(res, this.config);
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    clearAuthCookies(res, this.config);
  }

  @Get('me')
  @ApiCookieAuth('access_token')
  @ApiOkResponse({ type: UserDto })
  me(@CurrentUser() user: AuthUser): Promise<UserDto> {
    return this.auth.me(user.id);
  }

  @Public()
  @Get('csrf')
  @HttpCode(204)
  @ApiNoContentResponse({ description: 'Ensures the XSRF-TOKEN cookie is set' })
  csrf(): void {
    // The CSRF middleware sets the cookie on every response that lacks a valid one.
  }

  // ------------------------------------------------------------------ email verification

  @Public()
  @Post('verify-email')
  @HttpCode(200)
  @Throttle(AUTH_LIMIT)
  @ApiOkResponse({ type: UserDto })
  verifyEmail(@Body() dto: TokenDto): Promise<UserDto> {
    return this.auth.verifyEmail(dto.token);
  }

  @Post('resend-verification')
  @HttpCode(204)
  @Throttle({ default: { limit: 3, ttl: 60 * 60_000 } })
  @ApiCookieAuth('access_token')
  resendVerification(@CurrentUser() user: AuthUser): Promise<void> {
    return this.auth.resendVerification(user.id);
  }

  // ------------------------------------------------------------------ passwords

  @Public()
  @Post('forgot-password')
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 60 * 60_000 } })
  @ApiNoContentResponse({
    description: 'Always 204, whether or not the account exists',
  })
  forgotPassword(@Body() dto: EmailDto): Promise<void> {
    return this.auth.forgotPassword(dto.email);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(204)
  @Throttle(AUTH_LIMIT)
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.resetPassword(dto.token, dto.password);
    clearAuthCookies(res, this.config);
  }

  @Post('change-password')
  @HttpCode(204)
  @Throttle(AUTH_LIMIT)
  @ApiCookieAuth('access_token')
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.changePassword(
      user.id,
      dto.currentPassword,
      dto.newPassword,
    );
    // Every session (including this one) is revoked; the client signs in again.
    clearAuthCookies(res, this.config);
  }

  // ------------------------------------------------------------------ two-factor authentication

  @Post('2fa/setup')
  @HttpCode(200)
  @ApiCookieAuth('access_token')
  @ApiOkResponse({ type: TotpSetupDto })
  setupTotp(@CurrentUser() user: AuthUser): Promise<TotpSetupDto> {
    return this.auth.setupTotp(user.id);
  }

  @Post('2fa/enable')
  @HttpCode(200)
  @Throttle(AUTH_LIMIT)
  @ApiCookieAuth('access_token')
  @ApiOkResponse({ type: UserDto })
  enableTotp(
    @CurrentUser() user: AuthUser,
    @Body() dto: TotpCodeDto,
  ): Promise<UserDto> {
    return this.auth.enableTotp(user.id, dto.code);
  }

  @Post('2fa/disable')
  @HttpCode(200)
  @Throttle(AUTH_LIMIT)
  @ApiCookieAuth('access_token')
  @ApiOkResponse({ type: UserDto })
  disableTotp(
    @CurrentUser() user: AuthUser,
    @Body() dto: DisableTotpDto,
  ): Promise<UserDto> {
    return this.auth.disableTotp(user.id, dto.password, dto.code);
  }
}
