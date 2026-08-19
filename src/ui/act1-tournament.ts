/**
 * Act I — the hidden choice.
 *
 * The base model supplies the candidates. The watermark does not retrain the model;
 * keyed tournament selection changes which sampled candidate wins. In the
 * non-distortionary configuration — two competitors per match, which is what this lab
 * runs — the resulting process has a formal distribution-preservation property under the
 * assumptions given by the SynthID-Text work: the paper's Theorem 18 states that for two
 * samples per match, any number of layers, and any g-value distribution, the expected
 * output distribution over a uniformly random seed equals the model's own.
 *
 * The panel keeps two things apart on purpose: the conceptual tournament over 2^m
 * candidates, and the implementation strategy, which never builds them.
 */

import distributions from '../data/pinned/distributions.json';
import texts from '../data/pinned/texts.json';
import { defaultConstruction, watermarkParams } from '../lab-config.ts';
import { accumulateHash } from '../watermark/hash.ts';
import { effectiveCandidates, shannonEntropyBits } from '../watermark/entropy.ts';
import { computeContextRepetitionMask } from '../watermark/mask.ts';
import { tokenizer } from '../lab-config.ts';
import {
  applyTournamentReweighting, runBracket, totalVariationDistance,
} from '../watermark/tournament.ts';
import {
  actHeader, button, clear, el, fixed, integer, labelledRange, labelledSelect, panel,
  provenanceTag, readout, scroller,
} from './dom.ts';

const LITERAL_BRACKET_MAX_DEPTH = 8;

type PinnedDistribution = typeof distributions.distributions.high_entropy;

function makeRandom(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
}

export function renderAct1(root: HTMLElement): void {
  clear(root);
  root.append(...actHeader(
    'act-1',
    'Act I',
    'The hidden choice',
    'A watermarked model still samples from its own distribution. What the key changes is ' +
    'which of the sampled candidates survives a tournament.',
  ));

  root.append(el('p', { class: 'act-lede' }, [
    'The base model supplies the candidates. The watermark does not retrain the model; ' +
    'keyed tournament selection changes which sampled candidate wins. In the ' +
    'non-distortionary construction, the resulting process has a formal ' +
    'distribution-preservation property under the assumptions given by the SynthID-Text ' +
    'work. This lab implements that non-distortionary configuration — two competitors per ' +
    'match — and makes no claim about the distortionary one it did not build.',
  ]));

  const state = {
    depth: 3,
    distribution: 'high_entropy' as keyof typeof distributions.distributions,
    seed: 20260819,
  };

  const host = el('div');
  const { field: depthField, input: depthInput, output: depthOutput } =
    labelledRange('tournament-depth', 'Tournament layers (m)', 1, 30, state.depth);
  const { field: distField, select: distSelect } = labelledSelect(
    'tournament-distribution',
    'Pinned model distribution',
    Object.entries(distributions.distributions).map(([key, value]) => ({
      value: key,
      label: `${key.replace('_', ' ')} — H = ${fixed((value as PinnedDistribution).candidate_entropy_bits, 2)} bits`,
    })),
    state.distribution,
  );

  const redraw = () => {
    state.depth = Number(depthInput.value);
    state.distribution = distSelect.value as keyof typeof distributions.distributions;
    depthOutput.textContent = String(state.depth);
    clear(host);
    host.append(renderTournament(state.depth, state.distribution, state.seed));
  };
  depthInput.addEventListener('input', redraw);
  distSelect.addEventListener('change', redraw);

  root.append(panel('Run a tournament', [
    el('p', { class: 'note' }, [
      'The candidates below are drawn from a real GPT-2 next-token distribution captured ' +
      'offline. It is not the model’s unmodified distribution: temperature and top-k were ' +
      'applied first, because that is what the reference implementation watermarks over.',
    ]),
    el('div', { class: 'controls' }, [depthField, distField,
      button('New draw', () => { state.seed = (state.seed * 1103515245 + 12345) >>> 0; redraw(); })]),
    host,
  ], provenanceTag('paper', 'Algorithm 2, N = 2')));

  redraw();
  root.append(renderMaskingDemo());
}

