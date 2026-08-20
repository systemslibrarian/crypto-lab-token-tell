/**
 * One score, with everything needed to read it.
 *
 * The brief this lab was built to is explicit that a bare number is not a result. So a
 * score never appears on this page without: the null it is being compared against, the
 * number of positions behind it, the positions that were dropped and why, the decision
 * threshold, and where that threshold came from.
 *
 * That produced one card carrying fifteen equal-weight rows, which is the right instrument
 * for an auditor working through Act II and the wrong one for the first thing a visitor
 * sees: the verdict had to compete with the count of positions dropped after an
 * end-of-text token. So there are two forms of the same card and one body of evidence
 * behind both. `renderScoreCard` is unchanged — the full trail, in the order it was always
 * printed. `renderResultCard` promotes the verdict, the mean, the threshold and the
 * p-value, and puts every remaining row and both caveats behind a disclosure. Nothing is
 * dropped in either form; the summary form only decides what a reader meets first.
 */

import nullCorpus from '../data/pinned/null-corpus.json';
import { binomialUpperTail, normalApproximation } from '../watermark/frequentist.ts';
import type { ScoreResult } from '../watermark/score.ts';
import { NULL_EXPECTED_MEAN } from '../watermark/score.ts';
import {
  disclosure, el, fixed, integer, provenanceTag, pValue, readout, srOnly, verdict,
} from './dom.ts';
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

/**
 * The two null tests behind one score, computed once.
 *
 * The exact tail is a walk over the binomial, and the summary card asks for it twice — once
 * for the figure it promotes and once for the row inside the calculation trail, which is
 * built eagerly so the claims suite can read it through a closed disclosure. Two identical
 * walks per card, three cards, on every render is a measurable share of the hero's first
 * paint, and the second walk cannot disagree with the first if there is only one.
 */
interface Statistics {
  readonly exact: ReturnType<typeof binomialUpperTail> | null;
  readonly approximation: ReturnType<typeof normalApproximation> | null;
}

function statistics(result: ScoreResult): Statistics {
  if (result.score === null) return { exact: null, approximation: null };
  return {
    exact: binomialUpperTail(result.gSum, result.gValueCount),
    approximation: normalApproximation(result.score, result.scoredPositions, result.depth),
  };
}

/**
 * Every statistic behind one score, in the order it has always been printed.
 *
 * Shared by both card forms rather than written twice: the summary card hides these rows
 * behind a disclosure, and a second copy of the list would eventually disagree with the
 * first about what the full card claims.
 */
function statisticRows(
  result: ScoreResult,
  threshold: ThresholdInfo,
  empirical?: ScoreCardOptions['empirical'],
  computed?: Statistics,
): [string, string][] {
  const { exact, approximation } = computed ?? statistics(result);

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

  if (empirical) {
    rows.push(['Wrong-key null: draws', integer(empirical.samples)]);
    rows.push(['Wrong-key null: mean', fixed(empirical.mean)]);
    rows.push(['Wrong-key null: sd', fixed(empirical.sd, 5)]);
    rows.push(['Wrong keys scoring this high', integer(empirical.atOrAbove)]);
    rows.push(['Empirical p-value', empirical.pValue.toPrecision(3)]);
  }

  return rows;
}

/** Where the threshold came from, and what the normal approximation assumed to get z. */
function provenanceNote(threshold: ThresholdInfo): HTMLElement {
  return el('p', { class: 'note' }, [
    `Threshold source: ${threshold.source}. `,
    'Every threshold on this page is specific to this configuration. ',
    'The standard error and z are computed on the assumption that the counted ' +
      'g-values are independent fair coins; the paper argues that repeated-context ' +
      'masking makes them so, and the wrong-key null measured on this page is how that ' +
      'assumption gets checked rather than inherited.',
  ]);
}

export function renderScoreCard(
  result: ScoreResult,
  options: ScoreCardOptions,
): HTMLElement {
  const threshold = thresholdForLength(result.tokenCount);
  const decision = scoreVerdict(result, threshold);

  return el('div', {}, [
    el('div', { class: 'panel-title' }, [
      options.subject,
      provenanceTag('paper', 'mean g-score'),
    ]),
    el('p', { class: 'note', text: `${options.keyDescription} · ${options.constructionLabel}` }),
    verdict(decision.tone, decision.label, decision.detail),
    readout(statisticRows(result, threshold, options.empirical), `${options.subject} statistics`),
    provenanceNote(threshold),
  ]);
}

