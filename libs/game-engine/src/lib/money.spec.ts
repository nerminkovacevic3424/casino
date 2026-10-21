import { assertMinor, assertPositiveMinor, mulMinor, sumMinor } from './money';

describe('money guards', () => {
  it.each([0, 1, Number.MAX_SAFE_INTEGER])('accepts %p minor units', (v) => {
    expect(() => assertMinor(v)).not.toThrow();
  });

  it.each([-1, 0.1, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 2])(
    'rejects %p',
    (v) => {
      expect(() => assertMinor(v, 'stake')).toThrow(
        /stake must be a non-negative safe integer/,
      );
    },
  );

  it('rejects zero where a positive amount is required', () => {
    expect(() => assertPositiveMinor(0)).toThrow('greater than zero');
    expect(() => assertPositiveMinor(1)).not.toThrow();
  });

  it('multiplies and sums integers, refusing overflow', () => {
    expect(mulMinor(250, 4)).toBe(1000);
    expect(() => mulMinor(Number.MAX_SAFE_INTEGER, 2)).toThrow('overflow');
    expect(() => mulMinor(10, 0.5)).toThrow('must be an integer');
    expect(sumMinor([1, 2, 3])).toBe(6);
    expect(sumMinor([])).toBe(0);
  });
});
