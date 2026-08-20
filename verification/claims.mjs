/**
 * The substance of the verification manifest.
 *
 * Each claim pins one statement to one place in the code, to a reference that supports it,
 * and to a procedure that could show it wrong. verification/tools/build-manifest.mjs
 * assembles these into verification/manifest.yaml with the ordering, ids and coverage
 * accounting the schema requires.
 *
 * Two rules shape the wording. Statements avoid verdict words — a manifest records what
 * a component does and what a procedure would show, not whether the result is good.
 * And a claim whose confidence is below high names the open question that holds it back.
 */

export const LAB = {
  slug: 'token-tell',
  name: 'Token Tell',
  claimed_standards: [
    'C2PA Technical Specification 2.4 (structure only; this build is C2PA-shaped and not conformant)',
  ],
  claim_sources: [
    'Nature 634(8035):818-823 (2024) and its Supplementary Information',
    'google-deepmind/synthid-text @ addb4a158143c7c6851a1308f78b89fceed59683',
    'transformers 5.15.1 SynthIDTextWatermarkLogitsProcessor',
  ],
};

export const EXTRACTION = {
  // Filled by the commit that pins this tree; see verification/README.md for why this is
  // a two-commit dance rather than a self-reference.
  commit_sha: 'beeec8751e25d44ca15b293c0163a14eb1207857',
  extraction: {
    pass: 'B',
    model: 'claude-opus-5[1m]',
    date: '2026-08-19',
  },
};

export const AUDIT_MODE = {
  type: 'pedagogical_model',
  claimed_boundary:
    'The keyed g-value detection path (hash, chain seed, g-values, masking, mean score, '
    + 'exact null), the GPT-2 byte-level tokenizer, the tournament formulations, and an '
    + 'ECDSA P-256 signature over a C2PA-shaped manifest.',
  intentionally_omitted: [
    'the learned Bayesian detector both reference implementations ship',
    'the distortionary tournament configuration (more than two competitors per match)',
    'the Uniform[0,1] g-value distribution the paper also defines',
    'JUMBF containers, COSE claim signatures, certificate chains and trust lists',
    'any semantic-hybrid watermarking scheme',
    'in-browser language model inference',
  ],
  delegated_components: [
    'SHA-256 and ECDSA P-256 (WebCrypto in the browser, node:crypto in the verifier)',
    'SHA-256 for the chain seed in the browser (@noble/hashes)',
  ],
};

export const MATH_CORE = [
  'src/c2pa/manifest.ts',
  'src/c2pa/sign.ts',
  'src/c2pa/validate.ts',
  'src/tokenizer/byte-level.ts',
  'src/tokenizer/gpt2.ts',
  'src/watermark/aggregate.ts',
  'src/watermark/constructions.ts',
  'src/watermark/entropy.ts',
  'src/watermark/frequentist.ts',
  'src/watermark/gvalues.ts',
  'src/watermark/hash.ts',
  'src/watermark/mask.ts',
  'src/watermark/null-model.ts',
  'src/watermark/params.ts',
  'src/watermark/sampling-table.ts',
  'src/watermark/score.ts',
  'src/watermark/tournament.ts',
];

export const OTHER_FILES = [
  { path: 'src/main.ts', role: 'ui', note: 'mounts the panels' },
  { path: 'src/lab-config.ts', role: 'protocol_glue', note: 'assembles committed data into the runtime objects' },
  { path: 'src/ui', role: 'ui', note: 'panel rendering' },
  { path: 'src/data/pinned', role: 'data', note: 'captured offline by tools/, with provenance blocks' },
  { path: 'tools', role: 'test', note: 'capture scripts that produced the pinned data' },
  { path: 'verification/verifier', role: 'test', note: 'the independent verifier; shares no module with the lab' },
];

export const REFERENCE_PACK = [
  {
    id: 'PAPER',
    type: 'paper',
    title: 'Scalable watermarking for identifying large language model outputs',
    version: 'Nature 634(8035):818-823 (2024), with Supplementary Information',
    source_url: 'https://www.nature.com/articles/s41586-024-08025-4',
    section: 'Methods; Supplementary A, E, G',
    excerpt_sha256: '',
    supplied_by: 'human',
  },
  {
    id: 'REFIMPL',
    type: 'repo_claim',
    title: 'google-deepmind/synthid-text',
    version: 'addb4a158143c7c6851a1308f78b89fceed59683',
    source_url: 'https://github.com/google-deepmind/synthid-text',
    section: 'src/synthid_text/logits_processing.py; src/synthid_text/hashing_function.py',
    excerpt_sha256: '',
    supplied_by: 'human',
  },
  {
    id: 'HFIMPL',
    type: 'library_documentation',
    title: 'transformers SynthIDTextWatermarkLogitsProcessor',
    version: '5.15.1',
    source_url: 'https://github.com/huggingface/transformers',
    section: 'src/transformers/generation/logits_process.py',
    excerpt_sha256: '',
    supplied_by: 'human',
  },
  {
    id: 'GOOGLEDOC',
    type: 'library_documentation',
    title: 'SynthID: Tools for watermarking and detecting LLM-generated Text',
    version: 'last updated 2025-04-09, accessed 2026-08-19',
    source_url: 'https://ai.google.dev/responsible/docs/safeguards/synthid',
    section: 'Watermark configurations; Detector exposure',
    excerpt_sha256: '',
    supplied_by: 'human',
  },
  {
    id: 'C2PA',
    type: 'standard',
    title: 'C2PA Technical Specification',
    version: '2.4 (April 2026), accessed 2026-08-19',
    source_url: 'https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html',
    section: 'Manifests; claim signature; hard bindings',
    excerpt_sha256: '',
    supplied_by: 'human',
  },
  {
    id: 'WILSON',
    type: 'paper',
    title: 'Wilson, E. B. "Probable Inference, the Law of Succession, and Statistical Inference"',
    version: 'Journal of the American Statistical Association 22(158):209-212 (1927)',
    source_url: 'https://doi.org/10.1080/01621459.1927.10502953',
    section: 'the score interval for a binomial proportion',
    excerpt_sha256: '',
    supplied_by: 'human',
  },
  {
    id: 'ROGANGLADEN',
    type: 'paper',
    title: 'Rogan, W. J., Gladen, B. "Estimating prevalence from the results of a screening test"',
    version: 'American Journal of Epidemiology 107(1):71-76 (1978)',
    source_url: 'https://doi.org/10.1093/oxfordjournals.aje.a112510',
    section: 'the prevalence correction for a test of known sensitivity and specificity',
    excerpt_sha256: '',
    supplied_by: 'human',
  },
  {
    id: 'GPT2',
    type: 'repo_claim',
    title: 'GPT-2 byte-level BPE tokenizer',
    version: 'openai-community/gpt2 as pinned in src/data/pinned/tokenizer-meta.json',
    source_url: 'https://huggingface.co/openai-community/gpt2',
    section: 'vocab.json; merges.txt',
    excerpt_sha256: '',
    supplied_by: 'human',
  },
];

