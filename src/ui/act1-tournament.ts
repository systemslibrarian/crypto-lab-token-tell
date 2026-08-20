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
 *
 * Two things here are about being demonstrated rather than about the mathematics. The act
 * states one dominant result — how far keyed selection moved the model, and which token it
 * returned — above the audit trail that produces it, because three equal-weight blocks of
 * parameters ask a room to decide for itself what the point was. And the scenario is a
 * deep link: a presenter who has chosen a distribution can hand over the URL and know the
 * next person sees the same tournament, rather than the shipped default with a spoken
 * instruction attached.
 *
 * The subsections are `h3`s because they are the first level of structure beneath the
 * act's own `h2`, and a reader navigating by heading should not have to guess at a level
 * that was skipped. The bracket has two mutually exclusive spellings — the literal one,
 * and the layered one the slider reaches above eight layers — and they fill the same slot,
 * so they carry the same level whichever one is on screen.
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
import type { BracketResult } from '../watermark/tournament.ts';
import { resetButton } from './busy.ts';
import {
  actHeader, button, clear, consequence, el, fixed, integer, labelledRange, labelledSelect,
  panel, provenanceTag, readout, scroller,
} from './dom.ts';
import { param, setParam } from './mode.ts';

const LITERAL_BRACKET_MAX_DEPTH = 8;

type PinnedDistribution = typeof distributions.distributions.high_entropy;
type DistributionKey = keyof typeof distributions.distributions;

/** The state a presenter gets back from Reset, and the state a bare URL opens in. */
const SHIPPED = {
  depth: 3,
  distribution: 'high_entropy' as DistributionKey,
  seed: 20260819,
};

const SCENARIO_PARAM = 'scenario';

function scenarioFromUrl(): DistributionKey {
  const requested = param(SCENARIO_PARAM);
  if (requested !== null && requested in distributions.distributions) {
    return requested as DistributionKey;
  }
  // A parameter naming something this page cannot show is a link that lies about what the
  // audience will see, so it is dropped rather than left sitting beside a different
  // tournament.
  if (requested !== null) setParam(SCENARIO_PARAM, null);
  return SHIPPED.distribution;
}

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
    depth: SHIPPED.depth,
    distribution: scenarioFromUrl(),
    seed: SHIPPED.seed,
  };

  const headline = el('div', { class: 'act-headline' });
  root.append(headline);

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
    state.distribution = distSelect.value as DistributionKey;
    depthOutput.textContent = String(state.depth);
    clear(host);
    const tournament = renderTournament(state.depth, state.distribution, state.seed);
    host.append(tournament.node);
    clear(headline);
    headline.append(...renderHeadline(tournament.summary));
  };
  depthInput.addEventListener('input', redraw);
  // The scenario is written to the URL on every change, including a change back to the
  // shipped one: a link that omits the parameter and a link that names the default have
  // to mean the same thing, and the presenter should never have to know which they have.
  distSelect.addEventListener('change', () => {
    setParam(SCENARIO_PARAM, distSelect.value);
    redraw();
  });

  // The seed only ever moves forward, so without this the shipped draw is unreachable
  // short of a reload — and a reload costs the depth, the anchor and the scroll position.
  const reset = () => {
    state.seed = SHIPPED.seed;
    depthInput.value = String(SHIPPED.depth);
    distSelect.value = SHIPPED.distribution;
    setParam(SCENARIO_PARAM, null);
    redraw();
  };

  root.append(panel('Run a tournament', [
    el('p', { class: 'note' }, [
      'The candidates below are drawn from a real GPT-2 next-token distribution captured ' +
      'offline. It is not the model’s unmodified distribution: temperature and top-k were ' +
      'applied first, because that is what the reference implementation watermarks over.',
    ]),
    el('div', { class: 'controls' }, [depthField, distField,
      button('New draw', () => { state.seed = (state.seed * 1103515245 + 12345) >>> 0; redraw(); }),
      resetButton('Reset the tournament', reset)]),
    host,
  ], provenanceTag('paper', 'Algorithm 2, N = 2')));

  redraw();
  root.append(renderMaskingDemo());
}

interface TournamentSummary {
  readonly depth: number;
  readonly distributionLabel: string;
  readonly conceptualCandidates: number;
  readonly totalVariation: number;
  /** Null above the depth at which no candidate is instantiated, which is most of them. */
  readonly winningToken: string | null;
}

/**
 * The one result this act is for: the distance between the model's own distribution and
 * the one keyed selection leaves behind, and the token that distance produced.
 *
 * Both numbers appear again in the readouts below, which is deliberate rather than
 * duplication — they are read from the same computation, so they cannot drift, and the
 * difference between a decisive figure and an audit row is the whole point of stating one
 * of them at this size.
 */
function renderHeadline(summary: TournamentSummary): Node[] {
  const offered = `The model offered ${integer(summary.conceptualCandidates)} candidates`;
  return [
    el('p', { class: 'act-headline-label', text: 'How far the key moved the model' }),
    el('p', { class: 'act-headline-figure', text: fixed(summary.totalVariation, 4) }),
    el('p', {
      class: 'act-headline-detail',
      text: 'Total variation between the pinned sampling distribution and the distribution ' +
        `after keyed selection, at ${integer(summary.depth)} layers over the ` +
        `${summary.distributionLabel} context.`,
    }),
    summary.winningToken === null
      ? consequence(offered,
        'the key reweighted every one of them, and not one was drawn.')
      : consequence(offered,
        `the key decided which one survived: ${summary.winningToken}.`),
  ];
}

function renderTournament(
  depth: number,
  distributionKey: DistributionKey,
  seed: number,
): { node: HTMLElement; summary: TournamentSummary } {
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
  const totalVariation = totalVariationDistance(probabilities, reweighted.probabilities);
  // The bracket is played here rather than inside the renderer so the winning token can be
  // stated above the fold as well as drawn below it; the draw itself is unchanged.
  const bracket = depth <= LITERAL_BRACKET_MAX_DEPTH
    ? runBracket(probabilities, tokenIds, keys, contextHash,
      defaultConstruction, makeRandom(seed), 'random')
    : null;
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
    ['Total variation moved by the watermark', fixed(totalVariation, 4)],
  ], 'Tournament parameters'));

  if (bracket) container.append(renderLiteralBracket(bracket, keys.length, dist));
  else container.append(renderAggregatedView(depth, conceptualCandidates, reweighted));

  container.append(renderDistributionShift(dist, probabilities, reweighted.probabilities));

  const winner = bracket
    ? dist.candidates.find((c) => c.token_id === bracket.winnerTokenId)?.token_text ?? ''
    : null;
  return {
    node: container,
    summary: {
      depth,
      distributionLabel: distributionKey.replace('_', ' '),
      conceptualCandidates,
      totalVariation,
      winningToken: winner === null ? null : JSON.stringify(winner),
    },
  };
}

function renderLiteralBracket(
  result: BracketResult,
  layers: number,
  dist: PinnedDistribution,
): HTMLElement {
  const textOf = (index: number) => dist.candidates[index].token_text;

  const bracket = el('div', { class: 'bracket' });
  for (let layer = 0; layer < layers; layer++) {
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
    el('h3', { text: 'The literal bracket' }),
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
    el('h3', { text: 'Above eight layers: the layered view' }),
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
    el('h3', { text: 'What the key moved' }),
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
