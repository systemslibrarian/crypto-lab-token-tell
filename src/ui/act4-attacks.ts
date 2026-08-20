/**
 * Act IV — attack it.
 *
 * The experiment measures; it does not confirm. Nothing in this panel is arranged to
 * reach a particular answer, and where a transformation leaves the evidence standing the
 * page says so.
 *
 * Truncation, deletion and replacement are arithmetic on a token list, so they run live
 * here. Back-translation and paraphrase need real models, so they were run once offline
 * against pinned model revisions and the exact inputs and outputs are committed — but the
 * scores below are still recomputed in the browser by the same scorer, not read from the
 * capture.
 *
 * The act leads with the strongest measured result rather than with a button and three
 * hundred pixels of prose: the paraphrase is the attack that decides how this page is
 * read, and it is already computed when the section renders. Which of the two wordings it
 * gets is chosen from the number, not from the expectation — a panel that only knows how
 * to say "the evidence did not survive" is not a measurement.
 */

import attacks from '../data/pinned/attacks.json';
import texts from '../data/pinned/texts.json';
import { defaultConstruction, tokenizer, watermarkParams } from '../lab-config.ts';
import { scoreTokens } from '../watermark/score.ts';
import type { ScoreResult } from '../watermark/score.ts';
import { resetButton, runGuarded } from './busy.ts';
import { lineChart } from './chart.ts';
import {
  actHeader, button, clear, consequence, disclosure, el, fixed, integer, liveRegion,
  nextFrame, panel, provenanceTag, readout, scroller,
} from './dom.ts';
import { thresholdForLength } from './score-card.ts';
import type { ThresholdInfo } from './score-card.ts';

const GPT2_EOS = 50256;
const STRENGTHS = [0.01, 0.05, 0.1, 0.25, 0.5];
const REPEATS = 5;

function makeRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
}

export function renderAct4(root: HTMLElement): void {
  clear(root);
  root.append(...actHeader(
    'act-4',
    'Act IV',
    'Attack it',
    'Every transformation below is scored through the identical detector path, and the ' +
    'measured change is what appears — including where the evidence survives.',
  ));

  const pinned = scorePinnedAttacks();
  const paraphrase = pinned.find((entry) => entry.id === 'paraphrase');
  if (paraphrase) root.append(renderHeadline(paraphrase));

  const pinnedPanel = renderPinnedAttacks(pinned);
  root.append(renderLiveAttacks(pinnedPanel.reset));
  root.append(pinnedPanel.node);
  root.append(renderTheory());
}

/**
 * The one result this act is for: what a real paraphrase model did to the evidence.
 *
 * The score, the score it came down from and the threshold it is being judged against are
 * all stated together, because a number that has moved is not a result until the reader
 * knows what it moved from and what it has to clear.
 */
function renderHeadline(entry: PinnedAttack): HTMLElement {
  const before = entry.before.score;
  const after = entry.after.score;
  const direction = after !== null && before !== null && after < before ? 'down from' : 'from';
  return el('div', { class: 'act-headline' }, [
    el('p', {
      class: 'act-headline-label',
      text: 'What a real paraphrase did to the evidence',
    }),
    el('p', { class: 'act-headline-figure', text: fixed(after) }),
    el('p', {
      class: 'act-headline-detail',
      text: `Mean g-score after the paraphrase, ${direction} ${fixed(before)} before it, ` +
        `against a threshold of ${fixed(entry.threshold.value ?? Number.NaN)} at a 1% ` +
        'false-positive rate.',
    }),
    consequence(
      'Rewrote the text with a real model, keeping the meaning',
      entry.stillDetected
        ? 'the evidence stayed above the threshold.'
        : 'the evidence fell below the threshold and the detector could no longer find it.',
    ),
  ]);
}

interface AttackRun {
  strength: number;
  repeat: number;
  score: number;
  tokensKept: number;
  scoredPositions: number;
}

