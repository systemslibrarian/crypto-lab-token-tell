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
 */

import texts from '../data/pinned/texts.json';
import { encodeUtf8, sha256Hex } from '../c2pa/manifest.ts';
import { defaultConstruction, transformersConstruction, watermarkParams } from '../lab-config.ts';
import { drawKeySets, empiricalTail, wrongKeyNull } from '../watermark/null-model.ts';
import type { NullDistribution } from '../watermark/null-model.ts';
import { withKeys } from '../watermark/params.ts';
import { scoreTokens } from '../watermark/score.ts';
import { histogram } from './chart.ts';
import {
  actHeader, button, clear, el, fixed, integer, labelledRange, liveRegion, nextFrame,
  panel, provenanceTag, readout,
} from './dom.ts';
import { renderScoreCard } from './score-card.ts';

const GPT2_EOS = 50256;
const WRONG_KEY_MASK = 0x5a5a5;

/** The wrong key is the configured key with a fixed pattern folded in — a key, not noise. */
function wrongKeys(): number[] {
  return watermarkParams.keys.map((key) => key ^ WRONG_KEY_MASK);
}

function oneBitKeys(): number[] {
  const keys = [...watermarkParams.keys];
  keys[0] ^= 1;
  return keys;
}

export function renderHeroExperiment(root: HTMLElement): void {
  clear(root);
  root.append(...actHeader(
    'hero-experiment',
    'The experiment',
    'Same text, different key',
    'One watermarked passage, three runs of one detector. The first two runs are given ' +
    'byte-identical input and differ only in the key. Watch what happens to the evidence.',
  ));

  const watermarked = texts.samples.watermarked;
  const control = texts.samples.control;

  const identity = el('div', { class: 'readout' });
  root.append(panel('The inputs', [
    el('p', { class: 'note' }, [
      'Runs 1 and 2 are given the same bytes. Not similar text, not a regenerated ' +
      'version — the same bytes, hashed here so the claim is checkable rather than ' +
      'asserted.',
    ]),
    identity,
  ], provenanceTag('pinned', 'GPT-2 continuations')));

  void (async () => {
    const watermarkedHash = await sha256Hex(encodeUtf8(watermarked.text));
    const controlHash = await sha256Hex(encodeUtf8(control.text));
    clear(identity);
    identity.append(el('dl', {}, [
      el('dt', { text: 'Run 1 input (SHA-256)' }),
      el('dd', { class: 'hash', text: watermarkedHash }),
      el('dt', { text: 'Run 2 input (SHA-256)' }),
      el('dd', { class: 'hash', text: watermarkedHash }),
      el('dt', { text: 'Run 3 input (SHA-256)' }),
      el('dd', { class: 'hash', text: controlHash }),
      el('dt', { text: 'Runs 1 and 2 identical' }),
      el('dd', { text: 'yes — same bytes, different key' }),
    ]));
  })();

  const runs = el('div', { class: 'grid grid-3' });
  const scenarios = [
    {
      subject: 'Run 1 · watermarked text, configured key',
      tokenIds: watermarked.token_ids,
      keys: watermarkParams.keys,
      keyDescription: 'the key the generator used',
    },
    {
      subject: 'Run 2 · the same bytes, a wrong key',
      tokenIds: watermarked.token_ids,
      keys: wrongKeys(),
      keyDescription: 'a different key of the same shape',
    },
    {
      subject: 'Run 3 · unwatermarked control, configured key',
      tokenIds: control.token_ids,
      keys: watermarkParams.keys,
      keyDescription: 'the key the generator used, on text it never touched',
    },
  ];
  for (const scenario of scenarios) {
    const result = scoreTokens(
      scenario.tokenIds, withKeys(watermarkParams, scenario.keys), defaultConstruction, GPT2_EOS);
    runs.append(el('div', { class: 'panel' }, [renderScoreCard(result, {
      subject: scenario.subject,
      keyDescription: scenario.keyDescription,
      constructionLabel: defaultConstruction.label,
    })]));
  }
  root.append(runs);

  root.append(renderKeySweep());
  root.append(renderOneBit());
  root.append(renderCrossImplementation());

  root.append(el('p', { class: 'act-lede' }, [
    'Why did changing only the key make the evidence disappear? The next section opens up ' +
    'the choice the key was making.',
  ]));
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

  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    runButton.disabled = true;
    clear(output);
    clear(chartHost);
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

    chartHost.append(histogram({
      values: scores,
      marker: { value: observed.score as number, label: 'configured key' },
      secondaryMarker: { value: 0.5, label: 'no-mark expectation' },
      title: 'Scores of the same bytes under random wrong keys',
      xLabel: 'mean g-score',
    }));

    runButton.disabled = false;
    running = false;
  };

  const runButton = button('Run the sweep', () => { void run(); }, true);

  return panel('Not one wrong key — many', [
    el('p', { class: 'note' }, [
      'Do not take one wrong key on trust. Score the identical bytes under a whole ' +
      'population of random keys and see where the configured key falls in it.',
    ]),
    el('div', { class: 'controls' }, [field, runButton]),
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
