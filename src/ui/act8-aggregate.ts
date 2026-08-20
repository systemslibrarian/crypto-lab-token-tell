/**
 * Act VIII — the question this detector can actually answer.
 *
 * Everything above this act is a failure of individual adjudication, and a reader who
 * stops there leaves with "so the mechanism is worthless". It is not. Every limitation
 * this page demonstrates is a limitation on judging one document, and none of them is a
 * limitation on measuring a population: a false-positive rate that is stable is not noise
 * to be overcome, it is a known offset to be subtracted.
 *
 * So this act never judges a text. It scores a corpus whose mixture is held out of the
 * estimator, reports the marked fraction with an interval, and shows that interval closing
 * as the corpus grows while a verdict on any single document in it stays exactly as weak
 * as it was in Act II.
 *
 * The corpus is the one this lab already ships, cut smaller. The 48 marked and 48 unmarked
 * pinned texts are 320 tokens each, and 96 documents is too few to watch anything converge;
 * cut into eight 40-token documents apiece they become 768, and 40 tokens is short enough
 * that a single verdict is genuinely poor — which is the half of the demonstration that
 * has to be true for the other half to mean anything.
 *
 * Two rules keep the estimate honest, and both are stated on the page rather than only
 * here. The split between the documents that calibrate the detector and the documents it
 * then measures is made by SOURCE TEXT, not by document, so no measured document shares a
 * generation with a calibrating one. And the mixture the reader chooses is used to build
 * the corpus and to check the answer afterwards — never to compute it. The estimator sees
 * one number: how many documents were flagged.
 */

import nullCorpus from '../data/pinned/null-corpus.json';
import { defaultConstruction, watermarkParams } from '../lab-config.ts';
import {
  estimateMarkedFraction, operatingPoint, wilsonInterval,
} from '../watermark/aggregate.ts';
import type { OperatingPoint, PrevalenceEstimate } from '../watermark/aggregate.ts';
import { makeKeyStream } from '../watermark/null-model.ts';
import { scoreTokens } from '../watermark/score.ts';
import { armableReset, runGuarded } from './busy.ts';
import { lineChart } from './chart.ts';
import {
  actHeader, button, clear, consequence, el, fixed, integer, labelledSelect, liveRegion,
  nextFrame, panel, provenanceTag, readout, reasoning, scroller, srOnly,
} from './dom.ts';

const GPT2_EOS = 50256;

/** Tokens per document. Short on purpose: see the file header. */
const SEGMENT_TOKENS = 40;

/** 320 pinned tokens per text, cut end to end. */
const SEGMENTS_PER_TEXT = 8;

/**
 * Source texts per class whose documents calibrate the detector. The remaining 32 of each
 * class are the measurement pool, so calibration sees 128 documents per class and the
 * corpus can be grown to 256 of either.
 */
const CALIBRATION_TEXTS = 16;

/**
 * The false-positive rate the threshold is placed for.
 *
 * Five percent rather than the 1% the rest of the page decides at, and for the reason the
 * pinned corpus itself gives: a 1% threshold estimated from 128 samples rests on the top
 * one or two of them. At 5% it rests on the top six, which is a rate this act can measure
 * on held-out documents afterwards and report against.
 */
const TARGET_FPR = 0.05;

/** Corpus sizes the estimate is reported at, in documents. */
const LADDER = [32, 64, 96, 128, 160, 192, 224, 256] as const;

/** The mixtures a reader can ask for, as marked fractions. */
const MIXTURES = ['0.10', '0.30', '0.50'] as const;

/**
 * Seeds for the two deal orders. Fixed so a presenter who runs this twice gets the same
 * corpus twice, and recorded here so the run can be reproduced away from the page.
 */
const MARKED_ORDER_SEED = 0x5eed01;
const UNMARKED_ORDER_SEED = 0x5eed02;

interface Document {
  readonly textIndex: number;
  readonly segmentIndex: number;
  readonly score: number;
}

interface Scored {
  readonly marked: Document[];
  readonly unmarked: Document[];
}

