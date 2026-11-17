/**
 * Integer division rounded half to even (banker's rounding).
 * Used for every conversion so rounding errors don't accumulate in one direction.
 * Must match the SQL implementation used by the RPCs.
 */
export function divideHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('Denominator must be positive');

  const negative = numerator < 0n;
  const n = negative ? -numerator : numerator;
  let quotient = n / denominator;
  const twiceRemainder = (n % denominator) * 2n;

  if (twiceRemainder > denominator || (twiceRemainder === denominator && quotient % 2n === 1n)) {
    quotient += 1n;
  }
  return negative ? -quotient : quotient;
}
