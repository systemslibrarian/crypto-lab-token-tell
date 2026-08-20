/**
 * Population-level estimation from a detector that is weak on any single document.
 *
 * Every other statistic in this lab answers a question about one text. This file answers a
 * different one: given a pile of documents and a detector with a known error profile, what
 * fraction of the pile carries the mark? That question survives the limitations the rest
 * of the page demonstrates, because the errors it makes are the errors it is corrected
 * for — a false-positive rate that is stable is not noise, it is a known offset.
 *
 * Two pieces of arithmetic, both older than any of this:
 *
 *   - the prevalence correction of Rogan and Gladen (1978), which inverts the observed
 *     positive rate through the detector's own sensitivity and specificity;
 *   - the score interval of Wilson (1927), which is what puts the error bar on the
 *     observed rate before that inversion — chosen over the textbook normal interval
 *     because these counts are small and the rate sits near an end of its range often
 *     enough that the normal interval would run outside [0, 1] and say so with a straight
 *     face.
 *
 * What this file does NOT do is decide anything about a document. Nothing here takes a
 * verdict on one text; the input is a count of positives, and the output is a statement
 * about a corpus with an interval attached. That distinction is the entire point of the
 * act it serves.
 */

/** A closed interval, in the units of whatever produced it. */
export interface Interval {
  readonly low: number;
  readonly high: number;
}

/**
 * The two-sided normal quantile for 95% coverage.
 *
 * Written out rather than derived: an inverse normal CDF would be a fourth approximation
 * in a file whose whole subject is not overstating precision, and every interval this lab
 * draws is a 95% one.
 */
export const Z_95 = 1.959963984540054;

/**
 * The Wilson score interval for a binomial proportion.
 *
 * Solves |p̂ − p| = z·√(p(1−p)/n) for p rather than substituting p̂ into the standard error
 * and adding, which is what the normal ("Wald") interval does. The difference matters here
 * exactly where this lab operates: at n = 32 and zero positives the Wald interval is the
 * single point 0, which is a claim of certainty from a sample that saw nothing.
 *
 * Zero trials has no answer and is reported as the whole range rather than as a division
 * by zero dressed up as a number.
 */
export function wilsonInterval(successes: number, trials: number, z: number = Z_95): Interval {
  if (!Number.isFinite(trials) || trials <= 0) return { low: 0, high: 1 };
  const n = trials;
  const rate = successes / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const centre = (rate + z2 / (2 * n)) / denominator;
  const spread = (z / denominator) * Math.sqrt((rate * (1 - rate)) / n + z2 / (4 * n * n));
  return {
    low: Math.max(0, centre - spread),
    high: Math.min(1, centre + spread),
  };
}

/**
 * A detector reduced to the three numbers a population estimate needs.
 *
 * `falsePositiveRate` and `truePositiveRate` are measurements, not settings: they are what
 * the threshold did on a calibration corpus, which is why they travel together with it.
 */
export interface OperatingPoint {
  /** Scores at or above this count as positive. */
  readonly threshold: number;
  /** Unmarked calibration documents at or above the threshold, as a fraction. */
  readonly falsePositiveRate: number;
  /** Marked calibration documents at or above the threshold, as a fraction. */
  readonly truePositiveRate: number;
  readonly unmarkedCalibrationCount: number;
  readonly markedCalibrationCount: number;
}

/**
 * Choose a threshold from unmarked calibration scores, then measure what it does.
 *
 * The threshold is the ⌊f·n⌋-th largest unmarked score, so at most that many calibration
 * documents sit at or above it — the same construction the pinned corpus uses, applied to
 * a set this page can enlarge. Below one allowed exceedance the rule has nothing to place,
 * and the largest score is used instead: the realised rate is then 1/n, which is reported
 * rather than the rate that was asked for.
 *
 * Ties are why the realised rate is measured rather than assumed equal to `targetFpr`. Two
 * documents can share a score, and then a threshold placed for six exceedances gets seven.
 */
export function operatingPoint(
  unmarkedScores: readonly number[],
  markedScores: readonly number[],
  targetFpr: number,
): OperatingPoint | null {
  if (unmarkedScores.length === 0 || markedScores.length === 0) return null;
  const descending = [...unmarkedScores].sort((a, b) => b - a);
  const allowed = Math.floor(targetFpr * descending.length);
  const threshold = allowed >= 1 ? descending[allowed - 1] : descending[0];
  const atOrAbove = (scores: readonly number[]): number =>
    scores.filter((score) => score >= threshold).length;
  return {
    threshold,
    falsePositiveRate: atOrAbove(unmarkedScores) / unmarkedScores.length,
    truePositiveRate: atOrAbove(markedScores) / markedScores.length,
    unmarkedCalibrationCount: unmarkedScores.length,
    markedCalibrationCount: markedScores.length,
  };
}

/** What a corpus-level estimate reports, including the reasons it might report nothing. */
export interface PrevalenceEstimate {
  readonly documents: number;
  readonly positives: number;
  /** The raw fraction of documents the detector flagged, before any correction. */
  readonly positiveRate: number;
  /** The corrected estimate of the marked fraction, or null when it is not identifiable. */
  readonly estimate: number | null;
  readonly interval: Interval | null;
  /** Half the interval's width, which is the number the convergence claim is about. */
  readonly halfWidth: number | null;
  /**
   * True when the estimate or an interval endpoint was pushed back into [0, 1]. A clamped
   * endpoint is a real answer — the fraction cannot be negative — but it is not a
   * symmetric error bar any more, and a page that draws one has to know which.
   */
  readonly clamped: boolean;
}

/**
 * Invert an observed positive rate through the detector's error rates.
 *
 * Rogan and Gladen: an observed rate p is a mixture of the marked fraction π detected at
 * the true-positive rate and the unmarked remainder flagged at the false-positive rate,
 *
 *     p = π·TPR + (1 − π)·FPR   ⟹   π̂ = (p − FPR) / (TPR − FPR).
 *
 * The denominator is the detector's whole worth as a measuring instrument: it is how far
 * apart the two rates are, and a detector whose rates coincide measures nothing however
 * many documents it is given. That case returns null rather than a very large number.
 *
 * The interval is the Wilson interval on the observed count carried through the same
 * transform. It covers sampling error in the corpus and nothing else — in particular not
 * the error in TPR and FPR themselves, which are estimated from a finite calibration set.
 * The act that draws this states that limit next to the drawing.
 */
export function estimateMarkedFraction(
  positives: number,
  documents: number,
  point: OperatingPoint,
  z: number = Z_95,
): PrevalenceEstimate {
  const positiveRate = documents > 0 ? positives / documents : Number.NaN;
  const separation = point.truePositiveRate - point.falsePositiveRate;
  if (documents <= 0 || separation <= 0) {
    return {
      documents,
      positives,
      positiveRate,
      estimate: null,
      interval: null,
      halfWidth: null,
      clamped: false,
    };
  }
  const correct = (rate: number): number => (rate - point.falsePositiveRate) / separation;
  const raw = correct(positiveRate);
  const rawInterval = wilsonInterval(positives, documents, z);
  const low = correct(rawInterval.low);
  const high = correct(rawInterval.high);
  const clamp = (value: number): number => Math.min(1, Math.max(0, value));
  const interval = { low: clamp(low), high: clamp(high) };
  return {
    documents,
    positives,
    positiveRate,
    estimate: clamp(raw),
    interval,
    halfWidth: (interval.high - interval.low) / 2,
    clamped: raw !== clamp(raw) || low !== interval.low || high !== interval.high,
  };
}
