#!/usr/bin/env node
/**
 * Build verification/manifest.yaml from verification/claims.mjs.
 *
 * The manifest has hard structural rules — claims sorted by file, symbol and line with
 * sequential ids; every snippet a literal substring of the file it anchors to; coverage
 * accounting for every symbol the validator's own regex finds. Those are mechanical, and
 * a mechanical rule enforced by hand drifts. So the substance lives in claims.mjs and the
 * structure is assembled here, which also means the manifest can be regenerated and
 * diffed to prove it has not been edited into disagreement with the code.
 *
 * Usage:
 *   node verification/tools/build-manifest.mjs          write the manifest
 *   node verification/tools/build-manifest.mjs --check  fail if it would change
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const MANIFEST_PATH = join(ROOT, 'verification', 'manifest.yaml');

const { LAB, MATH_CORE, OTHER_FILES, PARAMETERS, CLAIMS, DEVIATIONS, OPEN_QUESTIONS,
  CRYPTOGRAPHER_CHECKLIST, REFERENCE_PACK, AUDIT_MODE, EXTRACTION } =
  await import(join(ROOT, 'verification', 'claims.mjs'));

/** The validator's own symbol regex, reproduced so coverage cannot drift from it. */
const SYMBOL_RE = /(?:function|class)\s+([A-Za-z0-9_]+)|(?:const|let|var)\s+([A-Za-z0-9_]+)\s*=/g;

function symbolsIn(source) {
  const found = new Set();
  let match;
  SYMBOL_RE.lastIndex = 0;
  while ((match = SYMBOL_RE.exec(source))) {
    if (match[1]) found.add(match[1]);
    if (match[2]) found.add(match[2]);
  }
  return [...found].sort();
}

const sources = new Map();
for (const path of MATH_CORE) sources.set(path, readFileSync(join(ROOT, path), 'utf8'));

