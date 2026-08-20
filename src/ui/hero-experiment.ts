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
 * Three staging decisions are encoded here and worth naming. The first is that the identity
 * claim is compressed to one sentence with the digests a click behind it: three
 * sixty-four-character hex runs above the cards are the checkable part of the experiment
 * and nobody's first impression of it, and printing both at full weight was costing the
 * verdict its place. The second is that the reveal the hero button replays stages content
 * and never opacity — the scores are already computed before the button exists, so what is
 * being sequenced is when an answer becomes readable, and text held at zero opacity is
 * text a reader can still select and a screen reader still announces while the audience
 * cannot see it. The third is that the reveal moves the page: on a phone the closing line
 * sat eleven hundred pixels below the last thing the reader had been shown, so the two
 * beats that carry the argument — the first verdict and the consequence — bring themselves
 * into the band between the two sticky bars. A beat played below the fold has not played.
 */

import texts from '../data/pinned/texts.json';
import { encodeUtf8, sha256Hex } from '../c2pa/manifest.ts';
import { defaultConstruction, transformersConstruction, watermarkParams } from '../lab-config.ts';
import { drawKeySets, empiricalTail, wrongKeyNull } from '../watermark/null-model.ts';
import type { NullDistribution } from '../watermark/null-model.ts';
import { withKeys } from '../watermark/params.ts';
import { scoreTokens } from '../watermark/score.ts';
import { armableReset, runGuarded } from './busy.ts';
import { histogram } from './chart.ts';
import {
  actHeader, button, clear, consequence, disclosure, el, fixed, integer, labelledRange,
  liveRegion, nextFrame, panel, provenanceTag, readout, reasoning, srOnly, verdict,
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
 * Where the readable band begins.
 *
 * Two sticky bars stand above the document and the targets here are panels rather than
 * acts, so they carry no `scroll-margin-top` of their own. Both bars measure themselves
 * into custom properties at mount; reading those is what keeps every landing position
 * right when a bar changes height, rather than a constant that was true once.
 */
function stickyTop(): number {
  const styles = window.getComputedStyle(document.documentElement);
  const bar = (name: string): number =>
    Number.parseFloat(styles.getPropertyValue(name)) || 0;
  return bar('--cl-topbar-h') + bar('--chapters-h');
}

function scrollToProof(target: HTMLElement): void {
  const top = target.getBoundingClientRect().top + window.scrollY - (stickyTop() + 14);
  window.scrollTo({
    top: Math.max(0, top),
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  });
}

/**
 * Bring the bottom of an element into the readable band, and no further.
 *
 * A reveal that lands its answer below the fold has not revealed anything: on a phone the
 * closing line sat over a thousand pixels under the last thing the reader was shown, and on
 * a laptop in presentation shape the first verdict never made it onto the screen at all.
 * So the page follows the beat down — only downward, so a reader who has scrolled ahead is
 * never dragged back, and only as far as this element's own bottom needs.
 *
 * The second clamp is the one worth naming: an element taller than the band would otherwise
 * be scrolled until the part that names it — a card's headline, a verdict's word — was off
 * the top, which trades one invisible half for another. Stopping at the element's own top
 * keeps the beginning of the answer on screen and lets the tail of it wait.
 */
function scrollIntoBand(target: HTMLElement, behavior: ScrollBehavior): void {
  const rect = target.getBoundingClientRect();
  const below = rect.bottom - window.innerHeight;
  const headroom = rect.top - stickyTop();
  const move = Math.max(0, Math.min(below, headroom));
  if (move < 1) return;
  window.scrollTo({ top: window.scrollY + move, behavior });
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
    'The proof',
    'Same text, different key',
    'One watermarked passage, three runs of one detector. The first two runs are given ' +
    'byte-identical input and differ only in the key. Watch what happens to the evidence.',
  ));

  root.append(renderLineage());

  const inputs = renderInputs();
  root.append(inputs.node);

  const runs = el('div', { class: 'grid grid-3 result-grid' });
  const cardStages: Stage[] = [];
  const cardPanels: HTMLElement[] = [];
  const figures: HTMLElement[] = [];
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
    figures.push(card.figure);
    const host = el('div', { class: 'panel' }, [card.node]);
    cardPanels.push(host);
    runs.append(host);
  }
  root.append(runs);

  // The largest number on the page is a term of art, and the short route never reaches the
  // act that defines it: "mean g-score" is printed six times before Act II, which is where
  // the definition lives and which the demo depth hides. One sentence, untagged so both
  // depths carry it — a second definition an auditor scrolls past costs nothing, and a
  // figure nobody can read costs the whole demonstration.
  root.append(el('p', { class: 'note' }, [
    'A g-score is the detector’s average over the text. Unmarked text averages 0.500; the ' +
    'marked pattern pushes it up.',
  ]));

  // The replay changes what three cards say without moving focus, so the beats are
  // narrated for a reader who is not watching them arrive.
  const narration = srOnly('');
  narration.setAttribute('role', 'status');
  narration.setAttribute('aria-live', 'polite');
  root.append(narration);

  const closing = consequence('Changed only the secret', 'the watermark verdict disappeared.');
  root.append(closing);

  root.append(labOnly(renderKeySweep()));
  root.append(labOnly(renderOneBit()));
  root.append(labOnly(renderCrossImplementation()));

  root.append(labOnly(el('p', { class: 'act-lede' }, [
    'Why did changing only the key make the evidence disappear? The next section opens up ' +
    'the choice the key was making.',
  ])));

  wireCta(makeReplay(inputs, cardStages, narration, {
    firstPanel: cardPanels[0],
    firstFigure: figures[0],
    closing,
  }));
}

