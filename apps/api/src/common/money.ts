/**
 * The database stores minor units as BIGINT; the API and game engine use JS
 * numbers (safe up to 2^53). These helpers convert at the boundary and refuse
 * anything that would lose precision.
 */
export function toMinor(value: bigint): number {
  if (
    value > BigInt(Number.MAX_SAFE_INTEGER) ||
    value < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw new RangeError('Amount exceeds the safe integer range');
  }
  return Number(value);
}

export function toBigMinor(value: number): bigint {
  if (!Number.isSafeInteger(value))
    throw new RangeError(`Amount must be a safe integer, got ${value}`);
  return BigInt(value);
}
