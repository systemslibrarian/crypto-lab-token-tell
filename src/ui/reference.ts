/**
 * Limitations, maths, implementation provenance, sources and test vectors.
 *
 * This section exists because everything above it is a claim. A reader who wants to
 * disbelieve the page should be able to find, here, exactly which component is faithful
 * to what, which numbers were measured rather than derived, and which questions this lab
 * could not answer.
 *
 * The limitations are the load-bearing part and none of them may be dropped, so they are
 * held in a list the section counts rather than in markup where a deletion would go
 * unnoticed. The provenance table is given a floor width for the same reason a table is
 * used at all: four columns squeezed to a character per line at a phone width are not a
 * disclosure, they are a formality, and this is the one table on the page a sceptical
 * reader is most likely to actually read.
 */

import attacks from '../data/pinned/attacks.json';
import distributions from '../data/pinned/distributions.json';
import nullCorpus from '../data/pinned/null-corpus.json';
import samplingTable from '../data/pinned/sampling-table.json';
import testVectors from '../data/pinned/test-vectors.json';
import texts from '../data/pinned/texts.json';
import tokenizerMeta from '../data/pinned/tokenizer-meta.json';
import { watermarkParams } from '../lab-config.ts';
import {
  actHeader, clear, consequence, el, integer, panel, provenanceTag, scroller,
} from './dom.ts';

const REPO = 'https://github.com/systemslibrarian/crypto-lab-token-tell';

interface ProvenanceEntry {
  readonly component: string;
  readonly kind: 'paper' | 'reference' | 'demo' | 'pinned';
  readonly source: string;
  readonly note: string;
}