export const PARAMETERS = [
  {
    name: 'ngram_len',
    value_in_code: 5,
    expected_value: 5,
    reference_anchor: { ref: 'REFIMPL', location: 'synthid_mixin.py DEFAULT_WATERMARKING_CONFIG' },
    reference_quote: 'This corresponds to H=4 context window size in the paper.',
    match: 'yes',
  },
  {
    name: 'keys',
    value_in_code: '30 published demo keys, one per tournament layer',
    expected_value: 'the reference implementation’s shipped default list of 30',
    reference_anchor: { ref: 'REFIMPL', location: 'synthid_mixin.py DEFAULT_WATERMARKING_CONFIG' },
    match: 'yes',
  },
  {
    name: 'context_history_size',
    value_in_code: 1024,
    expected_value: 1024,
    reference_anchor: { ref: 'REFIMPL', location: 'synthid_mixin.py DEFAULT_WATERMARKING_CONFIG' },
    match: 'yes',
  },
  {
    name: 'num_leaves',
    value_in_code: 2,
    expected_value: 2,
    reference_anchor: { ref: 'PAPER', location: 'Supplementary G.1 Theorem 18' },
    match: 'yes',
  },
  {
    name: 'lcg_multiplier',
    value_in_code: 6364136223846793005,
    expected_value: 6364136223846793005,
    reference_anchor: { ref: 'REFIMPL', location: 'hashing_function.py accumulate_hash' },
    reference_quote: 'Method uses adapted linear congruential generator (LCG)with newlib/musl',
    match: 'yes',
  },
  {
    name: 'num_apply_hash',
    value_in_code: 12,
    expected_value: 12,
    reference_anchor: { ref: 'REFIMPL', location: 'logits_processing.py get_gvals' },
    match: 'yes',
  },
  {
    name: 'gvalue_shift',
    value_in_code: 5,
    expected_value: 5,
    reference_anchor: { ref: 'REFIMPL', location: 'logits_processing.py get_gvals' },
    match: 'yes',
    reference_quote: 'shift = shift or (64 // num_apply_hash)',
  },
  {
    name: 'gvalue_output_bit',
    value_in_code: 30,
    expected_value: 30,
    reference_anchor: { ref: 'REFIMPL', location: 'logits_processing.py get_gvals' },
    reference_quote: 'return (ngram_keys >> 30) % 2',
    match: 'yes',
  },
  {
    name: 'null_expected_mean',
    value_in_code: 0.5,
    expected_value: 0.5,
    reference_anchor: { ref: 'PAPER', location: 'Supplementary A.2' },
    reference_quote: 'an expected score of 0.5 for unwatermarked text',
    match: 'yes',
  },
];

const anchor = (ref, location) => ({ ref, location });

