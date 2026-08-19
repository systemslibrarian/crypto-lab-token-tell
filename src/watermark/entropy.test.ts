/**
 * The entropy measures, and the error paths around them.
 *
 * These functions decide what Act III claims about how much freedom the model had, and
 * until now they were exercised only by the page. Every expectation here is computed by
 * hand or is a closed-form value, not re-derived from the implementation.
 */

import { describe, expect, it } from 'vitest';

import distributions from '../data/pinned/distributions.json';
import {
  collisionProbability, effectiveCandidates, renormalize, shannonEntropyBits, topMass,
} from './entropy.ts';

describe('Shannon entropy', () => {
  it('is zero when one outcome is certain', () => {
    expect(shannonEntropyBits([1, 0, 0])).toBe(0);
  });

  it('is log2(n) for a uniform distribution', () => {
    expect(shannonEntropyBits([0.25, 0.25, 0.25, 0.25])).toBeCloseTo(2, 12);
    expect(shannonEntropyBits(new Array(8).fill(1 / 8))).toBeCloseTo(3, 12);
  });

  it('matches a hand-computed mixed case', () => {
    // -(0.5 log2 0.5 + 0.25 log2 0.25 + 0.25 log2 0.25) = 0.5 + 0.5 + 0.5
    expect(shannonEntropyBits([0.5, 0.25, 0.25])).toBeCloseTo(1.5, 12);
  });

  it('ignores zero-probability entries rather than producing NaN', () => {
    expect(shannonEntropyBits([0.5, 0.5, 0, 0])).toBeCloseTo(1, 12);
    expect(Number.isNaN(shannonEntropyBits([1]))).toBe(false);
  });
});

describe('effective candidates', () => {
  it('is the perplexity, so a uniform distribution over n reports n', () => {
    expect(effectiveCandidates([0.25, 0.25, 0.25, 0.25])).toBeCloseTo(4, 10);
  });

  it('is one when the outcome is certain', () => {
    expect(effectiveCandidates([1])).toBeCloseTo(1, 12);
  });

  it('is strictly fewer than the candidate count for a real pinned distribution', () => {
    const probabilities = distributions.distributions.high_entropy.candidates
      .map((candidate) => candidate.probability);
    expect(effectiveCandidates(probabilities)).toBeLessThan(probabilities.length);
    expect(effectiveCandidates(probabilities)).toBeGreaterThan(1);
  });
});

describe('top mass', () => {
  it('is the largest probability, wherever it sits', () => {
    expect(topMass([0.1, 0.7, 0.2])).toBeCloseTo(0.7, 12);
    expect(topMass([0.7, 0.1, 0.2])).toBeCloseTo(0.7, 12);
  });

  it('is zero for an empty distribution rather than -Infinity', () => {
    expect(topMass([])).toBe(0);
  });
});

describe('collision probability', () => {
  it('is 1/n for a uniform distribution', () => {
    expect(collisionProbability([0.25, 0.25, 0.25, 0.25])).toBeCloseTo(0.25, 12);
  });

  it('is one when a single token holds all the mass', () => {
    // The case that matters: every tournament match is then a tie between identical
    // tokens, and the key decides nothing at all.
    expect(collisionProbability([1, 0, 0])).toBeCloseTo(1, 12);
  });

  it('is higher for the low-entropy pinned context than the high-entropy one', () => {
    const of = (name: 'high_entropy' | 'low_entropy') =>
      collisionProbability(distributions.distributions[name].candidates
        .map((candidate) => candidate.probability));
    expect(of('low_entropy')).toBeGreaterThan(of('high_entropy'));
  });
});

describe('renormalization', () => {
  it('scales weights to sum to one', () => {
    const result = renormalize([1, 1, 2]);
    expect(result.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(result[2]).toBeCloseTo(0.5, 12);
  });

  it('refuses a distribution with no mass rather than returning NaN', () => {
    expect(() => renormalize([0, 0])).toThrow(/no mass/);
    expect(() => renormalize([])).toThrow(/no mass/);
  });
});