const PROVENANCE: ProvenanceEntry[] = [
  {
    component: 'g-function construction',
    kind: 'reference',
    source: 'google-deepmind/synthid-text @ addb4a1, logits_processing.py get_gvals',
    note: 'Twelve re-hash rounds shifting five bits each, then bit 30. The transformers ' +
      'variant, which reads a pinned table of random bits instead, is also implemented and ' +
      'the two are shown disagreeing.',
  },
  {
    component: 'keyed hash',
    kind: 'reference',
    source: 'hashing_function.py accumulate_hash',
    note: 'A 64-bit linear congruential generator, multiplier 6364136223846793005, ' +
      'increment 1, wrapping with a sign. The reference repository states it "does not ' +
      'provide any guarantees of cryptographic security".',
  },
  {
    component: 'chain seed / initialization vector',
    kind: 'reference',
    source: 'logits_processing.py, SHA-256 over the packed key array mod 2^63 - 1',
    note: 'The only cryptographic primitive in the construction. transformers seeds with ' +
      'the literal 1 instead, which is why a single flipped key bit costs everything here ' +
      'and one layer there.',
  },
  {
    component: 'context-history handling',
    kind: 'reference',
    source: 'ngram_len = 5, context_history_size = 1024',
    note: 'ngram_len is the paper’s context window H plus one; the reference repository’s ' +
      'own comment says so.',
  },
  {
    component: 'repeated-context masking',
    kind: 'reference',
    source: 'compute_context_repetition_mask',
    note: 'Reproduced including its zero-initialised history buffer, which would mask a ' +
      'context hashing to exactly zero. Carried as an open question rather than tidied.',
  },
  {
    component: 'tournament sampling',
    kind: 'paper',
    source: 'Nature paper, Algorithm 2 with N = 2; Corollary 14 and Theorem 15',
    note: 'Both views are implemented: the literal bracket over 2^m drawn candidates, and ' +
      'the closed-form reweighting the implementations actually use. The unit suite ' +
      'measures their agreement.',
  },
  {
    component: 'tie-breaking rule',
    kind: 'paper',
    source: 'Nature paper, Algorithms 1 and 2: uniform among the maximal competitors',
    note: 'Specified by the paper in three places. A positional tie-break is shown to be ' +
      'equivalent and a token-identity one is shown to distort.',
  },
  {
    component: 'scoring statistic',
    kind: 'paper',
    source: 'Nature paper equation (1) / Supplementary A.2, MeanScore',
    note: 'This is NOT the production detector. The paper’s headline results use a learned ' +
      'Bayesian scoring function, and both reference implementations ship one.',
  },
  {
    component: 'null model and p-value',
    kind: 'paper',
    source: 'Supplementary A.3: p = 1 − CDF of Binomial(mT, 1/2) at the observed sum − 1',
    note: 'Exact, given the paper’s statement that repeated-context masking leaves the ' +
      'g-values independent. Measured against the empirical null on this page rather than ' +
      'assumed.',
  },
  {
    component: 'normal approximation and z',
    kind: 'demo',
    source: 'Supplementary A.3.1 with unit weights',
    note: 'Shown for comparison only. Nothing on this page decides on it.',
  },
  {
    component: 'decision threshold',
    kind: 'pinned',
    source: 'this lab’s own empirical construction from 48 unwatermarked texts',
    note: 'No primary source supplies a numeric threshold. Every threshold here is ' +
      'specific to this configuration, model and corpus.',
  },
  {
    component: 'tokenizer',
    kind: 'reference',
    source: 'GPT-2 byte-level BPE, reimplemented in TypeScript',
    note: 'Vocabulary derived from the merge list and checked against the real ' +
      'vocabulary’s SHA-256; encoding held to differential vectors from the Hugging Face ' +
      'tokenizer.',
  },
  {
    component: 'candidate distribution preprocessing',
    kind: 'pinned',
    source: 'GPT-2 logits after temperature 1.0 and top-k 40',
    note: 'Never described on this page as the model’s unmodified distribution, because it ' +
      'is not one.',
  },
  {
    component: 'sampling table (transformers variant)',
    kind: 'pinned',
    // The command comes out of the pinned file rather than being paraphrased here: a
    // paraphrase dropped the seeding step, and `integer()` rendered the size with a
    // thousands separator, which in Python is a two-tuple and builds a 65×536 tensor.
    source: `${samplingTable.generator} with size=${String(samplingTable.size)}, ` +
      `seed=${String(samplingTable.seed)}`,
    note: 'The one value the browser cannot re-derive, so it is committed with its ' +
      'SHA-256 and checked at load: lab-config.ts re-hashes the packed table and the ' +
      'bytes it decodes to, and refuses to run the page rather than score against a ' +
      'table it cannot vouch for.',
  },
  {
    component: 'C2PA manifest',
    kind: 'demo',
    source: 'C2PA-shaped: assertions, a claim binding them by hash, a hard binding',
    note: 'No JUMBF, no COSE, no certificate chain, no trust list, no Conformance Program ' +
      'status.',
  },
  {
    component: 'population estimate',
    kind: 'demo',
    source: 'Rogan–Gladen prevalence correction with a Wilson score interval',
    note: 'Screening-test arithmetic from epidemiology, applied to a watermark detector in ' +
      'Act VIII. Neither piece comes from the watermarking literature, and neither says ' +
      'anything about an individual document: the correction works precisely because it ' +
      'never decides which documents are marked.',
  },
  {
    component: 'signature',
    kind: 'reference',
    source: 'ECDSA P-256 with SHA-256 via WebCrypto',
    note: 'Real, and the only part of this page that is a standard cryptographic primitive ' +
      'used as intended.',
  },
];

/**
 * What this lab could not do, in full.
 *
 * A list rather than nine hand-written list items, so the section can state how many there
 * are and a deletion cannot pass as a re-layout. Every entry here is load-bearing: the
 * C2PA-shaped qualification and the non-distortionary scope in particular are the two
 * sentences that stop the rest of the page overclaiming.
 */
