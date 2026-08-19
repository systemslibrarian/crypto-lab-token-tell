/**
 * Act III — the watermark needs freedom.
 *
 * A generative watermark has more opportunity to encode detectable statistical structure
 * when the model has multiple plausible next tokens. If the next token is nearly
 * predetermined, there is much less freedom for keyed selection.
 *
 * Measured rather than asserted: the same keyed selection is run many times against two
 * real pinned distributions, and the evidence it manages to leave per token is reported
 * for each.
 */

import distributions from '../data/pinned/distributions.json';
import nullCorpus from '../data/pinned/null-corpus.json';
import { defaultConstruction, watermarkParams } from '../lab-config.ts';
import { scoreTokens } from '../watermark/score.ts';
import {
  collisionProbability, effectiveCandidates, shannonEntropyBits, topMass,
} from '../watermark/entropy.ts';
import { accumulateHash } from '../watermark/hash.ts';
import { applyTournamentReweighting, sampleIndex, totalVariationDistance } from '../watermark/tournament.ts';
import {
  actHeader, button, clear, el, fixed, integer, liveRegion, nextFrame, panel,
  provenanceTag, readout, scroller,
} from './dom.ts';

type PinnedDistribution = typeof distributions.distributions.high_entropy;

const DRAWS = 4000;

function makeRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
}

export function renderAct3(root: HTMLElement): void {
  clear(root);
  root.append(...actHeader(
    'act-3',
    'Act III',
    'The watermark needs choices',
    'Detection is not simply a matter of length. It depends on how much freedom the model ' +
    'had at each step, and a model that is certain what comes next leaves the key nothing ' +
    'to work with.',
  ));

  root.append(el('p', { class: 'act-lede' }, [
    'A generative watermark has more opportunity to encode detectable statistical ' +
    'structure when the model has multiple plausible next tokens. If the next token is ' +
    'nearly predetermined, there is much less freedom for keyed selection.',
  ]));

  const entries = Object.entries(distributions.distributions) as [string, PinnedDistribution][];
  const grid = el('div', { class: 'grid grid-2' });
  const measurements = entries.map(([key, dist]) => measure(key, dist));
  for (const measurement of measurements) grid.append(measurement.card);
  root.append(grid);

  root.append(panel('Side by side', [
    el('p', { class: 'note' }, [
      'Entropy here is Shannon entropy in bits over the pinned sampling distribution — the ' +
      'one after temperature and top-k, which is the distribution keyed selection actually ' +
      'acts on. Effective candidates is 2 raised to that entropy: roughly how many tokens ' +
      'were genuinely in play. Collision probability is the chance that two independent ' +
      'draws land on the same token, which is the quantity that decides how often a match ' +
      'is a tie the key cannot break.',
    ]),
    scroller('Entropy comparison', [
      el('table', {}, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'Pinned context' }),
          el('th', { class: 'num', text: 'Entropy (bits)' }),
          el('th', { class: 'num', text: 'Effective candidates' }),
          el('th', { class: 'num', text: 'Top token mass' }),
          el('th', { class: 'num', text: 'Collision probability' }),
          el('th', { class: 'num', text: 'Mean g, unwatermarked' }),
          el('th', { class: 'num', text: 'Mean g, keyed selection' }),
          el('th', { class: 'num', text: 'Evidence per token' }),
        ])]),
        el('tbody', {}, measurements.map((m) => el('tr', {}, [
          el('td', { text: m.label }),
          el('td', { class: 'num', text: fixed(m.entropy, 3) }),
          el('td', { class: 'num', text: fixed(m.effective, 1) }),
          el('td', { class: 'num', text: fixed(m.topMass, 3) }),
          el('td', { class: 'num', text: fixed(m.collision, 3) }),
          el('td', { class: 'num', text: fixed(m.plainMeanG, 4) }),
          el('td', { class: 'num', text: fixed(m.keyedMeanG, 4) }),
          el('td', { class: 'num', text: fixed(m.keyedMeanG - m.plainMeanG, 4) }),
        ]))),
      ]),
    ]),
    el('p', { class: 'note' }, [
      `Each row draws ${integer(DRAWS)} tokens from the pinned distribution twice: once by ` +
      'plain sampling, once through keyed selection at the configured depth. The last ' +
      'column is the gap between the mean g-value of the tokens that came out — the ' +
      'evidence one position contributes. It is not a claim about any other model or any ' +
      'other context; it is what these two pinned distributions do.',
    ]),
    el('p', { class: 'note' }, [
      'This is why "how many tokens do I need?" has no general answer. Two texts of the ' +
      'same length can carry very different amounts of evidence, because the model was ' +
      'confident through one and undecided through the other.',
    ]),
  ], provenanceTag('pinned', 'real GPT-2 distributions')));

  root.append(renderCorpusScale());
}

