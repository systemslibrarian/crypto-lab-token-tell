/**
 * Act III — the watermark needs freedom.
 *
 * A generative watermark has more opportunity to encode detectable statistical structure
 * when the model has multiple plausible next tokens. If the next token is nearly
 * predetermined, there is much less freedom for keyed selection.
 *
 * Computed rather than asserted, and computed exactly rather than sampled: the same keyed
 * selection is applied to three real pinned distributions, and the evidence it manages to
 * leave per token is reported for each. By the time that evidence is wanted, both weight
 * vectors — the pinned distribution and the one keyed selection leaves behind — are fully
 * explicit and the answer is a dot product, so drawing from them would only add sampling
 * error to a quantity that has none. Four decimals over a Monte Carlo estimate is a number
 * presented as more certain than it is, which is the failure this page exists to argue
 * against.
 *
 * Three near-identical measurement cards arriving before the lesson made the reader do the
 * subtraction, so the act now states the gap between them first and keeps the cards as the
 * working. The corpus run behind them is the longest computation on the page that a
 * visitor can start, which is why it is the one that most needs a control that comes back
 * — disabled while it runs, recoverable if it throws, and resettable without a reload.
 */

import distributions from '../data/pinned/distributions.json';
import nullCorpus from '../data/pinned/null-corpus.json';
import { defaultConstruction, watermarkParams } from '../lab-config.ts';
import { scoreTokens } from '../watermark/score.ts';
import {
  collisionProbability, effectiveCandidates, shannonEntropyBits, topMass,
} from '../watermark/entropy.ts';
import { accumulateHash } from '../watermark/hash.ts';
import { applyTournamentReweighting, totalVariationDistance } from '../watermark/tournament.ts';
import { armableReset, runGuarded } from './busy.ts';
import {
  actHeader, button, clear, consequence, el, fixed, integer, liveRegion, nextFrame, panel,
  provenanceTag, readout, reasoning, scroller, srOnly,
} from './dom.ts';

type PinnedDistribution = typeof distributions.distributions.high_entropy;

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

  const entries = Object.entries(distributions.distributions) as [string, PinnedDistribution][];
  // One row of three, because the comparison across the three contexts is the whole act.
  // Two columns wrapped the third card onto a row of its own and left the cell beside it
  // empty — 584x583px of bare ground at 1440, which reads as a rendering fault rather
  // than a layout, and which asks the reader to hold the first two cards in memory while
  // they look at the third. `.grid-3` is one column below 900px, so the phone still
  // stacks.
  const grid = el('div', { class: 'grid grid-3' });
  const measurements = entries.map(([key, dist]) => ({ key, ...measure(key, dist) }));
  for (const measurement of measurements) grid.append(measurement.card);

  const high = measurements.find((m) => m.key === 'high_entropy');
  const low = measurements.find((m) => m.key === 'low_entropy');
  if (high && low) root.append(renderHeadline(high, low));
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
    reasoning([
      el('p', { class: 'note' }, [
        'Each row is computed exactly rather than sampled. Both distributions are explicit — ' +
        'the pinned one, and the one keyed selection leaves behind — so the mean g-value of a ' +
        'token drawn from either is the probability-weighted average of the g-values of its ' +
        'own tokens, and the last column is the gap between the two. That gap is the evidence ' +
        'one position contributes. It is not a claim about any other model or any other ' +
        'context; it is what these pinned distributions do.',
      ]),
      el('p', { class: 'note' }, [
        'Neither mean-g column is the 0.5 null. A g-value is a fixed function of the context, ' +
        'the token and the key, so one frozen context has a mean of its own and it can sit ' +
        'well above or well below a half — which is why "Mean g, unwatermarked" here does not ' +
        'read 0.500 and is not meant to. The 0.5 Act II expects, and the threshold it derives, ' +
        'come from averaging over contexts, which is what the corpus null measures. That is ' +
        'why the last column subtracts each context’s own unwatermarked mean rather than 0.5.',
      ]),
      // The reconciliation B1 asks for, at the point where it bites hardest: one of these
      // cards moves the distribution almost the whole way, which reads as a refutation of
      // Act I unless the scope of the guarantee is stated where the number is.
      el('p', { class: 'note' }, [
        'The "distribution moved" figure on each card — as far as ' +
        `${fixed(Math.max(...measurements.map((m) => m.totalVariation)), 4)} here — is not in ` +
        'tension with the distribution-preservation property in Act I. That property is an ' +
        'expectation over a uniformly random key, and a statement about a single decoding ' +
        'step. These cards hold the key fixed at the one published set this lab ships and ' +
        'report one step, so a large distance is one of the terms that expectation averages ' +
        'over rather than a counterexample to it.',
      ]),
    ], 'How these columns are computed, and why neither mean-g reads 0.500'),
    el('p', { class: 'note' }, [
      'This is why "how many tokens do I need?" has no general answer. Two texts of the ' +
      'same length can carry very different amounts of evidence, because the model was ' +
      'confident through one and undecided through the other.',
    ]),
  ], provenanceTag('pinned', 'real GPT-2 distributions')));

  root.append(renderCorpusScale());
}

/**
 * The one result this act is for: how much less evidence a confident model leaves behind.
 *
 * Stated as the two gaps rather than as the ratio alone, because the ratio is the
 * memorable number and the pair is the checkable one — both appear again in the last
 * column of the comparison table, computed from the same distributions.
 *
 * The ratio is given to one decimal because that is the precision it has. The gaps are
 * exact, so the ratio is too; what a second decimal would suggest is that the ratio
 * generalises past these two pinned contexts, and it does not.
 */