const LIMITATIONS: string[] = [
  'The scoring statistic implemented here is the mean g-score. It is not the production ' +
  'learned or Bayesian detector, which is what the paper’s headline results use and what ' +
  'both reference implementations ship.',
  'The pinned distributions and texts come from GPT-2 with temperature 1.0 and top-k 40 ' +
  'applied, not from a production-scale model. Behaviour at scale differs; in particular ' +
  'larger models tend to be lower entropy, which the paper notes reduces watermarking ' +
  'strength.',
  'The demo keys are published in this repository — they are the reference ' +
  'implementation’s own default configuration. Real deployment requires the watermark ' +
  'configuration be held secret; a published key means the mark can be replicated or ' +
  'removed by anyone.',
  'This lab implements the NON-DISTORTIONARY configuration: two competitors per match. ' +
  'The paper proves the distortionary case is a different animal (its Theorem 19 shows ' +
  'N > 2 is distortionary) and this lab makes no claims about it.',
  'The C2PA panel is C2PA-SHAPED, not conformant: no JUMBF structures, no COSE claim ' +
  'signatures, no certificate chains, no trust-list validation and no Conformance ' +
  'Program status.',
  'No claim is made about detecting any vendor’s output. This detector reads the ' +
  'configuration published here and nothing else.',
  'Every threshold on this page is specific to this configuration, this model and this ' +
  'corpus of 48 texts per class. A 1% threshold estimated from 48 samples rests on the ' +
  'single highest of them.',
  'The thresholds are indexed by token count, while the evidence is indexed by scored ' +
  'positions. For a degenerate text these diverge sharply, which Act III measures rather ' +
  'than hides.',
  'The empirical null measured here is over a single model and prompt style. It is not a ' +
  'general statement about how the mean g-score behaves.',
  'Act VIII’s population estimate assumes the two error rates measured on its calibration ' +
  'half hold on the half it measures, and its interval covers sampling error in the corpus ' +
  'alone — not the error in those rates, not the correlation between eight documents cut ' +
  'from one generation, and nothing at all about a population unlike this one.',
];

interface Source {
  readonly title: string;
  readonly detail: string;
  readonly url: string;
  readonly accessed: string;
}

