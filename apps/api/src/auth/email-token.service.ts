import { Injectable } from '@nestjs/common';
import { randomToken, sha256Hex } from '../common/crypto';
import { EmailTokenPurpose } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';

const LIFETIME_MS: Record<EmailTokenPurpose, number> = {
  VERIFY_EMAIL: 24 * 3_600_000,
  RESET_PASSWORD: 3_600_000,
};

/** Single-use, hashed, expiring tokens delivered by email. */
@Injectable()
export class EmailTokenService {
  constructor(private readonly prisma: PrismaService) {}

  /** Issues a new token and invalidates any earlier unused ones for the same purpose. */
  async issue(userId: string, purpose: EmailTokenPurpose): Promise<string> {
    const token = randomToken();
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.emailToken.updateMany({
        where: { userId, purpose, usedAt: null },
        data: { usedAt: now },
      }),
      this.prisma.emailToken.create({
        data: {
          userId,
          purpose,
          tokenHash: sha256Hex(token),
          expiresAt: new Date(now.getTime() + LIFETIME_MS[purpose]),
        },
      }),
    ]);
    return token;
  }

  /** Atomically marks the token used; returns the owner, or null if invalid, expired or already used. */
  async consume(
    token: string,
    purpose: EmailTokenPurpose,
  ): Promise<string | null> {
    const record = await this.prisma.emailToken.findUnique({
      where: { tokenHash: sha256Hex(token) },
    });
    if (!record || record.purpose !== purpose) return null;
    const { count } = await this.prisma.emailToken.updateMany({
      where: { id: record.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    return count === 1 ? record.userId : null;
  }
}