/**
 * Where a mark can go: the substrate, the signal, the choices.
 *
 * The word "watermark" is doing a lot of work on this page, and it arrives carrying seven
 * and a half centuries of a technique that behaves nothing like the one below it. Three beats are
 * enough to make the difference structural rather than terminological: each move puts the
 * identifier further inside the thing being marked, and the last move runs out of thing.
 * That is the sentence the whole lab is a demonstration of — a mark in the sheet can be
 * read by anyone with a window, and a mark in the word choices cannot be read without the
 * key.
 *
 * Every date and every quotation here is from a primary or scholarly source rather than
 * from the potted history that circulates with them, and the reference section carries
 * both in full. Two of them are corrections: the first watermarks are usually dated 1282,
 * a date Briquet himself published with a question mark and which has never been
 * relocated since; and the Hembrooke patent's sentence is widely quoted as "can be
 * likened", where the patent says "may be".
 */
function renderLineage(): HTMLElement {
  // The same list shape the reference section's limitations use: an explicit role on both
  // halves, so the list survives whatever a stylesheet later does to its markers.
  const beat = (label: string, text: string): HTMLElement =>
    el('li', { role: 'listitem' }, [el('b', { text: `${label} ` }), text]);

  return panel('Where a mark can go', [
    el('p', {}, [
      'Three substrates, from the 1280s to this page, and the same idea each time: put ' +
      'the identifier inside the thing rather than beside it.',
    ]),
    el('ul', { role: 'list' }, [
      beat('Paper, from the 1280s.',
        'A figure bent in wire and stitched to the surface of the mould left less pulp ' +
        'where it sat. The sheet is thinner along the wire, more light passes through it ' +
        'there, and the shape appears when the page is held up to a window. Nothing is ' +
        'added to the sheet: the mark is a variation in the sheet itself.'),
      beat('Sound, 1954.',
        'Emil Hembrooke filed for Muzak Corporation a scheme that suppressed a narrow ' +
        'band of frequencies at timed intervals, to a code — inaudible, because the ear ' +
        'does not miss a band that was never there, and hard to strip, because it is part ' +
        'of the signal rather than an attachment to it. The patent reaches for the older ' +
        'craft by name: the invention, it says, "may be likened to a watermark in paper".'),
      beat('Text, on this page.',
        'There is no sheet to thin and no band to notch. The words are the whole of the ' +
        'artefact and every one of them is on display, so the only thing left that can ' +
        'carry a mark is which word came next — which is what the detector below is ' +
        'reading, and what the key it needs is for.'),
    ]),
    // Not folded, and measured rather than assumed: this is the one panel on the short
    // route with anything foldable in it, and behind a summary the demo page came out 60 px
    // TALLER at a laptop width and 158 px taller on a phone — a summary row, its border and
    // its margins cost about what the paragraph did. So the fold bought nothing here and
    // would have put a correction behind a click on the first panel a visitor meets.
    el('p', { class: 'note' }, [
      'Both of those come from the sources rather than from the version that circulates ' +
      'with them. The first watermarks are usually dated 1282; that is Briquet’s own ' +
      'entry, which he published with a question mark and which a systematic search of ' +
      'the same archive could not relocate, so the reliably dated examples are later in ' +
      'that decade. And Hembrooke’s sentence is widely quoted as "can be likened", where ' +
      'the patent — US 3,004,104, filed 29 April 1954, granted 10 October 1961 — says ' +
      '"may be". Both are cited in full in the reference section.',
    ]),
    // Deliberately not a `consequence`: that line is this page's device for reporting what
    // an experiment did when something was changed, and every one of them on this page
    // closes a measurement. This is a historical claim, and borrowing the form would put
    // it in the same voice as the three runs below.
    el('p', {}, [
      'Each move pushes the mark further inside the thing being marked, and the last one ' +
      'runs out of thing. ',
      el('b', { text: 'The mark ends up in the choices themselves' }),
      ' — and a choice, unlike a thinner sheet, cannot be checked by holding it to the ' +
      'light. It takes the key, which is what the rest of this page is about.',
    ]),
  ]);
}

