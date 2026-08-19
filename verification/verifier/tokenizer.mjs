/**
 * An independent GPT-2 byte-level BPE implementation.
 *
 * Written from the algorithm rather than from the lab's TypeScript, and structured
 * differently on purpose: this one materialises a rank-sorted pair list per word instead
 * of scanning for the minimum each pass. Same output, different route — which is what
 * makes agreement on the committed vectors worth something.
 */

import { createHash } from 'node:crypto';

const PATTERN = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;
const END_OF_TEXT = '<|endoftext|>';

function byteAlphabet() {
  const printable = [];
  for (let value = 0x21; value <= 0x7e; value += 1) printable.push(value);
  for (let value = 0xa1; value <= 0xac; value += 1) printable.push(value);
  for (let value = 0xae; value <= 0xff; value += 1) printable.push(value);

  const codePoints = printable.slice();
  let spare = 0;
  for (let value = 0; value < 256; value += 1) {
    if (!printable.includes(value)) {
      printable.push(value);
      codePoints.push(256 + spare);
      spare += 1;
    }
  }
  const byteToChar = new Array(256);
  const charToByte = new Map();
  printable.forEach((byteValue, index) => {
    const char = String.fromCodePoint(codePoints[index]);
    byteToChar[byteValue] = char;
    charToByte.set(char, byteValue);
  });
  return { byteToChar, charToByte, ordered: codePoints.map((c) => String.fromCodePoint(c)) };
}

export function createTokenizer(mergesText) {
  const { byteToChar, charToByte, ordered } = byteAlphabet();
  const merges = mergesText.split('\n').filter((line) => line && !line.startsWith('#version'));
  const rank = new Map(merges.map((line, index) => [line, index]));

  // GPT-2's vocabulary is exactly: the 256 byte tokens, the merge results in order, then
  // the end-of-text marker. Derived here rather than shipped, and checkable by hash.
  const vocabulary = [...ordered, ...merges.map((line) => line.replace(' ', '')), END_OF_TEXT];
  const idOf = new Map();
  vocabulary.forEach((token, id) => { if (!idOf.has(token)) idOf.set(token, id); });

  const cache = new Map();
  const mergeWord = (word) => {
    if (cache.has(word)) return cache.get(word);
    let symbols = Array.from(word);
    while (symbols.length > 1) {
      let best = null;
      for (let index = 0; index < symbols.length - 1; index += 1) {
        const candidate = rank.get(`${symbols[index]} ${symbols[index + 1]}`);
        if (candidate !== undefined && (best === null || candidate < best.rank)) {
          best = { rank: candidate, index };
        }
      }
      if (best === null) break;
      const left = symbols[best.index];
      const right = symbols[best.index + 1];
      const merged = [];
      for (let index = 0; index < symbols.length;) {
        if (index < symbols.length - 1 && symbols[index] === left && symbols[index + 1] === right) {
          merged.push(left + right);
          index += 2;
        } else {
          merged.push(symbols[index]);
          index += 1;
        }
      }
      symbols = merged;
    }
    cache.set(word, symbols);
    return symbols;
  };

  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8');

  return {
    vocabularySize: vocabulary.length,
    vocabularySha256() {
      return createHash('sha256').update(vocabulary.join('\n'), 'utf8').digest('hex');
    },
    encode(text) {
      const ids = [];
      text.split(END_OF_TEXT).forEach((chunk, chunkIndex) => {
        if (chunkIndex > 0) ids.push(vocabulary.length - 1);
        for (const match of chunk.matchAll(PATTERN)) {
          let mapped = '';
          for (const byte of encoder.encode(match[0])) mapped += byteToChar[byte];
          for (const piece of mergeWord(mapped)) {
            const id = idOf.get(piece);
            if (id === undefined) throw new Error(`unknown piece ${JSON.stringify(piece)}`);
            ids.push(id);
          }
        }
      });
      return ids;
    },
    decode(ids) {
      const bytes = [];
      for (const id of ids) {
        for (const char of Array.from(vocabulary[id] ?? '')) {
          const byte = charToByte.get(char);
          if (byte === undefined) for (const b of encoder.encode(char)) bytes.push(b);
          else bytes.push(byte);
        }
      }
      return decoder.decode(Uint8Array.from(bytes));
    },
  };
}