function renderLiveAttacks(resetPinned: () => void): HTMLElement {
  const output = liveRegion('Attack sweep results');
  const chartHost = el('div');
  const tableHost = el('div');
  const progress = el('p', { class: 'progress', role: 'status', 'aria-live': 'polite' });

  const sweep = async () => {
    clear(output); clear(chartHost); clear(tableHost);
    progress.textContent = 'Sweeping…';
    const tok = tokenizer();
    const original = tok.encode(texts.samples.watermarked.text);
    const baseline = scoreTokens(original, watermarkParams, defaultConstruction, GPT2_EOS);

    const results: Record<string, AttackRun[]> = { truncation: [], deletion: [], replacement: [] };

    for (const strength of STRENGTHS) {
      // Truncation is deterministic, so one run per strength is the whole story.
      const kept = Math.max(0, Math.round(original.length * (1 - strength)));
      const truncated = original.slice(0, kept);
      const truncatedScore = scoreTokens(truncated, watermarkParams, defaultConstruction, GPT2_EOS);
      if (truncatedScore.score !== null) {
        results.truncation.push({
          strength, repeat: 0, score: truncatedScore.score,
          tokensKept: truncated.length, scoredPositions: truncatedScore.scoredPositions,
        });
      }

      for (let repeat = 0; repeat < REPEATS; repeat++) {
        const random = makeRandom(1000 + Math.round(strength * 1000) * 17 + repeat);
        const deleted = original.filter(() => random() >= strength);
        const deletedScore = scoreTokens(deleted, watermarkParams, defaultConstruction, GPT2_EOS);
        if (deletedScore.score !== null) {
          results.deletion.push({
            strength, repeat, score: deletedScore.score,
            tokensKept: deleted.length, scoredPositions: deletedScore.scoredPositions,
          });
        }

        // Replacement draws its substitutes from the text's own vocabulary, so the
        // register and token distribution stay put and only the sequence changes.
        const vocabulary = Array.from(new Set(original));
        const random2 = makeRandom(5000 + Math.round(strength * 1000) * 31 + repeat);
        const replaced = original.map((tokenId) =>
          random2() < strength
            ? vocabulary[Math.floor(random2() * vocabulary.length)]
            : tokenId);
        const replacedScore = scoreTokens(replaced, watermarkParams, defaultConstruction, GPT2_EOS);
        if (replacedScore.score !== null) {
          results.replacement.push({
            strength, repeat, score: replacedScore.score,
            tokensKept: replaced.length, scoredPositions: replacedScore.scoredPositions,
          });
        }
      }
      progress.textContent = `Swept ${Math.round(strength * 100)}% …`;
      await nextFrame();
    }
    progress.textContent = 'Sweep complete.';

    const meanAt = (runs: AttackRun[], strength: number) => {
      const matching = runs.filter((r) => r.strength === strength);
      return matching.reduce((a, r) => a + r.score, 0) / matching.length;
    };

    output.append(readout([
      ['Baseline score, untouched', fixed(baseline.score)],
      ['Baseline scored positions', integer(baseline.scoredPositions)],
      ['Strengths swept', STRENGTHS.map((s) => `${Math.round(s * 100)}%`).join(', ')],
      ['Repeats per random attack', integer(REPEATS)],
      ['Total measurements', integer(Object.values(results).flat().length)],
    ], 'Sweep parameters'));

    chartHost.append(lineChart({
      series: [
        {
          label: 'truncation',
          className: 'series-null',
          points: STRENGTHS.map((s) => ({ x: s * 100, y: meanAt(results.truncation, s) })),
        },
        {
          label: 'deletion',
          className: 'series-wm',
          points: STRENGTHS.map((s) => ({ x: s * 100, y: meanAt(results.deletion, s) })),
        },
        {
          label: 'replacement',
          className: 'marker-alt',
          points: STRENGTHS.map((s) => ({ x: s * 100, y: meanAt(results.replacement, s) })),
        },
      ],
      xLabel: 'percent of tokens transformed',
      yLabel: 'mean g',
      title: 'Score against transformation strength',
      takeaway:
        'What to look for: how far each line has fallen toward 0.5 by the time half the ' +
        'tokens are transformed. That distance is the evidence the attack removed.',
      description:
        'Mean g-score against the fraction of tokens transformed, for truncation ' +
        '(dropping the tail), deletion (dropping tokens at random) and replacement ' +
        '(substituting tokens drawn from the text’s own vocabulary). Points are means ' +
        'over the repeats; the table below carries every individual run, unsmoothed.',
    }));

    const rows = Object.entries(results).flatMap(([attack, runs]) =>
      runs.map((run) => el('tr', {}, [
        el('td', { text: attack }),
        el('td', { class: 'num', text: `${Math.round(run.strength * 100)}%` }),
        el('td', { class: 'num', text: integer(run.repeat + 1) }),
        el('td', { class: 'num', text: integer(run.tokensKept) }),
        el('td', { class: 'num', text: integer(run.scoredPositions) }),
        el('td', { class: 'num', text: fixed(run.score) }),
        el('td', {
          class: 'num',
          text: fixed(run.score - (baseline.score ?? 0.5)),
        }),
      ])));

    tableHost.append(
      el('h4', { text: 'Every measurement, unsmoothed' }),
      scroller('Individual attack runs', [
        el('table', {}, [
          el('thead', {}, [el('tr', {}, [
            el('th', { text: 'Attack' }),
            el('th', { class: 'num', text: 'Strength' }),
            el('th', { class: 'num', text: 'Run' }),
            el('th', { class: 'num', text: 'Tokens' }),
            el('th', { class: 'num', text: 'Scored' }),
            el('th', { class: 'num', text: 'Score' }),
            el('th', { class: 'num', text: 'Change' }),
          ])]),
          el('tbody', {}, rows),
        ]),
      ]),
      el('p', { class: 'note' }, [
        'Truncation and deletion both remove evidence, but they are not the same attack: ' +
        'truncation leaves the surviving context windows intact and simply gives the ' +
        'detector fewer of them, while deletion breaks the windows around every removed ' +
        'token, so a given percentage costs more than the token count suggests. ' +
        'Replacement does both — it breaks windows and it substitutes tokens the key never ' +
        'chose.',
      ]),
    );

    const strongest = STRENGTHS[STRENGTHS.length - 1];
    const deletionMean = meanAt(results.deletion, strongest);
    const moved = deletionMean < (baseline.score ?? 0.5) ? 'fell' : 'rose';
    output.append(consequence(
      `Deleted ${Math.round(strongest * 100)}% of the tokens at random`,
      `the mean score ${moved} from ${fixed(baseline.score)} to ${fixed(deletionMean)}.`,
    ));
  };

  /**
   * The guard disables both controls, marks the results region busy and replaces a
   * half-written sweep with something a reader can act on if the run throws. The progress
   * line stays out of its hands: it ends by saying the sweep completed, and the guard's
   * contract is to empty what it was given the moment the work settles.
   */
  const start = (): Promise<void> => runGuarded(sweep, {
    controls: [runButton, resetControl],
    region: output,
    onError: () => { progress.textContent = ''; },
  });

  const reset = () => {
    clear(output); clear(chartHost); clear(tableHost);
    progress.textContent = '';
    resetPinned();
  };

  const runButton = button('Run the sweep', () => { void start(); }, true);
  const resetControl = resetButton('Reset the attacks', reset);

  return panel('Live attacks: truncation, deletion, replacement', [
    el('p', { class: 'note' }, [
      'These three run in the browser on the pinned watermarked sample. Random attacks are ' +
      `repeated ${integer(REPEATS)} times per strength with different seeds, and every ` +
      'individual run is listed rather than averaged away.',
    ]),
    el('p', { class: 'note' }, [
      'What is deliberately not here is synonym substitution. Doing it properly needs a ' +
      'lexical resource this lab does not ship, and doing it improperly — swapping words ' +
      'for unrelated ones and calling the result a synonym attack — would overstate how ' +
      'cheap the attack is. The semantically-aware attacks on this page are the ' +
      'back-translation and the paraphrase below, both run through real models.',
    ]),
    el('div', { class: 'controls' }, [runButton, resetControl]),
    progress,
    output,
    chartHost,
    tableHost,
  ], provenanceTag('paper', 'scored by the same detector'));
}

