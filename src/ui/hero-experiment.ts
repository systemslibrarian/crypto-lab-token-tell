/**
 * Same bytes, different key.
 *
 * The first interaction on the page, and the one to protect if anything has to be cut.
 * Three runs through one detector: a watermarked sample under the configured key, the
 * identical bytes under a wrong key, and an unwatermarked control. Then the same
 * experiment repeated across many random keys, so the single theatrical case becomes a
 * distribution.
 *
 * Nothing here is precomputed. The scores are produced by the same functions Act II
 * exposes, called on the same committed token ids.
 *
 * Two staging decisions are encoded here and worth naming. The first is that the identity
 * claim is compressed to one sentence with the digests a click behind it: three
 * sixty-four-character hex runs above the cards are the checkable part of the experiment
 * and nobody's first impression of it, and printing both at full weight was costing the
 * verdict its place. The second is that the reveal the hero button replays stages content
 * and never opacity — the scores are already computed before the button exists, so what is
 * being sequenced is when an answer becomes readable, and text held at zero opacity is
 * text a reader can still select and a screen reader still announces while the audience
 * cannot see it.
 */

import texts from '../data/pinned/texts.json';
import { encodeUtf8, sha256Hex } from '../c2pa/manifest.ts';
import { defaultConstruction, transformersConstruction, watermarkParams } from '../lab-config.ts';
import { drawKeySets, empiricalTail, wrongKeyNull } from '../watermark/null-model.ts';
import type { NullDistribution } from '../watermark/null-model.ts';
import { withKeys } from '../watermark/params.ts';
import { scoreTokens } from '../watermark/score.ts';
import { resetButton, runGuarded } from './busy.ts';
import { histogram } from './chart.ts';
import {
  actHeader, button, clear, consequence, disclosure, el, fixed, integer, labelledRange,
  liveRegion, nextFrame, panel, provenanceTag, readout, srOnly, verdict,
} from './dom.ts';
import { labOnly } from './mode.ts';
import { renderResultCard } from './score-card.ts';
import type { ResultCard } from './score-card.ts';

const GPT2_EOS = 50256;
const WRONG_KEY_MASK = 0x5a5a5;

/** One beat of the replay. Long enough to read a verdict, short enough to stay one gesture. */
const BEAT_MS = 750;

/** The wrong key is the configured key with a fixed pattern folded in — a key, not noise. */
function wrongKeys(): number[] {
  return watermarkParams.keys.map((key) => key ^ WRONG_KEY_MASK);
}

function oneBitKeys(): number[] {
  const keys = [...watermarkParams.keys];
  keys[0] ^= 1;
  return keys;
}

/**
 * A block of card content and the placeholder that stands in for it while the reveal is
 * running. The content element is held rather than rebuilt: it is the real, already
 * computed result, and re-deriving it for a replay would make the animation the source of
 * the answer instead of the record of it.
 */
interface Stage {
  readonly host: HTMLElement;
  readonly content: HTMLElement;
  readonly waiting: HTMLElement;
  /** What the placeholder says unless a beat overrides it, and what a restart restores. */
  readonly initialWaiting: string;
}

/** Wrap an element that is already in place, so staging never has to know its parent. */
function stageIn(content: HTMLElement, waitingText: string): Stage {
  const host = el('div', { class: 'stage-host' });
  content.replaceWith(host);
  host.append(content);
  return {
    host,
    content,
    waiting: el('p', { class: 'result-waiting', text: waitingText }),
    initialWaiting: waitingText,
  };
}

function showStage(stage: Stage, revealed: boolean, waitingText?: string): void {
  clear(stage.host);
  if (revealed) {
    stage.host.append(stage.content);
    return;
  }
  stage.waiting.textContent = waitingText ?? stage.initialWaiting;
  stage.host.append(stage.waiting);
}

