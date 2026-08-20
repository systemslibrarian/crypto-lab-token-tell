/**
 * The population estimator, checked against facts that are not this code.
 *
 * The Wilson interval is checked twice over: against published values for small counts,
 * and against its own defining equation — an endpoint p satisfies |p̂ − p| = z·√(p(1−p)/n),
 * which is the equation the closed form solves and a different statement from the closed
 * form itself.
 *
 * The prevalence correction is checked by construction: a corpus of known composition is
 * flagged at exactly the two rates the detector is declared to have, and the estimator has
 * to return the composition it was built from.
 */

import { describe, expect, it } from 'vitest';

import {
  estimateMarkedFraction, operatingPoint, wilsonInterval, Z_95,
} from './aggregate.ts';

/** The equation the Wilson interval solves, evaluated at an endpoint. */
function residual(endpoint: number, successes: number, trials: number): number {
  const rate = successes / trials;
  return Math.abs(rate - endpoint) - Z_95 * Math.sqrt((endpoint * (1 - endpoint)) / trials);
}

describe('the Wilson score interval', () => {
  it('reproduces published values', () => {
    // Textbook cases: 5 of 10 and 0 of 10 at 95%.
    const half = wilsonInterval(5, 10);
    expect(half.low).toBeCloseTo(0.236593, 6);
    expect(half.high).toBeCloseTo(0.763407, 6);

    const none = wilsonInterval(0, 10);
    expect(none.low).toBe(0);
    expect(none.high).toBeCloseTo(0.277533, 6);
  });

  it('satisfies its own defining equation at both endpoints', () => {
    for (const [successes, trials] of [[1, 20], [40, 256], [77, 256], [13, 47]]) {
      const interval = wilsonInterval(successes, trials);
      expect(residual(interval.low, successes, trials)).toBeCloseTo(0, 12);
      expect(residual(interval.high, successes, trials)).toBeCloseTo(0, 12);
    }
  });

  it('never leaves [0, 1], where the normal interval would', () => {
    // 0 of 32 and 32 of 32: the Wald interval is a single point at either end, and claims
    // certainty from a sample that saw nothing of one class.
    expect(wilsonInterval(0, 32).low).toBe(0);
    expect(wilsonInterval(0, 32).high).toBeGreaterThan(0);
    expect(wilsonInterval(32, 32).high).toBe(1);
    expect(wilsonInterval(32, 32).low).toBeLessThan(1);
  });

  it('narrows as the sample grows, at a fixed rate', () => {
    const widths = [16, 64, 256, 1024].map((n) => {
      const interval = wilsonInterval(n / 2, n);
      return interval.high - interval.low;
    });
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeLessThan(widths[i - 1]);
    // Four times the sample, half the width: the ratio is 2 in the limit and is already
    // within a few percent of it here.
    expect(widths[0] / widths[2]).toBeGreaterThan(1.8);
    expect(widths[1] / widths[3]).toBeGreaterThan(1.9);
  });

  it('reports the whole range when there is nothing to go on', () => {
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 });
  });
});

describe('the operating point', () => {
  // Twenty unmarked scores, evenly spaced, and twenty marked ones shifted up.
  const unmarked = Array.from({ length: 20 }, (_, i) => 0.50 + i * 0.001);
  const marked = Array.from({ length: 20 }, (_, i) => 0.51 + i * 0.001);

  it('places the threshold at the allowed number of exceedances', () => {
    // 10% of 20 is 2, so the threshold is the second largest unmarked score and exactly
    // two unmarked scores sit at or above it.
    const point = operatingPoint(unmarked, marked, 0.1);
    expect(point?.threshold).toBeCloseTo(0.518, 12);
    expect(point?.falsePositiveRate).toBeCloseTo(2 / 20, 12);
  });

  it('measures the realised rate rather than assuming the one asked for', () => {
    // Every unmarked score identical: one threshold, and every document is above it,
    // whatever rate was requested.
    const tied = Array.from({ length: 20 }, () => 0.5);
    const point = operatingPoint(tied, marked, 0.05);
    expect(point?.falsePositiveRate).toBe(1);
    expect(point?.truePositiveRate).toBe(1);
  });

  it('falls back to the largest score when no exceedance is allowed', () => {
    // 5% of 10 is 0.5, which floors to zero allowed exceedances.
    const point = operatingPoint(unmarked.slice(0, 10), marked, 0.05);
    expect(point?.threshold).toBe(Math.max(...unmarked.slice(0, 10)));
    expect(point?.falsePositiveRate).toBeCloseTo(1 / 10, 12);
  });

  it('has no answer without both classes', () => {
    expect(operatingPoint([], marked, 0.05)).toBeNull();
    expect(operatingPoint(unmarked, [], 0.05)).toBeNull();
  });
});