type Transformation = (typeof attacks.transformations)[number];

interface PinnedAttack {
  readonly id: string;
  readonly transformation: Transformation;
  readonly before: ScoreResult;
  readonly after: ScoreResult;
  readonly threshold: ThresholdInfo;
  readonly stillDetected: boolean;
}

/**
 * Scored once, read twice: by the headline above the act and by the table below it. The
 * alternative — scoring the same committed text in two places — is how two parts of one
 * page come to disagree about a number they both claim to have measured.
 */
function scorePinnedAttacks(): PinnedAttack[] {
  const tok = tokenizer();
  return attacks.transformations.map((transformation) => {
    const before = scoreTokens(tok.encode(transformation.original_text), watermarkParams,
      defaultConstruction, GPT2_EOS);
    const after = scoreTokens(tok.encode(transformation.transformed_text), watermarkParams,
      defaultConstruction, GPT2_EOS);
    const threshold = thresholdForLength(after.tokenCount);
    return {
      id: transformation.id,
      transformation,
      before,
      after,
      threshold,
      stillDetected: after.score !== null && threshold.value !== null
        && after.score >= threshold.value,
    };
  });
}

/** Back-translation and paraphrase: pinned inputs and outputs, recomputed scores. */
function renderPinnedAttacks(pinned: PinnedAttack[]): { node: HTMLElement; reset: () => void } {
  const rows: HTMLElement[] = [];
  const details: HTMLElement[] = [];

  for (const { transformation, before, after, threshold, stillDetected } of pinned) {
    rows.push(el('tr', {}, [
      el('td', { text: transformation.name }),
      el('td', { class: 'num', text: fixed(before.score) }),
      el('td', { class: 'num', text: fixed(after.score) }),
      el('td', { class: 'num', text: fixed((after.score ?? 0) - (before.score ?? 0)) }),
      el('td', { class: 'num', text: integer(after.scoredPositions) }),
      el('td', { class: 'num', text: fixed(threshold.value ?? Number.NaN) }),
      el('td', { text: stillDetected ? 'above threshold' : 'below threshold' }),
    ]));

    details.push(disclosure(
      `${transformation.name} — inputs, outputs and provenance`,
      () => [
        readout([
          ['Instructions', transformation.instructions],
          ...transformation.hops.map((hop) => [
            `Model · ${hop.hop}`, `${hop.model_id} @ ${hop.model_revision}`,
          ] as [string, string]),
          ['Parameters', JSON.stringify(transformation.parameters)],
          ['Captured', attacks.provenance.capture_timestamp_utc],
          ['Reference score before', fixed(transformation.reference_score_original.score)],
          ['Reference score after', fixed(transformation.reference_score_transformed.score)],
        ], `${transformation.name} provenance`),
        el('h4', { text: 'Text before' }),
        scroller(`${transformation.name} original text`, [
          el('p', { class: 'mono', text: transformation.original_text })]),
        el('h4', { text: 'Text after' }),
        scroller(`${transformation.name} transformed text`, [
          el('p', { class: 'mono', text: transformation.transformed_text })]),
      ],
    ));
  }

  const node = panel('Pinned attacks: back-translation and paraphrase', [
    el('p', { class: 'note' }, [
      'These need a model, so they were run once offline and committed with the exact ' +
      'inputs, outputs, model revisions and parameters. The scores below are recomputed ' +
      'here from the committed text; the capture’s own reference scores are inside each ' +
      'disclosure so the two can be compared.',
    ]),
    scroller('Pinned transformation results', [
      el('table', {}, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'Transformation' }),
          el('th', { class: 'num', text: 'Before' }),
          el('th', { class: 'num', text: 'After' }),
          el('th', { class: 'num', text: 'Change' }),
          el('th', { class: 'num', text: 'Scored positions' }),
          el('th', { class: 'num', text: 'Threshold @ 1%' }),
          el('th', { text: 'Verdict' }),
        ])]),
        el('tbody', {}, rows),
      ]),
    ]),
    ...details,
  ], provenanceTag('pinned', 'real translation and paraphrase models'));

  // A disclosure a presenter opened is state the next audience inherits, so the act's
  // reset closes both rather than leaving the provenance hanging open.
  return {
    node,
    reset: () => {
      for (const entry of details) entry.removeAttribute('open');
    },
  };
}