export function renderAct8(root: HTMLElement): void {
  clear(root);
  root.append(...actHeader(
    'act-8',
    'Act VIII',
    'Measure a population',
    'Every experiment above this one is a detector failing to settle a question about one ' +
    'text. This one asks a different question — what fraction of a pile of documents ' +
    'carries the mark — and answers it with an interval that closes as the pile grows.',
  ));

  root.append(renderFrame());
  root.append(renderMeasurement());
}

/**
 * The frame, before any number: what changed between this act and the ones above it.
 *
 * Stated first because the arithmetic below is only interesting once the reader has the
 * substitution in hand — the same detector, the same errors, a different question.
 */
function renderFrame(): HTMLElement {
  return panel('The question that changed', [
    el('p', {}, [
      'A detector that is wrong about individual documents at a ',
      el('em', { text: 'stable' }),
      ' rate is not a broken instrument. It is a biased one, and a known bias is ' +
      'subtractable. Flag every document in a corpus, count the flags, and the count is ' +
      'the marked fraction detected at the true-positive rate plus the unmarked remainder ' +
      'flagged at the false-positive rate. Both rates are measurable, so the mixture can ' +
      'be solved for.',
    ]),
    reasoning([el('p', { class: 'note' }, [
      'That is the whole of the correction, published by Rogan and Gladen in 1978 for ' +
      'exactly this problem in epidemiology: estimating how common something is in a ' +
      'population using a test that is wrong about individuals. Nothing about it repairs ' +
      'the individual verdicts. Every one of them is as weak here as it was in Act II — ' +
      'the panel below measures how weak, on the same corpus, at the same moment.',
    ])], 'Where this arithmetic comes from'),
    el('p', { class: 'note' }, [
      'Useless for judging one essay. Serviceable for measuring a population. Those are ' +
      'two different products, and only one of them is what schools, courts and newsrooms ' +
      'are being sold.',
    ]),
  ], provenanceTag('demo', 'framing; the arithmetic is cited below'));
}

function renderMeasurement(): HTMLElement {
  const output = liveRegion('Population estimate');
  // For eyes only, like Act III's: a polite live region would queue one string per
  // progress repaint and read the answer out last.
  const progress = el('p', { class: 'progress' });
  const announcer = srOnly('');
  announcer.setAttribute('role', 'status');
  announcer.setAttribute('aria-live', 'polite');

  const { field: mixtureField, select: mixtureSelect } = labelledSelect(
    'act8-mixture',
    'Marked fraction of the corpus',
    MIXTURES.map((value) => ({ value, label: `${Math.round(Number(value) * 100)}%` })),
    '0.30',
  );

  /** Held between runs so a change of mixture re-mixes rather than re-scores. */
  let scored: Scored | null = null;

  const show = (): void => {
    if (!scored) return;
    clear(output);
    output.append(...renderResults(scored, Number(mixtureSelect.value)));
  };

  const run = async (): Promise<void> => {
    clear(output);
    progress.textContent = 'Scoring the corpus…';
    announcer.textContent = `Scoring ${integer(documentCount())} documents. The result will ` +
      'be announced when it finishes.';
    scored = await scoreCorpora((done, total) => {
      progress.textContent = `Scoring the corpus: ${done} of ${total} documents…`;
    });
    progress.textContent = 'Done.';
    show();
    const estimate = currentEstimate(scored, Number(mixtureSelect.value));
    announcer.textContent = estimate.estimate === null
      ? 'The detector separated the two classes too poorly to estimate a fraction.'
      : `Estimated marked fraction ${fixed(estimate.estimate, 3)}, 95% interval ` +
        `${fixed(estimate.interval?.low ?? Number.NaN, 3)} to ` +
        `${fixed(estimate.interval?.high ?? Number.NaN, 3)}, from ` +
        `${integer(estimate.documents)} documents.`;
  };

  const start = (): Promise<void> => runGuarded(run, {
    controls: [runButton, resetControl.node, mixtureSelect],
    region: output,
    onError: () => { progress.textContent = ''; announcer.textContent = ''; },
    // See the hero's sweep: the guard restores every control to the state it found, so a
    // control armed inside the run would be switched off again on the way out.
    onSettled: () => { if (output.childElementCount > 0) resetControl.arm(); },
  });

  const reset = (): void => {
    scored = null;
    clear(output);
    progress.textContent = '';
    announcer.textContent = '';
    mixtureSelect.value = '0.30';
  };

  const runButton = button('Score the corpus and estimate', () => { void start(); }, true);
  const resetControl = armableReset(
    'Reset the estimate',
    'There is no estimate to reset yet. Score the corpus first; this then clears the '
    + 'result and puts the mixture back to 30%.',
    reset,
  );
  // A mixture chosen before the run is the mixture the run will use; chosen after it, the
  // corpus is re-mixed out of scores already in hand, which is instant and re-uses every
  // document rather than scoring a second pile.
  mixtureSelect.addEventListener('change', show);

  return panel('One corpus, one number, one interval', [
    el('p', { class: 'note' }, [
      `The ${integer(markedCorpus().length + unmarkedCorpus().length)} pinned texts of this ` +
      `lab’s corpus, cut into ${integer(SEGMENTS_PER_TEXT)} documents each of ` +
      `${integer(SEGMENT_TOKENS)} tokens: ` +
      `${integer(markedCorpus().length * SEGMENTS_PER_TEXT)} marked and ` +
      `${integer(unmarkedCorpus().length * SEGMENTS_PER_TEXT)} unmarked. The first ` +
      `${integer(CALIBRATION_TEXTS)} texts of each class calibrate the detector; the other ` +
      `${integer(markedCorpus().length - CALIBRATION_TEXTS)} are what gets measured, so no ` +
      'measured document shares a generation with a calibrating one.',
    ]),
    el('div', { class: 'controls' }, [mixtureField, runButton, resetControl.node]),
    resetControl.note,
    progress,
    announcer,
    output,
  ], provenanceTag('pinned',
    `${integer(markedCorpus().length + unmarkedCorpus().length)} texts, cut into ` +
    `${integer(documentCount())} documents`));
}