/**
 * Timers belonging to a reveal in flight. Module state because the button that starts one
 * outlives the hero's DOM: a global reset rebuilds this section while a replay may still
 * be part-way through it, and a timer that fires afterwards would put a card that no
 * longer exists back into a placeholder.
 */
let replayTimers: number[] = [];

/** Detaches the previous render's handler; `#run-the-proof` is not rebuilt with the act. */
let detachCta: (() => void) | null = null;

function cancelReplay(): void {
  for (const timer of replayTimers) window.clearTimeout(timer);
  replayTimers = [];
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Two sticky bars stand above the document and the target is a panel rather than an act,
 * so it carries no `scroll-margin-top` of its own. Both bars measure themselves into
 * custom properties at mount; reading those is what keeps the landing position right when
 * a bar changes height rather than a constant that was true once.
 */
function scrollToProof(target: HTMLElement): void {
  const styles = window.getComputedStyle(document.documentElement);
  const bar = (name: string): number =>
    Number.parseFloat(styles.getPropertyValue(name)) || 0;
  const top = target.getBoundingClientRect().top + window.scrollY
    - (bar('--cl-topbar-h') + bar('--chapters-h') + 14);
  window.scrollTo({
    top: Math.max(0, top),
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  });
}

interface Scenario {
  readonly headline: string;
  readonly subject: string;
  readonly tokenIds: readonly number[];
  readonly keys: readonly number[];
  readonly keyDescription: string;
  readonly change: string;
  readonly waiting: string;
}

function scenarios(): Scenario[] {
  return [
    {
      headline: 'Correct key',
      subject: 'Run 1 · watermarked text, configured key',
      tokenIds: texts.samples.watermarked.token_ids,
      keys: watermarkParams.keys,
      keyDescription: 'the key the generator used',
      change: 'Nothing was changed: this is the text as it was generated, read with the '
        + 'key that marked it.',
      waiting: 'Waiting for run 1.',
    },
    {
      headline: 'Wrong key, same bytes',
      subject: 'Run 2 · the same bytes, a wrong key',
      tokenIds: texts.samples.watermarked.token_ids,
      keys: wrongKeys(),
      keyDescription: 'a different key of the same shape',
      change: 'Byte-identical input to run 1. The key is the only thing that changed.',
      waiting: 'Waiting for run 2.',
    },
    {
      headline: 'Control',
      subject: 'Run 3 · unwatermarked control, configured key',
      tokenIds: texts.samples.control.token_ids,
      keys: watermarkParams.keys,
      keyDescription: 'the key the generator used, on text it never touched',
      change: 'A different text, never watermarked, read with the configured key.',
      waiting: 'Waiting for run 3.',
    },
  ];
}

export function renderHeroExperiment(root: HTMLElement): void {
  cancelReplay();
  clear(root);
  root.append(...actHeader(
    'hero-experiment',
    'The experiment',
    'Same text, different key',
    'One watermarked passage, three runs of one detector. The first two runs are given ' +
    'byte-identical input and differ only in the key. Watch what happens to the evidence.',
  ));

  const inputs = renderInputs();
  root.append(inputs.node);

  const runs = el('div', { class: 'grid grid-3 result-grid' });
  const cardStages: Stage[] = [];
  for (const scenario of scenarios()) {
    const result = scoreTokens(
      scenario.tokenIds, withKeys(watermarkParams, scenario.keys), defaultConstruction, GPT2_EOS);
    const card: ResultCard = renderResultCard(result, {
      headline: scenario.headline,
      subject: scenario.subject,
      keyDescription: scenario.keyDescription,
      constructionLabel: defaultConstruction.label,
      change: scenario.change,
    });
    cardStages.push(stageIn(card.body, scenario.waiting));
    runs.append(el('div', { class: 'panel' }, [card.node]));
  }
  root.append(runs);

  // The replay changes what three cards say without moving focus, so the beats are
  // narrated for a reader who is not watching them arrive.
  const narration = srOnly('');
  narration.setAttribute('role', 'status');
  narration.setAttribute('aria-live', 'polite');
  root.append(narration);

  root.append(consequence('Changed only the secret', 'the watermark verdict disappeared.'));

  root.append(labOnly(renderKeySweep()));
  root.append(labOnly(renderOneBit()));
  root.append(labOnly(renderCrossImplementation()));

  root.append(labOnly(el('p', { class: 'act-lede' }, [
    'Why did changing only the key make the evidence disappear? The next section opens up ' +
    'the choice the key was making.',
  ])));

  wireCta(makeReplay(inputs, cardStages, narration));
}

/**
 * The reveal, as a sequence of already-answered questions.
 *
 * Restarting rather than queueing is what makes a second press safe: every run begins by
 * cancelling whatever is in flight and ends with every stage revealed, so no card can be
 * left holding a placeholder however often the button is pressed. Under a reduced-motion
 * preference there are no timers at all — not shortened ones — because the request is for
 * the answer, not for a faster performance of it.
 */
function makeReplay(
  inputs: { node: HTMLElement; stage: Stage },
  cards: Stage[],
  narration: HTMLElement,
): () => void {
  const stages = [inputs.stage, ...cards];
  const revealAll = (): void => {
    for (const stage of stages) showStage(stage, true);
  };

  return () => {
    cancelReplay();
    scrollToProof(inputs.node);

    if (prefersReducedMotion()) {
      revealAll();
      narration.textContent = 'The three results are shown in full.';
      return;
    }

    for (const stage of stages) showStage(stage, false);

    const beats: (() => void)[] = [
      () => {
        showStage(inputs.stage, true);
        narration.textContent = 'Runs 1 and 2 are given byte-identical input.';
      },
      () => {
        showStage(cards[0], true);
        narration.textContent = 'Run 1, under the configured key: evidence.';
      },
      () => {
        showStage(cards[1], false, 'Same bytes. Changing only the key…');
        narration.textContent = 'Changing only the key.';
      },
      () => {
        showStage(cards[1], true);
        narration.textContent = 'Run 2, the same bytes under a wrong key: no evidence.';
      },
      () => {
        showStage(cards[2], true);
        narration.textContent = 'Run 3, unwatermarked control: no evidence.';
      },
    ];
    beats.forEach((beat, index) => {
      replayTimers.push(window.setTimeout(beat, (index + 1) * BEAT_MS));
    });
  };
}

/**
 * The page's first action, which ships disabled because it is offered before the detector
 * has produced anything for it to reveal. The shipped title says exactly that, and stops
 * being true the moment the button works, so it is replaced rather than left standing.
 */
function wireCta(replay: () => void): void {
  const cta = document.getElementById('run-the-proof');
  if (!(cta instanceof HTMLButtonElement)) return;
  detachCta?.();
  const handler = (): void => replay();
  cta.addEventListener('click', handler);
  detachCta = () => cta.removeEventListener('click', handler);
  cta.disabled = false;
  cta.title = 'Scrolls to the three results and replays the reveal. Nothing is recomputed.';
}

/**
 * The identity claim, compressed.
 *
 * The experiment is worth nothing unless runs 1 and 2 really were given the same bytes, so
 * the digests stay on the page and stay checkable. What changed is which of the two is met
 * first: the statement leads, and the sixty-four-character evidence for it is one click
 * away, with a copy affordance for anyone who wants to check it against their own hash.
 */
function renderInputs(): { node: HTMLElement; stage: Stage } {
  const watermarked = texts.samples.watermarked;
  const control = texts.samples.control;

  const digests = el('div', { class: 'readout' });
  const detail = disclosure('Show the full digests', () => [
    digests,
    el('p', { class: 'note' }, [
      'Not similar text, not a regenerated version — the same bytes, hashed here so the ' +
      'claim is checkable rather than asserted.',
    ]),
  ], { class: 'identity-digests', eager: true });

  const status = srOnly('');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  let shared = '';
  let revert = 0;
  const copy = button('Copy the shared digest', () => {
    if (!shared) {
      status.textContent = 'The digests are still being computed.';
      return;
    }
    const clipboard = navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      detail.setAttribute('open', '');
      status.textContent = 'This browser would not give the page the clipboard. The full '
        + 'digests are printed below.';
      return;
    }
    void clipboard.writeText(shared).then(
      () => {
        copy.textContent = 'Digest copied';
        status.textContent = 'Digest copied.';
        window.clearTimeout(revert);
        revert = window.setTimeout(() => { copy.textContent = 'Copy the shared digest'; }, 4000);
      },
      () => {
        // A refused clipboard is an expected outcome rather than a fault, so it is
        // answered on the page instead of in the developer tools.
        detail.setAttribute('open', '');
        status.textContent = 'The clipboard was refused. The full digests are printed below.';
      },
    );
  });
  copy.classList.add('identity-copy');

  const claim = el('div', { class: 'identity' }, [
    el('p', { class: 'identity-claim' }, [
      el('b', { text: 'Runs 1 and 2: same SHA-256.' }),
      ' Run 3 is a different text, and its digest says so.',
    ]),
    el('div', { class: 'controls' }, [copy]),
    detail,
    status,
  ]);

  const node = panel('The inputs', [claim], provenanceTag('pinned', 'GPT-2 continuations'));
  const stage = stageIn(claim, 'Hashing the two inputs…');

  void (async () => {
    try {
      const watermarkedHash = await sha256Hex(encodeUtf8(watermarked.text));
      const controlHash = await sha256Hex(encodeUtf8(control.text));
      shared = watermarkedHash;
      clear(digests);
      digests.append(el('dl', {}, [
        el('dt', { text: 'Run 1 input (SHA-256)' }),
        el('dd', { class: 'hash', text: watermarkedHash }),
        el('dt', { text: 'Run 2 input (SHA-256)' }),
        el('dd', { class: 'hash', text: watermarkedHash }),
        el('dt', { text: 'Run 3 input (SHA-256)' }),
        el('dd', { class: 'hash', text: controlHash }),
        el('dt', { text: 'Runs 1 and 2 identical' }),
        el('dd', { text: 'yes — same bytes, different key' }),
      ]));
    } catch (error) {
      // `crypto.subtle` does not exist outside a secure context. The claim above is only
      // worth making if it can be checked, so say plainly that it cannot be here.
      clear(digests);
      digests.append(verdict(
        'alarm',
        'The digests could not be computed',
        `${error instanceof Error ? error.message : String(error)} This browser gave the `
        + 'page no SHA-256, so the identity of the two inputs cannot be checked here.',
      ));
    }
  })();

  return { node, stage };
}