const SOURCES: Source[] = [
  {
    title: 'Dathathri, S., See, A., Ghaisas, S., et al. "Scalable watermarking for identifying large language model outputs"',
    detail: 'Nature 634(8035): 818–823 (2024), doi:10.1038/s41586-024-08025-4, with its Supplementary Information. Open access.',
    url: 'https://www.nature.com/articles/s41586-024-08025-4',
    accessed: '2026-08-19',
  },
  {
    title: 'google-deepmind/synthid-text',
    detail: 'The official reference implementation. Read at commit addb4a158143c7c6851a1308f78b89fceed59683 (default branch main, commit dated 2025-06-13). Apache-2.0, read from the LICENSE file.',
    url: 'https://github.com/google-deepmind/synthid-text',
    accessed: '2026-08-19',
  },
  {
    title: 'Google, "SynthID: Tools for watermarking and detecting LLM-generated Text"',
    detail: 'Responsible-GenAI documentation, last updated 2025-04-09. Source of the instruction that each watermarking configuration "should be stored securely and privately, otherwise your watermark may be trivially replicable by others", and of the three detector-exposure options.',
    url: 'https://ai.google.dev/responsible/docs/safeguards/synthid',
    accessed: '2026-08-19',
  },
  {
    title: 'Hugging Face transformers, SynthID text watermarking',
    detail: 'SynthIDTextWatermarkLogitsProcessor and SynthIDTextWatermarkDetector, read from source at version 5.15.1. Google’s own documentation calls this the "production-grade implementation" and the GitHub repository the "reference implementation".',
    url: 'https://github.com/huggingface/transformers',
    accessed: '2026-08-19',
  },
  {
    title: 'C2PA Technical Specification 2.4',
    detail: 'Published April 2026, from the specification’s own Version History (§5.3.1); the version and URL were read from spec.c2pa.org itself on the access date below rather than from a secondary source, since secondary sources disagree (2.1 / 2.2 / 2.3 / 2.4). The build resolves nothing: what is quoted here is what was read then.',
    url: 'https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html',
    accessed: '2026-08-19',
  },
  {
    title: 'C2PA Security Considerations 2.4',
    detail: 'The source of the statement that C2PA "does not offer any protection against the complete removal of C2PA manifests from assets", and of the threat entry for manifest stripping — which is the failure the watermark half of this page survives and the signature half does not.',
    url: 'https://spec.c2pa.org/specifications/specifications/2.4/security/Security_Considerations.html',
    accessed: '2026-08-19',
  },
  {
    title: 'Christ, M., Gunn, S., Zamir, O. "Undetectable Watermarks for Language Models"',
    detail: 'Proceedings of the 37th Conference on Learning Theory (COLT 2024), PMLR 247. Watermarks that are computationally undetectable without the secret key.',
    url: 'https://arxiv.org/abs/2306.09194',
    accessed: '2026-08-19',
  },
  {
    title: 'Fairoze, J., Garg, S., Jha, S., Mahloujifar, S., Mahmoody, M., Wang, M. "Publicly-Detectable Watermarking for Language Models"',
    detail: 'IACR Communications in Cryptology, vol. 1, no. 4 (13 January 2025), doi:10.62056/ahmpdkp10. The direct research response to the row this lab calls load-bearing: schemes where verification is public.',
    url: 'https://cic.iacr.org/p/1/4/31',
    accessed: '2026-08-19',
  },
  {
    title: 'Dabiriaghdam, A., Wang, L. "SimMark: A Robust Sentence-Level Similarity-Based Watermarking Algorithm for Large Language Models"',
    detail: 'EMNLP 2025 (Main), pages 30785–30806, doi:10.18653/v1/2025.emnlp-main.1567. Semantic-embedding watermarking, offered as robustness against paraphrasing. Not implemented here.',
    url: 'https://aclanthology.org/2025.emnlp-main.1567/',
    accessed: '2026-08-19',
  },
  {
    title: 'Huo, J., Liu, S., Wang, B., et al. "PMark: Towards Robust and Distortion-free Semantic-level Watermarking with Channel Constraints"',
    detail: 'arXiv:2509.21057 v2 (2 March 2026); the arXiv record states "ICLR 2026 Poster". Semantic-level watermarking with distortion-free guarantees. Not implemented here.',
    url: 'https://arxiv.org/abs/2509.21057',
    accessed: '2026-08-19',
  },
  {
    title: 'Li, Y., Qu, W., Wu, L., et al. "AliMark: Enhancing Robustness of Sentence-Level Watermarking Against Text Paraphrasing"',
    detail: 'arXiv:2605.29434 v1 (28 May 2026); the arXiv record states "Accepted by ICML 2026". Not implemented here.',
    url: 'https://arxiv.org/abs/2605.29434',
    accessed: '2026-08-19',
  },
  {
    title: 'Krishna, K., Song, Y., Karpinska, M., Wieting, J., Iyyer, M. "Paraphrasing evades detectors of AI-generated text, but retrieval is an effective defense"',
    detail: 'NeurIPS 2023. The paraphrase-attack result the regeneration measurement here sits alongside.',
    url: 'https://arxiv.org/abs/2303.13408',
    accessed: '2026-08-19',
  },
  {
    title: 'Kirchenbauer, J., Geiping, J., Wen, Y., et al. "A Watermark for Large Language Models"',
    detail: 'ICML 2023. The green-list watermark whose z-statistic is a different statistic from the mean g-score used here, and must not be borrowed for it.',
    url: 'https://arxiv.org/abs/2301.10226',
    accessed: '2026-08-19',
  },
  {
    title: 'Hembrooke, E. F. "Identification of sound and like signals"',
    detail: 'United States Patent 3,004,104, filed 29 April 1954 (Serial No. 426,465), granted 10 October 1961; Emil Frank Hembrooke of Brooklyn, N.Y., assignor to Muzak Corporation. The audio beat of the Hero’s opening panel, read from the patent itself rather than from any account of it: identification by suppressing "a selected frequency, or narrow band of frequencies … at timed intervals according to a predetermined code", imperceptible "[b]ecause of the insensitivity of the ear in detecting the absence of a particular frequency". Its analogy is quoted on this page in the patent’s own words — "i.e. it may be likened to a watermark in paper" — which the survey below, and most sources after it, reproduce as "can be likened". The number was resolved in the USPTO’s Patent Public Search (ppubs.uspto.gov, which serves pre-1976 grants as page images); the URL here is the full-text facsimile that was actually read.',
    url: 'https://patents.google.com/patent/US3004104A/en',
    accessed: '2026-08-20',
  },
  {
    title: 'Harris, N. "Paper and Watermarks as Bibliographical Evidence"',
    detail: 'Second edition, Lyon: Institut d’histoire du livre, 2017, ISBN 9782956042716. The paper beat, and the reason this page does not print the usual date: the mark is made "by stitching a piece of wire bent into a distinctive shape to the surface of the mould", and "[w]here the paper is thinner, in correspondence with the watermark and chain-lines, more light passes through". On the date, Harris puts the first watermarks "in the mid to late 1280s (not quite as early as the ‘1282’ claimed by Briquet)" — Briquet’s Bologna entry n. 5410 carries his own question mark, and a systematic search of that archive published in 2009 could not relocate it. The link is the author’s own institutional copy at the University of Udine, which is the text that was read.',
    url: 'https://air.uniud.it/retrieve/e27ce0c5-079a-055e-e053-6605fe0a7873/Harris_Paper_%20and_Watermarks_2017.pdf',
    accessed: '2026-08-20',
  },
  {
    title: 'Cox, I. J., Miller, M. L. "The First 50 Years of Electronic Watermarking"',
    detail: 'EURASIP Journal on Applied Signal Processing 2002(2):126–132, doi:10.1155/S1110865702000525; first given at the IEEE 2001 International Workshop on Multimedia Signal Processing, 225–230. Cites the Hembrooke patent as, "[t]o the best of our knowledge … the earliest reference to electronic watermarking". Carried here for the lineage only: it makes no claim about this construction.',
    url: 'https://doi.org/10.1155/S1110865702000525',
    accessed: '2026-08-20',
  },
  {
    title: 'Rogan, W. J., Gladen, B. "Estimating prevalence from the results of a screening test"',
    detail: 'American Journal of Epidemiology 107(1):71–76 (1978), doi:10.1093/oxfordjournals.aje.a112510. The correction Act VIII inverts an observed positive rate with, published for the same problem in a different field: measuring how common something is in a population with a test that is wrong about individuals.',
    url: 'https://doi.org/10.1093/oxfordjournals.aje.a112510',
    accessed: '2026-08-20',
  },
  {
    title: 'Wilson, E. B. "Probable Inference, the Law of Succession, and Statistical Inference"',
    detail: 'Journal of the American Statistical Association 22(158):209–212 (1927), doi:10.1080/01621459.1927.10502953. The score interval Act VIII puts on its counts before correcting them, rather than the normal interval, which at these counts runs outside the range a fraction can occupy.',
    url: 'https://doi.org/10.1080/01621459.1927.10502953',
    accessed: '2026-08-20',
  },
  {
    title: 'Chesney, R., Citron, D. K. "Deep Fakes: A Looming Challenge for Privacy, Democracy, and National Security"',
    detail: 'California Law Review 107:1753–1820 (2019); the liar’s dividend is §II.i, at 1785. Named in Act VII’s polarity row for the second-order effect of evidence that runs against the person holding the content: as an audience learns that a test exists, denial gets cheaper. Their subject is deep fakes rather than text watermarks, and the transfer is this page’s, not theirs.',
    url: 'https://www.californialawreview.org/print/deep-fakes-a-looming-challenge-for-privacy-democracy-and-national-security',
    accessed: '2026-08-20',
  },
];