function documentCount(): number {
  return (markedCorpus().length + unmarkedCorpus().length) * SEGMENTS_PER_TEXT;
}

function markedCorpus(): number[][] {
  return (nullCorpus as { watermarked_corpus_token_ids?: number[][] })
    .watermarked_corpus_token_ids ?? [];
}

function unmarkedCorpus(): number[][] {
  return (nullCorpus as { corpus_token_ids?: number[][] }).corpus_token_ids ?? [];
}

/**
 * Score every document in both corpora, yielding to the browser as it goes.
 *
 * A document whose score is null — nothing left after masking — is dropped rather than
 * counted as unflagged, and the counts printed on the page are the counts that survived,
 * so a dropped document cannot quietly become evidence of absence.
 */
async function scoreCorpora(onProgress: (done: number, total: number) => void): Promise<Scored> {
  const marked: Document[] = [];
  const unmarked: Document[] = [];
  const total = documentCount();
  let done = 0;

  const collect = async (corpus: number[][], into: Document[]): Promise<void> => {
    for (const [textIndex, tokenIds] of corpus.entries()) {
      for (let segmentIndex = 0; segmentIndex < SEGMENTS_PER_TEXT; segmentIndex++) {
        const slice = tokenIds.slice(
          segmentIndex * SEGMENT_TOKENS, (segmentIndex + 1) * SEGMENT_TOKENS);
        const result = scoreTokens(slice, watermarkParams, defaultConstruction, GPT2_EOS);
        done += 1;
        if (result.score !== null) into.push({ textIndex, segmentIndex, score: result.score });
      }
      if (textIndex % 4 === 0) {
        onProgress(done, total);
        await nextFrame();
      }
    }
  };

  await collect(markedCorpus(), marked);
  await collect(unmarkedCorpus(), unmarked);
  onProgress(total, total);
  return { marked, unmarked };
}

const calibration = (docs: Document[]): Document[] =>
  docs.filter((doc) => doc.textIndex < CALIBRATION_TEXTS);

const measurement = (docs: Document[]): Document[] =>
  docs.filter((doc) => doc.textIndex >= CALIBRATION_TEXTS);