export const CLAIMS = [
  {
    key: 'wilson-interval',
    file: 'src/watermark/aggregate.ts',
    symbol: 'wilsonInterval',
    type: 'distribution',
    statement:
      'The reported interval for an observed proportion should be the pair of values p '
      + 'satisfying |p_hat - p| = z*sqrt(p(1-p)/n), rather than p_hat plus or minus the '
      + 'standard error evaluated at p_hat.',
    latex:
      'p_{\\pm} = \\frac{\\hat p + \\frac{z^2}{2n} \\pm z\\sqrt{\\frac{\\hat p(1-\\hat p)}{n} '
      + '+ \\frac{z^2}{4n^2}}}{1 + \\frac{z^2}{n}}',
    snippet: 'export function wilsonInterval(successes: number, trials: number, z: number = Z_95): Interval {',
    computable: {
      language: 'python',
      relation: 'equality',
      expression:
        '(lambda z, p, n: ((p + z*z/(2*n)) + (z/1)*__import__("math").sqrt(p*(1-p)/n + '
        + 'z*z/(4*n*n)))/(1 + z*z/n))(1.959963984540054, 0.5, 10)',
      inputs: {},
      expected: 0.7634069094874361,
      dependencies: [],
    },
    reference_anchor: anchor('WILSON', 'the score interval, as against the normal approximation'),
    verification: {
      method: 'algebraic',
      implementation: 'the defining equation evaluated at both returned endpoints',
      vector_source: 'none required',
      procedure:
        'For several counts, substitute each endpoint back into |p_hat - p| = '
        + 'z*sqrt(p(1-p)/n) and check the residual is zero to double precision; compare '
        + 'two small cases against published values.',
      expected_observation: 'the residuals vanish and the published endpoints are reproduced',
    },
    implementation_provenance: {
      kind: 'custom', component: 'binomial score interval', package: '', version: '',
      boundary: 'closed form, clamped to [0, 1]',
    },
    extractor_confidence: 'high',
    extraction_status: 'anchored',
    verification_status: 'independently_tested',
    conformance_status: 'not_applicable',
    notes:
      'Outside the watermarking literature: it is the interval Act VIII puts on a count '
      + 'of flagged documents before the count is corrected. Nothing in the detection path '
      + 'depends on it.',
  },
  {
    key: 'operating-point',
    file: 'src/watermark/aggregate.ts',
    symbol: 'operatingPoint',
    type: 'arithmetic',
    statement:
      'The threshold should be the floor(f*n)-th largest unmarked calibration score, and '
      + 'the two rates reported beside it should be the measured fractions of each class at '
      + 'or above that threshold rather than the rate requested.',
    snippet: '  const threshold = allowed >= 1 ? descending[allowed - 1] : descending[0];',
    computable: {
      language: 'python',
      relation: 'equality',
      expression:
        'sorted([0.5 + i * 0.001 for i in range(20)], reverse=True)[int(0.1 * 20) - 1]',
      inputs: {},
      expected: 0.518,
      dependencies: [],
    },
    reference_anchor: anchor('ROGANGLADEN', 'sensitivity and specificity as measured quantities'),
    verification: {
      method: 'metamorphic',
      implementation: 'constructed score sets with known order and with ties',
      vector_source: 'none required',
      procedure:
        'Place a threshold on evenly spaced scores and count exceedances; repeat with every '
        + 'unmarked score identical, where no threshold can achieve the requested rate.',
      expected_observation:
        'the exceedance count equals floor(f*n) when the scores are distinct, and the '
        + 'reported rate departs from the requested one when they are tied',
    },
    implementation_provenance: {
      kind: 'custom', component: 'operating point', package: '', version: '',
      boundary: 'empirical quantile over a calibration set held out by source text',
    },
    extractor_confidence: 'high',
    extraction_status: 'anchored',
    verification_status: 'independently_tested',
    conformance_status: 'not_applicable',
    notes:
      'No primary source supplies a numeric threshold for this construction, here or '
      + 'anywhere else on the page. This one is placed on 128 unmarked documents and its '
      + 'realised rates are printed beside it, including on documents it never saw.',
  },
  {
    key: 'prevalence-correction',
    file: 'src/watermark/aggregate.ts',
    symbol: 'estimateMarkedFraction',
    type: 'arithmetic',
    statement:
      'The estimated marked fraction should equal the observed positive rate less the '
      + 'false-positive rate, divided by the difference between the true-positive and '
      + 'false-positive rates.',
    latex: '\\hat\\pi = \\frac{p - \\mathrm{FPR}}{\\mathrm{TPR} - \\mathrm{FPR}}',
    snippet: '  const correct = (rate: number): number => (rate - point.falsePositiveRate) / separation;',
    computable: {
      language: 'python',
      relation: 'equality',
      expression: '(0.23 - 0.05) / (0.65 - 0.05)',
      inputs: {},
      expected: 0.3,
      dependencies: [],
    },
    reference_anchor: anchor('ROGANGLADEN', 'the prevalence estimator'),
    verification: {
      method: 'metamorphic',
      implementation: 'a corpus of known composition flagged at exactly the declared rates',
      vector_source: 'src/data/pinned/null-corpus.json for the live run; constructed counts for the unit suite',
      procedure:
        'Build a count from a known marked fraction, the true-positive rate and the '
        + 'false-positive rate, hand the estimator only the total, and compare what it '
        + 'returns with the fraction the count was built from; repeat with rates that do '
        + 'not separate.',
      expected_observation:
        'the composition is recovered exactly, and a non-separating pair of rates returns '
        + 'no estimate rather than a large one',
    },
    implementation_provenance: {
      kind: 'adapted', component: 'prevalence correction', package: '', version: '',
      boundary: 'screening-test arithmetic applied to a watermark detector',
    },
    extractor_confidence: 'high',
    extraction_status: 'anchored',
    verification_status: 'independently_tested',
    conformance_status: 'not_applicable',
    notes:
      'The estimate is a statement about a corpus and never about a document. Its interval '
      + 'carries the sampling error in the corpus alone: the two rates are themselves '
      + 'estimates from a finite calibration set, and the documents are cut eight to a '
      + 'source text, so they are not independent. Both limits are stated in the act and in '
      + 'the limitations list.',
  },
  {
    key: 'lcg-step',
    file: 'src/watermark/hash.ts',
    symbol: 'accumulateStep',
    type: 'arithmetic',
    statement:
      'One accumulation step should equal ((current + value) * 6364136223846793005 + 1) '
      + 'reduced to a signed 64-bit integer.',
    latex: 'h_{i+1} = \\left((h_i + d_i)\\cdot M + 1\\right) \\bmod 2^{64}',
    snippet: 'export function accumulateStep(currentHash: bigint, value: number | bigint): bigint {\n  return BigInt.asIntN(64, (currentHash + BigInt(value)) * MULTIPLIER + INCREMENT);',
    computable: {
      language: 'python',
      relation: 'equality',
      expression: '((((1 + 464) * 6364136223846793005 + 1) + 2**63) % 2**64) - 2**63',
      inputs: {},
      expected: 2951479051793528132,
      dependencies: [],
    },
    reference_anchor: anchor('REFIMPL', 'hashing_function.py accumulate_hash'),
    verification: {
      method: 'differential',
      implementation: 'google-deepmind/synthid-text @ addb4a1 hashing_function.accumulate_hash',
      vector_source: 'src/data/pinned/test-vectors.json lcg_vectors',
      procedure:
        'Recompute each committed chain in an implementation that does not share arithmetic '
        + 'with the browser one and compare the decimal strings.',
      expected_observation: 'every committed chain reproduces exactly',
    },
    implementation_provenance: {
      kind: 'adapted', component: 'accumulate_hash', package: 'synthid-text',
      version: 'addb4a1', boundary: 'arithmetic only; no torch tensors',
    },
    extractor_confidence: 'high',
    extraction_status: 'anchored',
    verification_status: 'independently_tested',
    conformance_status: 'matches_reference',
    notes: 'Wraparound is implicit in the reference because it runs on torch int64 tensors.',
  },
  {
    key: 'lcg-prefix',
    file: 'src/watermark/hash.ts',
    symbol: 'accumulateHash',
    type: 'invariant',
    statement:
      'Folding a sequence should equal folding its prefix and then folding the remainder, '
      + 'which is what allows the context and the candidate token to be hashed separately.',
    snippet: 'export function accumulateHash(currentHash: bigint, data: readonly number[]): bigint {',
    computable: {
      language: 'javascript',
      relation: 'equality',
      expression:
        'const M=6364136223846793005n,S=(h,v)=>BigInt.asIntN(64,(h+BigInt(v))*M+1n);'
        + 'const A=(h,d)=>d.reduce(S,h);'
        + 'String(A(1n,[7,8,9]))===String(S(A(1n,[7,8]),9))',
      inputs: {},
      expected: true,
      dependencies: [],
    },
    reference_anchor: anchor('REFIMPL', 'hashing_function.py accumulate_hash docstring'),
    verification: {
      method: 'algebraic',
      implementation: 'independent evaluation of both groupings',
      vector_source: 'none required',
      procedure: 'Fold a sequence in one pass and in two, and compare.',
      expected_observation: 'both groupings agree',
    },
    implementation_provenance: {
      kind: 'adapted', component: 'accumulate_hash', package: 'synthid-text',
      version: 'addb4a1', boundary: 'property of the construction',
    },
    extractor_confidence: 'high',
    extraction_status: 'anchored',
    verification_status: 'independently_tested',
    conformance_status: 'matches_reference',
    notes: 'The reference docstring states this property explicitly.',
  },
  {
    key: 'table-index-sign',
    file: 'src/watermark/hash.ts',
    symbol: 'tableIndex',
    type: 'arithmetic',
    statement:
      'The table index should equal a non-negative residue, because the reference reduces '
      + 'a signed 64-bit hash with Python modulo semantics while JavaScript keeps the sign '
      + 'of the dividend.',
    snippet: 'export function tableIndex(hash: bigint, tableSize: number): number {\n  const size = BigInt(tableSize);\n  return Number(((hash % size) + size) % size);',
    computable: {
      language: 'python',
      relation: 'equality',
      expression: '(-7) % 65536',
      inputs: {},
      expected: 65529,
      dependencies: [],
    },
    reference_anchor: anchor('HFIMPL', 'logits_process.py sample_g_values'),
    verification: {
      method: 'differential',
      implementation: 'torch tensor modulo on a negative int64',
      vector_source: 'src/data/pinned/test-vectors-transformers.json',
      procedure:
        'Reduce a negative hash by the table size in both languages and compare the index.',
      expected_observation: 'both yield the same non-negative index',
    },
    implementation_provenance: {
      kind: 'adapted', component: 'sample_g_values', package: 'transformers',
      version: '5.15.1', boundary: 'index arithmetic only',
    },
    extractor_confidence: 'high',
    extraction_status: 'anchored',
    verification_status: 'independently_tested',
    conformance_status: 'matches_reference',
    notes: 'Silent when wrong: it only shows on hashes that land negative, about half of them.',
  },
  {
    key: 'chain-seed',
    file: 'src/watermark/hash.ts',
    symbol: 'hashIvFromKeys',
    type: 'encoding',
    statement:
      'The chain seed should equal SHA-256 over the keys packed as little-endian signed '
      + '64-bit integers, read big-endian, reduced modulo 2^63 - 1.',
    snippet: 'export function hashIvFromKeys(keys: readonly number[], sha256: (data: Uint8Array) => Uint8Array): bigint {',
    computable: {
      language: 'python',
      relation: 'equality',
      expression: '2**63 - 1',
      inputs: {},
      expected: 9223372036854775807,
      dependencies: [],
    },
    reference_anchor: anchor('REFIMPL', 'logits_processing.py __init__ hash_iv'),
    verification: {
      method: 'differential',
      implementation: 'google-deepmind/synthid-text @ addb4a1 SynthIDLogitsProcessor.hash_iv',
      vector_source: 'src/data/pinned/test-vectors.json chain_seeds',
      procedure:
        'Derive the seed for three key sets in an independent implementation and compare '
        + 'against the committed decimal strings.',
      expected_observation: 'all three seeds reproduce exactly',
    },
    implementation_provenance: {
      kind: 'adapted', component: 'hash_iv', package: 'synthid-text',
      version: 'addb4a1', boundary: 'SHA-256 delegated to a library',
    },
    extractor_confidence: 'high',
    extraction_status: 'anchored',
    verification_status: 'independently_tested',
    conformance_status: 'matches_reference',
    notes:
      'Because every key enters the seed, changing one bit of one key changes every '
      + 'g-value at every layer. The transformers construction does not share this property.',
  },
  {
    key: 'deepmind-gvalue',
    file: 'src/watermark/constructions.ts',
    symbol: 'makeDeepMindConstruction',
    type: 'invariant',
    statement:
      'A g-value should equal bit 30 of the layer hash after twelve rounds of re-hashing '
      + 'and shifting right five bits.',
    snippet: '      let h = accumulateStep(candidateHash, key);\n      for (let i = 0; i < DEEPMIND_NUM_APPLY_HASH; i++) {\n        h = shiftRight(accumulateStep(h, 1), DEEPMIND_SHIFT);',
    computable: {
      language: 'python',
      relation: 'equality',
      expression: '64 // 12',
      inputs: {},
      expected: 5,
      dependencies: [],
    },
    reference_anchor: anchor('REFIMPL', 'logits_processing.py get_gvals'),
    verification: {
      method: 'differential',
      implementation: 'google-deepmind/synthid-text @ addb4a1 get_gvals',
      vector_source: 'src/data/pinned/test-vectors.json sequences',
      procedure:
        'Compute g-values for every committed sequence under three key sets and compare '
        + 'element by element.',
      expected_observation: 'every g-value matches',
    },
    implementation_provenance: {
      kind: 'adapted', component: 'get_gvals', package: 'synthid-text',
      version: 'addb4a1', boundary: 'exact port',
    },
    extractor_confidence: 'high',
    extraction_status: 'anchored',
    verification_status: 'independently_tested',
    conformance_status: 'matches_reference',
    notes:
      'The reference docstring describes a different procedure from the body it ships '
      + 'with; the port follows the body. See Q3.',
  },
  {
    key: 'transformers-gvalue',
    file: 'src/watermark/constructions.ts',
    symbol: 'makeTransformersConstruction',
    type: 'invariant',
    statement:
      'Under the transformers construction a g-value should equal the pinned sampling '
      + 'table entry at the layer hash reduced by the table size, with the chain seeded at 1.',
    snippet: '    gValue(candidateHash, key) {\n      return table.at(tableIndex(accumulateStep(candidateHash, key), table.size));',
    computable: {
      language: 'python',
      relation: 'equality',
      expression: '2**16',
      inputs: {},
      expected: 65536,
      dependencies: [],
    },
    reference_anchor: anchor('HFIMPL', 'logits_process.py sample_g_values'),
    verification: {
      method: 'differential',
      implementation: 'transformers 5.15.1 SynthIDTextWatermarkLogitsProcessor',
      vector_source: 'src/data/pinned/test-vectors-transformers.json',
      procedure:
        'Compute g-values for every committed sequence under three key sets against the '
        + 'transformers vectors.',
      expected_observation: 'every g-value matches the transformers capture',
    },
    implementation_provenance: {
      kind: 'adapted', component: 'sample_g_values', package: 'transformers',
      version: '5.15.1', boundary: 'table supplied as pinned data',
    },
    extractor_confidence: 'high',
    extraction_status: 'anchored',
    verification_status: 'independently_tested',
    conformance_status: 'matches_reference',
    notes: 'Implemented so the divergence from the official repository can be measured. See Q1.',
  },
  {
    key: 'construction-divergence',
    file: 'src/watermark/constructions.ts',
    symbol: 'ConstructionId',
    type: 'security_behavior',
    statement:
      'Text marked under one published construction scores at the no-mark expectation '
      + 'under the other, given the same keys.',
    snippet: "export type ConstructionId = 'deepmind-addb4a1' | 'transformers-5.15.1';",
    reference_anchor: anchor('GOOGLEDOC', 'Implementations'),
    verification: {
      method: 'differential',
      implementation: 'both constructions, over the committed watermarked sample',
      vector_source:
        'src/data/pinned/test-vectors.json and src/data/pinned/test-vectors-transformers.json',
      procedure:
        'Score the same committed token ids under both constructions with the configured '
        + 'keys and compare each against its own capture.',
      expected_observation:
        'the marking construction reproduces its captured score and the other reproduces a '
        + 'score near one half',
    },
    implementation_provenance: {
      kind: 'custom', component: 'cross-implementation comparison', package: '',
      version: '', boundary: 'an observation about two references, not a third construction',
    },
    extractor_confidence: 'medium',
    extraction_status: 'anchored',
    verification_status: 'independently_tested',
    conformance_status: 'unresolved',
    notes:
      'Whether the two are meant to interoperate is unresolved; see Q1. Google documentation '
      + 'names both, calling one production-grade and the other a reference.',
  },
  {
    key: 'window-start',
    file: 'src/watermark/gvalues.ts',
    symbol: 'positionHashes',
    type: 'invariant',
    statement:
      'The number of candidate positions should equal the token count minus ngram_len - 1, '
      + 'because the opening tokens have no full context window.',
    snippet: '  for (let t = n - 1; t < tokenIds.length; t++) {',
    computable: {
      language: 'python',
      relation: 'equality',
      expression: 'max(0, 320 - (5 - 1))',
      inputs: {},
      expected: 316,
      dependencies: [],
    },
    reference_anchor: anchor('REFIMPL', 'logits_processing.py compute_g_values unfold'),
    verification: {
      method: 'differential',
      implementation: 'torch unfold with size=ngram_len, step=1',
      vector_source: 'src/data/pinned/test-vectors.json pinned_sample_scores',
      procedure:
        'Compare the candidate-position count against the reference capture for every '
        + 'committed sequence and sample.',
      expected_observation: 'the counts agree everywhere',
    },
    implementation_provenance: {
      kind: 'adapted', component: 'compute_g_values', package: 'synthid-text',
      version: 'addb4a1', boundary: 'window walk only',
    },
    extractor_confidence: 'high',
    extraction_status: 'anchored',
    verification_status: 'independently_tested',
    conformance_status: 'matches_reference',
    notes: '',
  },
  {
    key: 'mask-repeat',
    file: 'src/watermark/mask.ts',
    symbol: 'computeContextRepetitionMask',
    type: 'invariant',
    statement:
      'A position whose context window has already appeared in the sequence is dropped, '
      + 'and the history is a rolling buffer of context_history_size entries.',
    snippet: '    notRepeated.push(!history.includes(contextHash));\n    history.unshift(contextHash);\n    history.pop();',
    computable: {
      language: 'javascript',
      relation: 'equality',
      expression:
        'const h=[];const seen=[];for(const c of [1,2,1,3,2]){seen.push(!h.includes(c));h.unshift(c);}'
        + 'JSON.stringify(seen)',
      inputs: {},
      expected: '[true,true,false,true,false]',
      dependencies: [],
    },
    reference_anchor: anchor('REFIMPL', 'logits_processing.py compute_context_repetition_mask'),
    verification: {
      method: 'differential',
      implementation: 'google-deepmind/synthid-text @ addb4a1 compute_context_repetition_mask',
      vector_source: 'src/data/pinned/test-vectors.json sequences.repeated_context',
      procedure:
        'Run the mask over a sequence built to repeat its context and compare position by '
        + 'position against the capture.',
      expected_observation: 'the dropped positions agree, and at least one is dropped',
    },
    implementation_provenance: {
      kind: 'adapted', component: 'compute_context_repetition_mask', package: 'synthid-text',
      version: 'addb4a1', boundary: 'detection side',
    },
    extractor_confidence: 'high',
    extraction_status: 'anchored',
    verification_status: 'independently_tested',
    conformance_status: 'matches_reference',
    notes: 'The zero-initialised history buffer is reproduced rather than repaired; see Q2.',
  },
  {
    key: 'mask-eos',
    file: 'src/watermark/mask.ts',
    symbol: 'computeEosTokenMask',
    type: 'invariant',
    statement:
      'Every token from the first end-of-text token onward is dropped, and the mask is '
      + 'sliced by ngram_len - 1 before it meets the candidate positions.',
    snippet: '  for (let i = first; i < mask.length; i++) mask[i] = false;',
    computable: {
      language: 'javascript',
      relation: 'equality',
      expression:
        'const ids=[1,2,50256,3];const m=ids.map(()=>true);const f=ids.indexOf(50256);'
        + 'for(let i=f;i<m.length;i++)m[i]=false;JSON.stringify(m)',
      inputs: {},
      expected: '[true,true,false,false]',
      dependencies: [],
    },
    reference_anchor: anchor('REFIMPL', 'logits_processing.py compute_eos_token_mask'),
    verification: {
      method: 'differential',
      implementation: 'google-deepmind/synthid-text @ addb4a1 compute_eos_token_mask',
      vector_source: 'src/data/pinned/test-vectors.json sequences.with_eos',
      procedure: 'Compare the per-token mask against the capture for a sequence containing the marker.',
      expected_observation: 'the masks agree',
    },
    implementation_provenance: {
      kind: 'adapted', component: 'compute_eos_token_mask', package: 'synthid-text',
      version: 'addb4a1', boundary: 'detection side',
    },
    extractor_confidence: 'high',
    extraction_status: 'anchored',
    verification_status: 'independently_tested',
    conformance_status: 'matches_reference',
    notes: '',
  },
  {
    key: 'mean-score',
    file: 'src/watermark/score.ts',
    symbol: 'scoreFromHashes',
    type: 'arithmetic',
    statement:
      'The score should equal the sum of the counted g-values divided by the counted '
      + 'positions times the number of layers.',
    latex: '\\mathrm{Score}(x)=\\frac{1}{m\\,|\\hat{T}|}\\sum_{t\\in\\hat{T}}\\sum_{\\ell=1}^{m} g_{\\ell}(x_t,r_t)',
    snippet: '    score: counted === 0 ? null : gSum / (counted * d),',
    computable: {
      language: 'python',
      relation: 'equality',
      expression: '5470 / (302 * 30)',
      inputs: {},
      expected: 0.6037528604118993,
      dependencies: [],
    },
    reference_anchor: anchor('PAPER', 'equation (1); Supplementary A.2'),
    verification: {
      method: 'differential',
      implementation: 'reference implementation scoring over the same token ids',
      vector_source: 'src/data/pinned/test-vectors.json pinned_sample_scores',
      procedure:
        'Recompute the score for three samples under three key sets and compare against '
        + 'the captured values and position counts.',
      expected_observation: 'all nine agree to double precision',
    },
    implementation_provenance: {
      kind: 'custom', component: 'MeanScore', package: '',
      version: '', boundary: 'the paper’s mean, not the learned detector',
    },
    extractor_confidence: 'high',
    extraction_status: 'anchored',
    verification_status: 'independently_tested',
    conformance_status: 'matches_reference',
    notes:
      'The paper’s headline results use a learned Bayesian scoring function instead; '
      + 'that is stated wherever this page prints a score.',
  },
  {
    key: 'null-mean',
    file: 'src/watermark/score.ts',
    symbol: 'NULL_EXPECTED_MEAN',
    type: 'constant',
    statement:
      'The expected mean g-value for text carrying no mark under this key is one half.',
    snippet: 'export const NULL_EXPECTED_MEAN = 0.5;',
    reference_anchor: anchor('PAPER', 'Supplementary A.2'),
    verification: {
      method: 'statistical',
      implementation: 'empirical null over 48 unwatermarked texts',
      vector_source: 'src/data/pinned/null-corpus.json',
      procedure:
        'Score a corpus of unwatermarked texts at each length and compare the mean against '
        + 'one half.',
      expected_observation: 'the measured mean sits within a few thousandths of one half',
    },
    implementation_provenance: {
      kind: 'custom', component: 'null expectation', package: '', version: '', boundary: '',
    },
    extractor_confidence: 'high',
    extraction_status: 'anchored',
    verification_status: 'independently_tested',
    conformance_status: 'matches_reference',
    notes: '',
  },
  {
    key: 'exact-null',
    file: 'src/watermark/frequentist.ts',
    symbol: 'binomialUpperTail',
    type: 'distribution',
    statement:
      'The p-value should equal the upper tail of a Binomial distribution over the counted '
      + 'g-values with success probability one half.',
    latex: 'p = 1 - F_{\\mathrm{Bin}(mT,1/2)}\\left(\\sum_t\\sum_\\ell g_{t,\\ell} - 1\\right)',
    snippet: 'export function binomialUpperTail(observedSum: number, trials: number): ExactTail {',
    computable: {
      language: 'python',
      relation: 'equality',
      expression:
        'sum(__import__("math").comb(10, k) for k in range(6, 11)) / 2**10',
      inputs: {},
      expected: 0.376953125,
      dependencies: [],
    },
    reference_anchor: anchor('PAPER', 'Supplementary A.3 equation (A3)'),
    verification: {
      method: 'algebraic',
      implementation: 'brute-force summation of the binomial probability mass function',
      vector_source: 'none required',
      procedure:
        'Compare the log-space tail against a direct sum for small trial counts, and check '
        + 'that a log10 value survives after the probability underflows.',
      expected_observation: 'the tails agree to double precision and the log10 value stays finite',
    },
    implementation_provenance: {
      kind: 'custom', component: 'exact tail', package: '', version: '',
      boundary: 'log-space summation with a Lanczos log-gamma',
    },
    extractor_confidence: 'medium',
    extraction_status: 'anchored',
    verification_status: 'independently_tested',
    conformance_status: 'matches_reference',
    notes:
      'Exactness rests on the independence the paper attributes to repeated-context '
      + 'masking, argued for an idealised pseudorandom function rather than the linear '
      + 'congruential generator both implementations ship. See Q4.',
  },
  {
    key: 'normal-approx',
    file: 'src/watermark/frequentist.ts',
    symbol: 'normalApproximation',
    type: 'arithmetic',
    statement:
      'The standard error under the independence assumption should equal the square root '
      + 'of one quarter divided by the number of counted g-values.',
    snippet: '  const standardError = Math.sqrt(0.25 / n);',
    computable: {
      language: 'python',
      relation: 'equality',
      expression: '(0.25 / (302 * 30)) ** 0.5',
      inputs: {},
      expected: 0.005253784205889284,
      dependencies: [],
    },
    reference_anchor: anchor('PAPER', 'Supplementary A.3.1'),
    verification: {
      method: 'statistical',
      implementation: 'empirical null over 48 unwatermarked texts at matched lengths',
      vector_source: 'src/data/pinned/null-corpus.json',
      procedure:
        'Compare the measured spread of the empirical null against this prediction at each '
        + 'committed length.',
      expected_observation:
        'the measured spread is of the same order; agreement is reported rather than asserted',
    },
    implementation_provenance: {
      kind: 'illustrative', component: 'normal approximation', package: '', version: '',
      boundary: 'shown for comparison; no decision depends on it',
    },
    extractor_confidence: 'medium',
    extraction_status: 'anchored',
    verification_status: 'independently_tested',
    conformance_status: 'not_applicable',
    notes: 'Labelled a demo simplification in the page itself. See Q4.',
  },
  {
    key: 'empirical-p',
    file: 'src/watermark/null-model.ts',
    symbol: 'empiricalTail',
    type: 'arithmetic',
    statement:
      'The empirical p-value should equal the number of null draws at or above the '
      + 'observation plus one, divided by the number of draws plus one.',
    snippet: '    pValue: (atOrAbove + 1) / (n + 1),',
    computable: {
      language: 'python',
      relation: 'equality',
      expression: '(0 + 1) / (40 + 1)',
      inputs: {},
      expected: 0.024390243902439025,
      dependencies: [],
    },
    reference_anchor: anchor('lab_specific', 'empirical tail convention'),
    verification: {
      method: 'statistical',
      implementation: 'wrong-key sweep over the committed watermarked sample',
      vector_source: 'src/data/pinned/texts.json',
      procedure:
        'Draw forty wrong key sets, score the same token ids under each, and count how many '
        + 'reach the configured key’s score.',
      expected_observation: 'no wrong key reaches it, so the tail reports one over forty-one',
    },
    implementation_provenance: {
      kind: 'custom', component: 'empirical tail', package: '', version: '',
      boundary: 'the plus-one convention is stated in the source',
    },
    extractor_confidence: 'high',
    extraction_status: 'anchored',
    verification_status: 'independently_tested',
    conformance_status: 'not_applicable',
    notes:
      'The plus one bounds the smallest reportable value at one over the number of draws '
      + 'plus one, rather than reporting zero.',
  },
  {
    key: 'reweighting',
    file: 'src/watermark/tournament.ts',
    symbol: 'applyTournamentReweighting',
    type: 'distribution',
    statement:
      'Each layer multiplies the distribution by one plus the layer g-value minus the '
      + 'g-mass under that distribution, which the paper gives as the vectorized form of a '
      + 'two-sample tournament layer.',
    latex: 'p_{\\mathrm{wm}}(x)=p(x)\\left[1+g_\\ell(x,r)-p(V_{g_\\ell=1})\\right]',
    snippet: '    const updated = probs.map((p, i) => p * (1 + gValues[i][d] - gMass));',
    computable: {
      language: 'javascript',
      relation: 'equality',
      expression:
        'const p=[0.5,0.5],g=[1,0];const q=g.reduce((a,v,i)=>a+v*p[i],0);'
        + 'const r=p.map((x,i)=>x*(1+g[i]-q));Math.abs(r[0]+r[1]-1)<1e-12',
      inputs: {},
      expected: true,
      dependencies: [],
    },
    reference_anchor: anchor('PAPER', 'Supplementary E.1.1 Corollary 14; E.2 Theorem 15'),
    verification: {
      method: 'metamorphic',
      implementation: 'a literal bracket sampled over the same pinned distribution',
      vector_source: 'src/data/pinned/distributions.json',
      procedure:
        'Enumerate the single-layer winner distribution over all ordered candidate pairs '
        + 'and compare against the closed form; separately sample the multi-layer bracket '
        + 'and compare the empirical distribution.',
      expected_observation:
        'the enumeration agrees to floating-point slack and the sampled bracket agrees '
        + 'within sampling error',
    },
    implementation_provenance: {
      kind: 'adapted', component: 'update_scores', package: 'synthid-text',
      version: 'addb4a1', boundary: 'operates on probabilities rather than log scores',
    },
    extractor_confidence: 'high',
    extraction_status: 'anchored',
    verification_status: 'independently_tested',
    conformance_status: 'matches_reference',
    notes: '',
  },
  {
    key: 'bracket-ties',
    file: 'src/watermark/tournament.ts',
    symbol: 'runBracket',
    type: 'distribution',
    statement:
      'Ties are resolved uniformly among the competitors holding the maximal g-value; a '
      + 'positional rule leaves the winner distribution unchanged and a token-identity rule '
      + 'does not.',
    snippet: "        if (tieBreak === 'left') winner = left;",
    computable: {
      language: 'javascript',
      relation: 'equality',
      expression:
        'const p=[0.5,0.5],g=[1,1];let m=[0,0];'
        + 'for(let i=0;i<2;i++)for(let j=0;j<2;j++){const w=p[i]*p[j];m[i]+=w/2;m[j]+=w/2;}'
        + 'Math.abs(m[0]-0.5)<1e-12&&Math.abs(m[1]-0.5)<1e-12',
      inputs: {},
      expected: true,
      dependencies: ['reweighting'],
    },
    reference_anchor: anchor('PAPER', 'Methods Algorithms 1 and 2; Fig. 2 caption'),
    verification: {
      method: 'metamorphic',
      implementation: 'full enumeration of ordered candidate pairs under three tie rules',
      vector_source: 'src/data/pinned/distributions.json high_entropy',
      procedure:
        'Enumerate the single-layer marginal under uniform, positional and token-identity '
        + 'tie rules and compare each against the closed form.',
      expected_observation:
        'uniform and positional agree with the closed form; token-identity departs from it',
    },
    implementation_provenance: {
      kind: 'custom', component: 'literal bracket', package: '', version: '',
      boundary: 'neither reference implementation materialises a bracket',
    },
    extractor_confidence: 'high',
    extraction_status: 'anchored',
    verification_status: 'independently_tested',
    conformance_status: 'matches_reference',
    notes:
      'The bracket exists only to show the conceptual tournament; both references compute '
      + 'the closed form instead.',
  },
  {
    key: 'expected-mean-g',
    file: 'src/watermark/tournament.ts',
    symbol: 'expectedMeanGValue',
    type: 'arithmetic',
    statement:
      'For a uniform distribution and a single layer, the expected mean g-value should '
      + 'equal one half plus one quarter times one minus the reciprocal of the vocabulary size.',
    snippet: 'export function expectedMeanGValue(vocabSize: number, coinflipProb = 0.5): number {',
    computable: {
      language: 'python',
      relation: 'equality',
      expression: '0.5 + 0.5 * (1 - 0.5) * (1 - 1/2)',
      inputs: {},
      expected: 0.625,
      dependencies: [],
    },
    reference_anchor: anchor('REFIMPL', 'g_value_expectations.py expected_mean_g_value'),
    verification: {
      method: 'algebraic',
      implementation: 'direct evaluation of the closed form',
      vector_source: 'none required',
      procedure: 'Evaluate at a two-token vocabulary and at the GPT-2 vocabulary size.',
      expected_observation: 'the closed form reproduces both',
    },
    implementation_provenance: {
      kind: 'adapted', component: 'expected_mean_g_value', package: 'synthid-text',
      version: 'addb4a1', boundary: 'single layer, uniform distribution',
    },
    extractor_confidence: 'high',
    extraction_status: 'anchored',
    verification_status: 'independently_tested',
    conformance_status: 'matches_reference',
    notes:
      'It assumes a uniform model distribution, which no real one is; the page shows it '
      + 'beside a measured value rather than in place of one.',
  },
  {
    key: 'entropy',
    file: 'src/watermark/entropy.ts',
    symbol: 'shannonEntropyBits',
    type: 'arithmetic',
    statement:
      'Entropy should equal the negative sum of each probability times its base-two '
      + 'logarithm, with zero-probability entries contributing nothing.',
    latex: 'H(p) = -\\sum_i p_i \\log_2 p_i',
    snippet: 'export function shannonEntropyBits(probabilities: readonly number[]): number {',
    computable: {
      language: 'python',
      relation: 'equality',
      expression: '-sum(p * __import__("math").log2(p) for p in [0.5, 0.25, 0.25])',
      inputs: {},
      expected: 1.5,
      dependencies: [],
    },
    reference_anchor: anchor('lab_specific', 'standard definition'),
    verification: {
      method: 'algebraic',
      implementation: 'direct evaluation on a hand-computed distribution',
      vector_source: 'none required',
      procedure: 'Evaluate on a distribution whose entropy is known by hand.',
      expected_observation: 'the value agrees',
    },
    implementation_provenance: {
      kind: 'custom', component: 'Shannon entropy', package: '', version: '', boundary: '',
    },
    extractor_confidence: 'high',
    extraction_status: 'anchored',
    verification_status: 'independently_tested',
    conformance_status: 'not_applicable',
    notes: '',
  },
  {
    key: 'sampling-table-decode',
    file: 'src/watermark/sampling-table.ts',
    symbol: 'samplingTableFromPackedBase64',
    type: 'encoding',
    statement:
      'The pinned table decodes from little-endian bit packing, and the count of ones '
      + 'should equal the value recorded at capture.',
    snippet: '      return (bytes[index >> 3] >> (index & 7)) & 1;',
    computable: {
      language: 'python',
      relation: 'equality',
      expression: '(0b10110101 >> 3) & 1',
      inputs: {},
      expected: 0,
      dependencies: [],
    },
    reference_anchor: anchor('HFIMPL', 'logits_process.py sampling_table'),
    verification: {
      method: 'differential',
      implementation: 'torch.randint over the same seed and size',
      vector_source: 'src/data/pinned/sampling-table.json',
      procedure:
        'Decode the packed table and compare its size and count of ones against the capture.',
      expected_observation: 'both match the recorded values',
    },
    implementation_provenance: {
      kind: 'delegated', component: 'sampling table', package: 'torch',
      version: '2.13.0', boundary: 'the table is captured, not re-derived in the browser',
    },
    extractor_confidence: 'high',
    extraction_status: 'anchored',
    verification_status: 'independently_tested',
    conformance_status: 'matches_reference',
    notes: 'The one value the browser cannot re-derive; it travels with its own hash.',
  },
  {
    key: 'depth-is-keys',
    file: 'src/watermark/params.ts',
    symbol: 'depth',
    type: 'invariant',
    statement:
      'Tournament depth should equal the number of keys, which is a property of the '
      + 'implementations rather than of the scheme.',
    snippet: 'export function depth(params: WatermarkParams): number {\n  return params.keys.length;',
    computable: {
      language: 'python',
      relation: 'equality',
      expression: 'len([654, 400, 836])',
      inputs: {},
      expected: 3,
      dependencies: [],
    },
    reference_anchor: anchor('REFIMPL', 'detector_bayesian.py watermarking_depth'),
    verification: {
      method: 'differential',
      implementation: 'reference detector reading depth from the key list',
      vector_source: 'src/data/pinned/test-vectors.json',
      procedure:
        'Compare the depth reported alongside every captured score against the length of '
        + 'the key list used.',
      expected_observation: 'they agree for every capture',
    },
    implementation_provenance: {
      kind: 'adapted', component: 'watermarking_depth', package: 'synthid-text',
      version: 'addb4a1', boundary: '',
    },
    extractor_confidence: 'high',
    extraction_status: 'anchored',
    verification_status: 'independently_tested',
    conformance_status: 'deviates',
    notes:
      'The paper parameterizes differently: one key, with the layer index passed to the '
      + 'hash. Recorded as deviation D1.',
  },
  {
    key: 'byte-alphabet',
    file: 'src/tokenizer/byte-level.ts',
    symbol: 'buildByteAlphabet',
    type: 'encoding',
    statement:
      'The byte alphabet covers all 256 byte values exactly once and round-trips, and the '
      + 'vocabulary order starts at the exclamation mark rather than at the null byte.',
    snippet: '  push(0x21, 0x7e); // \'!\' .. \'~\'',
    computable: {
      language: 'python',
      relation: 'equality',
      expression: 'ord("!")',
      inputs: {},
      expected: 33,
      dependencies: [],
    },
    reference_anchor: anchor('GPT2', 'bytes_to_unicode'),
    verification: {
      method: 'differential',
      implementation: 'the Hugging Face tokenizer’s own vocabulary',
      vector_source: 'src/data/pinned/tokenizer-meta.json vocab_sha256',
      procedure:
        'Derive the vocabulary from the merge list and compare its hash against the hash of '
        + 'the real vocabulary.',
      expected_observation: 'the hashes agree',
    },
    implementation_provenance: {
      kind: 'adapted', component: 'bytes_to_unicode', package: 'gpt-2',
      version: 'pinned revision', boundary: '',
    },
    extractor_confidence: 'high',
    extraction_status: 'anchored',
    verification_status: 'independently_tested',
    conformance_status: 'matches_reference',
    notes: 'Getting the order wrong shifts the whole vocabulary by 256 and every g-value with it.',
  },
  {
    key: 'vocab-derivation',
    file: 'src/tokenizer/gpt2.ts',
    symbol: 'createGpt2Tokenizer',
    type: 'encoding',
    statement:
      'The vocabulary should equal the 256 byte tokens, then the merge results in merge '
      + 'order, then the end-of-text marker, so only the merge list needs shipping.',
    snippet: '  const vocab: string[] = [\n    ...byteTokensInVocabOrder,\n    ...merges.map((line) => line.split(\' \').join(\'\')),',
    computable: {
      language: 'python',
      relation: 'equality',
      expression: '256 + 50000 + 1',
      inputs: {},
      expected: 50257,
      dependencies: [],
    },
    reference_anchor: anchor('GPT2', 'vocab.json and merges.txt'),
    verification: {
      method: 'differential',
      implementation: 'the Hugging Face tokenizer at the pinned revision',
      vector_source: 'src/data/pinned/tokenizer-vectors.json',
      procedure:
        'Encode every committed case and compare the token ids, then decode them and '
        + 'compare the text.',
      expected_observation: 'every case round-trips exactly',
    },
    implementation_provenance: {
      kind: 'adapted', component: 'GPT-2 BPE', package: 'gpt-2',
      version: 'pinned revision', boundary: 'encoding and decoding only',
    },
    extractor_confidence: 'high',
    extraction_status: 'anchored',
    verification_status: 'independently_tested',
    conformance_status: 'matches_reference',
    notes:
      'Only the version header is filtered from the merge list: GPT-2 has real merges whose '
      + 'left half is a hash character, and dropping them shifts every later id.',
  },
  {
    key: 'canonicalization',
    file: 'src/c2pa/manifest.ts',
    symbol: 'canonicalize',
    type: 'encoding',
    statement:
      'Canonical serialization sorts object keys, preserves array order, and emits no '
      + 'whitespace, so a signer and a checker cover the same bytes.',
    snippet: 'export function canonicalize(value: unknown): string {',
    computable: {
      language: 'javascript',
      relation: 'equality',
      expression: 'JSON.stringify(Object.keys({b:1,a:2}).sort())',
      inputs: {},
      expected: '["a","b"]',
      dependencies: [],
    },
    reference_anchor: anchor('lab_specific', 'canonicalization convention'),
    verification: {
      method: 'differential',
      implementation: 'an independent canonicalizer in the verifier',
      vector_source: 'verification/vectors/canonicalization.json',
      procedure:
        'Run both implementations over hand-authored cases and compare against expectations '
        + 'written by hand rather than captured from either.',
      expected_observation: 'both reproduce every hand-authored string',
    },
    implementation_provenance: {
      kind: 'custom', component: 'canonical JSON', package: '', version: '',
      boundary: 'not JCS; a minimal ordering convention stated in the source',
    },
    extractor_confidence: 'medium',
    extraction_status: 'anchored',
    verification_status: 'independently_tested',
    conformance_status: 'not_applicable',
    notes:
      'Deliberately not a standard canonicalization; the C2PA structure here is shaped, '
      + 'not conformant. See Q5.',
  },
  {
    key: 'hard-binding',
    file: 'src/c2pa/manifest.ts',
    symbol: 'buildManifest',
    type: 'protocol_step',
    statement:
      'The claim records a digest of the asset bytes and a digest of each assertion, so the '
      + 'signature covers the claim and the claim covers everything else.',
    snippet: "      hard_binding: {\n        label: 'c2pa.hash.data',",
    reference_anchor: anchor('C2PA', 'hard bindings; c2pa.hash.data'),
    verification: {
      method: 'metamorphic',
      implementation: 'an independent manifest builder in the verifier',
      vector_source: 'none required',
      procedure:
        'Build a manifest, then alter one asset byte and one assertion in turn, and observe '
        + 'which of the three checks changes.',
      expected_observation:
        'altering the asset breaks the binding alone; altering an assertion breaks its hash '
        + 'alone; the signature over the claim is unaffected by either',
    },
    implementation_provenance: {
      kind: 'illustrative', component: 'C2PA manifest', package: '', version: '',
      boundary: 'structure only: no JUMBF, no COSE, no certificate chain, no trust list',
    },
    extractor_confidence: 'high',
    extraction_status: 'anchored',
    verification_status: 'independently_tested',
    conformance_status: 'not_applicable',
    notes: '',
  },
  {
    key: 'signature',
    file: 'src/c2pa/sign.ts',
    symbol: 'signClaim',
    type: 'security_behavior',
    statement:
      'The signature is computed over the canonical claim bytes with ECDSA P-256 and '
      + 'SHA-256, and covers nothing outside them.',
    snippet: 'export async function signClaim(claim: Claim, privateKey: CryptoKey): Promise<string> {',
    reference_anchor: anchor('C2PA', 'claim signature'),
    verification: {
      method: 'differential',
      implementation: 'node:crypto WebCrypto in the independent verifier',
      vector_source: 'none required',
      procedure:
        'Sign a claim, then check the signature against the same public key, against a '
        + 'different one, and after editing the claim.',
      expected_observation:
        'the check passes only for the untouched claim under its own key',
    },
    implementation_provenance: {
      kind: 'delegated', component: 'ECDSA P-256', package: 'WebCrypto',
      version: 'platform', boundary: 'the curve is not reimplemented',
    },
    extractor_confidence: 'high',
    extraction_status: 'anchored',
    verification_status: 'independently_tested',
    conformance_status: 'not_applicable',
    notes: 'A passing check establishes integrity and authentication against a key, nothing more.',
  },
  {
    key: 'validation-separates',
    file: 'src/c2pa/validate.ts',
    symbol: 'validateManifest',
    type: 'security_behavior',
    statement:
      'Signature checking, the hard binding and the assertion hashes are reported '
      + 'separately, and an absent manifest is reported as absent rather than as a failure.',
    snippet: '      summary:\n        \'No manifest. There is nothing to verify, and nothing was broken to get here — \' +',
    reference_anchor: anchor('C2PA', 'validation'),
    verification: {
      method: 'metamorphic',
      implementation: 'an independent validator in the verifier',
      vector_source: 'none required',
      procedure:
        'Run the four states — untouched, one byte altered, manifest removed, and a false '
        + 'statement signed — and compare the three reported outcomes in each.',
      expected_observation:
        'removal reports nothing to check while the asset digest is unchanged, and the '
        + 'false statement passes every structural check',
    },
    implementation_provenance: {
      kind: 'illustrative', component: 'C2PA validation', package: '', version: '',
      boundary: 'no trust model: the public key travels inside the manifest',
    },
    extractor_confidence: 'high',
    extraction_status: 'anchored',
    verification_status: 'independently_tested',
    conformance_status: 'not_applicable',
    notes: '',
  },
];

