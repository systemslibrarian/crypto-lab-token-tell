/**
 * One score, with everything needed to read it.
 *
 * The brief this lab was built to is explicit that a bare number is not a result. So a
 * score never appears on this page without: the null it is being compared against, the
 * number of positions behind it, the positions that were dropped and why, the decision
 * threshold, and where that threshold came from.
 */

import nullCorpus from '../data/pinned/null-corpus.json';
import { binomialUpperTail, normalApproximation } from '../watermark/frequentist.ts';
import type { ScoreResult } from '../watermark/score.ts';
import { NULL_EXPECTED_MEAN } from '../watermark/score.ts';
import { el, fixed, integer, provenanceTag, pValue, readout, verdict } from './dom.ts';
import type { VerdictTone } from './dom.ts';

export interface ThresholdInfo {
  readonly value: number | null;
  readonly measuredAtLength: number | null;
  readonly falsePositiveRate: number;
  readonly source: string;
}

type ByLength = Record<string, {
  tokens: number;
  null_sample_count: number;
  null_mean: number | null;
  null_sd: number | null;
  threshold_fpr_1_percent: number | null;
  threshold_fpr_5_percent: number | null;
}>;

/**
 * The decision threshold for a text of this length.
 *
 * Taken from the pinned corpus null: the top 1% of scores from unwatermarked texts of the
 * nearest length at or below this one. It is an empirical construction of this lab, for
 * this configuration, this model and this corpus. No primary source supplies a numeric
 * threshold, and this lab does not pretend otherwise.
 */
export function thresholdForLength(tokenCount: number, fpr: 0.01 | 0.05 = 0.01): ThresholdInfo {
  const byLength = nullCorpus.by_length as unknown as ByLength;
  const lengths = Object.values(byLength)
    .map((entry) => entry.tokens)
    .sort((a, b) => a - b);
  const eligible = lengths.filter((length) => length <= tokenCount);
  const chosen = eligible.length ? eligible[eligible.length - 1] : null;
  if (chosen === null) {
    return {
      value: null,
      measuredAtLength: null,
      falsePositiveRate: fpr,
      source: `shorter than the shortest length measured (${lengths[0]} tokens)`,
    };
  }
  const entry = byLength[String(chosen)];
  const value = fpr === 0.01 ? entry.threshold_fpr_1_percent : entry.threshold_fpr_5_percent;
  return {
    value,
    measuredAtLength: chosen,
    falsePositiveRate: fpr,
    source:
      `top ${(fpr * 100).toFixed(0)}% of ${entry.null_sample_count} unwatermarked texts ` +
      `of ${chosen} tokens, scored with this configuration`,
  };
}

export interface ScoreCardOptions {
  /** What was scored, in words. */
  readonly subject: string;
  /** Shown next to the verdict; keeps the reader oriented about which key ran. */
  readonly keyDescription: string;
  readonly constructionLabel: string;
  /** Optional empirical comparison from a live wrong-key run. */
  readonly empirical?: {
    readonly samples: number;
    readonly mean: number;
    readonly sd: number;
    readonly atOrAbove: number;
    readonly pValue: number;
  };
}

export function scoreVerdict(result: ScoreResult, threshold: ThresholdInfo): {
  tone: VerdictTone;
  label: string;
  detail: string;
} {
  if (result.score === null) {
    return {
      tone: 'none',
      label: 'No score',
      detail:
        `Too short to score: ${result.tokenCount} tokens leaves no position with a full ` +
        'context window.',
    };
  }
  if (threshold.value === null) {
    return {
      tone: 'caution',
      label: 'Below the measured range',
      detail:
        'This length is shorter than anything in the pinned null, so this lab has no ' +
        'threshold for it and will not invent one.',
    };
  }
  if (result.score >= threshold.value) {
    return {
      tone: 'evidence',
      label: 'Evidence for this key',
      detail:
        `${fixed(result.score)} is at or above the ${(threshold.falsePositiveRate * 100).toFixed(0)}% ` +
        `false-positive threshold of ${fixed(threshold.value)} for this configuration. ` +
        'That is evidence about this watermark configuration, not about who wrote the text.',
    };
  }
  return {
    tone: 'none',
    label: 'No evidence for this key',
    detail:
      `${fixed(result.score)} is below the ${(threshold.falsePositiveRate * 100).toFixed(0)}% ` +
      `false-positive threshold of ${fixed(threshold.value)}. This is not evidence that a ` +
      'human wrote it, and not evidence that no other watermark is present.',
  };
}

export function renderScoreCard(
  result: ScoreResult,
  options: ScoreCardOptions,
): HTMLElement {
  const threshold = thresholdForLength(result.tokenCount);
  const decision = scoreVerdict(result, threshold);
  const approximation = result.score === null
    ? null
    : normalApproximation(result.score, result.scoredPositions, result.depth);
  const exact = result.score === null
    ? null
    : binomialUpperTail(result.gSum, result.gValueCount);

  const rows: [string, string][] = [
    ['Mean g-score', fixed(result.score)],
    ['Expected under no mark', fixed(NULL_EXPECTED_MEAN, 3)],
    ['Tokens', integer(result.tokenCount)],
    ['Candidate positions', integer(result.candidatePositions)],
    ['Scored positions', integer(result.scoredPositions)],
    ['Skipped: repeated context', integer(result.maskedRepeatedContext)],
    ['Skipped: after end-of-text', integer(result.maskedAfterEos)],
    ['Tournament layers (depth)', integer(result.depth)],
    ['g-values behind the mean', integer(result.gValueCount)],
    ['Sum of counted g-values', integer(result.gSum)],
  ];

  if (exact) {
    rows.push(['Exact null', `Binomial(${integer(exact.trials)}, 1/2)`]);
    rows.push(['p-value (exact tail)', pValue(exact.pValue, exact.log10PValue)]);
  }
  if (approximation) {
    rows.push(['Standard error if independent', fixed(approximation.standardError, 5)]);
    rows.push(['z on that assumption', fixed(approximation.z, 2)]);
  }
  rows.push([
    `Threshold at FPR ${(threshold.falsePositiveRate * 100).toFixed(0)}%`,
    threshold.value === null ? 'not measured at this length' : fixed(threshold.value),
  ]);

  if (options.empirical) {
    rows.push(['Wrong-key null: draws', integer(options.empirical.samples)]);
    rows.push(['Wrong-key null: mean', fixed(options.empirical.mean)]);
    rows.push(['Wrong-key null: sd', fixed(options.empirical.sd, 5)]);
    rows.push(['Wrong keys scoring this high', integer(options.empirical.atOrAbove)]);
    rows.push(['Empirical p-value', options.empirical.pValue.toPrecision(3)]);
  }

  return el('div', {}, [
    el('div', { class: 'panel-title' }, [
      options.subject,
      provenanceTag('paper', 'mean g-score'),
    ]),
    el('p', { class: 'note', text: `${options.keyDescription} · ${options.constructionLabel}` }),
    verdict(decision.tone, decision.label, decision.detail),
    readout(rows, `${options.subject} statistics`),
    el('p', { class: 'note' }, [
      `Threshold source: ${threshold.source}. `,
      'Every threshold on this page is specific to this configuration. ',
      'The standard error and z are computed on the assumption that the counted ' +
        'g-values are independent fair coins; the paper argues that repeated-context ' +
        'masking makes them so, and the wrong-key null measured on this page is how that ' +
        'assumption gets checked rather than inherited.',
    ]),
  ]);
}
