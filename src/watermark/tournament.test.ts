/**
 * The tournament, and the closed form that replaces it.
 *
 * The paper proves these are the same distribution (Supplementary Theorem 15, with the
 * two-sample binary case as Corollary 14). Neither reference implementation runs the
 * bracket — both apply the closed form. This suite checks the equivalence empirically on
 * a real pinned distribution, so the page's claim that the bracket "is" the reweighting
 * rests on a measurement rather than on a citation alone.
 *
 * These are statistical expectations, not invariants, and they carry tolerances derived
 * from the sampling error rather than equality assertions.
 */

import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';

import distributions from '../data/pinned/distributions.json';

import { makeDeepMindConstruction } from './constructions.ts';
import { accumulateHash, hashIvFromKeys } from './hash.ts';
import { effectiveCandidates, shannonEntropyBits } from './entropy.ts';
import {
  applyTournamentReweighting, expectedMeanGValue, runBracket, sampleIndex,
  totalVariationDistance,
} from './tournament.ts';

const construction = makeDeepMindConstruction((d) => sha256(d), hashIvFromKeys);
const highEntropy = distributions.distributions.high_entropy;
const lowEntropy = distributions.distributions.low_entropy;

function candidatesOf(dist: typeof highEntropy) {
  return {
    tokenIds: dist.candidates.map((c) => c.token_id),
    probabilities: dist.candidates.map((c) => c.probability),
  };
}