/**
 * Deal the measurement documents so that the small corpora are the diverse ones.
 *
 * Eight documents cut from one generation are not eight independent documents: they share
 * a prompt, a sampling run and whatever the model did during it, repetition loops
 * included. Dealing one document from every source text before returning for a second from
 * any of them means the 32-document corpus is 32 distinct generations rather than four,
 * which is the honest version of a small sample. It does not repair the large end — a
 * 256-document corpus is 32 texts however it is dealt — and the note under the chart says
 * so.
 */
function dealOrder(docs: Document[], seed: number): Document[] {
  const pool = measurement(docs);
  const texts = shuffle([...new Set(pool.map((doc) => doc.textIndex))], seed);
  const order: Document[] = [];
  for (let segmentIndex = 0; segmentIndex < SEGMENTS_PER_TEXT; segmentIndex++) {
    for (const textIndex of texts) {
      const found = pool.find(
        (doc) => doc.textIndex === textIndex && doc.segmentIndex === segmentIndex);
      if (found) order.push(found);
    }
  }
  return order;
}

/**
 * Fisher–Yates over the lab's existing deterministic stream.
 *
 * `makeKeyStream` is xorshift32 and is not cryptographic; neither this nor the wrong-key
 * sweep it was written for needs it to be. What both need is that a run can be repeated
 * exactly, which a fixed seed gives.
 */
function shuffle<T>(items: T[], seed: number): T[] {
  const next = makeKeyStream(seed);
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = next() % (index + 1);
    const held = copy[index];
    copy[index] = copy[swap];
    copy[swap] = held;
  }
  return copy;
}

interface Mixture {
  readonly documents: Document[];
  readonly markedCount: number;
  readonly unmarkedCount: number;
}

/**
 * The corpus at one size, built from the two deal orders as nested prefixes: the
 * 64-document corpus contains the 32-document one. That is what makes the ladder below a
 * corpus growing rather than eight unrelated draws, which is the claim being made about
 * it.
 */
function mix(
  markedOrder: Document[], unmarkedOrder: Document[], size: number, fraction: number,
): Mixture | null {
  const markedCount = Math.round(fraction * size);
  const unmarkedCount = size - markedCount;
  if (markedCount > markedOrder.length || unmarkedCount > unmarkedOrder.length) return null;
  return {
    documents: [...markedOrder.slice(0, markedCount), ...unmarkedOrder.slice(0, unmarkedCount)],
    markedCount,
    unmarkedCount,
  };
}

function countAtOrAbove(docs: readonly Document[], threshold: number): number {
  return docs.filter((doc) => doc.score >= threshold).length;
}

function pointFor(scored: Scored): OperatingPoint | null {
  return operatingPoint(
    calibration(scored.unmarked).map((doc) => doc.score),
    calibration(scored.marked).map((doc) => doc.score),
    TARGET_FPR,
  );
}

/** The estimate at the largest corpus size, which is what the headline and the announcement report. */
function currentEstimate(scored: Scored, fraction: number): PrevalenceEstimate {
  const point = pointFor(scored);
  const empty: PrevalenceEstimate = {
    documents: 0, positives: 0, positiveRate: Number.NaN, estimate: null, interval: null,
    halfWidth: null, clamped: false,
  };
  if (!point) return empty;
  const mixture = mix(
    dealOrder(scored.marked, MARKED_ORDER_SEED),
    dealOrder(scored.unmarked, UNMARKED_ORDER_SEED),
    LADDER[LADDER.length - 1],
    fraction,
  );
  if (!mixture) return empty;
  return estimateMarkedFraction(
    countAtOrAbove(mixture.documents, point.threshold), mixture.documents.length, point);
}