export const DEVIATIONS = [
  {
    id: 'D1',
    description:
      'The paper carries one watermarking key and passes the layer index into the hash. '
      + 'Both implementations carry a list of keys, one per layer, and derive depth from its '
      + 'length. This build follows the implementations.',
    classification: 'intentional_disclosed',
    disclosed: 'docs/MATH.md section 1, and the implementation-provenance table on the page',
    reference_anchor: anchor('PAPER', 'Methods, Definition 4'),
    reference_quote: 'g_ℓ(x, r)',
    code_anchor: {
      file: 'src/watermark/params.ts',
      symbol: 'depth',
      lines: [1, 1],
      snippet: 'export function depth(params: WatermarkParams): number {',
    },
    severity_note:
      'The two parameterizations coincide in effect; the difference matters when reading '
      + 'the paper and the code side by side.',
  },
  {
    id: 'D2',
    description:
      'The two published implementations compute different g-values from the same keys and '
      + 'text. This build implements both rather than choosing one and calling it the scheme.',
    classification: 'reference_mismatch',
    disclosed: 'the Hero panel measures it; docs/MATH.md section 1 tabulates it',
    reference_anchor: anchor('REFIMPL', 'PR #32, merged 2025-06-13'),
    code_anchor: {
      file: 'src/watermark/constructions.ts',
      symbol: 'makeTransformersConstruction',
      lines: [1, 1],
      snippet: 'export function makeTransformersConstruction(table: SamplingTable): GValueConstruction {',
    },
    severity_note:
      'A detector built against one reads the other as unmarked. Whether this is intended '
      + 'is unresolved; see Q1.',
  },
  {
    id: 'D3',
    description:
      'The scoring statistic here is the mean g-score. Both implementations ship a learned '
      + 'Bayesian detector, and the paper uses one for its headline results.',
    classification: 'intentional_disclosed',
    disclosed: 'stated wherever the page prints a score, and in the limitations section',
    reference_anchor: anchor('PAPER', 'Supplementary A.4'),
    code_anchor: {
      file: 'src/watermark/score.ts',
      symbol: 'scoreFromHashes',
      lines: [1, 1],
      snippet: 'export function scoreFromHashes(',
    },
    severity_note:
      'Detection rates measured here are therefore not comparable with published numbers '
      + 'for the Bayesian detector.',
  },
];

