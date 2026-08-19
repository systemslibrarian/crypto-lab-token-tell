#!/usr/bin/env node
/**
 * The independent verifier.
 *
 * Parses the same committed vectors the lab ships, recomputes everything from its own
 * implementation, and compares. It imports nothing from src/ — a verifier that shares a
 * module with the thing it verifies would reproduce that module's bugs on both sides at
 * once and call the agreement a pass.
 *
 * Every expectation is classified, because they are not the same kind of claim:
 *
 *   MATHEMATICAL INVARIANT   true by the arithmetic; an exact comparison
 *   IMPLEMENTATION INVARIANT true of this construction as published; an exact comparison
 *   STATISTICAL EXPECTATION  true on average; compared against a stated tolerance
 *   EMPIRICAL OBSERVATION    what was measured here; recorded, and only bounded loosely
 *
 * A statistical expectation asserted as a binary invariant is a flaky test pretending to
 * be a proof, so the tolerances below are explicit and are part of the claim.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { accumulate, toDecimalString, fromBigInt } from './int64.mjs';
import {
  binomialUpperTail, chainSeed, eosMask, gValue, positionHashes, repeatedContextMask, score,
} from './watermark.mjs';
import { createTokenizer } from './tokenizer.mjs';
import { buildManifest, canonicalize, generateKeyPair, signManifest, validate } from './c2pa.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PINNED = join(ROOT, 'src', 'data', 'pinned');

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const vectors = read(join(PINNED, 'test-vectors.json'));
const texts = read(join(PINNED, 'texts.json'));
const attacks = read(join(PINNED, 'attacks.json'));
const distributions = read(join(PINNED, 'distributions.json'));
const corpus = read(join(PINNED, 'null-corpus.json'));
const tokenizerMeta = read(join(PINNED, 'tokenizer-meta.json'));
const tokenizerVectors = read(join(PINNED, 'tokenizer-vectors.json'));
const labConfig = read(join(ROOT, 'src', 'data', 'watermark-config.json'));
const canonVectors = read(join(ROOT, 'verification', 'vectors', 'canonicalization.json'));

const params = vectors.watermark;
const tokenizer = createTokenizer(readFileSync(join(PINNED, 'gpt2-merges.txt'), 'utf8'));

const results = [];
let failures = 0;

function check(kind, name, passed, detail) {
  results.push({ kind, name, passed, detail });
  if (!passed) failures += 1;
}

const near = (actual, expected, tolerance) =>
  Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance;

// ── The keyed hash ──────────────────────────────────────────────────────────────
for (const vector of vectors.lcg_vectors) {
  const actual = toDecimalString(accumulate(fromBigInt(BigInt(vector.seed)), vector.data));
  check('MATHEMATICAL INVARIANT', `LCG chain over ${JSON.stringify(vector.data)}`,
    actual === vector.hash, `${actual} vs ${vector.hash}`);
}

for (const [name, expected] of Object.entries(vectors.chain_seeds)) {
  const actual = toDecimalString(chainSeed(vectors.key_sets[name]));
  check('IMPLEMENTATION INVARIANT', `chain seed for ${name}`,
    actual === expected, `${actual} vs ${expected}`);
}

// ── g-values, masking and scores on the pinned sequences ────────────────────────
for (const [sequenceName, sequence] of Object.entries(vectors.sequences)) {
  for (const [keyName, expected] of Object.entries(sequence.per_key_set)) {
    const keyed = { ...params, keys: vectors.key_sets[keyName] };
    if (expected.g_values.length) {
      const positions = positionHashes(sequence.token_ids, keyed);
      const actual = positions.map((position) =>
        keyed.keys.map((key) => gValue(position.candidateHash, key)));
      check('IMPLEMENTATION INVARIANT', `g-values on ${sequenceName} under ${keyName}`,
        JSON.stringify(actual) === JSON.stringify(expected.g_values),
        `${actual.length} rows`);

      const mask = repeatedContextMask(sequence.token_ids, keyed);
      check('IMPLEMENTATION INVARIANT',
        `repeated-context mask on ${sequenceName} under ${keyName}`,
        JSON.stringify(mask) === JSON.stringify(expected.context_repetition_mask),
        `${mask.filter((keep) => !keep).length} positions dropped`);
    }
    const eos = eosMask(sequence.token_ids, 50256);
    check('IMPLEMENTATION INVARIANT', `end-of-text mask on ${sequenceName} under ${keyName}`,
      JSON.stringify(eos) === JSON.stringify(expected.eos_mask),
      `${eos.filter((keep) => !keep).length} tokens dropped`);
  }
}

check('MATHEMATICAL INVARIANT', 'masking actually fires on a repeated context',
  repeatedContextMask(vectors.sequences.repeated_context.token_ids, params)
    .some((keep) => !keep),
  'the repeated-context vector is not vacuous');

check('MATHEMATICAL INVARIANT', 'text shorter than one n-gram yields no score',
  score(vectors.sequences.too_short.token_ids, params).score === null,
  `${vectors.sequences.too_short.token_ids.length} tokens, ngram_len ${params.ngram_len}`);

check('MATHEMATICAL INVARIANT', 'the shortest scorable text offers exactly one position',
  score(vectors.sequences.shortest_scorable.token_ids, params).candidatePositions === 1,
  'one candidate position');

// ── The pinned samples, under every key set ─────────────────────────────────────
for (const [sampleName, perKey] of Object.entries(vectors.pinned_sample_scores)) {
  const tokenIds = texts.samples[sampleName].token_ids;
  for (const [keyName, expected] of Object.entries(perKey)) {
    const actual = score(tokenIds, { ...params, keys: vectors.key_sets[keyName] });
    check('IMPLEMENTATION INVARIANT', `score of ${sampleName} under ${keyName}`,
      near(actual.score, expected.score, 1e-12)
      && actual.scoredPositions === expected.scored_positions
      && actual.gSum === expected.g_sum,
      `${actual.score} vs ${expected.score}, ${actual.scoredPositions} positions`);
  }
}

// ── The adversarial matrix ──────────────────────────────────────────────────────
const watermarked = texts.samples.watermarked.token_ids;
const control = texts.samples.control.token_ids;
const baseline = score(watermarked, params);
const controlScore = score(control, params);

const threshold320 = corpus.by_length['320'].threshold_fpr_1_percent;
check('EMPIRICAL OBSERVATION', 'correct key clears this configuration’s 1% threshold',
  baseline.score >= threshold320,
  `${baseline.score.toFixed(4)} vs threshold ${threshold320.toFixed(4)}`);

check('EMPIRICAL OBSERVATION', 'unwatermarked control does not clear it',
  controlScore.score < threshold320,
  `${controlScore.score.toFixed(4)} vs threshold ${threshold320.toFixed(4)}`);

const wrongKeyScores = [];
for (let seed = 1; seed <= 40; seed += 1) {
  // Deterministic wrong keys, derived from the configured ones so they are keys of the
  // same shape rather than arbitrary noise.
  const keys = params.keys.map((key, index) => (key ^ ((seed * 2654435761 + index) >>> 8)) % 1048576);
  wrongKeyScores.push(score(watermarked, { ...params, keys }).score);
}
const wrongMean = wrongKeyScores.reduce((total, value) => total + value, 0) / wrongKeyScores.length;
const wrongMax = Math.max(...wrongKeyScores);
check('STATISTICAL EXPECTATION', 'forty wrong keys centre on one half (tolerance 0.02)',
  near(wrongMean, 0.5, 0.02), `mean ${wrongMean.toFixed(4)}`);
check('STATISTICAL EXPECTATION', 'no wrong key reaches the correct key’s score',
  wrongMax < baseline.score, `highest wrong key ${wrongMax.toFixed(4)}`);

const oneBit = score(watermarked, { ...params, keys: vectors.key_sets.one_bit_flipped });
check('IMPLEMENTATION INVARIANT', 'one flipped key bit removes essentially all evidence',
  Math.abs(oneBit.score - 0.5) < Math.abs(baseline.score - 0.5) * 0.15,
  `${oneBit.score.toFixed(4)} against baseline ${baseline.score.toFixed(4)}`);

// A tokenizer that disagrees with the generator is scoring a different sequence.
const shifted = watermarked.map((id) => (id + 1) % 50257);
const shiftedScore = score(shifted, params);
check('IMPLEMENTATION INVARIANT', 'a tokenizer mismatch destroys the evidence',
  Math.abs(shiftedScore.score - 0.5) < Math.abs(baseline.score - 0.5) * 0.3,
  `${shiftedScore.score.toFixed(4)} after shifting every token id by one`);

const truncated = score(watermarked.slice(0, 40), params);
check('MATHEMATICAL INVARIANT', 'truncation reduces the counted positions exactly',
  truncated.candidatePositions === 40 - (params.ngram_len - 1),
  `${truncated.candidatePositions} candidate positions from 40 tokens`);

const halfDeleted = score(watermarked.filter((_, index) => index % 2 === 0), params);
check('STATISTICAL EXPECTATION', 'deleting every second token moves the score toward the null',
  Math.abs(halfDeleted.score - 0.5) < Math.abs(baseline.score - 0.5),
  `${halfDeleted.score.toFixed(4)} against baseline ${baseline.score.toFixed(4)}`);

const substituted = watermarked.map((id, index) => (index % 2 === 0 ? watermarked[0] : id));
const substitutedScore = score(substituted, params);
check('STATISTICAL EXPECTATION', 'substituting every second token moves the score toward the null',
  Math.abs(substitutedScore.score - 0.5) < Math.abs(baseline.score - 0.5),
  `${substitutedScore.score.toFixed(4)} against baseline ${baseline.score.toFixed(4)}`);

for (const transformation of attacks.transformations) {
  const recomputed = score(tokenizer.encode(transformation.transformed_text), params);
  const captured = transformation.reference_score_transformed;
  check('IMPLEMENTATION INVARIANT', `${transformation.id}: recomputed score matches the capture`,
    near(recomputed.score, captured.score, 1e-12)
    && recomputed.scoredPositions === captured.scored_positions,
    `${recomputed.score} vs ${captured.score}`);
}

// ── Entropy of the pinned distributions ─────────────────────────────────────────
const entropyOf = (probabilities) =>
  -probabilities.reduce((total, p) => (p > 0 ? total + p * Math.log2(p) : total), 0);
const high = distributions.distributions.high_entropy;
const low = distributions.distributions.low_entropy;
check('EMPIRICAL OBSERVATION', 'the high-entropy context really has more entropy',
  entropyOf(high.candidates.map((c) => c.probability))
    > entropyOf(low.candidates.map((c) => c.probability)),
  `${entropyOf(high.candidates.map((c) => c.probability)).toFixed(3)} vs ` +
  `${entropyOf(low.candidates.map((c) => c.probability)).toFixed(3)} bits`);

// The tolerance is float32-scale on purpose: these probabilities are a softmax computed
// by torch in float32 and then written out as float64, so they sum to one to about 1e-7
// and no tighter. Asserting 1e-9 here would be asserting a precision the capture never had.
check('IMPLEMENTATION INVARIANT',
  'every pinned distribution is normalized to float32 precision',
  Object.values(distributions.distributions).every((dist) =>
    near(dist.candidates.reduce((total, c) => total + c.probability, 0), 1, 1e-6)),
  Object.entries(distributions.distributions)
    .map(([name, dist]) =>
      `${name}: ${dist.candidates.reduce((total, c) => total + c.probability, 0).toFixed(9)}`)
    .join(', '));

// ── The corpus and its thresholds ───────────────────────────────────────────────
for (const entry of Object.values(corpus.by_length)) {
  const scores = entry.null_scores;
  if (!scores.length) continue;
  const rank = Math.min(scores.length - 1, Math.max(0, Math.round(0.99 * scores.length) - 1));
  check('IMPLEMENTATION INVARIANT',
    `threshold at ${entry.tokens} tokens is the recorded quantile`,
    near([...scores].sort((a, b) => a - b)[rank], entry.threshold_fpr_1_percent, 1e-12),
    `${entry.threshold_fpr_1_percent}`);
}

const recomputedNull = corpus.corpus_token_ids
  .map((tokenIds) => score(tokenIds.slice(0, 200), params).score)
  .filter((value) => value !== null);
const pinnedNull = corpus.by_length['200'].null_scores;
check('IMPLEMENTATION INVARIANT', 'the pinned null at 200 tokens recomputes exactly',
  recomputedNull.length === pinnedNull.length
  && [...recomputedNull].sort((a, b) => a - b)
    .every((value, index) => near(value, pinnedNull[index], 1e-12)),
  `${recomputedNull.length} texts`);

const measuredSd = Math.sqrt(recomputedNull.reduce((total, value) =>
  total + (value - recomputedNull.reduce((a, b) => a + b, 0) / recomputedNull.length) ** 2, 0)
  / (recomputedNull.length - 1));
const meanScored = corpus.by_length['200'].null_mean_scored_positions
  ?? (200 - (params.ngram_len - 1));
const predictedSd = Math.sqrt(0.25 / (meanScored * params.keys.length));
check('EMPIRICAL OBSERVATION',
  'measured null spread against the independence prediction (recorded, bounded at 2x)',
  measuredSd < predictedSd * 2,
  `measured ${measuredSd.toFixed(5)} against predicted ${predictedSd.toFixed(5)}`);

// ── The exact null ──────────────────────────────────────────────────────────────
check('MATHEMATICAL INVARIANT', 'binomial tail is one half above the median for even trials',
  near(binomialUpperTail(6, 10).pValue,
    (1 - (252 / 1024)) / 2, 1e-12),
  'closed form for n = 10');
check('MATHEMATICAL INVARIANT', 'binomial tail keeps a log10 value after underflow',
  binomialUpperTail(9000, 9420).pValue === 0
  && Number.isFinite(binomialUpperTail(9000, 9420).log10PValue),
  `log10 p = ${binomialUpperTail(9000, 9420).log10PValue.toFixed(1)}`);

// ── The tokenizer ───────────────────────────────────────────────────────────────
check('IMPLEMENTATION INVARIANT', 'derived vocabulary matches the real one by hash',
  tokenizer.vocabularySha256() === tokenizerMeta.vocab_sha256,
  tokenizer.vocabularySha256().slice(0, 16));
check('IMPLEMENTATION INVARIANT', 'derived vocabulary has the recorded size',
  tokenizer.vocabularySize === tokenizerMeta.vocab_size, `${tokenizer.vocabularySize}`);

let tokenizerMismatches = 0;
for (const testCase of tokenizerVectors.cases) {
  if (JSON.stringify(tokenizer.encode(testCase.text)) !== JSON.stringify(testCase.token_ids)) {
    tokenizerMismatches += 1;
  }
  if (tokenizer.decode(testCase.token_ids) !== testCase.decoded) tokenizerMismatches += 1;
}
check('IMPLEMENTATION INVARIANT', 'every tokenizer vector round-trips',
  tokenizerMismatches === 0, `${tokenizerVectors.cases.length} cases`);

for (const [sampleName, sample] of Object.entries(texts.samples)) {
  check('IMPLEMENTATION INVARIANT', `${sampleName} re-tokenizes to its committed ids`,
    JSON.stringify(tokenizer.encode(sample.text)) === JSON.stringify(sample.token_ids),
    `${sample.token_ids.length} tokens`);
}

// ── Configuration consistency ───────────────────────────────────────────────────
check('IMPLEMENTATION INVARIANT', 'the shipped configuration matches the vectors',
  JSON.stringify(labConfig.watermark.keys) === JSON.stringify(params.keys)
  && labConfig.watermark.ngram_len === params.ngram_len
  && labConfig.watermark.context_history_size === params.context_history_size,
  `${params.keys.length} keys, ngram_len ${params.ngram_len}`);

// ── Signatures ──────────────────────────────────────────────────────────────────
const CLAIM_OPTIONS = {
  claimGenerator: 'crypto-lab-token-tell/verifier',
  format: 'text/plain',
  instanceId: 'urn:uuid:00000000-0000-4000-8000-000000000001',
};
const ASSERTIONS = [{ label: 'stds.schema-org.CreativeWork', data: { author: [{ name: 'A. Cataloguer' }] } }];

for (const testCase of canonVectors.cases) {
  check('IMPLEMENTATION INVARIANT',
    `canonicalization of ${JSON.stringify(testCase.input).slice(0, 40)}`,
    canonicalize(testCase.input) === testCase.canonical,
    canonicalize(testCase.input));
}

const asset = Buffer.from('The library will retain the accession register in paper form.', 'utf8');
const keyPair = await generateKeyPair();
const signed = await signManifest(await buildManifest(asset, ASSERTIONS, CLAIM_OPTIONS), keyPair);

const clean = await validate(signed, asset);
check('IMPLEMENTATION INVARIANT', 'a signed manifest verifies', clean.valid,
  `signature ${clean.signatureValid}, binding ${clean.bindingValid}`);

const tampered = Buffer.from(asset);
tampered[0] ^= 0x01;
const tamperedResult = await validate(signed, tampered);
check('MATHEMATICAL INVARIANT', 'one flipped asset byte breaks the binding',
  !tamperedResult.bindingValid && !tamperedResult.valid && tamperedResult.signatureValid,
  'binding fails while the signature over the claim still verifies');

const stripped = await validate(null, asset);
check('IMPLEMENTATION INVARIANT', 'a stripped manifest leaves nothing to verify',
  !stripped.manifestPresent && !stripped.valid
  && stripped.actualAssetHash === clean.actualAssetHash,
  'the asset bytes are unchanged and now unmarked');

const lie = Buffer.from('This document was written by hand in 1687 and contains no errors.', 'utf8');
const signedLie = await signManifest(
  await buildManifest(lie, [{ label: 'stds.schema-org.CreativeWork', data: { dateCreated: '1687-01-01' } }],
    CLAIM_OPTIONS), keyPair);
const lieResult = await validate(signedLie, lie);
check('IMPLEMENTATION INVARIANT', 'a plainly false statement still verifies',
  lieResult.valid, 'integrity and truth are different properties');

// ── Report ──────────────────────────────────────────────────────────────────────
const byKind = results.reduce((groups, result) => {
  (groups[result.kind] ??= []).push(result);
  return groups;
}, {});

for (const [kind, group] of Object.entries(byKind)) {
  const failed = group.filter((result) => !result.passed);
  console.log(`\n${kind} — ${group.length - failed.length}/${group.length} passed`);
  for (const result of group) {
    if (!result.passed) console.log(`  FAIL  ${result.name} — ${result.detail}`);
  }
}

console.log(`\n${results.length - failures} of ${results.length} checks passed.`);
if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
