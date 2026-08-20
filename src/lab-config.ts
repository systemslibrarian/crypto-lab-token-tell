/**
 * Everything the page runs on, assembled once from committed data.
 *
 * Nothing here is a literal typed by hand: the watermark parameters, the pinned sampling
 * table, the tokenizer merge list and the pinned texts all come from files that
 * tools/ produced and the repository carries, each with its own provenance block.
 *
 * The sampling table is the one of those the browser cannot re-derive for itself, so it
 * is the one that has to be checked rather than trusted. That check lives here, and it
 * runs before anything downstream can score a token against the table.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import rawConfig from './data/watermark-config.json';
import samplingTableData from './data/pinned/sampling-table.json';
import tokenizerMeta from './data/pinned/tokenizer-meta.json';
import mergesBlob from './data/pinned/gpt2-merges.txt?raw';

import { hashIvFromKeys } from './watermark/hash.ts';
import { makeDeepMindConstruction, makeTransformersConstruction } from './watermark/constructions.ts';
import type { ConstructionId, GValueConstruction } from './watermark/constructions.ts';
import { paramsFromConfig } from './watermark/params.ts';
import type { WatermarkParams } from './watermark/params.ts';
import { samplingTableFromPackedBase64 } from './watermark/sampling-table.ts';
import type { SamplingTable } from './watermark/sampling-table.ts';
import { createGpt2Tokenizer } from './tokenizer/gpt2.ts';
import type { Gpt2Tokenizer } from './tokenizer/gpt2.ts';

const sha256Bytes = (data: Uint8Array): Uint8Array => sha256(data);

export const watermarkParams: WatermarkParams = paramsFromConfig(rawConfig.watermark);

/**
 * What a pinned input failing its own digest has to look like.
 *
 * Throwing stops the module graph, which is the easy half of the answer and the right
 * one: no panel may compute a number from a table this module cannot vouch for. But a
 * throw on its own leaves the static shell standing — the thesis, the call to action and
 * nine empty sections — which reads as a page still loading rather than one that refused
 * to run. On a page whose whole argument is that it checks its own inputs, a check that
 * failed in silence would be the worst outcome available, so the reason is written into
 * the document first and the throw follows it.
 */
function refusePinnedData(what: string, expected: string, actual: string): never {
  const message =
    `Token Tell did not run: the ${what} does not match the SHA-256 committed alongside ` +
    `it in src/data/pinned/sampling-table.json. Expected ${expected}, computed ${actual}. ` +
    'Every g-value on this page would have been read from that table, so none of them ' +
    'was computed.';
  if (typeof document !== 'undefined' && document.body) {
    const notice = document.createElement('p');
    notice.id = 'pinned-data-failure';
    notice.setAttribute('role', 'alert');
    // Styled inline: the stylesheet is one more thing that could be what went wrong, and
    // this notice is the one piece of the page that has to survive anything.
    notice.style.cssText =
      'margin:0;padding:1rem;background:#7f1d1d;color:#fff;font:0.95rem/1.6 monospace';
    notice.textContent = message;
    document.body.prepend(notice);
  }
  throw new Error(message);
}

/**
 * The sampling table, checked rather than trusted — which is what the provenance table
 * means when it says this one value is committed with its SHA-256 and checked at load.
 *
 * Two digests, because two different things can go wrong. `sha256_of_packed` covers the
 * base64 blob as it arrives, so it catches a table that changed in the repository, in the
 * bundler or in transit. `sha256_of_bytes` is the digest of torch's own byte-per-entry
 * array, and re-deriving it through `table.at()` holds the browser's bit unpacking to the
 * capture script's packing — which the packed digest cannot do, because a wrong bit order
 * reads the right bytes.
 *
 * The base64 is decoded twice, once here and once in the decoder itself. Eight kilobytes
 * is a cheaper price than widening a signature in a file the verification manifest
 * anchors, and the whole check is two SHA-256 passes over 73 kB: under a millisecond,
 * once, before the first panel renders.
 */
function verifiedSamplingTable(): SamplingTable {
  const binary = atob(samplingTableData.packed_base64);
  const packed = new Uint8Array(binary.length);
  for (let i = 0; i < packed.length; i++) packed[i] = binary.charCodeAt(i);
  const packedDigest = bytesToHex(sha256Bytes(packed));
  if (packedDigest !== samplingTableData.sha256_of_packed) {
    refusePinnedData('packed sampling table', samplingTableData.sha256_of_packed, packedDigest);
  }

  const table = samplingTableFromPackedBase64(
    samplingTableData.packed_base64,
    samplingTableData.size,
  );
  const unpacked = new Uint8Array(table.size);
  for (let i = 0; i < unpacked.length; i++) unpacked[i] = table.at(i);
  const unpackedDigest = bytesToHex(sha256Bytes(unpacked));
  if (unpackedDigest !== samplingTableData.sha256_of_bytes) {
    refusePinnedData('unpacked sampling table', samplingTableData.sha256_of_bytes, unpackedDigest);
  }
  return table;
}

export const samplingTable: SamplingTable = verifiedSamplingTable();

export const deepMindConstruction: GValueConstruction = makeDeepMindConstruction(
  sha256Bytes,
  hashIvFromKeys,
);

export const transformersConstruction: GValueConstruction =
  makeTransformersConstruction(samplingTable);

export const constructions: Record<ConstructionId, GValueConstruction> = {
  'deepmind-addb4a1': deepMindConstruction,
  'transformers-5.15.1': transformersConstruction,
};

/** The construction the lab detects with unless a panel deliberately switches it. */
export const defaultConstruction: GValueConstruction =
  constructions[rawConfig.construction as ConstructionId] ?? deepMindConstruction;

let tokenizerInstance: Gpt2Tokenizer | null = null;

/** The tokenizer is built on first use: deriving 50,257 entries is not free. */
export function tokenizer(): Gpt2Tokenizer {
  if (!tokenizerInstance) tokenizerInstance = createGpt2Tokenizer(mergesBlob);
  return tokenizerInstance;
}

export const decoding = rawConfig.decoding;
export const modelInfo = rawConfig.model;
export const tokenizerProvenance = tokenizerMeta;
export const samplingTableProvenance = {
  size: samplingTableData.size,
  seed: samplingTableData.seed,
  ones: samplingTableData.ones,
  sha256: samplingTableData.sha256_of_bytes,
  generator: samplingTableData.generator,
};
