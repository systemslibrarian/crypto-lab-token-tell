/**
 * Act II — find the signal.
 *
 * The detector, opened up: tokenization, context history, g-values, masking, statistic,
 * evidence. No model is involved at any point, which is the property that makes this
 * panel possible at all — detection needs the tokenizer, the key and the g-function, and
 * nothing else.
 *
 * Every number here is computed live, by the same functions the Hero called.
 *
 * The act has one result — the score card — and everything else in its first panel is the
 * working behind it. That working used to sit open underneath, three thousand pixels of it,
 * competing with the verdict it explains; it is now behind a disclosure, because a reader
 * who wants the pipeline asks for it and a reader who wants the answer should not have to
 * scroll past the derivation to be sure they have found it.
 *
 * The chosen sample is a deep link. A presenter demonstrating the paraphrase result should
 * be able to hand over a URL rather than a URL and an instruction.
 */

import attacks from '../data/pinned/attacks.json';
import nullCorpus from '../data/pinned/null-corpus.json';
import texts from '../data/pinned/texts.json';
import { defaultConstruction, tokenizer, watermarkParams } from '../lab-config.ts';
import { binomialUpperTail } from '../watermark/frequentist.ts';
import { scoreTokens } from '../watermark/score.ts';
import type { ScoreResult } from '../watermark/score.ts';
import { resetButton, runGuarded } from './busy.ts';
import { lineChart } from './chart.ts';
import {
  actHeader, button, clear, disclosure, el, fixed, integer, labelledSelect, liveRegion,
  nextFrame, panel, provenanceTag, readout, scroller,
} from './dom.ts';
import { param, setParam } from './mode.ts';
import { renderScoreCard } from './score-card.ts';

const GPT2_EOS = 50256;
const SAMPLE_PARAM = 'sample';

interface Preset {
  readonly id: string;
  readonly label: string;
  readonly text: string;
}

function presets(): Preset[] {
  const list: Preset[] = [
    { id: 'watermarked', label: 'Pinned watermarked sample', text: texts.samples.watermarked.text },
    { id: 'control', label: 'Pinned unwatermarked control', text: texts.samples.control.text },
    {
      id: 'watermarked_alt',
      label: 'Second watermarked sample',
      text: texts.samples.watermarked_alt.text,
    },
  ];
  for (const transformation of attacks.transformations) {
    list.push({
      id: transformation.id,
      label: `After ${transformation.name.toLowerCase()}`,
      text: transformation.transformed_text,
    });
  }
  return list;
}

/** The preset a deep link asked for, or none — the shipped state is no preset chosen. */
function presetFromUrl(): Preset | null {
  const requested = param(SAMPLE_PARAM);
  const found = presets().find((preset) => preset.id === requested) ?? null;
  // A parameter naming a sample this page does not hold is a link that lies about what the
  // audience will see, so it is dropped rather than left beside the shipped text.
  if (found === null && requested !== null) setParam(SAMPLE_PARAM, null);
  return found;
}

