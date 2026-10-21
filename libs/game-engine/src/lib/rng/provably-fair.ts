import { Rng } from './rng';
import { HmacFn, fromHex, hmacSha256, sha256, toHex, utf8 } from './sha256';

/**
 * Provably fair byte stream.
 *
 *   block(r) = HMAC_SHA256(key = serverSeed, msg = `${clientSeed}:${nonce}:${r}`)
 *
 * for r = 0, 1, 2, ... Each 32-byte block yields eight big-endian uint32
 * values which games consume through {@link Rng}. The server commits to
 * `sha256(serverSeed)` before any bet; once the seed is rotated it is revealed
 * and anyone can recompute every outcome.
 */
export class ProvablyFairRng implements Rng {
  private round = 0;
  private block: Uint8Array = new Uint8Array(0);
  private offset = 0;
  private readonly key: Uint8Array;
  /** Number of uint32 values consumed so far (useful for audits). */
  consumed = 0;

  constructor(
    serverSeed: string,
    private readonly clientSeed: string,
    private readonly nonce: number,
    private readonly hmac: HmacFn = hmacSha256,
  ) {
    assertServerSeed(serverSeed);
    assertClientSeed(clientSeed);
    if (!Number.isSafeInteger(nonce) || nonce < 0)
      throw new RangeError('nonce must be a non-negative integer');
    this.key = fromHex(serverSeed);
  }

  nextUint32(): number {
    if (this.offset >= this.block.length) {
      this.block = this.hmac(
        this.key,
        utf8(`${this.clientSeed}:${this.nonce}:${this.round}`),
      );
      this.round++;
      this.offset = 0;
    }
    const b = this.block;
    const o = this.offset;
    this.offset += 4;
    this.consumed++;
    return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  }
}

/** Server seeds are 32 random bytes encoded as 64 lowercase hex chars. */
export function assertServerSeed(seed: string): void {
  if (!/^[0-9a-f]{64}$/.test(seed))
    throw new Error('Server seed must be 64 lowercase hex characters');
}

/** Client seeds are user-chosen, printable and bounded. */
export function assertClientSeed(seed: string): void {
  if (seed.length < 1 || seed.length > 64 || !/^[\x21-\x7e]+$/.test(seed)) {
    throw new Error(
      'Client seed must be 1-64 printable ASCII characters without spaces',
    );
  }
}

/** The public commitment published before any bet uses `serverSeed`. */
export function hashServerSeed(serverSeed: string): string {
  assertServerSeed(serverSeed);
  return toHex(sha256(fromHex(serverSeed)));
}

/** Checks that a revealed server seed matches the commitment shown earlier. */
export function verifyServerSeed(
  serverSeed: string,
  committedHash: string,
): boolean {
  return hashServerSeed(serverSeed) === committedHash.toLowerCase();
}

export interface FairSeedInput {
  serverSeed: string;
  clientSeed: string;
  nonce: number;
}

export const createFairRng = (
  { serverSeed, clientSeed, nonce }: FairSeedInput,
  hmac?: HmacFn,
): ProvablyFairRng => new ProvablyFairRng(serverSeed, clientSeed, nonce, hmac);
