/**
 * Signed 64-bit arithmetic on pairs of 32-bit halves.
 *
 * The lab implements the same arithmetic with BigInt. This file deliberately does not:
 * an independent verifier that reuses the implementation it is checking verifies
 * nothing, and a reimplementation in different arithmetic catches a whole class of bug —
 * sign handling, wraparound, shift semantics — that a shared helper would hide from both
 * sides at once.
 *
 * Values are carried as { hi, lo }, each an unsigned 32-bit integer, together
 * representing a two's-complement 64-bit value.
 */

const MULTIPLIER_HI = 0x5851f42d;
const MULTIPLIER_LO = 0x4c957f2d; // 6364136223846793005 = 0x5851F42D4C957F2D

/** Multiply by the LCG multiplier and add the increment, modulo 2^64. */
function mulAddIncrement(hi, lo) {
  const aLow = lo & 0xffff;
  const aHigh = lo >>> 16;
  const bLow = MULTIPLIER_LO & 0xffff;
  const bHigh = MULTIPLIER_LO >>> 16;

  const p0 = aLow * bLow;
  const p1 = aHigh * bLow + Math.floor(p0 / 65536);
  const p2 = aLow * bHigh + (p1 & 0xffff);

  const lowResult = ((((p2 & 0xffff) << 16) | (p0 & 0xffff)) >>> 0);
  const carry = aHigh * bHigh + Math.floor(p1 / 65536) + Math.floor(p2 / 65536);
  const highResult = (carry + Math.imul(hi, MULTIPLIER_LO) + Math.imul(lo, MULTIPLIER_HI)) >>> 0;

  const withIncrementLo = lowResult + 1;
  const withIncrementHi = highResult + (withIncrementLo > 0xffffffff ? 1 : 0);
  return { hi: withIncrementHi >>> 0, lo: withIncrementLo >>> 0 };
}

/** One accumulation step: ((current + value) * multiplier + 1) as int64. */
export function accumulateStep(state, value) {
  const addedLo = state.lo + (value >>> 0);
  const carry = addedLo > 0xffffffff ? 1 : 0;
  // A value may be negative in principle; the reference feeds token ids and keys, which
  // are not, and this verifier rejects anything else rather than guessing.
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`value out of the range this verifier accepts: ${value}`);
  }
  return mulAddIncrement((state.hi + carry) >>> 0, addedLo >>> 0);
}

export function accumulate(state, values) {
  let current = state;
  for (const value of values) current = accumulateStep(current, value);
  return current;
}

/** Arithmetic right shift, preserving the sign bit. */
export function shiftRight(state, bits) {
  if (bits <= 0 || bits >= 64) throw new Error(`unsupported shift: ${bits}`);
  if (bits < 32) {
    const lo = ((state.lo >>> bits) | (state.hi << (32 - bits))) >>> 0;
    const hi = ((state.hi | 0) >> bits) >>> 0;
    return { hi, lo };
  }
  const hi = ((state.hi | 0) >> 31) >>> 0;
  const lo = (((state.hi | 0) >> (bits - 32)) >>> 0);
  return { hi, lo };
}

/** Bit at the given index, counting from the least significant. */
export function bitAt(state, index) {
  return index < 32 ? (state.lo >>> index) & 1 : (state.hi >>> (index - 32)) & 1;
}

export function fromBigInt(value) {
  const unsigned = BigInt.asUintN(64, value);
  return { hi: Number(unsigned >> 32n) >>> 0, lo: Number(unsigned & 0xffffffffn) >>> 0 };
}

/** Decimal string of the signed value, for comparing against committed vectors. */
export function toDecimalString(state) {
  const unsigned = (BigInt(state.hi) << 32n) | BigInt(state.lo);
  return BigInt.asIntN(64, unsigned).toString();
}

export function equals(a, b) {
  return a.hi === b.hi && a.lo === b.lo;
}
