/**
 * Tournament sampling — the hidden choice.
 *
 * The base model supplies the candidates. The watermark does not retrain the model;
 * keyed tournament selection changes which sampled candidate wins.
 *
 * Two views of the same process live here, and keeping them distinct is the point of
 * Act I:
 *
 *   THE CONCEPTUAL TOURNAMENT (`runBracket`)
 *     Draw 2^m candidates independently from the model's distribution, pair them up, and
 *     let the higher g-value win each match, layer by layer, one key per layer.
 *
 *   THE IMPLEMENTATION STRATEGY (`applyTournamentReweighting`)
 *     REFERENCE-IMPLEMENTATION-FAITHFUL port of `update_scores` in transformers 5.15.1,
 *     which never materialises 2^m candidates. It reweights the distribution once per
 *     layer:  p <- p * (1 + g_d - E_p[g_d]).
 *
 * Those are the same distribution. For one layer with two candidates drawn i.i.d. from
 * p, writing q = E_p[g]: a token with g = 1 wins unless it meets another g = 1 and loses
 * the coin, giving 2p(x)(1 - q/2) = p(x)(2 - q) = p(x)(1 + 1 - q); a token with g = 0
 * wins only against another g = 0 on the coin, giving p(x)(1 - q) = p(x)(1 + 0 - q).
 * Layer two then runs on the layer-one winners, which is the same formula applied to the
 * updated p. `bracketAgreesWithReweighting` in the test suite is what actually holds this
 * claim up: it samples the bracket and compares against the closed form.
 *
 * This is also why a depth-30 tournament does not mean a browser tab allocating a
 * billion candidates. The conceptual bracket over 2^30 = 1,073,741,824 candidates is
 * real; instantiating it is not what any implementation does.
 */

import type { GValueConstruction } from './constructions.ts';
import { accumulateStep } from './hash.ts';

export interface Candidate {
  readonly tokenId: number;
  readonly probability: number;
  readonly text: string;
}

export interface MatchRecord {
  readonly layer: number;
  readonly leftIndex: number;
  readonly rightIndex: number;
  readonly leftG: number;
  readonly rightG: number;
  readonly winnerIndex: number;
  readonly decidedByTieBreak: boolean;
}

export interface BracketResult {
  readonly depth: number;
  /** Token ids drawn at the leaves, in bracket order. */
  readonly leaves: number[];
  readonly matches: MatchRecord[];
  readonly winnerTokenId: number;
}

/**
 * How a match is decided when both competitors hold the same g-value.
 *
 *   'random'          the paper's rule: uniform among the competitors attaining the
 *                     maximal g-value.
 *   'left'            always the left slot. This does NOT change the distribution, and
 *                     that is worth knowing rather than assuming: the two competitors are
 *                     independent draws from the same distribution, so which slot they
 *                     landed in carries no information about which token they are.
 *   'lowestTokenId'   always the smaller token id. This DOES change the distribution,
 *                     because now the tie is decided by something about the token itself.
 *
 * Offered so the difference can be measured rather than asserted.
 */
export type TieBreak = 'random' | 'left' | 'lowestTokenId';

/**
 * Run a literal bracket over 2^depth candidates drawn i.i.d. from `probabilities`.
 *
 * Ties are broken by a coin by default, which is what the paper specifies: Algorithms 1
 * and 2 collect every competitor attaining the maximal g-value and then sample uniformly
 * from them, and the main text and Fig. 2 both say ties are broken randomly. With a
 * Bernoulli(0.5) g-value and two competitors a tie happens about half the time, so the
 * rule is load-bearing rather than an edge case.
 */
export function runBracket(
  probabilities: readonly number[],
  tokenIds: readonly number[],
  keys: readonly number[],
  contextHash: bigint,
  construction: GValueConstruction,
  random: () => number,
  tieBreak: TieBreak = 'random',
): BracketResult {
  const depth = keys.length;
  const leafCount = 2 ** depth;
  const leaves: number[] = [];
  for (let i = 0; i < leafCount; i++) leaves.push(sampleIndex(probabilities, random()));

  const matches: MatchRecord[] = [];
  let field = leaves.slice();
  for (let layer = 0; layer < depth; layer++) {
    const key = keys[layer];
    const next: number[] = [];
    for (let i = 0; i < field.length; i += 2) {
      const left = field[i];
      const right = field[i + 1];
      const leftG = gFor(tokenIds[left], key, contextHash, construction);
      const rightG = gFor(tokenIds[right], key, contextHash, construction);
      let winner: number;
      let tie = false;
      if (leftG > rightG) winner = left;
      else if (rightG > leftG) winner = right;
      else {
        tie = true;
        if (tieBreak === 'left') winner = left;
        else if (tieBreak === 'lowestTokenId') {
          winner = tokenIds[left] <= tokenIds[right] ? left : right;
        } else winner = random() < 0.5 ? left : right;
      }
      matches.push({
        layer, leftIndex: left, rightIndex: right, leftG, rightG,
        winnerIndex: winner, decidedByTieBreak: tie,
      });
      next.push(winner);
    }
    field = next;
  }
  return { depth, leaves, matches, winnerTokenId: tokenIds[field[0]] };
}

function gFor(
  tokenId: number,
  key: number,
  contextHash: bigint,
  construction: GValueConstruction,
): number {
  return construction.gValue(accumulateStep(contextHash, tokenId), key);
}

/** Inverse-CDF sampling from a normalized distribution. */
export function sampleIndex(probabilities: readonly number[], u: number): number {
  let acc = 0;
  for (let i = 0; i < probabilities.length; i++) {
    acc += probabilities[i];
    if (u < acc) return i;
  }
  return probabilities.length - 1;
}

export interface LayerReweighting {
  readonly layer: number;
  /** E_p[g] under the distribution entering this layer — the "g mass". */
  readonly gMass: number;
  /** The distribution leaving this layer. */
  readonly probabilities: number[];
}

export interface ReweightingResult {
  readonly layers: LayerReweighting[];
  readonly probabilities: number[];
}

/**
 * REFERENCE-IMPLEMENTATION-FAITHFUL port of `update_scores`.
 *
 * The reference works in log space and calls softmax first; this takes an already
 * normalized probability vector, which is the same distribution one step later.
 */
export function applyTournamentReweighting(
  probabilities: readonly number[],
  gValues: readonly (readonly number[])[],
  depth: number,
): ReweightingResult {
  let probs = probabilities.slice();
  const layers: LayerReweighting[] = [];
  for (let d = 0; d < depth; d++) {
    let gMass = 0;
    for (let i = 0; i < probs.length; i++) gMass += gValues[i][d] * probs[i];
    const updated = probs.map((p, i) => p * (1 + gValues[i][d] - gMass));
    layers.push({ layer: d, gMass, probabilities: updated });
    probs = updated;
  }
  return { layers, probabilities: probs };
}

/**
 * Expected mean g-value after watermarking, assuming a uniform model distribution and a
 * single layer.
 *
 * REFERENCE-IMPLEMENTATION-FAITHFUL port of `expected_mean_g_value`. It applies to a
 * uniform distribution over `vocabSize` and to one layer only, which is why the page
 * shows it next to the measured value rather than in place of it: a real model
 * distribution is nowhere near uniform, and that gap is the subject of Act III.
 */
export function expectedMeanGValue(vocabSize: number, coinflipProb = 0.5): number {
  return coinflipProb + coinflipProb * (1 - coinflipProb) * (1 - 1 / vocabSize);
}

/** Total variation distance — how far reweighting moved the distribution. */
export function totalVariationDistance(
  a: readonly number[],
  b: readonly number[],
): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / 2;
}