function renderResults(scored: Scored, fraction: number): HTMLElement[] {
  const point = pointFor(scored);
  if (!point) {
    return [el('p', { class: 'note', text: 'The calibration corpus produced no usable ' +
      'threshold, so nothing downstream of it was computed.' })];
  }

  const markedOrder = dealOrder(scored.marked, MARKED_ORDER_SEED);
  const unmarkedOrder = dealOrder(scored.unmarked, UNMARKED_ORDER_SEED);

  const rungs = LADDER
    .map((size) => {
      const mixture = mix(markedOrder, unmarkedOrder, size, fraction);
      if (!mixture) return null;
      const positives = countAtOrAbove(mixture.documents, point.threshold);
      return {
        size,
        mixture,
        estimate: estimateMarkedFraction(positives, mixture.documents.length, point),
      };
    })
    .filter((rung): rung is NonNullable<typeof rung> => rung !== null);

  const last = rungs[rungs.length - 1];
  if (!last || last.estimate.estimate === null || !last.estimate.interval) {
    return [el('p', { class: 'note', text: 'The two classes were not separated well enough ' +
      'at this operating point to invert the observed rate, so no fraction is reported.' })];
  }

  // What the threshold does on documents it has never seen. The calibration rates are what
  // the correction uses; these are the rates it should have used, and the gap between them
  // is the part of the error no interval on the corpus count can see.
  const heldOutFpr = countAtOrAbove(measurement(scored.unmarked), point.threshold)
    / measurement(scored.unmarked).length;
  const heldOutTpr = countAtOrAbove(measurement(scored.marked), point.threshold)
    / measurement(scored.marked).length;

  const flaggedMarked = countAtOrAbove(
    last.mixture.documents.slice(0, last.mixture.markedCount), point.threshold);
  const flaggedUnmarked = last.estimate.positives - flaggedMarked;
  const precision = last.estimate.positives > 0
    ? flaggedMarked / last.estimate.positives
    : Number.NaN;

  return [
    renderHeadline(last.estimate, fraction),
    readout([
      ['Documents in the corpus', integer(last.estimate.documents)],
      ['Marked fraction, held out', percent(fraction)],
      ['Documents flagged', integer(last.estimate.positives)],
      ['Flagged fraction, uncorrected', percent(last.estimate.positiveRate)],
      ['Estimated marked fraction', percent(last.estimate.estimate)],
      ['95% interval', `${percent(last.estimate.interval.low)} to ` +
        `${percent(last.estimate.interval.high)}`],
      ['True fraction inside the interval',
        fraction >= last.estimate.interval.low && fraction <= last.estimate.interval.high
          ? 'yes' : 'no'],
    ], 'Population estimate at the full corpus size'),
    renderLadder(rungs, fraction),
    renderCalibration(point, heldOutFpr, heldOutTpr),
    renderSingleDocument(last, flaggedMarked, flaggedUnmarked, precision, fraction),
    el('p', { class: 'note' }, [
      'What the interval covers, and what it does not. It covers the sampling error in a ' +
      'corpus of this size and nothing else: not the error in the two calibration rates, ' +
      'which are themselves estimates from ' +
      `${integer(point.unmarkedCalibrationCount)} and ` +
      `${integer(point.markedCalibrationCount)} documents; not the fact that the documents ` +
      `come ${integer(SEGMENTS_PER_TEXT)} to a source text, which makes them correlated in ` +
      `a way ${integer(last.estimate.documents)} independently generated ones would not ` +
      'be; and not the fact that every text here came from one model, one decoding ' +
      'configuration and one set of prompts. Point a calibrated detector at a population that differs from its ' +
      'calibration corpus and the rates it was calibrated with are the wrong rates.',
    ]),
    el('p', { class: 'note' }, [
      'And the estimate is a fraction, not an identification. It says nothing about which ' +
      'documents are marked — the correction works precisely because it never has to ' +
      'decide that — and nothing about who wrote any of them.',
    ]),
  ];
}

function renderHeadline(estimate: PrevalenceEstimate, fraction: number): HTMLElement {
  const interval = estimate.interval;
  const value = estimate.estimate ?? Number.NaN;
  return el('div', { class: 'act-headline' }, [
    el('p', {
      class: 'act-headline-label',
      text: `Estimated marked fraction of ${integer(estimate.documents)} documents`,
    }),
    el('p', {
      class: 'act-headline-figure',
      text: interval
        ? `${percent(value)}  (${percent(interval.low)} – ${percent(interval.high)})`
        : percent(value),
    }),
    el('p', {
      class: 'act-headline-detail',
      text: `The corpus was built at ${percent(fraction)} marked, and that number was used ` +
        'to build it and to check the answer — never to compute it. The estimator was ' +
        `given one input: that ${integer(estimate.positives)} of ` +
        `${integer(estimate.documents)} documents were flagged.`,
    }),
    consequence(
      'Asked for a fraction instead of a verdict',
      `the answer landed ${points(Math.abs(value - fraction))} from the truth, with an ` +
      'interval that says how far it could have been.',
    ),
  ]);
}

