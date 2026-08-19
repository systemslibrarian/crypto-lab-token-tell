/**
 * Limitations, maths, implementation provenance, sources and test vectors.
 *
 * This section exists because everything above it is a claim. A reader who wants to
 * disbelieve the page should be able to find, here, exactly which component is faithful
 * to what, which numbers were measured rather than derived, and which questions this lab
 * could not answer.
 */

import attacks from '../data/pinned/attacks.json';
import distributions from '../data/pinned/distributions.json';
import nullCorpus from '../data/pinned/null-corpus.json';
import samplingTable from '../data/pinned/sampling-table.json';
import testVectors from '../data/pinned/test-vectors.json';
import texts from '../data/pinned/texts.json';
import tokenizerMeta from '../data/pinned/tokenizer-meta.json';
import { watermarkParams } from '../lab-config.ts';
import { clear, el, integer, panel, provenanceTag, scroller, thesisStrip } from './dom.ts';

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
    source: `torch.randint(0, 2, (${integer(samplingTable.size)},)) seeded ${samplingTable.seed}`,
    note: 'The one value the browser cannot re-derive, so it is committed with its ' +
      'SHA-256 and checked at load.',
  },
  {
    component: 'C2PA manifest',
    kind: 'demo',
    source: 'C2PA-shaped: assertions, a claim binding them by hash, a hard binding',
    note: 'No JUMBF, no COSE, no certificate chain, no trust list, no Conformance Program ' +
      'status.',
  },
  {
    component: 'signature',
    kind: 'reference',
    source: 'ECDSA P-256 with SHA-256 via WebCrypto',
    note: 'Real, and the only part of this page that is a standard cryptographic primitive ' +
      'used as intended.',
  },
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
    detail: 'Published April 2026; resolved from spec.c2pa.org at build time rather than copied from a secondary source, which disagree (2.1 / 2.2 / 2.3 / 2.4).',
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
];

export function renderReference(root: HTMLElement): void {
  clear(root);
  root.append(
    el('p', { class: 'act-kicker', text: 'Reference' }),
    el('h2', { id: 'reference-heading', text: 'Limitations, maths, provenance and sources' }),
    thesisStrip(),
  );

  root.append(panel('Limitations', [
    el('ul', { role: 'list' }, [
      li('The scoring statistic implemented here is the mean g-score. It is not the ' +
        'production learned or Bayesian detector, which is what the paper’s headline ' +
        'results use and what both reference implementations ship.'),
      li('The pinned distributions and texts come from GPT-2 with temperature 1.0 and ' +
        'top-k 40 applied, not from a production-scale model. Behaviour at scale differs; ' +
        'in particular larger models tend to be lower entropy, which the paper notes ' +
        'reduces watermarking strength.'),
      li('The demo keys are published in this repository — they are the reference ' +
        'implementation’s own default configuration. Real deployment requires the ' +
        'watermark configuration be held secret; a published key means the mark can be ' +
        'replicated or removed by anyone.'),
      li('This lab implements the NON-DISTORTIONARY configuration: two competitors per ' +
        'match. The paper proves the distortionary case is a different animal (its ' +
        'Theorem 19 shows N > 2 is distortionary) and this lab makes no claims about it.'),
      li('The C2PA panel is C2PA-SHAPED, not conformant: no JUMBF structures, no COSE ' +
        'claim signatures, no certificate chains, no trust-list validation and no ' +
        'Conformance Program status.'),
      li('No claim is made about detecting any vendor’s output. This detector reads the ' +
        'configuration published here and nothing else.'),
      li('Every threshold on this page is specific to this configuration, this model and ' +
        'this corpus of 48 texts per class. A 1% threshold estimated from 48 samples rests ' +
        'on the single highest of them.'),
      li('The thresholds are indexed by token count, while the evidence is indexed by ' +
        'scored positions. For a degenerate text these diverge sharply, which Act III ' +
        'measures rather than hides.'),
      li('The empirical null measured here is over a single model and prompt style. It is ' +
        'not a general statement about how the mean g-score behaves.'),
    ]),
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
    scroller('Implementation provenance table', [
      el('table', {}, [
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
          el('td', { class: 'note', text: entry.note }),
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
      el('table', {}, [
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

function li(text: string): HTMLElement {
  return el('li', { role: 'listitem', class: 'note', text });
}

function dataRow(name: string, contents: string, script: string): HTMLElement {
  return el('tr', {}, [
    el('td', { class: 'mono', text: name }),
    el('td', { class: 'note', text: contents }),
    el('td', { class: 'mono', text: script }),
  ]);
}