export interface ResultCardOptions extends ScoreCardOptions {
  /** The scenario in the fewest words that still tell it from the other two. */
  readonly headline: string;
  /** One sentence: what this run changed, and what it holds in common with the others. */
  readonly change: string;
}

/**
 * A summary card and the handle a staged reveal needs.
 *
 * The scenario name stays on screen while the rest of the card is held back, so a replay
 * shows three named boxes filling in rather than three boxes appearing out of nothing.
 * `body` is therefore everything downstream of the name, handed back rather than found
 * again with a selector that would silently stop matching the day the card is restructured.
 */
export interface ResultCard {
  readonly node: HTMLElement;
  readonly body: HTMLElement;
  /**
   * The promoted mean, handed back for the same reason `body` is: the hero has to know
   * whether the decisive figure ended up below the fold before it decides where to leave
   * the page, and a selector for it would stop matching without saying so.
   */
  readonly figure: HTMLElement;
}

/**
 * One figure, at the weight its role deserves: the mean is the decisive one and is marked
 * as such, the threshold and the p-value are what make it readable, and everything else is
 * a click away rather than a scroll away.
 *
 * A definition pair rather than two spans, for the same reason `readout` is one: these are
 * labels and values, a reader hears them as pairs, and the grouping element the list
 * allows means the pair still reads as a pair before anyone has styled it.
 */
function metric(label: string, value: string, major = false): HTMLElement {
  return el('div', { class: major ? 'result-metric result-metric-major' : 'result-metric' }, [
    el('dt', { class: 'result-metric-label', text: label }),
    el('dd', { class: 'result-metric-value', text: value }),
  ]);
}

export function renderResultCard(result: ScoreResult, options: ResultCardOptions): ResultCard {
  const threshold = thresholdForLength(result.tokenCount);
  const decision = scoreVerdict(result, threshold);
  const computed = statistics(result);
  const { exact } = computed;

  const call = verdict(decision.tone, decision.label, decision.detail);
  call.classList.add('result-verdict');

  const figure = metric('Mean g-score', fixed(result.score), true);

  // Three of these cards stand side by side, so three controls called nothing but "Show
  // calculation" is what a screen reader's control list gets: the page's central result,
  // three times, told apart by tab order alone. The scenario is added for a reader who
  // hears the name and not the headline above it; the visible label is left as it was, so
  // the visible string stays a prefix of the accessible one and the three cards keep the
  // same shape at every width.
  //
  // Eager, not lazy: the claims suite re-derives the mean from the sum and the count
  // through this closed summary, and a body built on first open reads as an empty string.
  const calculation = disclosure('Show calculation', () => [
    el('p', { class: 'note', text: `${options.subject} · ${options.constructionLabel}` }),
    readout(statisticRows(result, threshold, options.empirical, computed),
      `${options.subject} statistics`),
    provenanceNote(threshold),
  ], { class: 'result-calculation', eager: true });
  calculation.querySelector('summary')?.append(srOnly(` · ${options.headline}`));

  const body = el('div', { class: 'result-body' }, [
    call,
    el('dl', { class: 'result-metrics' }, [
      figure,
      metric(
        `Threshold at FPR ${(threshold.falsePositiveRate * 100).toFixed(0)}%`,
        threshold.value === null ? 'not measured at this length' : fixed(threshold.value),
      ),
      metric(
        'p-value (exact tail)',
        exact === null ? 'no score to test' : pValue(exact.pValue, exact.log10PValue),
      ),
    ]),
    el('p', { class: 'result-change', text: options.change }),
    calculation,
  ]);

  return {
    node: el('div', { class: 'result-card' }, [
      el('div', { class: 'panel-title' }, [
        options.headline,
        provenanceTag('paper', 'mean g-score'),
      ]),
      el('p', { class: 'result-scope', text: options.keyDescription }),
      body,
    ]),
    body,
    figure,
  };
}
