# The maths, the divergences, and what this lab could not resolve

Every claim in this file is anchored to a primary source or labelled as this lab's own
construction. Where the paper and the two reference implementations disagree, the
disagreement is recorded rather than blended into a single canonical story.

Sources are cited by short name:

- **Paper** — Dathathri, S., See, A., Ghaisas, S., et al. "Scalable watermarking for
  identifying large language model outputs." *Nature* **634**(8035): 818–823 (2024),
  doi:10.1038/s41586-024-08025-4, plus its Supplementary Information. Accessed
  2026-08-19.
- **Reference** — `google-deepmind/synthid-text` at commit
  `addb4a158143c7c6851a1308f78b89fceed59683` (branch `main`, commit dated 2025-06-13),
  Apache-2.0. Accessed 2026-08-19.
- **Transformers** — Hugging Face `transformers` 5.15.1,
  `SynthIDTextWatermarkLogitsProcessor`. Accessed 2026-08-19.
- **Google docs** — <https://ai.google.dev/responsible/docs/safeguards/synthid>, page
  footer "Last updated 2025-04-09 UTC". Accessed 2026-08-19.

---

## 1. What a g-value is

The Paper defines g by inverse-transform sampling on a pseudorandom function:

> **Definition 4** (g-value). *Given a g-value distribution with cumulative density
> function F_g, a random seed r ∈ R, and integer ℓ ∈ 1, …, m, the layer-ℓ g-value of a
> token x ∈ V is given by:* g_ℓ(x, r) := F_g^{-1}( h(x, ℓ, r) / 2^{n_sec} )

and states that it primarily uses `f_g = Bernoulli(0.5)`, while also exploring
`Uniform[0,1]`. This lab implements the Bernoulli(0.5) case only.

The seed itself is a sliding window over the **previous** H tokens plus the key:

> "for our experiments, we use the sliding window f_r(x_<t, k) ≔ h(x_{t−H}, …, x_{t−1}, k)
> … (we use H = 4)"

**Divergence 1 — one key, or one key per layer.** The Paper has a single watermarking key
`k`, and passes the layer number `ℓ` as an argument to the hash. Both implementations
instead take a *list* of keys, one per layer, and derive depth from `len(keys)`. The
Reference's Bayesian detector makes the identity explicit:
`watermarking_depth=len(logits_processor.keys)`. This lab follows the implementations,
because it is the implementations it is differentially tested against.

**Divergence 2 — `ngram_len` is not `H`.** The Reference's own configuration comment reads
"This corresponds to H=4 context window size in the paper", with `ngram_len = 5`. So
`ngram_len = H + 1`: the context window plus the candidate token.

**Divergence 3 — the g-function itself.** The two implementations do not agree, and this
lab implements both so the disagreement can be measured.

| | Reference @ `addb4a1` | Transformers 5.15.1 |
|---|---|---|
| chain seed | SHA-256 over the packed int64 key array, big-endian, mod 2^63 − 1 | the literal `1` |
| g-value | `((h >> 5) re-hashed 12 times) >> 30 & 1` | `sampling_table[h mod 65536]` |
| sampling table | none — removed in PR #32, merged 2025-06-13 | present, built by a torch RNG |

Both are faithful — to different references. Google's own documentation calls
Transformers "a production-grade implementation of SynthID Text" and the GitHub repository
"a reference implementation". At the versions pinned here, given the same text and the
same keys, they do not read each other's marks; the lab measures this rather than
asserting it.

**Consequence for a single flipped key bit.** Because the Reference hashes the whole key
list into the initialization vector that seeds every chain, flipping one bit of one key
changes every g-value at every layer. Under Transformers, where each key enters only at
its own layer, the same flip costs approximately one layer's worth of evidence. Neither
behaviour is more correct; they are different constructions.

---

## 2. Tournament sampling, and why nothing draws 2^30 candidates

The Paper's Algorithm 2 draws `N^m` candidates and plays a knockout tournament, one key
per layer, "breaking ties randomly" — formally, collecting every competitor attaining the
maximal g-value and sampling uniformly from them.

It then gives the vectorized form, and says plainly which one it runs:

> "**In practice we use the vectorized formulation for our experiments.**"

For `N = 2` and binary g-values that form is Corollary 14:

> p_wm(x_t | p, r, f_g, 2, 1) = p(x_t) · [ 1 + g_1(x_t, r) − p(V_{g_1 = 1}) ]

applied once per layer (Theorem 15). Both implementations implement exactly this, as
`update_scores`.

The two views are the same distribution, which this lab checks by measurement rather than
by citation: `src/watermark/tournament.test.ts` enumerates the single-layer marginal over
all ordered candidate pairs and compares it against the closed form, and samples the
multi-layer bracket and compares the empirical distribution against it.

**Tie-breaking, precisely.** A positional tie-break (always take the left slot) leaves the
distribution unchanged, because the two competitors are independent draws and the slot
carries no information about which token is in it. A token-identity tie-break (always take
the smaller token id) does distort it. The test asserts both.

**Non-distortion, at its stated scope.** The Paper's Theorem 18 states that for two
samples per match, any number of layers, and any g-value distribution, the expected output
distribution over a uniformly random seed equals the model's. Theorem 19 states that
`N > 2` is distortionary. This lab implements `N = 2` and claims nothing about `N > 2`.
The guarantee is an expectation over the seed — not a statement about any fixed seed — and
it is a single-decoding-step statement; the Paper defines stronger sequence-level notions
separately.

---

## 3. The statistic and its null