const GPT2_EOS = 50256;

/**
 * The same lesson at corpus scale, and the reason this lab's detection rate has a
 * ceiling.
 *
 * Roughly one in seven of the watermarked texts in the pinned corpus is never detected at
 * any length. They are not short. They are degenerate: GPT-2 fell into a repetition loop,
 * the repeated-context rule threw out almost every position, and there was nothing left
 * to score. A length-based reading of the detection curve would call that a length
 * problem. It is an entropy problem.
 */
function renderCorpusScale(): HTMLElement {
  const output = liveRegion('Corpus-scale entropy analysis');
  const progress = el('p', { class: 'progress', role: 'status', 'aria-live': 'polite' });

  const run = async () => {
    runButton.disabled = true;
    clear(output);
    const corpus = (nullCorpus as { watermarked_corpus_token_ids?: number[][] })
      .watermarked_corpus_token_ids ?? [];
    const threshold = (nullCorpus.by_length as unknown as
      Record<string, { threshold_fpr_1_percent: number | null }>)['320'].threshold_fpr_1_percent;

    const rows: {
      score: number; scored: number; candidates: number; distinct: number; detected: boolean;
    }[] = [];
    for (const [index, tokenIds] of corpus.entries()) {
      const result = scoreTokens(tokenIds, watermarkParams, defaultConstruction, GPT2_EOS);
      if (result.score === null) continue;
      rows.push({
        score: result.score,
        scored: result.scoredPositions,
        candidates: result.candidatePositions,
        distinct: new Set(tokenIds).size,
        detected: threshold !== null && result.score >= threshold,
      });
      if (index % 8 === 0) {
        progress.textContent = `Scoring watermarked corpus: ${index + 1} of ${corpus.length}…`;
        await nextFrame();
      }
    }
    progress.textContent = 'Done.';

    const missed = rows.filter((r) => !r.detected);
    const found = rows.filter((r) => r.detected);
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / (values.length || 1);

    output.append(readout([
      ['Watermarked texts scored', integer(rows.length)],
      ['Detected at FPR 1%', integer(found.length)],
      ['Not detected', integer(missed.length)],
      ['Detected: mean scored positions', fixed(mean(found.map((r) => r.scored)), 1)],
      ['Not detected: mean scored positions', fixed(mean(missed.map((r) => r.scored)), 1)],
      ['Detected: mean distinct tokens', fixed(mean(found.map((r) => r.distinct)), 1)],
      ['Not detected: mean distinct tokens', fixed(mean(missed.map((r) => r.distinct)), 1)],
      ['Positions the window offered (all texts)', integer(rows[0]?.candidates ?? 0)],
    ], 'Detected against undetected'));

    const worst = [...rows].sort((a, b) => a.scored - b.scored).slice(0, 8)
      .map((row) => el('tr', {}, [
        el('td', { class: 'num', text: fixed(row.score) }),
        el('td', { class: 'num', text: integer(row.scored) }),
        el('td', { class: 'num', text: integer(row.distinct) }),
        el('td', { text: row.detected ? 'detected' : 'not detected' }),
      ]));

    output.append(
      el('h4', { text: 'The texts with the fewest scored positions' }),
      scroller('Texts with the fewest scored positions', [
        el('table', {}, [
          el('thead', {}, [el('tr', {}, [
            el('th', { class: 'num', text: 'Score' }),
            el('th', { class: 'num', text: 'Scored positions' }),
            el('th', { class: 'num', text: 'Distinct tokens' }),
            el('th', { text: 'Verdict at FPR 1%' }),
          ])]),
          el('tbody', {}, worst),
        ]),
      ]),
      el('p', { class: 'note' }, [
        'Every text in this corpus is 320 tokens long, so length explains none of the ' +
        'difference. What separates them is how many distinct tokens the model produced: ' +
        'the undetected ones collapsed into repetition loops, the repeated-context rule ' +
        'discarded almost every position, and there was nothing left to average.',
      ]),
      el('p', { class: 'note' }, [
        'The table also shows the other edge of the same problem. A text with one scored ' +
        'position can post a high mean g-score purely by chance, and a length-based ' +
        'threshold — which is what the curve in Act II uses, and what the paper reports ' +
        'against — does not know that. This is a real limitation of the threshold this lab ' +
        'ships: it is indexed by token count, and the evidence is indexed by scored ' +
        'positions.',
      ]),
    );
    runButton.disabled = false;
  };

  const runButton = button('Score the watermarked corpus', () => { void run(); }, true);

  return panel('Where the watermark failed to take', [
    el('p', { class: 'note' }, [
      'The detection rate in Act II plateaus below 100% however long the text gets. This ' +
      'is why, computed here in the browser from the committed corpus rather than quoted.',
    ]),
    el('div', { class: 'controls' }, [runButton]),
    progress,
    output,
  ], provenanceTag('pinned', '48 watermarked texts'));
}

