/**
 * All monetary amounts are integer minor units (1 credit = 100 minor units).
 * Floats are never used for money; these guards make violations loud.
 */
export type Minor = number;

export function assertMinor(
  value: number,
  label = 'amount',
): asserts value is Minor {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `${label} must be a non-negative safe integer (minor units), got ${value}`,
    );
  }
}

export function assertPositiveMinor(
  value: number,
  label = 'amount',
): asserts value is Minor {
  assertMinor(value, label);
  if (value === 0) throw new RangeError(`${label} must be greater than zero`);
}

/** Integer multiply with overflow guard. Fractional factors are refused, never rounded. */
export function mulMinor(amount: Minor, factor: number): Minor {
  if (!Number.isInteger(factor))
    throw new RangeError(`Multiplier must be an integer, got ${factor}`);
  const result = amount * factor;
  if (!Number.isSafeInteger(result)) throw new RangeError('Monetary overflow');
  return result;
}

export const sumMinor = (values: readonly Minor[]): Minor =>
  values.reduce((a, b) => a + b, 0);