function renderTournament(
  depth: number,
  distributionKey: keyof typeof distributions.distributions,
  seed: number,
): HTMLElement {
  const dist = distributions.distributions[distributionKey] as PinnedDistribution;
  const tokenIds = dist.candidates.map((c) => c.token_id);
  const probabilities = dist.candidates.map((c) => c.probability);
  const keys = watermarkParams.keys.slice(0, depth);
  const chainSeed = defaultConstruction.chainSeed(watermarkParams.keys);
  const contextHash = accumulateHash(
    chainSeed, dist.context_token_ids.slice(-(watermarkParams.ngramLen - 1)));

  const gValues = tokenIds.map((tokenId) =>
    keys.map((key) => defaultConstruction.gValue(accumulateHash(contextHash, [tokenId]), key)));
  const reweighted = applyTournamentReweighting(probabilities, gValues, depth);

  const conceptualCandidates = 2 ** depth;
  const container = el('div');

  container.append(readout([
    ['Layers (m)', integer(depth)],
    ['Competitors per match (N)', integer(watermarkParams.numLeaves)],
    ['Conceptual candidates drawn (N^m)', integer(conceptualCandidates)],
    ['Candidates this browser instantiated',
      depth <= LITERAL_BRACKET_MAX_DEPTH ? integer(conceptualCandidates) : '0'],
    ['Distinct tokens in the pinned distribution', integer(tokenIds.length)],
    ['Entropy of that distribution', `${fixed(shannonEntropyBits(probabilities), 3)} bits`],
    ['Effective candidates (2^H)', fixed(effectiveCandidates(probabilities), 1)],
    ['Total variation moved by the watermark',
      fixed(totalVariationDistance(probabilities, reweighted.probabilities), 4)],
  ], 'Tournament parameters'));

  if (depth <= LITERAL_BRACKET_MAX_DEPTH) {
    container.append(renderLiteralBracket(
      probabilities, tokenIds, keys, contextHash, seed, dist));
  } else {
    container.append(renderAggregatedView(depth, conceptualCandidates, reweighted));
  }

  container.append(renderDistributionShift(dist, probabilities, reweighted.probabilities));
  return container;
}

function renderLiteralBracket(
  probabilities: number[],
  tokenIds: number[],
  keys: number[],
  contextHash: bigint,
  seed: number,
  dist: PinnedDistribution,
): HTMLElement {
  const result = runBracket(probabilities, tokenIds, keys, contextHash,
    defaultConstruction, makeRandom(seed), 'random');
  const textOf = (index: number) => dist.candidates[index].token_text;

  const bracket = el('div', { class: 'bracket' });
  for (let layer = 0; layer < keys.length; layer++) {
    const matches = result.matches.filter((match) => match.layer === layer);
    const row = el('div', { class: 'bracket-layer' }, [
      el('span', { class: 'layer-label', text: `layer ${layer + 1}` }),
    ]);
    for (const match of matches.slice(0, 64)) {
      const leftWins = match.winnerIndex === match.leftIndex;
      row.append(el('span', { class: 'match' }, [
        el('span', {
          class: leftWins ? 'winner' : 'loser',
          text: `${JSON.stringify(textOf(match.leftIndex))}:${match.leftG}`,
        }),
        el('span', { text: match.decidedByTieBreak ? '~' : '>' , class: match.decidedByTieBreak ? 'tie' : '' }),
        el('span', {
          class: leftWins ? 'loser' : 'winner',
          text: `${JSON.stringify(textOf(match.rightIndex))}:${match.rightG}`,
        }),
      ]));
    }
    if (matches.length > 64) {
      row.append(el('span', { class: 'note', text: `+${matches.length - 64} more matches` }));
    }
    bracket.append(row);
  }

  const ties = result.matches.filter((match) => match.decidedByTieBreak).length;
  return el('div', {}, [
    el('h4', { text: 'The literal bracket' }),
    el('p', { class: 'note' }, [
      `${integer(result.leaves.length)} candidates were actually drawn and played off. Each ` +
      'chip is one match: the two competitors, their g-values for that layer, and the ' +
      'survivor. A tilde marks a match where both had the same g-value, so the key had ' +
      'nothing to say and a coin decided it — the rule the paper specifies.',
    ]),
    scroller('Tournament bracket', [bracket]),
    readout([
      ['Matches played', integer(result.matches.length)],
      ['Matches decided by the key', integer(result.matches.length - ties)],
      ['Matches decided by a coin (tie)', integer(ties)],
      ['Winning token', JSON.stringify(dist.candidates.find(
        (c) => c.token_id === result.winnerTokenId)?.token_text ?? '')],
    ], 'Bracket outcome'),
  ]);
}

function renderAggregatedView(
  depth: number,
  conceptualCandidates: number,
  reweighted: ReturnType<typeof applyTournamentReweighting>,
): HTMLElement {
  const rows = reweighted.layers.map((layer) => el('tr', {}, [
    el('td', { text: String(layer.layer + 1) }),
    el('td', { class: 'num', text: integer(2 ** (depth - layer.layer - 1)) }),
    el('td', { class: 'num', text: fixed(layer.gMass, 4) }),
    el('td', { class: 'num', text: fixed(Math.max(...layer.probabilities), 4) }),
  ]));

  return el('div', {}, [
    el('h4', { text: 'Above eight layers: the layered view' }),
    el('p', { class: 'note' }, [
      `A tournament of ${integer(depth)} layers starts from ${integer(conceptualCandidates)} ` +
      'candidates. That number is the real conceptual starting field — and this browser did ' +
      'not instantiate a single one of them. Neither does any efficient implementation: ' +
      'both reference implementations compute the distribution the tournament would ' +
      'produce, one multiplicative pass per layer, and sample from that instead. The paper ' +
      'proves the two are the same distribution and states that its own experiments use ' +
      'the vectorized form.',
    ]),
    el('p', { class: 'note' }, [
      'What is summarised below is per layer: how many survivors the conceptual bracket ' +
      'would have at that point, the g-mass the layer is working against, and where the ' +
      'reweighted distribution has moved. Nothing about the individual matches is shown, ' +
      'because nothing about them was computed.',
    ]),
    scroller('Per-layer summary', [
      el('table', {}, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'Layer' }),
          el('th', { class: 'num', text: 'Survivors in the conceptual bracket' }),
          el('th', { class: 'num', text: 'g-mass entering the layer' }),
          el('th', { class: 'num', text: 'Largest probability after it' }),
        ])]),
        el('tbody', {}, rows),
      ]),
    ]),
  ]);
}

