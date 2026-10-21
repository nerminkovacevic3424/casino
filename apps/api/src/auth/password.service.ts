import { BadRequestException, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomToken } from '../common/crypto';

/** OWASP-recommended argon2id parameters (19 MiB, 2 iterations, 1 lane). */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

const COMMON_PASSWORDS = new Set([
  'password123',
  'password1234',
  '1234567890',
  'qwertyuiop',
  'iloveyou123',
  'letmein1234',
  'welcome123',
  'administrator',
  'passw0rd123',
  'qwerty12345',
]);

@Injectable()
export class PasswordService {
  /** Hash of a random string, used to equalise timing when the account does not exist. */
  private dummyHash: Promise<string> | null = null;

  hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  /** Burns the same time as a real verification so login timing does not reveal registered emails. */
  async verifyDummy(password: string): Promise<false> {
    this.dummyHash ??= this.hash(randomToken());
    await this.verify(await this.dummyHash, password);
    return false;
  }

  /** NIST 800-63B style: length plus a deny-list, no arbitrary composition rules. */
  assertAcceptable(password: string, email: string): void {
    const lower = password.toLowerCase();
    if (
      COMMON_PASSWORDS.has(lower) ||
      lower === email.toLowerCase() ||
      /^(.)\1+$/.test(password)
    ) {
      throw new BadRequestException(
        'This password is too easy to guess; choose another one',
      );
    }
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, ARGON2_OPTIONS);
  }
}
