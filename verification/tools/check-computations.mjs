#!/usr/bin/env node
/**
 * Evaluate every computable claim's own expression and compare it to the value published
 * beside it.
 *
 * Reads: verification/manifest.yaml (generated from verification/claims.mjs).
 * Prevents: a published figure that its own stated expression does not produce.
 *
 * WHY THIS EXISTS. The manifest carries 25 `computable` blocks: a language, an
 * expression, and an `expected` value. `validate-manifest.mjs` checks that the BLOCK is
 * present for the claim types that need one. Nothing evaluated the expression. So the
 * expressions were prose sitting next to numbers, and on 2026-11-05 three of the
 * nineteen python ones disagreed with the value published beside them -- including C18,
 * whose published 2951479051793528132 is not the value of its expression under any input
 * or multiplier (its expression, its LaTeX, its statement and the code it anchors to all
 * give 7844292295230488766).
 *
 * WHAT IS CHECKED. The `python` claims, by running each expression in python3 -- the
 * language the claim itself declares, rather than a reimplementation of it. Integers must
 * match EXACTLY, including the decimal-string encoding the manifest uses for values a
 * double cannot hold. Floats must agree to 1e-12 relative, which is loose enough for the
 * last-bit differences a cross-language float computation produces and far tighter than
 * any real discrepancy (the two open ones below are 1.7e-7 and 1.5e-4).
 *
 * WHAT IS NOT. The six `javascript` claims are statement lists whose value is their
 * completion value, which only `eval` returns -- and an eval over file content is a
 * code-injection sink this fleet will not add to a repository under CodeQL. They are
 * printed as NOT EVALUATED, by id, so the gap is named rather than silent. Each asserts a
 * boolean or a JSON shape that its own unit tests cover.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = join(HERE, '..', 'manifest.yaml');
const SCRATCH = join(tmpdir(), 'token-tell-claim-expression.py');

/** Relative tolerance for non-integer expected values. See the header. */
const FLOAT_TOLERANCE = 1e-12;

/**
 * Claims whose published value its own expression does not produce, left as they are
 * because correcting them is a decision about published evidence rather than a
 * transcription fix: for each, the number corresponds to no integer count in the
 * expression, so either the literals or the measurement is the authoritative one, and
 * only the person who ran it can say which.
 *
 * Each entry must STILL disagree. If one starts agreeing, this file fails too: a list of
 * known exceptions that nobody re-reads is how a fixed defect goes on being excused.
 */
const KNOWN_UNRESOLVED = {
  C15: 'published 0.005253784205889284, expression gives 0.005252981913594169 '
    + '(1.5e-4 relative; the published value implies a count of 9057.23, and no integer '
    + 'count reproduces it)',
  C27: 'published 0.6037528604118994, expression gives 0.6037527593818984 '
    + '(1.7e-7 relative; the published value implies a denominator of 9059.9985)'
};

function blocks() {
  const manifest = yaml.load(readFileSync(MANIFEST_PATH, 'utf8'));
  const out = [];
  for (const claim of manifest.claims ?? []) {
    if (claim.computable) out.push({ id: claim.id, computable: claim.computable });
  }
  for (const parameter of manifest.parameters ?? []) {
    if (parameter.computable) out.push({ id: `parameter:${parameter.name}`, computable: parameter.computable });
  }
  return out;
}

/** Run one expression in the language it declares. The expression is repo-owned. */
function evaluatePython(expression) {
  writeFileSync(SCRATCH, `print(repr((${expression})))\n`, 'utf8');
  return execFileSync('python3', [SCRATCH], { encoding: 'utf8' }).trim();
}

function agrees(expected, computed) {
  const wantedText = String(expected).replace(/^"|"$/g, '');
  if (/^-?\d+$/.test(wantedText) && /^-?\d+$/.test(computed)) {
    // Exact, always: this is the case a double silently rounds, which is why the
    // manifest encodes these as decimal strings in the first place.
    return wantedText === computed;
  }
  const wanted = Number(wantedText);
  const got = Number(computed);
  if (!Number.isFinite(wanted) || !Number.isFinite(got)) return wantedText === computed;
  return Math.abs(got - wanted) <= FLOAT_TOLERANCE * Math.max(Math.abs(wanted), Number.MIN_VALUE);
}

const failures = [];
const notEvaluated = [];
let checked = 0;
let excused = 0;

for (const { id, computable } of blocks()) {
  if (computable.language !== 'python') {
    notEvaluated.push(`${id} (${computable.language})`);
    continue;
  }
  let computed;
  try {
    computed = evaluatePython(computable.expression);
  } catch (error) {
    failures.push(`${id}: its expression did not evaluate — ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    continue;
  }
  const ok = agrees(computable.expected, computed);
  const known = Object.hasOwn(KNOWN_UNRESOLVED, id);
  if (ok && known) {
    failures.push(`${id}: now AGREES with its expression, so its KNOWN_UNRESOLVED entry is stale — delete it. ${KNOWN_UNRESOLVED[id]}`);
    continue;
  }
  if (ok) {
    checked += 1;
    continue;
  }
  if (known) {
    excused += 1;
    console.log(`UNRESOLVED ${id} — ${KNOWN_UNRESOLVED[id]}`);
    continue;
  }
  failures.push(
    `${id}: published ${JSON.stringify(computable.expected)}, its own expression gives ${computed}\n`
      + `        ${computable.expression}`
  );
}

if (notEvaluated.length) {
  console.log(`NOT EVALUATED (${notEvaluated.length}) — a completion value needs eval, which this repo will not add: ${notEvaluated.join(', ')}`);
}

if (failures.length) {
  console.error(`\n${failures.length} computable claim(s) disagree with their own expressions:`);
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log(`${checked} computable claims agree with their own expressions`
  + `${excused ? `, ${excused} recorded as unresolved above` : ''}`);