export function renderReference(root: HTMLElement): void {
  clear(root);
  root.append(...actHeader(
    'reference',
    'Reference',
    'Limitations, maths, provenance and sources',
    'Everything above this section is a claim. What follows is the material to check it ' +
    'against: what this lab could not do, the statistic in full, which component is ' +
    'faithful to what, the committed inputs, and the primary sources.',
  ));

  root.append(renderHeadline());

  root.append(panel('Limitations', [
    el('ul', { role: 'list' }, LIMITATIONS.map(li)),
  ], provenanceTag('demo', 'honest scoping')));

  root.append(panel('The statistic, in full', [
    el('p', {}, [
      'For text x₁…x_T and m layers, the score is the mean of the g-values over the ' +
      'positions that count: ',
      el('code', { text: 'Score(x) = (1/(m·|T̂|)) Σ_{t ∈ T̂} Σ_{ℓ=1..m} g_ℓ(x_t, r_t)' }),
      '. T̂ excludes the first ngram_len − 1 positions, which have no full context window, ' +
      'and any position whose context has already been seen.',
    ]),
    el('p', {}, [
      'Under the hypothesis that the text carries no mark for this key, each g-value is a ' +
      'fair coin, so the sum of the counted g-values is Binomial(m·|T̂|, ½) and the ' +
      'p-value is its exact upper tail. That independence is not this lab’s assumption to ' +
      'make casually: the paper states it, and states that repeated-context masking is ' +
      'what secures it. The wrong-key sweep in the Hero measures the same spread ' +
      'empirically so the two can be compared instead of one being taken on faith.',
    ]),
    el('p', { class: 'note' }, [
      'The full derivation, the divergences between the paper and the two implementations, ' +
      'and the open questions this lab could not close are in ',
      el('a', { href: `${REPO}/blob/main/docs/MATH.md`, text: 'docs/MATH.md' }),
      '.',
    ]),
  ], provenanceTag('paper', 'equation (1), Supplementary A.2–A.3')));

  root.append(panel('Implementation provenance', [
    el('p', { class: 'note' }, [
      'Every algorithmic component, and what it is faithful to. A component labelled ' +
      'DEMO-SIMPLIFICATION says what was simplified and what the simplification costs.',
    ]),
    // The prose columns carry `provenance-note` rather than `note`. `.note` sets
    // `overflow-wrap: anywhere`, which is right for a paragraph that may contain a
    // 64-character digest and catastrophic inside a table cell: it drops the cell's
    // min-content width to one character, so the table never exceeds its scroller, the
    // scroller never scrolls, and sixteen rows render a character per line down the phone.
    scroller('Implementation provenance table', [
      el('table', { class: 'provenance-table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'Component' }),
          el('th', { text: 'Label' }),
          el('th', { text: 'Source' }),
          el('th', { text: 'Note' }),
        ])]),
        el('tbody', {}, PROVENANCE.map((entry) => el('tr', {}, [
          el('td', { text: entry.component }),
          el('td', {}, [provenanceTag(entry.kind)]),
          el('td', { class: 'mono', text: entry.source }),
          el('td', { class: 'provenance-note', text: entry.note }),
        ]))),
      ]),
    ]),
  ], provenanceTag('demo', 'the labels themselves')));

  root.append(panel('Pinned data and test vectors', [
    el('p', { class: 'note' }, [
      'Every number on this page is reproducible from committed inputs. The capture ' +
      'scripts are in ',
      el('a', { href: `${REPO}/tree/main/tools`, text: 'tools/' }),
      ', the data they produced is in ',
      el('a', { href: `${REPO}/tree/main/src/data/pinned`, text: 'src/data/pinned/' }),
      ', and the independent verifier that re-derives it without importing this lab’s code ' +
      'is in ',
      el('a', { href: `${REPO}/tree/main/verification`, text: 'verification/' }),
      '.',
    ]),
    scroller('Pinned datasets', [
      el('table', { class: 'datasets-table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: 'Dataset' }),
          el('th', { text: 'Contents' }),
          el('th', { text: 'Produced by' }),
        ])]),
        el('tbody', {}, [
          dataRow('texts.json',
            `${integer(Object.keys(texts.samples).length)} GPT-2 continuations of ` +
            `${integer(texts.decoding.max_new_tokens)} tokens, with reference scores`,
            texts.provenance.capture_script),
          dataRow('distributions.json',
            `${integer(Object.keys(distributions.distributions).length)} next-token ` +
            'distributions after temperature and top-k',
            distributions.provenance.capture_script),
          dataRow('null-corpus.json',
            `${integer(nullCorpus.corpus_size)} unwatermarked and ` +
            `${integer((nullCorpus as { watermarked_corpus_size?: number }).watermarked_corpus_size ?? 0)} ` +
            'watermarked texts, with their token ids so every threshold can be recomputed',
            nullCorpus.provenance.capture_script),
          dataRow('attacks.json',
            `${integer(attacks.transformations.length)} transformations with the models, ` +
            'revisions and parameters that produced them',
            attacks.provenance.capture_script),
          dataRow('test-vectors.json',
            `${integer(testVectors.lcg_vectors.length)} hash vectors and ` +
            `${integer(Object.keys(testVectors.sequences).length)} scored sequences from ` +
            'the reference implementation',
            testVectors.provenance.capture_script),
          dataRow('tokenizer-meta.json',
            `GPT-2 vocabulary of ${integer(tokenizerMeta.vocab_size)} entries and ` +
            `${integer(tokenizerMeta.merge_count)} merges, with hashes`,
            tokenizerMeta.provenance.capture_script),
        ]),
      ]),
    ]),
    el('p', { class: 'note' }, [
      `Watermark configuration in use: ngram_len ${integer(watermarkParams.ngramLen)}, ` +
      `${integer(watermarkParams.keys.length)} keys (one per tournament layer), ` +
      `context_history_size ${integer(watermarkParams.contextHistorySize)}, ` +
      `${integer(watermarkParams.numLeaves)} competitors per match. These are the ` +
      'reference implementation’s shipped defaults, published in its own repository.',
    ]),
  ], provenanceTag('pinned', 'reproducible from committed inputs')));

  root.append(panel('Sources', [
    el('p', { class: 'note' }, [
      'Every material claim on this page traces to one of these. Access dates are recorded ' +
      'because product claims in this area go stale quickly.',
    ]),
    el('ul', { role: 'list', class: 'note' }, SOURCES.map((source) =>
      el('li', { role: 'listitem' }, [
        el('a', { href: source.url, target: '_blank', rel: 'noopener', text: source.title }),
        ' — ',
        source.detail,
        ` Accessed ${source.accessed}.`,
      ]))),
    el('p', { class: 'note' }, [
      'One thing deliberately absent: any accuracy percentage for a SynthID detector taken ' +
      'from a watermark-removal vendor’s blog. Such figures circulate widely and have no ' +
      'traceable methodology. The only detection numbers on this page are the ones ' +
      'measured here, on this configuration.',
    ]),
  ], provenanceTag('paper', 'primary sources')));
}