/**
 * The theatrical single wrong key, generalised.
 *
 * One wrong key proves nothing on its own — it could have been an unlucky draw. Many
 * wrong keys give the null a shape, and the shape is the argument.
 */
function renderKeySweep(): HTMLElement {
  const output = liveRegion('Wrong-key distribution results');
  const chartHost = el('div');
  const progress = el('p', { class: 'progress', role: 'status', 'aria-live': 'polite' });

  const { field, input, output: sizeOutput } = labelledRange(
    'wrong-key-count', 'Random wrong keys to try', 20, 300, 100);
  input.addEventListener('input', () => { sizeOutput.textContent = input.value; });

  const sweep = async (): Promise<void> => {
    clear(output);
    clear(chartHost);
    // The busy text is written here rather than handed to the guard: the guard clears its
    // progress element when the work settles, and the last line this one prints — the
    // count that was actually scored — is the record of the run and has to survive it.
    progress.textContent = 'Scoring the same bytes under random wrong keys…';
    const count = Number(input.value);
    const keySets = drawKeySets(20260819, count, watermarkParams.keys.length,
      watermarkParams.keys);
    const tokenIds = texts.samples.watermarked.token_ids;

    // Chunked so the page can paint a progress line instead of freezing: at the reference
    // implementation's depth of 30 every key set walks the whole sequence again.
    const scores: number[] = [];
    const chunkSize = 10;
    let scoredPositions = 0;
    for (let start = 0; start < keySets.length; start += chunkSize) {
      const chunk = keySets.slice(start, start + chunkSize);
      const partial = wrongKeyNull(tokenIds, watermarkParams, defaultConstruction, chunk,
        GPT2_EOS);
      scores.push(...partial.scores);
      scoredPositions = partial.scoredPositions;
      progress.textContent = `Scored ${scores.length} of ${keySets.length} wrong keys.`;
      await nextFrame();
    }

    const nullDist: NullDistribution = {
      scores,
      mean: scores.reduce((a, b) => a + b, 0) / scores.length,
      sd: Math.sqrt(scores.reduce((a, s, _i, arr) =>
        a + (s - arr.reduce((x, y) => x + y, 0) / arr.length) ** 2, 0) / (scores.length - 1)),
      min: Math.min(...scores),
      max: Math.max(...scores),
      scoredPositions,
      depth: watermarkParams.keys.length,
    };
    const observed = scoreTokens(tokenIds, watermarkParams, defaultConstruction, GPT2_EOS);
    const tail = empiricalTail(observed.score as number, nullDist);

    progress.textContent = `Scored ${scores.length} of ${keySets.length} wrong keys. Done.`;
    output.append(readout([
      ['Correct-key score', fixed(observed.score)],
      ['Wrong keys tried', integer(scores.length)],
      ['Wrong-key mean', fixed(nullDist.mean)],
      ['Wrong-key spread (sd)', fixed(nullDist.sd, 5)],
      ['Lowest wrong-key score', fixed(nullDist.min)],
      ['Highest wrong-key score', fixed(nullDist.max)],
      ['Wrong keys at or above the correct one', integer(tail.atOrAbove)],
      ['Empirical p-value', tail.pValue.toPrecision(3)],
      ['Distance in wrong-key spreads', fixed(tail.zAgainstEmpiricalNull ?? Number.NaN, 1)],
      ['Predicted spread if independent',
        fixed(Math.sqrt(0.25 / (scoredPositions * watermarkParams.keys.length)), 5)],
    ], 'Wrong-key sweep statistics'));

    output.append(el('p', { class: 'note' }, [
      'The last two rows are the check the page is really making. The paper argues that ' +
      'repeated-context masking leaves the counted g-values independent, which fixes the ' +
      'spread at the predicted value. The measured spread is right there beside it. They ' +
      'are not asserted to agree.',
    ]));

    chartHost.append(
      // The figure states counts and a range; what it is for belongs above it, where a
      // reader meets it before the drawing rather than after.
      el('p', { class: 'chart-takeaway' }, [
        'Wrong keys land near 0.5, which is what a key that never marked this text should ' +
        'do; the distance between that spread and the configured key is the measurement.',
      ]),
      histogram({
        values: scores,
        marker: { value: observed.score as number, label: 'configured key' },
        secondaryMarker: { value: 0.5, label: 'no-mark expectation' },
        title: 'Scores of the same bytes under random wrong keys',
        xLabel: 'mean g-score',
      }),
    );
  };

  const runButton = button('Run the sweep', () => {
    void runGuarded(sweep, {
      controls: [runButton, input, reset],
      region: output,
      onError: () => { progress.textContent = 'The sweep did not finish.'; },
    });
  }, true);

  const reset = resetButton('Reset the sweep', () => {
    clear(output);
    clear(chartHost);
    progress.textContent = '';
    input.value = '100';
    sizeOutput.textContent = '100';
  });

  return panel('Not one wrong key — many', [
    el('p', { class: 'note' }, [
      'Do not take one wrong key on trust. Score the identical bytes under a whole ' +
      'population of random keys and see where the configured key falls in it.',
    ]),
    el('div', { class: 'controls' }, [field, runButton, reset]),
    progress,
    output,
    chartHost,
  ], provenanceTag('paper', 'mean g-score, empirical null'));
}