export function renderAct2(root: HTMLElement): void {
  clear(root);
  root.append(...actHeader(
    'act-2',
    'Act II',
    'Find the signal',
    'Paste anything. The detector tokenizes it, walks the context windows, computes a ' +
    'g-value per layer at each position, drops the positions the rule says to drop, and ' +
    'averages what is left.',
  ));

  const linked = presetFromUrl();

  const textarea = el('textarea', {
    id: 'detector-input',
    spellcheck: 'false',
    'aria-describedby': 'detector-input-help',
  }) as HTMLTextAreaElement;
  textarea.value = linked ? linked.text : texts.samples.watermarked.text;

  const { field: presetField, select: presetSelect } = labelledSelect(
    'detector-preset',
    'Load a committed sample',
    [{ value: '', label: 'Choose…' }, ...presets().map((p) => ({ value: p.id, label: p.label }))],
    linked ? linked.id : '',
  );
  presetSelect.addEventListener('change', () => {
    const preset = presets().find((p) => p.id === presetSelect.value);
    setParam(SAMPLE_PARAM, preset ? preset.id : null);
    if (preset) {
      textarea.value = preset.text;
      run();
    }
  });

  const results = liveRegion('Detector results');
  const breakdown = el('div');

  // The text that produced what is currently on screen. A verdict that outlives its
  // input is worse than no verdict, so editing the box retires the old one rather than
  // leaving a number sitting under text it was never computed from.
  let scoredText: string | null = null;

  const run = () => {
    const tok = tokenizer();
    const tokenIds = tok.encode(textarea.value);
    const result = scoreTokens(tokenIds, watermarkParams, defaultConstruction, GPT2_EOS);
    scoredText = textarea.value;
    clear(results);
    results.append(renderScoreCard(result, {
      subject: 'This text, under the published demo keys',
      keyDescription: `${integer(watermarkParams.keys.length)} keys, one per tournament layer`,
      constructionLabel: defaultConstruction.label,
    }));
    clear(breakdown);
    // Built on first open rather than eagerly: the token stream and the per-position table
    // are the expensive half of this act, and nothing under test reads through the closed
    // disclosure — the claims suite takes its statistics from the score card above it.
    breakdown.append(disclosure(
      'Show the pipeline, on this text',
      () => [renderPipeline(tokenIds, result)],
    ));
  };

  const retire = () => {
    // Re-typing the same text is not a change: a no-op must not retire a fresh verdict.
    if (scoredText === null || textarea.value === scoredText) return;
    scoredText = null;
    clear(results);
    results.append(el('p', { class: 'note', 'data-retired': 'true' }, [
      'The text changed, so the previous score was retired. It described the earlier ' +
      'text and says nothing about this one. Score it again to get a number for what is ' +
      'in the box now.',
    ]));
    clear(breakdown);
  };
  textarea.addEventListener('input', retire);

  // A presenter leaves this box holding whatever the last demonstration typed into it, and
  // the way back has to be one control rather than a reload — a reload would also take the
  // depth, the anchor and the scroll position the audience is looking at.
  const reset = () => {
    presetSelect.value = '';
    textarea.value = texts.samples.watermarked.text;
    setParam(SAMPLE_PARAM, null);
    run();
  };

  root.append(panel('Score any text', [
    el('p', { id: 'detector-input-help', class: 'note' }, [
      'This detector reads only the watermark configuration published in this repository. ' +
      'Text from any real product will score as unmarked here, and that is the correct ' +
      'result rather than a limitation to work around.',
    ]),
    el('div', { class: 'controls' }, [
      presetField,
      button('Score it', run, true),
      resetButton('Reset the detector', reset),
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'detector-input', text: 'Text to score' }),
      textarea,
    ]),
    results,
    breakdown,
  ], provenanceTag('paper', 'mean g-score')));

  root.append(renderDoesNotProve());
  root.append(renderWhyNotGemini());
  root.append(renderStrengthCurve());
  run();
}

