/**
 * Creates the first admin account from environment variables, for production.
 * Runs on every container start and does nothing once the account exists.
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='long passphrase' tsx apps/api/prisma/create-admin.ts
 *
 * Without ADMIN_EMAIL it exits quietly. Remove ADMIN_PASSWORD from the host's
 * settings after the first deploy; it is only read when the account is missing.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client';

const STARTING_BALANCE = 1_000_000n; // 10,000.00 credits

async function main(): Promise<void> {
  const email = process.env['ADMIN_EMAIL']?.trim().toLowerCase();
  if (!email) {
    console.log('create-admin: ADMIN_EMAIL not set, skipping');
    return;
  }
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      if (existing.role !== 'ADMIN') {
        await prisma.user.update({
          where: { id: existing.id },
          data: { role: 'ADMIN' },
        });
        console.log(`create-admin: promoted ${email} to admin`);
      } else {
        console.log(`create-admin: ${email} already exists`);
      }
      return;
    }

    const password = process.env['ADMIN_PASSWORD'] ?? '';
    if (password.length < 12) {
      throw new Error(
        'ADMIN_PASSWORD must be set (12+ characters) to create the admin account',
      );
    }
    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          displayName: process.env['ADMIN_NAME']?.trim() || 'Admin',
          dateOfBirth: new Date('1990-01-01T00:00:00Z'),
          role: 'ADMIN',
          emailVerifiedAt: new Date(),
        },
      });
      const wallet = await tx.wallet.create({
        data: { userId: user.id, balance: STARTING_BALANCE },
      });
      await tx.ledgerEntry.create({
        data: {
          walletId: wallet.id,
          userId: user.id,
          type: 'ADJUSTMENT',
          amount: STARTING_BALANCE,
          balanceAfter: STARTING_BALANCE,
          description: 'Admin account funding',
        },
      });
    });
    console.log(`create-admin: created ${email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