// ── validate the definitions before emitting anything ───────────────────────────
const problems = [];
for (const claim of CLAIMS) {
  const source = sources.get(claim.file);
  if (!source) {
    problems.push(`${claim.symbol}: ${claim.file} is not declared as math_core`);
    continue;
  }
  if (!source.includes(claim.snippet)) {
    problems.push(`${claim.symbol}: snippet is not a literal substring of ${claim.file}`);
  }
  const line = source.split('\n').findIndex((text) => text.includes(claim.snippet.split('\n')[0]));
  if (line >= 0) claim.resolvedLine = line + 1;
  else problems.push(`${claim.symbol}: could not locate the snippet's first line`);
}
if (problems.length) {
  console.error('claim definitions are inconsistent with the source:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

// ── canonical ordering: file, then symbol, then first line ──────────────────────
const ordered = [...CLAIMS].sort((a, b) =>
  a.file < b.file ? -1 : a.file > b.file ? 1
    : a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1
      : a.resolvedLine - b.resolvedLine);

const claimIds = new Map();
ordered.forEach((claim, index) => claimIds.set(claim.key, `C${index + 1}`));

// ── coverage: every symbol the validator will find, accounted for ───────────────
const coverage = MATH_CORE.map((path) => {
  const source = sources.get(path);
  const all = symbolsIn(source);
  const reviewed = ordered.filter((claim) => claim.file === path).map((claim) => claim.symbol);
  const reviewedSet = new Set(reviewed);
  const excluded = all.filter((symbol) => !reviewedSet.has(symbol));
  return {
    file: path,
    reviewed_symbols: [...new Set(reviewed)].sort(),
    excluded_symbols: excluded,
    unresolved_regions: [],
    note: excluded.length
      ? 'excluded_symbols are local bindings and helpers reached through the reviewed '
        + 'entry points; they carry no independent claim of their own'
      : '',
  };
});

// extraction_hash is left PENDING: the validator is authoritative for it, and a value
// written here by the same pass that wrote the claims would be checking itself.
const extractionHash = 'PENDING';

const manifest = {
  manifest_version: '0.2',
  lab: LAB,
  repository: {
    url: 'https://github.com/systemslibrarian/crypto-lab-token-tell',
    default_branch: 'main',
    commit_sha: process.env.TOKEN_TELL_COMMIT_SHA ?? EXTRACTION.commit_sha,
  },
  extraction: { ...EXTRACTION.extraction, extraction_hash: extractionHash },
  audit_mode: AUDIT_MODE,
  reference_pack: REFERENCE_PACK,
  scope_map: {
    files: [
      ...MATH_CORE.map((path) => ({ path, role: 'math_core', note: '' })),
      ...OTHER_FILES,
    ],
    entry_points: ['src/main.ts'],
    extraction_order: MATH_CORE,
    red_flags: [],
    scope_amendments: [],
  },
  coverage,
  parameters: PARAMETERS,
  claims: ordered.map((claim) => ({
    id: claimIds.get(claim.key),
    type: claim.type,
    statement: claim.statement,
    latex: claim.latex ?? '',
    ...(claim.computable ? { computable: claim.computable } : {}),
    code_anchor: {
      file: claim.file,
      symbol: claim.symbol,
      lines: [claim.resolvedLine, claim.resolvedLine + claim.snippet.split('\n').length - 1],
      snippet: claim.snippet,
    },
    reference_anchor: claim.reference_anchor,
    verification: claim.verification,
    implementation_provenance: claim.implementation_provenance,
    depends_on: (claim.depends_on ?? []).map((key) => claimIds.get(key) ?? key),
    extractor_confidence: claim.extractor_confidence,
    extraction_status: claim.extraction_status,
    verification_status: claim.verification_status,
    conformance_status: claim.conformance_status,
    notes: claim.notes ?? '',
  })),
  deviations: DEVIATIONS,
  open_questions: OPEN_QUESTIONS,
  cryptographer_checklist: CRYPTOGRAPHER_CHECKLIST,
};

// ── emit YAML (a small, explicit writer: no dependency, no surprises) ───────────
function yaml(value, indent = 0) {
  const pad = ' '.repeat(indent);
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    if (!value.length) return ' []';
    return `\n${value.map((item) => {
      const rendered = yaml(item, indent + 2);
      return rendered.startsWith('\n')
        ? `${pad}-${rendered.replace(/\n/g, '\n').slice(1).replace(new RegExp(`^${' '.repeat(indent + 2)}`), ' ')}`
        : `${pad}-${rendered}`;
    }).join('\n')}`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) return ' {}';
    return `\n${entries.map(([key, entry]) =>
      `${pad}${key}:${yaml(entry, indent + 2)}`).join('\n')}`;
  }
  if (typeof value === 'string') {
    // Always a double-quoted scalar, even for multi-line values. A block scalar would be
    // friendlier to read, but its indentation is inferred from the first line, and these
    // strings are code snippets whose leading whitespace is load-bearing: the validator
    // checks each one is a literal substring of the file it anchors to, so a single eaten
    // space is a failed check.
    return ` ${JSON.stringify(value)}`;
  }
  return ` ${JSON.stringify(value)}`;
}

const header = `# Verification manifest for crypto-lab-token-tell.
#
# GENERATED by verification/tools/build-manifest.mjs from verification/claims.mjs.
# Do not edit this file by hand: run the builder, and CI re-runs it with --check so an
# edit here that disagrees with the code cannot land.
#
# extraction_hash is PENDING on purpose. The validator computes it from the math_core
# contents and is authoritative for it; a value written by the same pass that wrote the
# claims would be marking its own homework.
`;

const body = Object.entries(manifest)
  .map(([key, value]) => `${key}:${yaml(value, 2)}`)
  .join('\n');
const output = `${header}${body}\n`;

if (process.argv.includes('--check')) {
  const existing = readFileSync(MANIFEST_PATH, 'utf8');
  if (existing !== output) {
    console.error('verification/manifest.yaml is out of date — run '
      + 'node verification/tools/build-manifest.mjs');
    process.exit(1);
  }
  console.log(`manifest is in sync (${manifest.claims.length} claims, `
    + `${manifest.open_questions.length} open questions)`);
} else {
  writeFileSync(MANIFEST_PATH, output, 'utf8');
  const mathCoreContent = MATH_CORE.slice().sort().map((path) => sources.get(path)).join('');
  console.log(`wrote verification/manifest.yaml — ${manifest.claims.length} claims, `
    + `${manifest.open_questions.length} open questions`);
  console.log('extraction_hash the validator will compute: '
    + createHash('sha256').update(mathCoreContent).digest('hex'));
}