export const OPEN_QUESTIONS = [
  {
    id: 'Q1',
    question:
      'Are the two published SynthID-Text implementations intended to interoperate, given '
      + 'that at the pinned versions they compute different g-values from the same keys?',
    why_it_matters:
      'It decides whether "the watermark configuration" means the key list or the key list '
      + 'plus a choice of construction, which is the difference between a detector that '
      + 'reads a mark and one that reads noise.',
    what_would_resolve_it:
      'A first-party statement about compatibility across the change that removed the '
      + 'sampling table, or a released version of either implementation that matches the other.',
  },
  {
    id: 'Q2',
    question:
      'Is the zero-initialised repeated-context history buffer intentional, given that a '
      + 'context hashing to exactly zero would be treated as already seen?',
    why_it_matters:
      'It is a one-in-2^64 event per position, so it cannot be observed empirically; but a '
      + 'reimplementation has to choose whether to copy it, and copying it silently is how '
      + 'an accidental behaviour becomes a specification.',
    what_would_resolve_it: 'A comment, test or issue in either implementation addressing the case.',
  },
  {
    id: 'Q3',
    question:
      'Which is authoritative for the g-value derivation: the reference docstring, which '
      + 'describes taking the lowest three bits and adding them to the previous value, or '
      + 'the body it ships with, which shifts twelve times and reads bit 30?',
    why_it_matters:
      'They describe different functions. This build follows the body, which is what runs, '
      + 'but a reader comparing against the docstring will find a mismatch.',
    what_would_resolve_it:
      'A corrected docstring, or a statement that the docstring describes an earlier version.',
  },
  {
    id: 'Q4',
    question:
      'Does the exact null hold when the hash is a linear congruential generator rather '
      + 'than the pseudorandom function the paper assumes?',
    why_it_matters:
      'The exact p-value depends on the counted g-values being independent fair coins. If '
      + 'the generator biases them, published p-values are optimistic in a way no reader '
      + 'could detect from the number alone.',
    what_would_resolve_it:
      'A null study at a scale that separates the two hypotheses — thousands of texts '
      + 'rather than the 48 measured here — or an analysis of the generator’s output '
      + 'under the specific key-mixing this construction uses.',
  },
  {
    id: 'Q5',
    question:
      'What canonicalization does a conformant C2PA claim signature actually cover, and how '
      + 'far does the minimal ordering convention used here depart from it?',
    why_it_matters:
      'The page teaches that a signature covers exact bytes. If the byte-determining rule '
      + 'differs from the specification’s, the lesson is right and the artefact is not '
      + 'the thing it resembles.',
    what_would_resolve_it:
      'Reading the specification’s COSE and JUMBF sections in full and either '
      + 'implementing them or documenting each departure.',
  },
  {
    id: 'Q6',
    question:
      'What is the secret for SynthID image, audio and video, and does any published route '
      + 'let a third party check text they did not issue?',
    why_it_matters:
      'The page states issuer-only verification as a property of the construction. A '
      + 'publicly-checkable variant would change that from a consequence into a choice.',
    what_would_resolve_it:
      'A first-party description of the media watermark’s detection requirements, or a '
      + 'published route that checks text without the configuration.',
  },
  {
    id: 'Q7',
    question:
      'Should a published detection threshold be indexed by token count or by scored '
      + 'positions, given that a degenerate text can offer 320 tokens and a single scored '
      + 'position?',
    why_it_matters:
      'A threshold chosen by length is applied to evidence measured by position, and the '
      + 'two diverge exactly where a text is most unusual.',
    what_would_resolve_it:
      'A threshold family indexed by scored positions, measured against a corpus large '
      + 'enough to populate the sparse end.',
  },
];

export const CRYPTOGRAPHER_CHECKLIST = [
  'Confirm the mean g-score is the statistic intended, and that describing the Bayesian detector as out of scope is acceptable for a teaching build.',
  'Confirm the exact Binomial null is applied only where its independence premise is stated, and that the empirical comparison beside it is presented as a check rather than a confirmation.',
  'Confirm the wrong-key null and the corpus null are described as answering different questions, and that neither is presented as the other.',
  'Confirm the cross-implementation result is scoped to the pinned versions and is not stated as a defect in either implementation.',
  'Confirm the non-distortionary property is stated no more broadly than Theorem 18 supports: two competitors per match, in expectation over the seed, at a single decoding step.',
  'Confirm the C2PA panel is described as shaped rather than conformant everywhere it appears, including the manifest disclosure.',
  'Confirm no threshold on the page is presented as general, and that each carries the corpus it came from.',
  'Confirm the published demo keys are described as published, and that the page never implies the mark they produce is unforgeable.',
];