function renderDistributionShift(
  dist: PinnedDistribution,
  before: number[],
  after: number[],
): HTMLElement {
  const rows = dist.candidates
    .map((candidate, index) => ({
      text: candidate.token_text,
      before: before[index],
      after: after[index],
      delta: after[index] - before[index],
    }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 10)
    .map((row) => el('tr', {}, [
      el('td', { class: 'mono', text: JSON.stringify(row.text) }),
      el('td', { class: 'num', text: fixed(row.before, 4) }),
      el('td', { class: 'num', text: fixed(row.after, 4) }),
      el('td', { class: 'num', text: (row.delta >= 0 ? '+' : '') + fixed(row.delta, 4) }),
    ]));

  return el('div', {}, [
    el('h4', { text: 'What the key moved' }),
    el('p', { class: 'note' }, [
      'Three things stay distinct on this page and this table is where they meet: the raw ' +
      'model logits, the sampling distribution after temperature and top-k, and the keyed ' +
      'selection applied on top of it. The "before" column is the second of those, not the ' +
      'first.',
    ]),
    scroller('Largest probability changes', [
      el('table', {}, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'Token' }),
          el('th', { class: 'num', text: 'Sampling probability' }),
          el('th', { class: 'num', text: 'After keyed selection' }),
          el('th', { class: 'num', text: 'Change' }),
        ])]),
        el('tbody', {}, rows),
      ]),
    ]),
  ]);
}

/** Repeated-context masking, shown firing on the real pinned sample. */
function renderMaskingDemo(): HTMLElement {
  const tok = tokenizer();
  const tokenIds = texts.samples.watermarked.token_ids;
  const chainSeed = defaultConstruction.chainSeed(watermarkParams.keys);
  const mask = computeContextRepetitionMask(tokenIds, watermarkParams, chainSeed);
  const n = watermarkParams.ngramLen;

  const repeats = mask
    .map((keep, index) => ({ keep, index }))
    .filter((entry) => !entry.keep)
    .slice(0, 8)
    .map((entry) => {
      const tokenIndex = entry.index + n - 1;
      const context = tokenIds.slice(tokenIndex - (n - 1), tokenIndex);
      return el('tr', {}, [
        el('td', { class: 'num', text: integer(tokenIndex) }),
        el('td', { class: 'mono', text: JSON.stringify(tok.decode(context)) }),
        el('td', { class: 'mono', text: JSON.stringify(tok.decode([tokenIds[tokenIndex]])) }),
      ]);
    });

  const maskedCount = mask.filter((keep) => !keep).length;

  return panel('The rule that stops the watermark repeating itself', [
    el('p', { class: 'note' }, [
      'If the same context window came round twice, the same key would push the generator ' +
      'the same way twice — conspicuous, and self-reinforcing. So the reference ' +
      'implementation skips watermarking whenever the context has been seen before, and ' +
      'the detector skips scoring exactly those positions. Both sides have to agree, or ' +
      'the score is measuring two different things.',
    ]),
    readout([
      ['Positions the window offers', integer(mask.length)],
      ['Positions dropped as repeated context', integer(maskedCount)],
      ['Positions counted', integer(mask.length - maskedCount)],
      ['Context window length (ngram_len - 1)', integer(n - 1)],
      ['Contexts remembered (context_history_size)', integer(watermarkParams.contextHistorySize)],
    ], 'Masking on the pinned sample'),
    maskedCount === 0
      ? el('p', { class: 'note', text: 'No context repeated in this sample.' })
      : scroller('Repeated contexts found in the pinned sample', [
        el('table', {}, [
          el('thead', {}, [el('tr', {}, [
            el('th', { class: 'num', text: 'Token index' }),
            el('th', { text: 'Repeated context' }),
            el('th', { text: 'Token that went unscored' }),
          ])]),
          el('tbody', {}, repeats),
        ]),
      ]),
  ], provenanceTag('reference', 'compute_context_repetition_mask'));
}