The score is the Paper's equation (1), with the masking of its Supplementary A.1:

    Score(x) = (1 / (m · |T̂|)) Σ_{t ∈ T̂} Σ_{ℓ=1..m} g_ℓ(x_t, r_t)

where `T̂` excludes the first `H` positions (no full context window) and any position
whose context appeared previously in the sequence.

The Paper states the null expectation directly — "an expected score of 0.5 for
unwatermarked text" — and gives an exact p-value for the Bernoulli(0.5) case:

    p = 1 − CDF_{Binomial(mT, 0.5)}( [Σ_t Σ_ℓ g_{t,ℓ}] − 1 )

which is `P(X ≥ observed sum)` for `X ~ Binomial(mT, 1/2)`. It rests on this sentence:

> "Under the null hypothesis, each g_{t,ℓ} follows the g-value distribution f_g;
> furthermore **if we apply repeated context masking … then the g_{t,ℓ} are
> independent**."

`src/watermark/frequentist.ts` computes that exact tail in log space, because at the
lengths this lab works with the p-value underflows a double and "p = 0" is a claim no
finite experiment supports.

**Why the lab also measures the null.** The independence argument is about the Paper's
idealised construction, in which `h` is assumed to be a pseudorandom function family. Both
implementations use a linear congruential generator, and the Reference's README states
that it "does not provide any guarantees of cryptographic security". So the page computes
the closed form *and* measures the spread empirically — by scoring the same bytes under
many random keys, and by scoring a corpus of unwatermarked texts — and shows the two side
by side rather than asserting agreement.

**Thresholds.** No primary source supplies a numeric threshold. Every threshold in this
lab is its own empirical construction: the top 1% (or 5%) of scores from 48 unwatermarked
texts of the nearest length. The Paper reports detectability the same way and says so:

> "Although some scoring functions allow a precise theoretical guarantee on the
> false-positive rate … in this work we take the empirical approach described above."

**What this lab does not implement.** The Paper's headline results use a learned Bayesian
scoring function (Supplementary A.4), trained on labelled watermarked and unwatermarked
data. Both implementations ship one. This lab implements the mean, because it is the one a
reader can follow end to end, and it says so wherever it prints a number.

---

## 4. Measured results, and what they are results about

All figures below are for this configuration — `ngram_len = 5`, 30 keys,
`context_history_size = 1024`, `N = 2`, GPT-2 at temperature 1.0 and top-k 40 — and for no
other. They were produced by `tools/` and are committed under `src/data/pinned/`.

- Detection rate at a 1% false-positive threshold rises from roughly 56% at 10 tokens to
  roughly 85% at 150 tokens, and then plateaus.
- The plateau is not a length effect. Around one in seven watermarked texts in the corpus
  collapses into a repetition loop; the repeated-context rule then discards almost every
  position, and there is nothing left to score. Those texts are never detected at any
  length.
- Back-translation (English → German → English, Helsinki-NLP opus-mt) degrades the score
  but leaves it above the threshold. Paraphrase (a T5 paraphraser, sentence by sentence)
  takes it to the null. Both transformations are committed with the exact models,
  revisions and parameters that produced them.
- The measured spread of the empirical null runs slightly above the independence
  prediction at short lengths and matches it at long ones. With 48 samples the standard
  deviation itself carries about 10% relative error, so this is suggestive, not settled —
  and where it holds, the exact p-value is optimistic at that length.

---

## 5. Open questions

These are carried rather than guessed. They also appear in
`verification/manifest.yaml`, which is the machine-readable copy.

**OQ-1 · The zero-initialised context history.** Both implementations start the
repeated-context history buffer as zeros, so a context whose int64 hash is exactly 0 would
collide with the empty history and be masked. Probability about 2^-64 per position.
Reproduced faithfully rather than fixed. Unresolved: whether this is intentional.

**OQ-2 · Whether the two implementations are meant to interoperate.** Google's
documentation names both, calling one production-grade and the other a reference. At the
pinned versions they compute different g-values. Unresolved: whether the divergence is
intended, transitional, or an oversight — PR #32 in the Reference changed the g-value
derivation and removed the sampling table, and the change is not described as a
compatibility break in any source consulted.

**OQ-3 · Independence under a non-cryptographic hash.** The exact null depends on the
counted g-values being independent, argued for an idealised PRF. The implementations use
an LCG that the Reference itself declines to call cryptographically secure. Unresolved:
whether the LCG's structure biases the null at any length. The measurement here is
suggestive at short lengths and cannot settle it with 48 samples.

**OQ-4 · Threshold indexing.** This lab's thresholds are indexed by token count; the
evidence is indexed by scored positions, and for a degenerate text these diverge sharply.
Unresolved: what the right index is for a threshold that has to be published in advance of
seeing the text.

**OQ-5 · The mechanism of SynthID for image, audio and video.** The Paper says nothing
about it; a full-text search finds no substantive mention. Google's consumer-facing routes
for those media are issuer-operated and no detector is published. Unresolved by the
sources this lab cites: what the secret actually is for those media. This lab therefore
makes no claim about it beyond the observable access model.

**OQ-6 · Whether any published route allows third-party verification of SynthID-Text.**
Checked as carefully as the available first-party sources allow: the Gemini app
verification covers image, video and audio and requires sign-in; the SynthID Detector
portal is waitlisted and currently described for image, video and audio; the Cloud AI
Content Detection API is images-only, private preview, and is a classifier rather than a
watermark reader; and Google's guidance frames detector exposure as three choices the
issuer makes. No route was found. Should a publicly-verifiable variant ship, the
load-bearing row of Act VII would need revisiting — which is why it is written as a
property of the construction, with the product situation reported separately.