interface Rung {
  readonly size: number;
  readonly mixture: Mixture;
  readonly estimate: PrevalenceEstimate;
}

function renderLadder(rungs: Rung[], fraction: number): HTMLElement {
  const usable = rungs.filter((rung) => rung.estimate.interval !== null);
  const chart = lineChart({
    series: [
      {
        label: 'estimated marked fraction',
        className: 'series-wm',
        points: usable.map((rung) => ({ x: rung.size, y: rung.estimate.estimate ?? 0 })),
      },
      {
        label: 'the fraction the corpus was built at',
        className: 'marker-alt',
        points: usable.map((rung) => ({ x: rung.size, y: fraction })),
      },
    ],
    band: usable.map((rung) => ({
      x: rung.size,
      low: rung.estimate.interval?.low ?? 0,
      high: rung.estimate.interval?.high ?? 1,
    })),
    xLabel: 'documents in the corpus',
    yLabel: 'marked fraction',
    title: 'The estimate against corpus size',
    takeaway:
      'What to look for: the dashed line is the fraction the corpus was built at, and the ' +
      'grey band is the 95% interval. The band closes as documents are added; the ' +
      'individual verdicts underneath it never get any better.',
    description:
      'Estimated marked fraction against the number of documents in the corpus, with its ' +
      '95% interval as a band and the true fraction as a dashed line. Both the estimate ' +
      'and the interval come from the same operating point; only the corpus grows.',
  });

  const rows = rungs.map((rung) => el('tr', {}, [
    el('td', { class: 'num', text: integer(rung.size) }),
    el('td', { class: 'num', text: integer(rung.estimate.positives) }),
    el('td', { class: 'num', text: percent(rung.estimate.positiveRate) }),
    el('td', { class: 'num', text: percent(rung.estimate.estimate) }),
    el('td', {
      class: 'num',
      text: rung.estimate.interval
        ? `${percent(rung.estimate.interval.low)} – ${percent(rung.estimate.interval.high)}`
        : 'n/a',
    }),
    el('td', { class: 'num', text: percent(rung.estimate.halfWidth) }),
  ]));

  return panel('The same corpus, grown', [
    chart,
    scroller('Estimate at each corpus size', [
      el('table', {}, [
        el('thead', {}, [el('tr', {}, [
          el('th', { class: 'num', text: 'Documents' }),
          el('th', { class: 'num', text: 'Flagged' }),
          el('th', { class: 'num', text: 'Flagged fraction' }),
          el('th', { class: 'num', text: 'Estimated marked' }),
          el('th', { class: 'num', text: '95% interval' }),
          el('th', { class: 'num', text: '± half-width' }),
        ])]),
        el('tbody', {}, rows),
      ]),
    ]),
    reasoning([el('p', { class: 'note' }, [
      'Each corpus contains the one above it: documents are added, never redrawn. The ' +
      'estimate wanders early — the smallest corpus here is 32 documents, and a handful of ' +
      'flags either way moves it several points — and the interval is what says so at ' +
      'every size, rather than only where it happens to be wide.',
    ])], 'How the ladder is built'),
  ], provenanceTag('demo', 'Wilson interval carried through the correction'));
}

