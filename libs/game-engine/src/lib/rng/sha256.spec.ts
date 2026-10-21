import { createHash, createHmac, randomBytes } from 'node:crypto';
import { fromHex, hmacSha256, sha256, toHex, utf8 } from './sha256';

const nodeSha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const nodeHmac = (k: Uint8Array, m: Uint8Array) =>
  createHmac('sha256', k).update(m).digest('hex');

describe('sha256', () => {
  it('matches the FIPS 180-4 test vectors', () => {
    expect(toHex(sha256(utf8('')))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(toHex(sha256(utf8('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it.each([0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 1000, 4096])(
    'matches node:crypto for %i-byte messages',
    (len) => {
      const msg = new Uint8Array(randomBytes(len));
      expect(toHex(sha256(msg))).toBe(nodeSha(msg));
    },
  );
});

describe('hmacSha256', () => {
  it('matches RFC 4231 test case 2', () => {
    expect(
      toHex(hmacSha256(utf8('Jefe'), utf8('what do ya want for nothing?'))),
    ).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  });

  it.each([0, 16, 32, 64, 65, 200])(
    'matches node:crypto with %i-byte keys',
    (keyLen) => {
      const key = new Uint8Array(randomBytes(keyLen));
      const msg = new Uint8Array(randomBytes(77));
      expect(toHex(hmacSha256(key, msg))).toBe(nodeHmac(key, msg));
    },
  );
});

describe('hex helpers', () => {
  it('round-trips bytes', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255]);
    expect(toHex(bytes)).toBe('00017f80ff');
    expect(fromHex('00017f80ff')).toEqual(bytes);
    expect(fromHex('ABcd')).toEqual(new Uint8Array([0xab, 0xcd]));
  });

  it.each(['abc', 'zz', '0x12'])('rejects invalid hex %p', (hex) => {
    expect(() => fromHex(hex)).toThrow('Invalid hex string');
  });
});