/**
 * One bit.
 *
 * In this construction the keys are hashed together into the initialization vector of the
 * whole chain, so a single flipped bit in one of thirty keys does not cost a thirtieth of
 * the evidence. It costs all of it.
 */
function renderOneBit(): HTMLElement {
  const tokenIds = texts.samples.watermarked.token_ids;
  const correct = scoreTokens(tokenIds, watermarkParams, defaultConstruction, GPT2_EOS);
  const flipped = scoreTokens(
    tokenIds, withKeys(watermarkParams, oneBitKeys()), defaultConstruction, GPT2_EOS);

  return panel('One bit of one key', [
    el('p', { class: 'note' }, [
      `The configured key is a list of ${integer(watermarkParams.keys.length)} integers, one ` +
      'per tournament layer. Here the lowest bit of the first one is flipped and nothing ' +
      'else changes.',
    ]),
    readout([
      ['Configured keys, first entry', String(watermarkParams.keys[0])],
      ['Flipped keys, first entry', String(oneBitKeys()[0])],
      ['Remaining keys', 'unchanged'],
      ['Score, configured keys', fixed(correct.score)],
      ['Score, one bit flipped', fixed(flipped.score)],
      ['Evidence remaining', `${fixed(((flipped.score ?? 0.5) - 0.5) / ((correct.score ?? 0.5) - 0.5) * 100, 1)}%`],
    ], 'One-bit key mutation'),
    el('p', { class: 'note' }, [
      'A thirtieth of the key material changed, and effectively none of the evidence ' +
      'survived. That is a property of this construction rather than of watermarking in ' +
      'general: the reference implementation hashes the whole key list with SHA-256 into ' +
      'the initialization vector that seeds every hash in the chain, so touching any key ' +
      'changes every g-value at every layer. The transformers implementation, which seeds ' +
      'its chain with the literal 1 and folds each key in only at its own layer, loses ' +
      'roughly one layer of evidence instead.',
    ]),
  ], provenanceTag('reference', 'synthid-text @ addb4a1'));
}