function renderCalibration(
  point: OperatingPoint, heldOutFpr: number, heldOutTpr: number,
): HTMLElement {
  return panel('What the detector was calibrated to do', [
    readout([
      ['Threshold (mean g-score)', fixed(point.threshold, 4)],
      ['Placed for a false-positive rate of', percent(TARGET_FPR)],
      ['Calibration documents, unmarked', integer(point.unmarkedCalibrationCount)],
      ['Calibration documents, marked', integer(point.markedCalibrationCount)],
      ['False-positive rate, calibration', percent(point.falsePositiveRate)],
      ['True-positive rate, calibration', percent(point.truePositiveRate)],
      ['False-positive rate, held-out documents', percent(heldOutFpr)],
      ['True-positive rate, held-out documents', percent(heldOutTpr)],
      ['Separation the correction divides by',
        percent(point.truePositiveRate - point.falsePositiveRate)],
    ], 'Operating point'),
    reasoning([
      el('p', { class: 'note' }, [
        'The threshold is placed on unmarked calibration documents alone, then both rates are ' +
        'measured at it. The two held-out rows are the same rates on documents the threshold ' +
        'never saw: they are not what the correction uses, and the distance between the two ' +
        'pairs is the part of the answer’s error that no amount of corpus would remove.',
      ]),
      el('p', { class: 'note' }, [
        'The separation is the detector’s whole worth as an instrument here. Divide by it and ' +
        'the sampling error in the flagged count is magnified by its reciprocal — which is ' +
        `why a corpus scored by a detector this weak (${percent(point.truePositiveRate)} of ` +
        'marked documents flagged) still needs hundreds of documents to reach an interval a ' +
        'few points wide.',
      ]),
    ], 'How the threshold was placed, and what the separation costs'),
  ], provenanceTag('pinned', `${integer(CALIBRATION_TEXTS * 2)} calibration texts`));
}

function renderSingleDocument(
  last: Rung,
  flaggedMarked: number,
  flaggedUnmarked: number,
  precision: number,
  fraction: number,
): HTMLElement {
  // Measured on this corpus rather than carried over from calibration: the sentence below
  // is about the documents on screen, and the two numbers are close but not the same.
  const missRate = last.mixture.markedCount > 0
    ? 1 - flaggedMarked / last.mixture.markedCount
    : Number.NaN;
  // The same interval arithmetic, applied to the one question this act says it cannot
  // answer: of the documents flagged, how many were actually marked?
  const precisionInterval = wilsonInterval(flaggedMarked, last.estimate.positives);
  return panel('The same corpus, one document at a time', [
    readout([
      ['Marked documents in the corpus', integer(last.mixture.markedCount)],
      ['Marked documents flagged', integer(flaggedMarked)],
      ['Marked documents missed', integer(last.mixture.markedCount - flaggedMarked)],
      ['Unmarked documents in the corpus', integer(last.mixture.unmarkedCount)],
      ['Unmarked documents flagged', integer(flaggedUnmarked)],
      ['Of the flagged documents, share actually marked', percent(precision)],
      ['95% interval on that share',
        `${percent(precisionInterval.low)} to ${percent(precisionInterval.high)}`],
    ], 'Individual verdicts on the same corpus'),
    el('p', { class: 'note' }, [
      'These are the individual verdicts the population estimate was computed from, and ' +
      'they are poor. At a corpus built ' + percent(fraction) + ' marked, a flag on one ' +
      'document is wrong ' + percent(1 - precision) + ' of the time it fires, and the ' +
      'detector misses ' + percent(missRate) + ' of the marked documents ' +
      'altogether. Nothing above changed either number. The corpus-level answer is not a ' +
      'better verdict on any of these documents; it is a different question, asked of the ' +
      'same evidence.',
    ]),
    consequence(
      'Accused one document instead of measuring the corpus',
      `${percent(1 - precision)} of the accusations would have been wrong.`,
    ),
  ], provenanceTag('demo', 'the same flags, counted the other way'));
}

/** A fraction as a percentage, at the one decimal these counts actually support. */
function percent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * A DIFFERENCE between two fractions, which is not a percentage of anything.
 *
 * Printing it with a per-cent sign would say the estimate was out by 0.8% of the true
 * fraction, and it is out by 0.8 of a hundred documents — a factor of forty apart at the
 * mixtures this act offers.
 */
function points(value: number): string {
  if (!Number.isFinite(value)) return 'n/a';
  const size = (value * 100).toFixed(1);
  return `${size} percentage point${size === '1.0' ? '' : 's'}`;
}
