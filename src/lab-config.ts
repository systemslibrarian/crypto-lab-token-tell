/**
 * Everything the page runs on, assembled once from committed data.
 *
 * Nothing here is a literal typed by hand: the watermark parameters, the pinned sampling
 * table, the tokenizer merge list and the pinned texts all come from files that
 * tools/ produced and the repository carries, each with its own provenance block.
 */

import { sha256 } from '@noble/hashes/sha2.js';

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
import { createGpt2Tokenizer } from './tokenizer/gpt2.ts';
import type { Gpt2Tokenizer } from './tokenizer/gpt2.ts';

const sha256Bytes = (data: Uint8Array): Uint8Array => sha256(data);

export const watermarkParams: WatermarkParams = paramsFromConfig(rawConfig.watermark);

export const samplingTable = samplingTableFromPackedBase64(
  samplingTableData.packed_base64,
  samplingTableData.size,
);

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