function renderTheory(): HTMLElement {
  return panel('Why regeneration can destroy the evidence — and why that is a separate claim', [
    el('p', {}, [
      'The mechanism carries no semantic component. Every g-value is a function of exact ' +
      'token identities in an exact order: the previous ngram_len − 1 tokens seed the hash ' +
      'and the candidate token is folded in. Nothing about meaning enters anywhere. So a ' +
      'rewrite that preserves the meaning and replaces the wording discards the keyed ' +
      'selection history entirely — not because the rewrite attacked the watermark, but ' +
      'because the watermark was never attached to the meaning in the first place.',
    ]),
    el('p', { class: 'note' }, [
      'That is the theoretical reason, and it is stated separately from the measurement ' +
      'above on purpose. The measurement is what these particular models did to this ' +
      'particular text under this particular configuration. The reasoning says what to ' +
      'expect in general; the table says what happened here, and if the two ever disagree ' +
      'the table wins.',
    ]),
    el('p', { class: 'note' }, [
      'There is an active line of research responding to exactly this: watermarking schemes ' +
      'that bind the mark to semantic content — sentence embeddings, paraphrase-invariant ' +
      'partitions — so that a rewrite preserving the meaning also preserves the mark. This ' +
      'lab does not implement any of it. See the sources section for the citations.',
    ]),
  ], provenanceTag('paper', 'construction has no semantic component'));
}