/** The pipeline, one stage per section, on the text actually in the box. */
function renderPipeline(tokenIds: number[], result: ScoreResult): HTMLElement {
  const tok = tokenizer();
  const n = watermarkParams.ngramLen;

  const stream = el('div', { class: 'token-stream' });
  for (let index = 0; index < tokenIds.length; index++) {
    const position = result.perPosition.find((p) => p.tokenIndex === index);
    const text = tok.decode([tokenIds[index]]);
    let className = 'token context';
    let title = `token ${index} · context only, no full window yet`;
    if (position) {
      if (!position.counted) {
        className = 'token masked';
        title = `token ${index} · dropped: ${position.repeatedContext ? 'repeated context' : 'after end-of-text'}`;
      } else if (position.mean >= 0.5) {
        className = 'token counted-high';
        title = `token ${index} · mean g = ${position.mean.toFixed(3)} across ${position.gValues.length} layers`;
      } else {
        className = 'token counted-low';
        title = `token ${index} · mean g = ${position.mean.toFixed(3)} across ${position.gValues.length} layers`;
      }
    }
    stream.append(el('span', { class: className, title, text: text === '' ? '·' : text }));
  }

  const sampleRows = result.perPosition.slice(0, 12).map((position) => el('tr', {}, [
    el('td', { class: 'num', text: integer(position.tokenIndex) }),
    el('td', { class: 'mono', text: JSON.stringify(tok.decode([tokenIds[position.tokenIndex]])) }),
    el('td', {
      class: 'mono',
      text: JSON.stringify(tok.decode(
        tokenIds.slice(position.tokenIndex - (n - 1), position.tokenIndex))),
    }),
    el('td', { class: 'mono', text: position.gValues.slice(0, 12).join('') + (position.gValues.length > 12 ? '…' : '') }),
    el('td', { class: 'num', text: fixed(position.mean, 3) }),
    el('td', { text: position.counted ? 'counted' : (position.repeatedContext ? 'repeated context' : 'after end-of-text') }),
  ]));

  const exact = result.score === null ? null : binomialUpperTail(result.gSum, result.gValueCount);

  return el('div', {}, [
    el('h4', { text: '1 · Tokenize' }),
    readout([
      ['Characters in', integer([...(tok.decode(tokenIds))].length)],
      ['Tokens out', integer(tokenIds.length)],
      ['Tokenizer', 'GPT-2 byte-level BPE, reimplemented in the browser'],
      ['Vocabulary size', integer(tok.vocabSize)],
    ], 'Tokenization'),
    el('h4', { text: '2 · Slide the context window and compute g-values' }),
    el('div', { class: 'legend' }, [
      el('span', {}, [el('span', { class: 'swatch', style: 'background:color-mix(in oklab,var(--ok) 22%,transparent);border-bottom:3px solid var(--ok)' }), 'counted, mean g at or above 0.5 (solid underline)']),
      el('span', {}, [el('span', { class: 'swatch', style: 'background:color-mix(in oklab,var(--alarm) 16%,transparent);border-bottom:3px dotted var(--alarm)' }), 'counted, mean g below 0.5 (dotted underline)']),
      el('span', {}, [el('span', { class: 'swatch', style: 'background:repeating-linear-gradient(45deg,transparent,transparent 3px,#8fa0b1 3px,#8fa0b1 6px)' }), 'dropped by the masking rule']),
      el('span', {}, [el('span', { class: 'swatch', style: 'background:transparent' }), 'context only — no full window yet']),
    ]),
    scroller('Scored token stream', [stream]),
    el('h4', { text: '3 · The first twelve scored positions' }),
    // A header row over an empty body is a table that describes nothing, and a screen
    // reader is told about columns that have no cells. When there is nothing to show,
    // say so in a sentence instead.
    sampleRows.length
      ? scroller('Per-position g-values', [
        el('table', {}, [
          el('thead', {}, [el('tr', {}, [
            el('th', { class: 'num', text: 'Index' }),
            el('th', { text: 'Token' }),
            el('th', { text: 'Context window' }),
            el('th', { text: 'g per layer' }),
            el('th', { class: 'num', text: 'mean' }),
            el('th', { text: 'Status' }),
          ])]),
          el('tbody', {}, sampleRows),
        ]),
      ])
      : el('p', { class: 'note' }, [
        `No position has a full context window yet: scoring starts at token ` +
        `${integer(n - 1)}, and this text has ${integer(tokenIds.length)}.`,
      ]),
    el('h4', { text: '4 · Average, and compare against the null' }),
    readout([
      ['Sum of counted g-values', integer(result.gSum)],
      ['Counted g-values', integer(result.gValueCount)],
      ['Mean', fixed(result.score)],
      ['Expected with no mark', '0.500'],
      ['Exact null', exact ? `Binomial(${integer(exact.trials)}, 1/2)` : 'n/a'],
      ['Sum expected under the null', exact ? fixed(exact.nullExpectedSum, 1) : 'n/a'],
    ], 'Statistic'),
  ]);
}

function renderDoesNotProve(): HTMLElement {
  const box = el('div', { class: 'warn-box' }, [
    el('h3', { id: 'does-not-prove', text: 'What this does not prove' }),
    el('p', { class: 'note' }, ['A positive score does not establish:']),
    el('ul', { role: 'list' }, [
      el('li', { role: 'listitem', text: 'the identity of a human author' }),
      el('li', { role: 'listitem', text: 'that anything in the text is factually true' }),
      el('li', { role: 'listitem', text: 'plagiarism' }),
      el('li', { role: 'listitem', text: 'malicious intent' }),
      el('li', { role: 'listitem', text: 'that some arbitrary AI system generated the text' }),
      el('li', {
        role: 'listitem',
        text: 'that a specific commercial model generated it, absent that model’s own '
          + 'watermark configuration and provenance',
      }),
    ]),
    el('p', { class: 'note' }, [
      'A negative score does not establish human authorship. It establishes that this ' +
      'configuration’s mark was not found — which is also what an unmarked machine ' +
      'generation, a different vendor’s mark, or a thoroughly rewritten marked text all ' +
      'look like.',
    ]),
  ]);
  return box;
}

function renderWhyNotGemini(): HTMLElement {
  return el('div', { class: 'warn-box' }, [
    el('h3', { text: 'Why this lab cannot check Gemini' }),
    el('p', { class: 'note' }, [
      'This detector reads text watermarked with the keys published in this repository. It ' +
      'cannot read Google’s, because Google does not publish its watermark configuration — ' +
      'and by the construction, detection requires it. Tools advertising third-party ' +
      '"SynthID text detection" are running generic AI-text classifiers under a borrowed ' +
      'name; at least one such vendor concedes in its own FAQ that it does not read the ' +
      'SynthID watermark and that doing so would require private keys that are not public.',
    ]),
    el('p', { class: 'note' }, [
      'The Hero panel already showed this as a measurement rather than an argument: two ' +
      'published reference implementations of the same scheme, given the same text and the ' +
      'same keys, do not read each other’s marks. Configuration is not a detail around the ' +
      'key; it is part of the key.',
    ]),
  ]);
}

