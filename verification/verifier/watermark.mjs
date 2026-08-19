/**
 * An independent implementation of the SynthID-Text detection path.
 *
 * Written against the reference implementation's published source
 * (google-deepmind/synthid-text @ addb4a1) and the paper, NOT against the lab's
 * TypeScript. It shares no module with the lab. If the two agree on the committed
 * vectors, that agreement is evidence; if one file imported the other it would be
 * decoration.
 */

import { createHash } from 'node:crypto';

import { accumulate, accumulateStep, bitAt, equals, fromBigInt, shiftRight } from './int64.mjs';

const NUM_APPLY_HASH = 12;
const SHIFT = 5; // 64 // 12, which is what `shift = shift or (64 // num_apply_hash)` yields
const OUTPUT_BIT = 30;
const INT64_MAX = (1n << 63n) - 1n;

/** SHA-256 over the little-endian int64 key array, big-endian, modulo 2^63 - 1. */
export function chainSeed(keys) {
  const packed = Buffer.alloc(keys.length * 8);
  keys.forEach((key, index) => packed.writeBigInt64LE(BigInt(key), index * 8));
  const digest = createHash('sha256').update(packed).digest();
  let value = 0n;
  for (const byte of digest) value = (value << 8n) | BigInt(byte);
  return fromBigInt(value % INT64_MAX);
}

/** g-value for one candidate hash under one layer key. */
export function gValue(candidateHash, key) {
  let state = accumulateStep(candidateHash, key);
  for (let round = 0; round < NUM_APPLY_HASH; round += 1) {
    state = shiftRight(accumulateStep(state, 1), SHIFT);
  }
  return bitAt(state, OUTPUT_BIT);
}

/**
 * Per-position hashes.
 *
 * The window starts at ngram_len - 1: earlier tokens are context only. Built by hashing
 * the context and then folding the candidate in, which the reference's prefix property
 * makes equivalent to hashing the whole n-gram at once.
 */
export function positionHashes(tokenIds, params) {
  const seed = chainSeed(params.keys);
  const window = params.ngram_len - 1;
  const positions = [];
  for (let index = window; index < tokenIds.length; index += 1) {
    const contextHash = accumulate(seed, tokenIds.slice(index - window, index));
    positions.push({
      tokenIndex: index,
      contextHash,
      candidateHash: accumulateStep(contextHash, tokenIds[index]),
    });
  }
  return positions;
}

/** Positions whose context has not been seen before, in a rolling history. */
export function repeatedContextMask(tokenIds, params) {
  const seed = chainSeed(params.keys);
  const window = params.ngram_len - 1;
  const history = [];
  const keep = [];
  for (let index = window; index < tokenIds.length; index += 1) {
    const contextHash = accumulate(seed, tokenIds.slice(index - window, index));
    const seen = history.some((entry) => equals(entry, contextHash))
      // The reference initialises its history buffer with zeros, so a context hashing to
      // exactly zero collides with the empty buffer. Reproduced, not corrected.
      || equals(contextHash, { hi: 0, lo: 0 });
    keep.push(!seen);
    history.unshift(contextHash);
    if (history.length > params.context_history_size) history.pop();
  }
  return keep;
}

/** Everything from the first end-of-text token onward is dropped. */
export function eosMask(tokenIds, eosTokenId) {
  const mask = tokenIds.map(() => true);
  if (eosTokenId === null || eosTokenId === undefined) return mask;
  const first = tokenIds.indexOf(eosTokenId);
  if (first === -1) return mask;
  for (let index = first; index < mask.length; index += 1) mask[index] = false;
  return mask;
}

/** The mean g-score, with the position bookkeeping needed to interpret it. */
export function score(tokenIds, params, eosTokenId = 50256) {
  const window = params.ngram_len - 1;
  if (tokenIds.length <= window) {
    return { score: null, gSum: 0, scoredPositions: 0, candidatePositions: 0, depth: params.keys.length };
  }
  const positions = positionHashes(tokenIds, params);
  const notRepeated = repeatedContextMask(tokenIds, params);
  const eos = eosMask(tokenIds, eosTokenId).slice(window);

  let gSum = 0;
  let counted = 0;
  const perPosition = [];
  positions.forEach((position, index) => {
    const keep = notRepeated[index] && (eos[index] ?? true);
    const values = params.keys.map((key) => gValue(position.candidateHash, key));
    if (keep) {
      counted += 1;
      for (const value of values) gSum += value;
    }
    perPosition.push({ tokenIndex: position.tokenIndex, values, keep });
  });

  return {
    score: counted === 0 ? null : gSum / (counted * params.keys.length),
    gSum,
    scoredPositions: counted,
    candidatePositions: positions.length,
    depth: params.keys.length,
    perPosition,
  };
}

/** Exact upper tail of Binomial(trials, 1/2), by direct summation in log space. */
export function binomialUpperTail(observedSum, trials) {
  if (trials <= 0) return { pValue: Number.NaN, log10PValue: Number.NaN };
  const k0 = Math.ceil(observedSum);
  if (k0 <= 0) return { pValue: 1, log10PValue: 0 };
  if (k0 > trials) return { pValue: 0, log10PValue: -Infinity };

  const logFactorial = new Array(trials + 1).fill(0);
  for (let n = 1; n <= trials; n += 1) logFactorial[n] = logFactorial[n - 1] + Math.log(n);
  const logTerms = [];
  for (let k = k0; k <= trials; k += 1) {
    logTerms.push(
      logFactorial[trials] - logFactorial[k] - logFactorial[trials - k] - trials * Math.LN2,
    );
  }
  const maxLog = Math.max(...logTerms);
  const sum = logTerms.reduce((total, term) => total + Math.exp(term - maxLog), 0);
  const logP = maxLog + Math.log(sum);
  return { pValue: Math.exp(logP), log10PValue: logP / Math.LN10 };
}
