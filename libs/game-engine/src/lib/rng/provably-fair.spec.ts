import { createHash, createHmac } from 'node:crypto';
import {
  ProvablyFairRng,
  assertClientSeed,
  createFairRng,
  hashServerSeed,
  verifyServerSeed,
} from './provably-fair';
import { randomInt } from './rng';

const SERVER_SEED = 'a'.repeat(64);
const nodeHmac = (key: Uint8Array, msg: Uint8Array) =>
  new Uint8Array(createHmac('sha256', key).update(msg).digest());

function expectedUint32s(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  round: number,
): number[] {
  const block = createHmac('sha256', Buffer.from(serverSeed, 'hex'))
    .update(`${clientSeed}:${nonce}:${round}`)
    .digest();
  return Array.from({ length: 8 }, (_, i) => block.readUInt32BE(i * 4));
}

describe('ProvablyFairRng', () => {
  it('emits the HMAC-SHA256 stream as big-endian uint32 values', () => {
    const rng = new ProvablyFairRng(SERVER_SEED, 'player-seed', 7);
    const values = Array.from({ length: 16 }, () => rng.nextUint32());
    expect(values).toEqual([
      ...expectedUint32s(SERVER_SEED, 'player-seed', 7, 0),
      ...expectedUint32s(SERVER_SEED, 'player-seed', 7, 1),
    ]);
    expect(rng.consumed).toBe(16);
  });

  it('is deterministic and sensitive to every input', () => {
    const first = (s: string, c: string, n: number) =>
      new ProvablyFairRng(s, c, n).nextUint32();
    expect(first(SERVER_SEED, 'c', 1)).toBe(first(SERVER_SEED, 'c', 1));
    expect(first(SERVER_SEED, 'c', 1)).not.toBe(first(SERVER_SEED, 'c', 2));
    expect(first(SERVER_SEED, 'c', 1)).not.toBe(first(SERVER_SEED, 'd', 1));
    expect(first(SERVER_SEED, 'c', 1)).not.toBe(first('b'.repeat(64), 'c', 1));
  });

  it('produces identical outcomes with the injected node:crypto HMAC', () => {
    const pure = createFairRng({
      serverSeed: SERVER_SEED,
      clientSeed: 'abc',
      nonce: 3,
    });
    const native = createFairRng(
      { serverSeed: SERVER_SEED, clientSeed: 'abc', nonce: 3 },
      nodeHmac,
    );
    for (let i = 0; i < 50; i++)
      expect(randomInt(pure, 37)).toBe(randomInt(native, 37));
  });

  it.each(['', 'A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64)])(
    'rejects malformed server seed %p',
    (seed) => {
      expect(() => new ProvablyFairRng(seed, 'c', 0)).toThrow('Server seed');
    },
  );

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects nonce %p',
    (nonce) => {
      expect(() => new ProvablyFairRng(SERVER_SEED, 'c', nonce)).toThrow(
        'nonce',
      );
    },
  );
});

describe('client seed validation', () => {
  it.each(['', 'has space', 'x'.repeat(65), 'tab\t', 'ünïcode'])(
    'rejects %p',
    (seed) => {
      expect(() => assertClientSeed(seed)).toThrow('Client seed');
    },
  );

  it('accepts printable ASCII', () => {
    expect(() => assertClientSeed('My_Lucky-Seed!42')).not.toThrow();
  });
});

describe('server seed commitment', () => {
  it('hashes the seed bytes with SHA-256', () => {
    const expected = createHash('sha256')
      .update(Buffer.from(SERVER_SEED, 'hex'))
      .digest('hex');
    expect(hashServerSeed(SERVER_SEED)).toBe(expected);
  });

  it('verifies a revealed seed against its commitment', () => {
    const hash = hashServerSeed(SERVER_SEED);
    expect(verifyServerSeed(SERVER_SEED, hash)).toBe(true);
    expect(verifyServerSeed(SERVER_SEED, hash.toUpperCase())).toBe(true);
    expect(verifyServerSeed('b'.repeat(64), hash)).toBe(false);
  });
});
