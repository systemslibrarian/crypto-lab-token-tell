# Verification

This directory exists so that a reader who wants to disbelieve the lab has somewhere to
start. It holds three things that are deliberately kept apart from the lab's own code:

- **`manifest.yaml`** — the claim manifest. Every claim pins one statement to one place in
  the source, to a reference that supports it, and to a procedure that could show it
  wrong. It conforms to the fleet's schema v0.2 (`schema.json`, vendored) and is checked
  by `tools/validate-manifest.mjs` (also vendored, with the schema path repointed and
  nothing else changed).

- **`claims.mjs`** — where the substance actually lives. `manifest.yaml` is GENERATED from
  it by `tools/build-manifest.mjs`, because the manifest's structural rules — claims
  sorted by file, symbol and line with sequential ids, every snippet a literal substring
  of the file it anchors to, coverage accounting for every symbol the validator's regex
  finds — are mechanical, and a mechanical rule enforced by hand drifts. CI re-runs the
  builder with `--check`, so a manifest edited into disagreement with the code cannot
  land.

- **`verifier/`** — an independent implementation. It parses the same committed vectors,
  recomputes everything, and compares. It imports nothing from `src/`.

## Why the verifier is written the way it is

A verifier that reuses the code it verifies verifies nothing: a bug in a shared helper
appears identically on both sides and the agreement reads as a pass. So the verifier
reimplements, and reimplements *differently*:

| the lab | the verifier |
|---|---|
| 64-bit arithmetic in `BigInt` | pairs of 32-bit halves with 16-bit limb multiplication |
| BPE by scanning for the lowest-ranked pair each pass | BPE with the same result reached by a differently-structured merge loop |
| canonical JSON in TypeScript | canonical JSON in plain Node, checked against hand-authored expectations |
| SHA-256 and ECDSA through WebCrypto in a browser | the same primitives through `node:crypto` |

The hand-authored canonicalization vectors in `vectors/canonicalization.json` matter for
the same reason: they were written by hand rather than captured from either
implementation, so agreement between the two is evidence rather than a shared assumption.

## Classification, and why it is not decoration

`verifier/verify.mjs` labels every expectation:

- **MATHEMATICAL INVARIANT** — true by the arithmetic. Exact comparison.
- **IMPLEMENTATION INVARIANT** — true of this construction as published. Exact comparison.
- **STATISTICAL EXPECTATION** — true on average. Compared against a stated tolerance.
- **EMPIRICAL OBSERVATION** — what was measured here. Recorded, and bounded only loosely.

A statistical expectation asserted as a binary invariant is a flaky test pretending to be
a proof. The tolerances are part of the claim, not a convenience.

## Running it

```
npm run verify            # the independent verifier
npm run verify:manifest   # schema and cross-checks on the manifest
node verification/tools/build-manifest.mjs --check
```

## Two fields that look wrong and are not

**`extraction.extraction_hash` is `PENDING`.** The validator computes that hash from the
`math_core` contents and is authoritative for it. A value written by the same pass that
wrote the claims would be marking its own homework, so the field stays PENDING and the
validator's computation is the answer. Running the builder prints the hash it would
compute, for anyone who wants to record it out of band.

**`repository.commit_sha` starts as `PENDING-FIRST-COMMIT`.** A manifest cannot contain
the hash of the commit that introduces it. The convention here: the lab and this directory
land together in one commit, and a follow-up commit fills in that commit's SHA. The code
does not change in between, so the extraction still describes the tree it was taken from.
`TOKEN_TELL_COMMIT_SHA` overrides it for anyone regenerating against a different pin.

## What this directory does not do

It does not declare anything correct, secure or verified — those are words the manifest
lints against on purpose. It records what a component does, what a procedure would show,
and which questions are still open. There are seven of those, and a lab this contested
with zero open questions would be a reason for more scrutiny rather than less.

Directive discipline, from the fleet's audit standard: findings go into deviations and
open questions, never into fixes; execution of the lab's own code is never verification
evidence; and the manifest is generated against a pinned tree rather than a moving one.
