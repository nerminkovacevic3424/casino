/**
 * Idempotent seed: demo player and admin with verified emails and funded wallets.
 *   pnpm nx run api:seed
 * Set SEED_DEMO_USERS=false to skip (e.g. real production data).
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client';
import type { Role } from '../src/generated/prisma/enums';

const DEMO_BALANCE = 1_000_000n; // 10,000.00 credits

interface DemoUser {
  email: string;
  password: string;
  displayName: string;
  role: Role;
}

const users: DemoUser[] = [
  {
    email: 'player@casino.local',
    password: process.env['DEMO_PLAYER_PASSWORD'] ?? 'DemoPlayer!2026',
    displayName: 'DemoPlayer',
    role: 'PLAYER',
  },
  {
    email: 'admin@casino.local',
    password: process.env['DEMO_ADMIN_PASSWORD'] ?? 'DemoAdmin!2026',
    displayName: 'DemoAdmin',
    role: 'ADMIN',
  },
];

async function main(): Promise<void> {
  if (process.env['SEED_DEMO_USERS'] === 'false') {
    console.log('SEED_DEMO_USERS=false; nothing to seed');
    return;
  }
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });

  try {
    for (const demo of users) {
      const existing = await prisma.user.findUnique({
        where: { email: demo.email },
      });
      if (existing) {
        console.log(`exists  ${demo.email}`);
        continue;
      }
      const passwordHash = await argon2.hash(demo.password, {
        type: argon2.argon2id,
        memoryCost: 19_456,
        timeCost: 2,
        parallelism: 1,
      });
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: demo.email,
            passwordHash,
            displayName: demo.displayName,
            dateOfBirth: new Date('1990-01-01T00:00:00Z'),
            role: demo.role,
            emailVerifiedAt: new Date(),
          },
        });
        const wallet = await tx.wallet.create({
          data: { userId: user.id, balance: DEMO_BALANCE },
        });
        await tx.ledgerEntry.create({
          data: {
            walletId: wallet.id,
            userId: user.id,
            type: 'ADJUSTMENT',
            amount: DEMO_BALANCE,
            balanceAfter: DEMO_BALANCE,
            description: 'Demo account funding',
          },
        });
      });
      console.log(`created ${demo.email} (${demo.role})`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