/**
 * The three places a beat has to be able to leave the page.
 *
 * Held as elements rather than looked up when a timer fires: the section is rebuilt by the
 * global reset while a replay may still be part-way through it, and a selector evaluated at
 * that moment would find the new document's card and scroll to a beat nobody started.
 */
interface ReplayTargets {
  readonly firstPanel: HTMLElement;
  readonly firstFigure: HTMLElement;
  readonly closing: HTMLElement;
}

/**
 * Put the first verdict on screen, if it is not already.
 *
 * This is the beat that has to land, and on a short viewport the inputs panel above it
 * fills the readable band on its own — at 844×390 the verdict and its figure were both
 * zero pixels visible when the reveal reached them. Whether that is happening is measured
 * rather than predicted from the two heights: the difference between the prediction and
 * the truth is the card's own chrome — its title, its scope line, the grid gap — which is
 * exactly the amount that decides it at the narrow end.
 */
function landFirstCard(targets: ReplayTargets, behavior: ScrollBehavior): void {
  if (targets.firstFigure.getBoundingClientRect().bottom <= window.innerHeight) return;
  scrollIntoBand(targets.firstPanel, behavior);
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
  targets: ReplayTargets,
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
      // The same choice the staged reveal makes at its first card, made once and without
      // an animation: the request was for the answer, not for a faster performance of it,
      // and an answer off the bottom of the screen is not one.
      landFirstCard(targets, 'auto');
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
        landFirstCard(targets, 'smooth');
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
        // The line the whole sequence exists to earn. It is the last thing appended and
        // therefore the first thing to fall off the bottom of a short viewport, so the
        // closing beat carries the page to it instead of leaving the reader to find it.
        scrollIntoBand(targets.closing, 'smooth');
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
  let unhashable = false;
  const copy = button('Copy the shared digest', () => {
    if (!shared) {
      status.textContent = unhashable
        ? 'The digests could not be computed in this browser, so there is nothing to copy.'
        : 'The digests are still being computed.';
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

  const claimLine = el('p', { class: 'identity-claim' }, [
    el('b', { text: 'Runs 1 and 2: same SHA-256.' }),
    ' Run 3 is a different text, and its digest says so.',
  ]);

  const claim = el('div', { class: 'identity' }, [
    claimLine,
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
    } catch {
      // `crypto.subtle` does not exist outside a secure context. The claim above is only
      // worth making if it can be checked, so say plainly that it cannot be here — and say
      // it where it will be read. A notice folded inside a closed disclosure, under a
      // sentence still asserting a hash nobody computed, is the page telling a projector
      // audience something it does not know. So the disclosure opens itself, the claim
      // steps back to what the pinned inputs alone support, and the copy affordance stops
      // offering a value that will never arrive.
      //
      // The cause is named rather than the browser's own message repeated: "Cannot read
      // properties of undefined (reading 'digest')" names a property, not the plain-http
      // projector that produced it, which is the one thing a presenter can act on.
      unhashable = true;
      clear(digests);
      digests.append(verdict(
        'alarm',
        'The digests could not be computed',
        'This browser gave the page no SHA-256. crypto.subtle exists only in a secure '
        + 'context, so a lab served over plain http:// from anything other than localhost '
        + 'cannot hash the two inputs here. The same files over https:// restore this '
        + 'check. The token ids the three runs were scored from are unaffected.',
      ));
      detail.setAttribute('open', '');
      clear(claimLine);
      claimLine.append(
        el('b', { text: 'Runs 1 and 2 are the same bytes' }),
        ' — this browser cannot hash them to show it. Run 3 is a different text.',
      );
      copy.disabled = true;
      copy.title = 'There is no digest to copy: this browser gave the page no SHA-256.';
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
  // Visible, and deliberately not a live region. The per-chunk line exists so a sighted
  // reader can see the page working rather than frozen. A polite region queues rather than
  // replaces, so announcing every tenth key is up to thirty-one sentences read out over a
  // quarter-second of work, with the answer spoken last of all. What the sweep has to say
  // aloud is what it is doing and what it found, and both belong in the region that
  // carries the result.
  const progress = el('p', { class: 'progress' });

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
    // What the region says while it is working. The guard holds `aria-busy` on it for the
    // duration, so this is what a reader who inspects the region mid-run is told, and it
    // is folded into the one announcement the region makes when the busy flag clears.
    output.append(srOnly(`Scoring ${integer(count)} wrong keys…`));
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

    // The mean is named before the spread rather than recomputed inside it: the same sum
    // over every score, once per score, is quadratic work for a number that is already on
    // the line above.
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const nullDist: NullDistribution = {
      scores,
      mean,
      sd: Math.sqrt(scores.reduce((a, s) => a + (s - mean) ** 2, 0) / (scores.length - 1)),
      min: Math.min(...scores),
      max: Math.max(...scores),
      scoredPositions,
      depth: watermarkParams.keys.length,
    };
    const observed = scoreTokens(tokenIds, watermarkParams, defaultConstruction, GPT2_EOS);
    const tail = empiricalTail(observed.score as number, nullDist);

    progress.textContent = `Scored ${scores.length} of ${keySets.length} wrong keys. Done.`;
    // The opening line is replaced rather than added to, so what is finally announced is
    // the count and the statistics together, and not an answer queued behind a sentence
    // that has stopped being true.
    clear(output);
    output.append(srOnly(`Scored ${integer(scores.length)} of ${integer(keySets.length)} `
      + 'wrong keys.'));
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

    output.append(reasoning([el('p', { class: 'note' }, [
      'The last two rows are the check the page is really making. The paper argues that ' +
      'repeated-context masking leaves the counted g-values independent, which fixes the ' +
      'spread at the predicted value. The measured spread is right there beside it. They ' +
      'are not asserted to agree.',
    ])], 'What the last two rows are for'));

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
      controls: [runButton, input, reset.node],
      region: output,
      onError: () => { progress.textContent = 'The sweep did not finish.'; },
      // Armed after the guard has restored what it switched off, and only if the run left
      // something behind: `runGuarded` puts every control back to the disabled state it
      // found, so a control armed inside the run would be switched off again on the way
      // out.
      onSettled: () => { if (chartHost.childElementCount > 0) reset.arm(); },
    });
  }, true);

  const reset = armableReset(
    'Reset the sweep',
    'There is no sweep to reset yet. Run the sweep first; this then puts the panel back '
    + 'to the draw it ships with.',
    () => {
      clear(output);
      clear(chartHost);
      progress.textContent = '';
      input.value = '100';
      sizeOutput.textContent = '100';
    },
  );

  return panel('Not one wrong key — many', [
    el('p', { class: 'note' }, [
      'Do not take one wrong key on trust. Score the identical bytes under a whole ' +
      'population of random keys and see where the configured key falls in it.',
    ]),
    el('div', { class: 'controls' }, [field, runButton, reset.node]),
    reset.note,
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
  const flippedKeys = oneBitKeys();
  const correct = scoreTokens(tokenIds, watermarkParams, defaultConstruction, GPT2_EOS);
  const flipped = scoreTokens(
    tokenIds, withKeys(watermarkParams, flippedKeys), defaultConstruction, GPT2_EOS);

  return panel('One bit of one key', [
    el('p', { class: 'note' }, [
      `The configured key is a list of ${integer(watermarkParams.keys.length)} integers, one ` +
      'per tournament layer. Here the lowest bit of the first one is flipped and nothing ' +
      'else changes.',
    ]),
    readout([
      ['Configured keys, first entry', String(watermarkParams.keys[0])],
      ['Flipped keys, first entry', String(flippedKeys[0])],
      ['Remaining keys', 'unchanged'],
      ['Score, configured keys', fixed(correct.score)],
      ['Score, one bit flipped', fixed(flipped.score)],
      ['Evidence remaining', `${fixed(((flipped.score ?? 0.5) - 0.5) / ((correct.score ?? 0.5) - 0.5) * 100, 1)}%`],
    ], 'One-bit key mutation'),
    reasoning([el('p', { class: 'note' }, [
      'A thirtieth of the key material changed, and effectively none of the evidence ' +
      'survived. That is a property of this construction rather than of watermarking in ' +
      'general: the reference implementation hashes the whole key list with SHA-256 into ' +
      'the initialization vector that seeds every hash in the chain, so touching any key ' +
      'changes every g-value at every layer. The transformers implementation, which seeds ' +
      'its chain with the literal 1 and folds each key in only at its own layer, loses ' +
      'roughly one layer of evidence instead.',
    ])], 'Why one bit costs everything here'),
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
    reasoning([el('p', { class: 'note' }, [
      'Neither implementation is broken. The official repository derives g-values by ' +
      're-hashing and reading a bit; transformers indexes a pinned table of random bits, ' +
      'and seeds its chain differently. "The watermark configuration" therefore means more ' +
      'than the key: it includes which construction produced the mark. This is the whole ' +
      'of Act VII in one table, and it is measured rather than argued.',
    ])], 'Why two faithful implementations disagree'),
  ], provenanceTag('reference', 'two implementations'));
}