/**
 * Two reference implementations, one key, one text.
 *
 * This is Act VII arriving early, as a measurement. The detector below is not
 * misconfigured and the key is not wrong; it is a faithful implementation of the same
 * published scheme, and it cannot read this mark.
 */
function renderCrossImplementation(): HTMLElement {
  const tokenIds = texts.samples.watermarked.token_ids;
  const mine = scoreTokens(tokenIds, watermarkParams, defaultConstruction, GPT2_EOS);
  const other = scoreTokens(tokenIds, watermarkParams, transformersConstruction, GPT2_EOS);

  return panel('The same key, a different implementation', [
    el('p', { class: 'note' }, [
      'SynthID-Text has more than one published implementation. This passage was ' +
      'watermarked by the official reference implementation. Below it is scored twice ' +
      'with the same keys: once by that implementation’s g-function, and once by the ' +
      'one shipped in transformers, which computes g-values a different way.',
    ]),
    readout([
      ['Text', 'identical bytes in both rows'],
      ['Keys', 'identical in both rows'],
      [`Score · ${defaultConstruction.label}`, fixed(mine.score)],
      [`Score · ${transformersConstruction.label}`, fixed(other.score)],
      ['Scored positions', integer(mine.scoredPositions)],
    ], 'Cross-implementation comparison'),
    el('p', { class: 'note' }, [
      'Neither implementation is broken. The official repository derives g-values by ' +
      're-hashing and reading a bit; transformers indexes a pinned table of random bits, ' +
      'and seeds its chain differently. "The watermark configuration" therefore means more ' +
      'than the key: it includes which construction produced the mark. This is the whole ' +
      'of Act VII in one table, and it is measured rather than argued.',
    ]),
  ], provenanceTag('reference', 'two implementations'));
}