function renderHeadline(high: Measurement, low: Measurement): HTMLElement {
  const gap = (m: Measurement) => m.keyedMeanG - m.plainMeanG;
  const ratio = gap(low) > 0 ? gap(high) / gap(low) : null;
  return el('div', { class: 'act-headline' }, [
    el('p', {
      class: 'act-headline-label',
      text: 'Evidence left per token: high entropy against low entropy',
    }),
    el('p', {
      class: 'act-headline-figure',
      text: `${fixed(gap(high), 4)} against ${fixed(gap(low), 4)}`,
    }),
    el('p', {
      class: 'act-headline-detail',
      text: 'The mean g-value a token drawn through keyed selection carries, less the mean ' +
        'a token drawn by plain sampling carries — computed exactly from each pinned ' +
        'distribution and its keyed reweighting, not estimated from draws.',
    }),
    consequence(
      'Gave the same key a context the model was already sure about',
      ratio === null
        ? 'it left no measurable evidence per token at all.'
        : `it left about ${fixed(ratio, 1)} times less evidence per token.`,
    ),
  ]);
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
  // The progress line is for eyes. It repaints once every eight texts so a sighted reader
  // can see the page is working rather than hung, and that is the whole of its job.
  const progress = el('p', { class: 'progress' });
  // It is emphatically NOT a live region. A polite region queues rather than coalesces, so
  // scoring forty-eight texts in 691ms handed a screen reader eight separate strings to
  // read out in turn, and the answer the reader had actually asked for arrived at the back
  // of that queue. The run says once that it has started; the region below says once what
  // it found, when the guard lifts `aria-busy` from it.
  const announcer = srOnly('');
  announcer.setAttribute('role', 'status');
  announcer.setAttribute('aria-live', 'polite');

  const score = async () => {
    clear(output);
    progress.textContent = 'Scoring the watermarked corpus…';
    announcer.textContent = 'Scoring the watermarked corpus. The results will be announced ' +
      'when it finishes.';
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
      consequence(
        'Held the length fixed at 320 tokens and varied only the entropy',
        `${integer(missed.length)} of ${integer(rows.length)} watermarked texts still went ` +
        'undetected.',
      ),
    );
  };

  /**
   * The progress line is not handed to the guard.
   *
   * `runGuarded` empties whatever it was given the moment the work settles, and this line
   * has to survive that: "Done." is the completion signal the accessibility gate waits on,
   * and a status line that clears itself the instant the answer arrives tells a reader
   * nothing about whether the run finished or was abandoned. So the act keeps its own
   * status line — which is also the visible busy text while the scoring runs — and the
   * guard is asked only to clear it when a run fails, where a half-written count beside a
   * failure notice would be worse than nothing.
   */
  const start = (): Promise<void> => runGuarded(score, {
    controls: [runButton, resetControl.node],
    region: output,
    onError: () => { progress.textContent = ''; announcer.textContent = ''; },
    // After the guard has restored what it switched off, and only if the run left a
    // result: an armed control put back by the guard would be switched off again.
    onSettled: () => { if (output.childElementCount > 0) resetControl.arm(); },
  });

  const reset = () => {
    clear(output);
    progress.textContent = '';
    announcer.textContent = '';
  };

  const runButton = button('Score the watermarked corpus', () => { void start(); }, true);
  const resetControl = armableReset(
    'Reset the corpus scoring',
    'There is no corpus run to reset yet. Score the watermarked corpus first; this then '
    + 'clears the result.',
    reset,
  );

  return panel('Where the watermark failed to take', [
    el('p', { class: 'note' }, [
      'The detection rate in Act II plateaus below 100% however long the text gets. This ' +
      'is why, computed here in the browser from the committed corpus rather than quoted.',
    ]),
    el('div', { class: 'controls' }, [runButton, resetControl.node]),
    resetControl.note,
    progress,
    announcer,
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
  totalVariation: number;
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

  // The mean g-value of a token drawn from a distribution, taken exactly. Both weight
  // vectors are in hand and g is a fixed function of the token, so this is Σ pᵢ·ḡᵢ — the
  // same quantity a sample would estimate, without the estimate's error bar.
  const expectedG = (weights: number[]) =>
    weights.reduce((total, weight, index) => total + weight * meanG[index], 0);

  const entropy = shannonEntropyBits(probabilities);
  // Computed once and read twice — by this card and by the note that reconciles these
  // distances with Act I's preservation property — so the two cannot disagree.
  const totalVariation = totalVariationDistance(probabilities, reweighted);
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
    // Three of these cards side by side is 319px each on a 1052px laptop, and the term
    // column alone wants 218px of that. The pairs stack rather than let every figure wrap
    // a character at a time; the stylesheet's own stacking rule is keyed to the viewport,
    // which is not the thing that got narrow here.
    readout([
      ['Full-vocabulary entropy', `${fixed(dist.full_vocabulary_entropy_bits, 3)} bits`],
      ['Sampling-distribution entropy', `${fixed(entropy, 3)} bits`],
      ['Effective candidates (2^H)', fixed(effectiveCandidates(probabilities), 1)],
      ['Most likely token', JSON.stringify(dist.candidates[0].token_text)],
      ['Its probability', fixed(topMass(probabilities), 4)],
      ['Collision probability', fixed(collisionProbability(probabilities), 4)],
      ['Mass kept by top-k', fixed(dist.mass_kept_by_top_k, 4)],
      ['Distribution moved (total variation)', fixed(totalVariation, 4)],
    ], `${label} distribution`, { stackWhenNarrow: true }),
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
    plainMeanG: expectedG(probabilities),
    keyedMeanG: expectedG(reweighted),
    totalVariation,
    card,
  };
}
