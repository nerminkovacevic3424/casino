import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import type { User } from '../generated/prisma/client';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { RegisterDto, UserDto } from './dto/auth.dto';
import { EmailTokenService } from './email-token.service';
import { PasswordService } from './password.service';
import { SessionMeta, TokenService } from './token.service';
import { TotpService } from './totp.service';

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60_000;
export const MINIMUM_AGE = 18;

/** Everything a controller needs to set the auth cookies. */
export interface IssuedSession {
  readonly user: UserDto;
  readonly accessToken: string;
  readonly refreshToken: string;
}

export type LoginOutcome =
  | ({ readonly kind: 'session' } & IssuedSession)
  | { readonly kind: 'mfa'; readonly mfaToken: string };

const INVALID_CREDENTIALS = 'Invalid email or password';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly totp: TotpService,
    private readonly emailTokens: EmailTokenService,
    private readonly mail: MailService,
    private readonly wallet: WalletService,
  ) {}

  // ------------------------------------------------------------------ registration

  async register(dto: RegisterDto, meta: SessionMeta): Promise<IssuedSession> {
    assertAdult(dto.dateOfBirth);
    this.passwords.assertAcceptable(dto.password, dto.email);
    const passwordHash = await this.passwords.hash(dto.password);

    let user: User;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email: dto.email,
            passwordHash,
            displayName: dto.displayName,
            dateOfBirth: new Date(`${dto.dateOfBirth.slice(0, 10)}T00:00:00Z`),
          },
        });
        await this.wallet.createWallet(tx, created.id);
        return created;
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'An account with this email already exists',
        );
      }
      throw err;
    }

    await this.mail.sendVerification(
      user.email,
      await this.emailTokens.issue(user.id, 'VERIFY_EMAIL'),
    );
    this.logger.log({ userId: user.id }, 'User registered');
    return this.issueSession(user, meta);
  }

  // ------------------------------------------------------------------ login

  async login(
    email: string,
    password: string,
    meta: SessionMeta,
  ): Promise<LoginOutcome> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      await this.passwords.verifyDummy(password);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    this.assertNotLocked(user);

    if (!(await this.passwords.verify(user.passwordHash, password))) {
      await this.recordFailedLogin(user);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    this.assertActive(user);

    if (this.passwords.needsRehash(user.passwordHash)) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await this.passwords.hash(password) },
      });
    }

    if (user.totpEnabledAt) {
      return { kind: 'mfa', mfaToken: await this.tokens.signMfa(user.id) };
    }
    await this.clearFailedLogins(user);
    return { kind: 'session', ...(await this.issueSession(user, meta)) };
  }

  async completeMfaLogin(
    mfaToken: string,
    code: string,
    meta: SessionMeta,
  ): Promise<IssuedSession> {
    const userId = await this.tokens.verifyMfa(mfaToken);
    const user = await this.requireUser(userId);
    this.assertNotLocked(user);
    this.assertActive(user);
    if (!(await this.acceptTotp(user, code))) {
      await this.recordFailedLogin(user);
      throw new UnauthorizedException('Invalid authentication code');
    }
    await this.clearFailedLogins(user);
    return this.issueSession(user, meta);
  }

  async refresh(
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string } | 'conflict'> {
    const result = await this.tokens.rotate(refreshToken);
    if (result.status === 'conflict') return 'conflict';
    const user = await this.prisma.user.findUnique({
      where: { id: result.userId },
    });
    if (!user || user.status !== 'ACTIVE' || isSelfExcluded(user)) {
      await this.tokens.revokeSession(result.refreshToken);
      throw new UnauthorizedException('Session revoked');
    }
    return {
      accessToken: await this.tokens.signAccess({
        id: user.id,
        role: user.role,
      }),
      refreshToken: result.refreshToken,
    };
  }

  logout(refreshToken: string | undefined): Promise<void> {
    return refreshToken
      ? this.tokens.revokeSession(refreshToken)
      : Promise.resolve();
  }

  async me(userId: string): Promise<UserDto> {
    return toUserDto(await this.requireUser(userId));
  }

  // ------------------------------------------------------------------ email verification

  async verifyEmail(token: string): Promise<UserDto> {
    const userId = await this.emailTokens.consume(token, 'VERIFY_EMAIL');
    if (!userId)
      throw new BadRequestException(
        'This verification link is invalid or has expired',
      );
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
    });
    return toUserDto(user);
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.requireUser(userId);
    if (user.emailVerifiedAt)
      throw new ConflictException('Email address already verified');
    await this.mail.sendVerification(
      user.email,
      await this.emailTokens.issue(user.id, 'VERIFY_EMAIL'),
    );
  }

  // ------------------------------------------------------------------ passwords

  /** Always succeeds from the caller's point of view so it cannot be used to probe for accounts. */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') return;
    await this.mail.sendPasswordReset(
      user.email,
      await this.emailTokens.issue(user.id, 'RESET_PASSWORD'),
    );
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const userId = await this.emailTokens.consume(token, 'RESET_PASSWORD');
    if (!userId)
      throw new BadRequestException(
        'This reset link is invalid or has expired',
      );
    const user = await this.requireUser(userId);
    this.passwords.assertAcceptable(password, user.email);
    await this.prisma.user.update({
      where: { id: userId },
      // Proving control of the mailbox also clears any lockout.
      data: {
        passwordHash: await this.passwords.hash(password),
        failedLogins: 0,
        lockedUntil: null,
      },
    });
    await this.tokens.revokeAllSessions(userId);
  }

  async changePassword(
    userId: string,
    current: string,
    next: string,
  ): Promise<void> {
    const user = await this.requireUser(userId);
    if (!(await this.passwords.verify(user.passwordHash, current))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    this.passwords.assertAcceptable(next, user.email);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await this.passwords.hash(next) },
    });
    await this.tokens.revokeAllSessions(userId);
  }

  // ------------------------------------------------------------------ two-factor authentication

  /** Generates a new (not yet active) secret; it only takes effect after {@link enableTotp}. */
  async setupTotp(
    userId: string,
  ): Promise<{ otpauthUrl: string; qrCodeDataUrl: string }> {
    const user = await this.requireUser(userId);
    if (user.totpEnabledAt)
      throw new ConflictException(
        'Two-factor authentication is already enabled',
      );
    const secret = this.totp.generateSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: this.totp.encrypt(secret), totpLastTimeStep: null },
    });
    return this.totp.enrollment(secret, user.email);
  }

  async enableTotp(userId: string, code: string): Promise<UserDto> {
    const user = await this.requireUser(userId);
    if (user.totpEnabledAt)
      throw new ConflictException(
        'Two-factor authentication is already enabled',
      );
    if (!user.totpSecret)
      throw new BadRequestException('Start two-factor setup first');
    if (!(await this.acceptTotp(user, code)))
      throw new BadRequestException('Invalid authentication code');
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { totpEnabledAt: new Date() },
    });
    return toUserDto(updated);
  }

  async disableTotp(
    userId: string,
    password: string,
    code: string,
  ): Promise<UserDto> {
    const user = await this.requireUser(userId);
    if (!user.totpEnabledAt)
      throw new ConflictException('Two-factor authentication is not enabled');
    if (
      !(await this.passwords.verify(user.passwordHash, password)) ||
      !(await this.acceptTotp(user, code))
    ) {
      throw new UnauthorizedException(
        'Invalid password or authentication code',
      );
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: null, totpEnabledAt: null, totpLastTimeStep: null },
    });
    return toUserDto(updated);
  }

  // ------------------------------------------------------------------ helpers

  private async issueSession(
    user: User,
    meta: SessionMeta,
  ): Promise<IssuedSession> {
    return {
      user: toUserDto(user),
      accessToken: await this.tokens.signAccess({
        id: user.id,
        role: user.role,
      }),
      refreshToken: await this.tokens.createSession(user.id, meta),
    };
  }

  /** Verifies a code and atomically records its time step so it can never be replayed. */
  private async acceptTotp(user: User, code: string): Promise<boolean> {
    if (!user.totpSecret) return false;
    const step = this.totp.verify(
      this.totp.decrypt(user.totpSecret),
      code,
      user.totpLastTimeStep,
    );
    if (step === null) return false;
    const { count } = await this.prisma.user.updateMany({
      where: {
        id: user.id,
        OR: [{ totpLastTimeStep: null }, { totpLastTimeStep: { lt: step } }],
      },
      data: { totpLastTimeStep: step },
    });
    return count === 1;
  }

  private assertNotLocked(user: User): void {
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new HttpException(
        'Too many failed sign-in attempts; try again later or reset your password',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private assertActive(user: User): void {
    if (user.status !== 'ACTIVE')
      throw new ForbiddenException('This account is suspended');
    if (isSelfExcluded(user)) {
      throw new ForbiddenException(
        'This account is self-excluded. Contact support if you need help.',
      );
    }
  }

  private async recordFailedLogin(user: User): Promise<void> {
    const failures = user.failedLogins + 1;
    const lock = failures >= MAX_FAILED_LOGINS;
    await this.prisma.user.update({
      where: { id: user.id },
      data: lock
        ? { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MS) }
        : { failedLogins: { increment: 1 } },
    });
    if (lock)
      this.logger.warn(
        { userId: user.id },
        'Account locked after repeated failed sign-ins',
      );
  }

  private async clearFailedLogins(user: User): Promise<void> {
    if (user.failedLogins > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: 0, lockedUntil: null },
      });
    }
  }

  private async requireUser(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}

const isSelfExcluded = (user: User): boolean =>
  user.selfExcludedUntil !== null &&
  user.selfExcludedUntil.getTime() > Date.now();

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    emailVerified: user.emailVerifiedAt !== null,
    twoFactorEnabled: user.totpEnabledAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}

/** Rejects future dates, absurd ages and anyone under {@link MINIMUM_AGE} (UTC calendar dates). */
export function assertAdult(dateOfBirth: string, now = new Date()): void {
  const dob = new Date(`${dateOfBirth.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(dob.getTime()))
    throw new BadRequestException('Invalid date of birth');
  const eighteenth = new Date(
    Date.UTC(
      dob.getUTCFullYear() + MINIMUM_AGE,
      dob.getUTCMonth(),
      dob.getUTCDate(),
    ),
  );
  if (eighteenth.getTime() > now.getTime()) {
    throw new ForbiddenException(
      `You must be at least ${MINIMUM_AGE} years old to play`,
    );
  }
  if (now.getUTCFullYear() - dob.getUTCFullYear() > 120)
    throw new BadRequestException('Invalid date of birth');
}