interface Measurement {
  label: string;
  entropy: number;
  effective: number;
  topMass: number;
  collision: number;
  plainMeanG: number;
  keyedMeanG: number;
  card: HTMLElement;
}

function measure(key: string, dist: PinnedDistribution): Measurement {
  const probabilities = dist.candidates.map((c) => c.probability);
  const tokenIds = dist.candidates.map((c) => c.token_id);
  const chainSeed = defaultConstruction.chainSeed(watermarkParams.keys);
  const contextHash = accumulateHash(
    chainSeed, dist.context_token_ids.slice(-(watermarkParams.ngramLen - 1)));

  const gValues = tokenIds.map((tokenId) =>
    watermarkParams.keys.map((k) =>
      defaultConstruction.gValue(accumulateHash(contextHash, [tokenId]), k)));
  const meanG = gValues.map((row) => row.reduce((a, b) => a + b, 0) / row.length);

  const reweighted = applyTournamentReweighting(
    probabilities, gValues, watermarkParams.keys.length).probabilities;

  const plainRandom = makeRandom(11);
  const keyedRandom = makeRandom(11);
  let plainSum = 0;
  let keyedSum = 0;
  for (let draw = 0; draw < DRAWS; draw++) {
    plainSum += meanG[sampleIndex(probabilities, plainRandom())];
    keyedSum += meanG[sampleIndex(reweighted, keyedRandom())];
  }

  const entropy = shannonEntropyBits(probabilities);
  const label = key.replace('_', ' ');

  const winners = dist.candidates
    .map((candidate, index) => ({
      text: candidate.token_text,
      before: probabilities[index],
      after: reweighted[index],
      g: meanG[index],
    }))
    .sort((a, b) => b.after - a.after)
    .slice(0, 6)
    .map((row) => el('tr', {}, [
      el('td', { class: 'mono', text: JSON.stringify(row.text) }),
      el('td', { class: 'num', text: fixed(row.before, 4) }),
      el('td', { class: 'num', text: fixed(row.after, 4) }),
      el('td', { class: 'num', text: fixed(row.g, 3) }),
    ]));

  const card = panel(`${label} context`, [
    el('p', { class: 'note', text: JSON.stringify(dist.prompt) }),
    readout([
      ['Full-vocabulary entropy', `${fixed(dist.full_vocabulary_entropy_bits, 3)} bits`],
      ['Sampling-distribution entropy', `${fixed(entropy, 3)} bits`],
      ['Effective candidates (2^H)', fixed(effectiveCandidates(probabilities), 1)],
      ['Most likely token', JSON.stringify(dist.candidates[0].token_text)],
      ['Its probability', fixed(topMass(probabilities), 4)],
      ['Collision probability', fixed(collisionProbability(probabilities), 4)],
      ['Mass kept by top-k', fixed(dist.mass_kept_by_top_k, 4)],
      ['Distribution moved (total variation)',
        fixed(totalVariationDistance(probabilities, reweighted), 4)],
    ], `${label} distribution`),
    scroller(`${label}: most likely tokens after keyed selection`, [
      el('table', {}, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'Token' }),
          el('th', { class: 'num', text: 'Before' }),
          el('th', { class: 'num', text: 'After' }),
          el('th', { class: 'num', text: 'mean g' }),
        ])]),
        el('tbody', {}, winners),
      ]),
    ]),
  ], provenanceTag('pinned', dist.label.includes('top-k') ? 'after top-k' : 'pinned'));

  return {
    label,
    entropy,
    effective: effectiveCandidates(probabilities),
    topMass: topMass(probabilities),
    collision: collisionProbability(probabilities),
    plainMeanG: plainSum / DRAWS,
    keyedMeanG: keyedSum / DRAWS,
    card,
  };
}