describe('the prevalence correction', () => {
  const point = {
    threshold: 0.53,
    falsePositiveRate: 0.05,
    truePositiveRate: 0.65,
    unmarkedCalibrationCount: 128,
    markedCalibrationCount: 128,
  };

  it('recovers a composition it was never told', () => {
    // Build the corpus by hand: 300 marked documents flagged at 65%, 700 unmarked flagged
    // at 5%. The estimator sees only the total.
    const marked = 300;
    const unmarked = 700;
    const positives = marked * point.truePositiveRate + unmarked * point.falsePositiveRate;
    const estimate = estimateMarkedFraction(positives, marked + unmarked, point);
    expect(estimate.estimate).toBeCloseTo(0.3, 12);
    expect(estimate.positiveRate).toBeCloseTo(0.23, 12);
  });

  it('is the identity for a detector that never errs', () => {
    const perfect = { ...point, falsePositiveRate: 0, truePositiveRate: 1 };
    const estimate = estimateMarkedFraction(41, 100, perfect);
    expect(estimate.estimate).toBeCloseTo(0.41, 12);
    expect(estimate.interval?.low).toBeCloseTo(wilsonInterval(41, 100).low, 12);
    expect(estimate.interval?.high).toBeCloseTo(wilsonInterval(41, 100).high, 12);
  });

  it('reports nothing when the two rates do not separate', () => {
    const useless = { ...point, truePositiveRate: point.falsePositiveRate };
    const estimate = estimateMarkedFraction(10, 100, useless);
    expect(estimate.estimate).toBeNull();
    expect(estimate.interval).toBeNull();
    expect(estimate.halfWidth).toBeNull();
  });

  it('magnifies sampling error by the reciprocal of the separation', () => {
    // The same observed count through two detectors: one that separates the classes by
    // 0.6 and one that separates them by 0.15. The interval is four times as wide.
    const wide = estimateMarkedFraction(10, 100, { ...point, truePositiveRate: 0.65 });
    const narrow = estimateMarkedFraction(10, 100, { ...point, truePositiveRate: 0.2 });
    const ratio = (narrow.halfWidth ?? 0) / (wide.halfWidth ?? 1);
    expect(ratio).toBeCloseTo(0.6 / 0.15, 6);
  });

  it('clamps out of the range and says that it did', () => {
    // Fewer flags than the false-positive rate alone would produce: the uncorrected
    // answer is negative, and a negative fraction of a corpus is not an answer.
    const estimate = estimateMarkedFraction(1, 100, point);
    expect(estimate.estimate).toBe(0);
    expect(estimate.clamped).toBe(true);
    expect(estimate.interval?.low).toBe(0);
  });

  it('has no answer for an empty corpus', () => {
    const estimate = estimateMarkedFraction(0, 0, point);
    expect(estimate.estimate).toBeNull();
    expect(estimate.interval).toBeNull();
  });

  it('closes the interval as the corpus grows at a fixed composition', () => {
    const halfWidths = [32, 128, 512, 2048].map((documents) => {
      const positives = documents * (0.3 * point.truePositiveRate + 0.7 * point.falsePositiveRate);
      return estimateMarkedFraction(positives, documents, point).halfWidth ?? 0;
    });
    for (let i = 1; i < halfWidths.length; i++) {
      expect(halfWidths[i]).toBeLessThan(halfWidths[i - 1]);
    }
    // The estimate itself does not move: only the interval does.
    const estimates = [32, 2048].map((documents) => {
      const positives = documents * (0.3 * point.truePositiveRate + 0.7 * point.falsePositiveRate);
      return estimateMarkedFraction(positives, documents, point).estimate;
    });
    expect(estimates[0]).toBeCloseTo(estimates[1] ?? 0, 12);
  });
});