/**
 * How the evidence accumulates with length — for this configuration, and no other.
 *
 * Built from two matched pinned corpora: unwatermarked texts set the threshold at a
 * chosen false-positive rate, watermarked texts are then measured against it. The page
 * can also recompute the whole thing in the browser from the committed token ids, so the
 * pinned numbers are checkable rather than merely quoted.
 */
function renderStrengthCurve(): HTMLElement {
  type Entry = {
    tokens: number;
    null_mean: number | null;
    null_sd: number | null;
    threshold_fpr_1_percent: number | null;
    watermarked_mean?: number | null;
    watermarked_sd?: number | null;
    tpr_at_fpr_1_percent?: number | null;
    null_sample_count: number;
    watermarked_sample_count?: number;
    null_mean_scored_positions?: number | null;
  };
  const byLength = Object.values(nullCorpus.by_length as unknown as Record<string, Entry>)
    .sort((a, b) => a.tokens - b.tokens);

  const rows = byLength.map((entry) => {
    const predicted = predictedSpread(entry);
    return el('tr', {}, [
      el('td', { class: 'num', text: integer(entry.tokens) }),
      el('td', { class: 'num', text: fixed(entry.null_mean ?? Number.NaN) }),
      el('td', { class: 'num', text: fixed(entry.null_sd ?? Number.NaN, 4) }),
      el('td', { class: 'num', text: fixed(predicted, 4) }),
      el('td', { class: 'num', text: fixed(entry.threshold_fpr_1_percent ?? Number.NaN) }),
      el('td', { class: 'num', text: fixed(entry.watermarked_mean ?? Number.NaN) }),
      el('td', {
        class: 'num',
        text: entry.tpr_at_fpr_1_percent === null || entry.tpr_at_fpr_1_percent === undefined
          ? 'n/a'
          : `${(entry.tpr_at_fpr_1_percent * 100).toFixed(1)}%`,
      }),
    ]);
  });

  const chart = lineChart({
    series: [
      {
        label: 'unwatermarked mean',
        className: 'series-null',
        points: byLength.map((e) => ({ x: e.tokens, y: e.null_mean ?? 0.5 })),
      },
      {
        label: 'watermarked mean',
        className: 'series-wm',
        points: byLength
          .filter((e) => e.watermarked_mean !== null && e.watermarked_mean !== undefined)
          .map((e) => ({ x: e.tokens, y: e.watermarked_mean as number })),
      },
    ],
    band: byLength.map((e) => ({
      x: e.tokens,
      low: (e.null_mean ?? 0.5) - 2 * (e.null_sd ?? 0),
      high: (e.null_mean ?? 0.5) + 2 * (e.null_sd ?? 0),
    })),
    xLabel: 'tokens scored',
    yLabel: 'mean g',
    title: 'Detection strength against length',
    takeaway:
      'What to look for: the grey band is the range unmarked text occupies at each length, ' +
      'and the distance from it up to the watermarked line is the evidence a decision would ' +
      'have to rest on.',
    description:
      'Mean g-score against text length for this configuration. The grey band is two ' +
      'standard deviations of the unwatermarked corpus; the upper line is the watermarked ' +
      'corpus mean. The bands narrow as length grows, which is the whole of why longer ' +
      'text carries more evidence.',
  });

  const live = liveRegion('Recomputed detection statistics');
  const progress = el('p', { class: 'progress', role: 'status', 'aria-live': 'polite' });

  const recompute = async () => {
    clear(live);
    progress.textContent = 'Re-scoring both corpora…';
    const unmarked = nullCorpus.corpus_token_ids as number[][];
    const marked = (nullCorpus as { watermarked_corpus_token_ids?: number[][] })
      .watermarked_corpus_token_ids ?? [];
    const length = 200;
    const scoreAll = async (corpus: number[][], label: string) => {
      const scores: number[] = [];
      for (const [index, tokenIds] of corpus.entries()) {
        const result = scoreTokens(tokenIds.slice(0, length), watermarkParams,
          defaultConstruction, GPT2_EOS);
        if (result.score !== null) scores.push(result.score);
        if (index % 8 === 0) {
          progress.textContent = `Re-scoring ${label}: ${index + 1} of ${corpus.length}…`;
          await nextFrame();
        }
      }
      return scores.sort((a, b) => a - b);
    };
    const nullScores = await scoreAll(unmarked, 'unwatermarked corpus');
    const markedScores = marked.length ? await scoreAll(marked, 'watermarked corpus') : [];
    const pinned = (nullCorpus.by_length as unknown as Record<string, Entry>)[String(length)];
    const threshold = nullScores[Math.min(nullScores.length - 1,
      Math.max(0, Math.round(0.99 * nullScores.length) - 1))];
    const tpr = markedScores.length
      ? markedScores.filter((s) => s >= threshold).length / markedScores.length
      : null;

    progress.textContent = 'Done.';
    live.append(readout([
      ['Recomputed at length', `${integer(length)} tokens`],
      ['Unwatermarked texts re-scored', integer(nullScores.length)],
      ['Threshold at FPR 1% (recomputed)', fixed(threshold)],
      ['Threshold at FPR 1% (pinned)', fixed(pinned.threshold_fpr_1_percent ?? Number.NaN)],
      ['Watermarked texts re-scored', integer(markedScores.length)],
      ['Detection rate (recomputed)', tpr === null ? 'n/a' : `${(tpr * 100).toFixed(1)}%`],
      ['Detection rate (pinned)',
        pinned.tpr_at_fpr_1_percent === null || pinned.tpr_at_fpr_1_percent === undefined
          ? 'n/a' : `${((pinned.tpr_at_fpr_1_percent) * 100).toFixed(1)}%`],
    ], 'Recomputed against pinned values'));
    live.append(el('p', { class: 'note' }, [
      'Recomputed in this browser from the committed token ids, by the same scorer the ' +
      'rest of the page uses. If these disagree with the pinned values, the pinned values ' +
      'are wrong.',
    ]));
  };

  // The guard owns the button state, the busy flag on the region and the recovery block if
  // the run throws. It is not given the progress line: it empties what it was given the
  // moment the work settles, and this line ends by saying the run finished.
  const start = (): Promise<void> => runGuarded(recompute, {
    controls: [recomputeButton, resetControl],
    region: live,
    onError: () => { progress.textContent = ''; },
  });

  const reset = () => {
    clear(live);
    progress.textContent = '';
  };

  const recomputeButton = button('Recompute in this browser', () => { void start(); });
  const resetControl = resetButton('Reset the recomputation', reset);

  return panel('How much text does it take?', [
    el('p', { class: 'note' }, [
      'There is no universal token count below which a watermark cannot be found. What ' +
      'detection needs depends on the text length, the model’s entropy, the watermark ' +
      'parameters, the decoding configuration, the scoring method, the false-positive rate ' +
      'you are willing to accept, and how the tokenizer and context are treated. This ' +
      'table measures one configuration: this one.',
    ]),
    chart,
    scroller('Detection statistics by length', [
      el('table', {}, [
        el('thead', {}, [el('tr', {}, [
          el('th', { class: 'num', text: 'Tokens' }),
          el('th', { class: 'num', text: 'Unmarked mean' }),
          el('th', { class: 'num', text: 'Unmarked sd (measured)' }),
          el('th', { class: 'num', text: 'sd if independent' }),
          el('th', { class: 'num', text: 'Threshold @ FPR 1%' }),
          el('th', { class: 'num', text: 'Marked mean' }),
          el('th', { class: 'num', text: 'Detection rate @ FPR 1%' }),
        ])]),
        el('tbody', {}, rows),
      ]),
    ]),
    el('p', { class: 'note' }, [
      `Both corpora hold ${integer(nullCorpus.corpus_size)} texts. A 1% threshold estimated ` +
      'from that many samples rests on the single highest of them, so the shortest rows are ' +
      'the least trustworthy in the table — and a detection rate of 100% here means 48 of ' +
      '48, which is a different claim from a rate of 1. Where the measured spread runs ' +
      'above the independence prediction, the exact p-value in the score card is optimistic ' +
      'at that length.',
    ]),
    el('div', { class: 'controls' }, [recomputeButton, resetControl]),
    progress,
    live,
  ], provenanceTag('pinned', 'matched corpora, 48 texts each'));
}

/**
 * The spread the exact null predicts at a given length.
 *
 * It needs the number of positions that actually counted, not the number the window
 * offered, because masking removes some. The capture records the measured mean; if that
 * is missing the fallback ignores masking and therefore slightly under-predicts the
 * spread, which is stated rather than hidden.
 */
function predictedSpread(entry: { tokens: number; null_mean_scored_positions?: number | null }): number {
  const counted = entry.null_mean_scored_positions
    ?? Math.max(0, entry.tokens - (watermarkParams.ngramLen - 1));
  return counted > 0
    ? Math.sqrt(0.25 / (counted * watermarkParams.keys.length))
    : Number.NaN;
}