/**
 * The one result this section is for: how much of the page is faithful to what.
 *
 * Counted from the provenance table below rather than typed, so the summary cannot drift
 * away from the thing it summarises — a hand-written "sixteen components" would survive
 * the day a seventeenth is added, and that is exactly the kind of small lie this section
 * exists to make impossible.
 */
function renderHeadline(): HTMLElement {
  const count = (kind: ProvenanceEntry['kind']): string =>
    integer(PROVENANCE.filter((entry) => entry.kind === kind).length);
  return el('div', { class: 'act-headline' }, [
    el('p', { class: 'act-headline-label', text: 'Everything this page is built from' }),
    el('p', {
      class: 'act-headline-figure',
      text: `${integer(PROVENANCE.length)} components, ${integer(LIMITATIONS.length)} limitations`,
    }),
    el('p', {
      class: 'act-headline-detail',
      text: `${count('reference')} components faithful to the reference implementation, ` +
        `${count('paper')} to the paper, ${count('pinned')} pinned measurements and ` +
        `${count('demo')} deliberate simplifications — each one named below, with what it ` +
        'is faithful to and what the simplification costs.',
    }),
    consequence(
      'Everything above this section is a claim',
      'this is the material to check it against, including where it fails.',
    ),
  ]);
}

function li(text: string): HTMLElement {
  return el('li', { role: 'listitem', class: 'note', text });
}

function dataRow(name: string, contents: string, script: string): HTMLElement {
  return el('tr', {}, [
    el('td', { class: 'mono', text: name }),
    el('td', { class: 'provenance-note', text: contents }),
    el('td', { class: 'mono', text: script }),
  ]);
}
