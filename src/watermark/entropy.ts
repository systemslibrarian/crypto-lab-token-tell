/**
 * How much freedom the model had.
 *
 * A generative watermark has more opportunity to encode detectable statistical structure
 * when the model has several plausible next tokens. If the next token is nearly
 * predetermined, keyed selection has almost nothing to select between: every candidate
 * the tournament draws is the same token, so every match is a tie and the winner is that
 * token whatever the key says.
 *
 * Two numbers, both reported, because they answer different questions:
 *   Shannon entropy in bits  — the classical measure of uncertainty.
 *   Effective candidates 2^H — the same quantity expressed as "about how many tokens
 *                              were genuinely in play", which is the one a reader can
 *                              hold next to a bracket of 2^m leaves.
 */

/** Shannon entropy in bits. Zero-probability entries contribute nothing. */
export function shannonEntropyBits(probabilities: readonly number[]): number {
  let h = 0;
  for (const p of probabilities) {
    if (p > 0) h -= p * Math.log2(p);
  }
  return h;
}

/** 2^H — the perplexity of the distribution, read as an effective candidate count. */
export function effectiveCandidates(probabilities: readonly number[]): number {
  return 2 ** shannonEntropyBits(probabilities);
}

/** Probability mass held by the single most likely token. */
export function topMass(probabilities: readonly number[]): number {
  return probabilities.reduce((m, p) => (p > m ? p : m), 0);
}

/**
 * Probability that two independent draws from this distribution are the same token.
 *
 * This is the one that governs a tournament directly: a match between two identical
 * tokens is decided by a coin rather than by the key, so it carries no signal at all.
 */
export function collisionProbability(probabilities: readonly number[]): number {
  let sum = 0;
  for (const p of probabilities) sum += p * p;
  return sum;
}

/** Renormalize a truncated distribution so it sums to one. */
export function renormalize(weights: readonly number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) throw new Error('cannot renormalize a distribution with no mass');
  return weights.map((w) => w / total);
}