/** Deterministic uniform stream, so a sampled result is reproducible from its seed. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
}

describe('sampling from a pinned distribution', () => {
  it('is an inverse-CDF draw, so the first and last candidates are reachable', () => {
    const { probabilities } = candidatesOf(highEntropy);
    expect(sampleIndex(probabilities, 0)).toBe(0);
    expect(sampleIndex(probabilities, 0.999999)).toBe(probabilities.length - 1);
  });
});

describe('the bracket and the closed form', () => {
  const cases = [
    { name: 'high entropy', dist: highEntropy, depth: 3, trials: 40000, tolerance: 0.02 },
    { name: 'low entropy', dist: lowEntropy, depth: 3, trials: 40000, tolerance: 0.02 },
    { name: 'high entropy, one layer', dist: highEntropy, depth: 1, trials: 40000, tolerance: 0.02 },
  ];

  for (const testCase of cases) {
    it(`agree in distribution on ${testCase.name}`, () => {
      const { tokenIds, probabilities } = candidatesOf(testCase.dist);
      const keys = [654, 400, 836].slice(0, testCase.depth);
      const contextHash = accumulateHash(
        construction.chainSeed(keys),
        testCase.dist.context_token_ids.slice(-4),
      );

      const gValues = tokenIds.map((tokenId) =>
        keys.map((key) =>
          construction.gValue(accumulateHash(contextHash, [tokenId]), key)));
      const closedForm = applyTournamentReweighting(probabilities, gValues, keys.length);

      const counts = new Array(tokenIds.length).fill(0);
      const random = makeRandom(20260819);
      for (let trial = 0; trial < testCase.trials; trial++) {
        const result = runBracket(probabilities, tokenIds, keys, contextHash,
          construction, random, 'random');
        counts[tokenIds.indexOf(result.winnerTokenId)] += 1;
      }
      const empirical = counts.map((c) => c / testCase.trials);

      // Total variation between a sampled bracket and the closed form it is supposed to
      // equal. With this many trials the sampling error alone is a few thousandths.
      expect(totalVariationDistance(empirical, closedForm.probabilities))
        .toBeLessThan(testCase.tolerance);
    });
  }

  it('is unchanged by a positional tie-break, and broken by a token-identity one', () => {
    // The guard against the equivalence test passing for the wrong reason — and a result
    // worth having on its own. This one is enumerated rather than sampled: with a single
    // layer the winner distribution is a sum over all ordered pairs of candidates, so it
    // can be computed exactly and there is no sampling error to argue about.
    //
    // Always taking the left slot leaves the distribution exactly alone, because the two
    // competitors are independent draws and the slot carries no information about which
    // token is in it. Always taking the smaller token id does move it, because that rule
    // reads the token.
    const { tokenIds, probabilities } = candidatesOf(highEntropy);
    const keys = [654];
    const contextHash = accumulateHash(
      construction.chainSeed(keys), highEntropy.context_token_ids.slice(-4));
    const g = tokenIds.map((tokenId) =>
      construction.gValue(accumulateHash(contextHash, [tokenId]), keys[0]));
    const closedForm = applyTournamentReweighting(
      probabilities, g.map((value) => [value]), 1).probabilities;

    const enumerate = (tieBreak: 'random' | 'left' | 'lowestTokenId') => {
      const marginal = new Array(tokenIds.length).fill(0);
      for (let i = 0; i < tokenIds.length; i++) {
        for (let j = 0; j < tokenIds.length; j++) {
          const weight = probabilities[i] * probabilities[j];
          if (g[i] > g[j]) marginal[i] += weight;
          else if (g[j] > g[i]) marginal[j] += weight;
          else if (tieBreak === 'left') marginal[i] += weight;
          else if (tieBreak === 'lowestTokenId') {
            marginal[tokenIds[i] <= tokenIds[j] ? i : j] += weight;
          } else {
            marginal[i] += weight / 2;
            marginal[j] += weight / 2;
          }
        }
      }
      return marginal;
    };

    // 1e-6 is floating-point slack over forty candidates, four orders of magnitude below
    // the distortion the third assertion looks for.
    expect(totalVariationDistance(enumerate('random'), closedForm)).toBeLessThan(1e-6);
    expect(totalVariationDistance(enumerate('left'), closedForm)).toBeLessThan(1e-6);
    expect(totalVariationDistance(enumerate('lowestTokenId'), closedForm)).toBeGreaterThan(0.01);
  });

  it('samples the enumerated marginal, so the bracket code matches the enumeration', () => {
    const { tokenIds, probabilities } = candidatesOf(highEntropy);
    const keys = [654];
    const contextHash = accumulateHash(
      construction.chainSeed(keys), highEntropy.context_token_ids.slice(-4));
    const counts = new Array(tokenIds.length).fill(0);
    const random = makeRandom(4242);
    const trials = 60000;
    for (let trial = 0; trial < trials; trial++) {
      const result = runBracket(probabilities, tokenIds, keys, contextHash,
        construction, random, 'random');
      counts[tokenIds.indexOf(result.winnerTokenId)] += 1;
    }
    const closedForm = applyTournamentReweighting(
      probabilities,
      tokenIds.map((tokenId) =>
        [construction.gValue(accumulateHash(contextHash, [tokenId]), keys[0])]),
      1,
    ).probabilities;
    expect(totalVariationDistance(counts.map((c) => c / trials), closedForm)).toBeLessThan(0.02);
  });
});

describe('the bracket code path', () => {
  it('honours every tie-break rule in the bracket itself, not just in the enumeration', () => {
    // The enumeration above tests the idea. This tests the code path: an earlier edit
    // declared 'lowestTokenId' in the type and left the bracket falling through to the
    // coin, and the enumeration test could not have noticed.
    const { tokenIds, probabilities } = candidatesOf(highEntropy);
    const keys = [654];
    const contextHash = accumulateHash(
      construction.chainSeed(keys), highEntropy.context_token_ids.slice(-4));

    const winners = (tieBreak: 'random' | 'left' | 'lowestTokenId') => {
      const counts = new Array(tokenIds.length).fill(0);
      const random = makeRandom(31337);
      for (let trial = 0; trial < 8000; trial++) {
        const result = runBracket(probabilities, tokenIds, keys, contextHash,
          construction, random, tieBreak);
        counts[tokenIds.indexOf(result.winnerTokenId)] += 1;
      }
      return counts.map((count) => count / 8000);
    };

    const identity = winners('lowestTokenId');
    const coin = winners('random');
    // A token-identity rule is not a coin, and the bracket must be able to tell them apart.
    expect(totalVariationDistance(identity, coin)).toBeGreaterThan(0.05);
  });
});

describe('the reweighting itself', () => {
  it('keeps the distribution normalized at every layer', () => {
    const { tokenIds, probabilities } = candidatesOf(highEntropy);
    const keys = [654, 400, 836, 123, 340];
    const contextHash = accumulateHash(
      construction.chainSeed(keys), highEntropy.context_token_ids.slice(-4));
    const gValues = tokenIds.map((tokenId) =>
      keys.map((key) => construction.gValue(accumulateHash(contextHash, [tokenId]), key)));
    const result = applyTournamentReweighting(probabilities, gValues, keys.length);
    for (const layer of result.layers) {
      // The reweighting preserves the total exactly in arithmetic and approximately in
      // floating point; the reference implementation does not renormalize either.
      expect(layer.probabilities.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    }
  });

  it('never assigns mass to a token the model gave none', () => {
    const probabilities = [0.5, 0.5, 0];
    const gValues = [[1], [0], [1]];
    const result = applyTournamentReweighting(probabilities, gValues, 1);
    expect(result.probabilities[2]).toBe(0);
  });

  it('moves a low-entropy distribution far less than a high-entropy one', () => {
    // Act III's claim, as a measurement: when one token holds most of the mass there is
    // little for keyed selection to select between.
    const keys = [654, 400, 836];
    const shift = (dist: typeof highEntropy) => {
      const { tokenIds, probabilities } = candidatesOf(dist);
      const contextHash = accumulateHash(
        construction.chainSeed(keys), dist.context_token_ids.slice(-4));
      const gValues = tokenIds.map((tokenId) =>
        keys.map((key) => construction.gValue(accumulateHash(contextHash, [tokenId]), key)));
      const result = applyTournamentReweighting(probabilities, gValues, keys.length);
      return totalVariationDistance(probabilities, result.probabilities);
    };
    expect(shift(lowEntropy)).toBeLessThan(shift(highEntropy));
  });
});

describe('the reference expectation', () => {
  it('reproduces expected_mean_g_value for a uniform distribution', () => {
    // google-deepmind/synthid-text g_value_expectations: 0.5 + 0.25 * (1 - 1/V).
    expect(expectedMeanGValue(2)).toBeCloseTo(0.625, 12);
    expect(expectedMeanGValue(50257)).toBeCloseTo(0.5 + 0.25 * (1 - 1 / 50257), 12);
  });

  it('is an upper bound this lab does not reach, because GPT-2 is not uniform', () => {
    // Stated as a measurement rather than as an aside: the single-layer expectation
    // assumes a uniform model distribution, and a real one is nowhere near that.
    const { probabilities } = candidatesOf(highEntropy);
    expect(shannonEntropyBits(probabilities))
      .toBeLessThan(Math.log2(probabilities.length));
    expect(effectiveCandidates(probabilities)).toBeLessThan(probabilities.length);
  });
});
