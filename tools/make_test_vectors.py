"""Pin cross-language test vectors.

The browser reimplements the reference implementation's arithmetic. A reimplementation
is worth exactly what its differential test proves, so this script records what the
reference actually produces and the unit suite makes the TypeScript reproduce it. If the
two ever disagree, the TypeScript is wrong.

Run under the environment that has the construction you are pinning:
  --construction deepmind      needs google-deepmind/synthid-text @ addb4a1
  --construction transformers  needs transformers 5.15.1
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from synthid_ref import (  # noqa: E402
    DATA_DIR, WatermarkParams, load_config, provenance, sha256_text, write_json,
)

# Short sequences chosen to exercise the parts that are easy to get wrong: a plain run, a
# sequence whose context window repeats exactly, and a run containing the end-of-text id.
SEQUENCES = {
    "plain": [464, 3835, 338, 649, 22321, 2450, 6653, 326, 262, 649, 3835, 468],
    "repeated_context": [464, 3835, 338, 649, 22321, 464, 3835, 338, 649, 22321, 464, 3835,
                         338, 649, 22321],
    "with_eos": [464, 3835, 338, 649, 22321, 2450, 50256, 6653, 326, 262],
    "shortest_scorable": [464, 3835, 338, 649, 22321],
    "too_short": [464, 3835, 338, 649],
}

# Tokenizer cases: ASCII, leading spaces, punctuation runs, digits, CJK, emoji beyond the
# BMP, combining marks, tabs and newlines, and the end-of-text marker itself.
TOKENIZER_CASES = [
    "The library's new archival policy explains that",
    " leading space",
    "no-leading-space",
    "Numbers 1234567890 and 0.5 and -3",
    "punctuation!!! ??? ,,, ... --- ***",
    "tabs\tand\nnewlines\r\nmixed",
    "     five spaces",
    "CJK: 図書館の方針",
    "emoji: 🔏🗝️ and a flag 🇬🇧",
    "combining: éüñ vs éüñ",
    "<|endoftext|>",
    "before <|endoftext|> after",
    "Ġ literal and Ċ literal",
    "",
    "a",
    "  ",
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--construction", choices=["deepmind", "transformers"], required=True)
    args = ap.parse_args()

    import torch
    from transformers import AutoTokenizer

    torch.set_grad_enabled(False)
    cfg = load_config()
    params = WatermarkParams.from_config(cfg)
    keys = params.keys

    wrong_keys = [k ^ 0x5A5A5 for k in keys]
    one_bit_keys = list(keys)
    one_bit_keys[0] ^= 1

    if args.construction == "deepmind":
        from synthid_text import hashing_function, logits_processing

        def make(kl):
            return logits_processing.SynthIDLogitsProcessor(
                ngram_len=params.ngram_len, keys=list(kl),
                context_history_size=params.context_history_size,
                temperature=float(cfg["decoding"]["temperature"]),
                top_k=int(cfg["decoding"]["top_k"]),
                device=torch.device("cpu"),
                skip_first_ngram_calls=params.skip_first_ngram_calls,
                num_leaves=params.num_leaves)

        accumulate = hashing_function.accumulate_hash
        construction_id = "deepmind-addb4a1"
        chain_seeds = {
            "configured_keys": make(keys).hash_iv,
            "wrong_keys": make(wrong_keys).hash_iv,
            "one_bit_flipped": make(one_bit_keys).hash_iv,
        }
    else:
        from transformers.generation.logits_process import (  # noqa: N813
            SynthIDTextWatermarkLogitsProcessor as Proc)

        tv = cfg["transformers_variant"]

        def make(kl):
            return Proc(ngram_len=params.ngram_len, keys=list(kl),
                        sampling_table_size=tv["sampling_table_size"],
                        sampling_table_seed=tv["sampling_table_seed"],
                        context_history_size=params.context_history_size,
                        device="cpu",
                        skip_first_ngram_calls=params.skip_first_ngram_calls)

        accumulate = make(keys).accumulate_hash
        construction_id = "transformers-5.15.1"
        chain_seeds = {"configured_keys": 1, "wrong_keys": 1, "one_bit_flipped": 1}

    # ---- the hash itself ------------------------------------------------------------
    lcg_vectors = []
    for seed, data in [
        (1, [0]), (1, [1]), (1, [464, 3835, 338, 649]), (0, [50256]),
        (-1, [7]), (1614033703599872695, [464]), (1, list(range(10))),
    ]:
        h = torch.tensor([seed], dtype=torch.long)
        out = accumulate(h, torch.tensor([data], dtype=torch.long))
        # int64 values travel as decimal strings: they exceed what a JSON number can
        # carry without losing its last digits, and a hash that is nearly right is wrong.
        lcg_vectors.append({"seed": str(seed), "data": data, "hash": str(int(out[0]))})

    # ---- g-values, masks and scores --------------------------------------------------
    def describe(processor, token_ids):
        ids = torch.tensor([token_ids], dtype=torch.long)
        # The end-of-text mask is per token and does not need a full context window, so
        # it is computed even for a sequence too short to score.
        eos = processor.compute_eos_token_mask(input_ids=ids, eos_token_id=50256)
        out = {"eos_mask": [bool(v) for v in eos[0].tolist()]}
        if ids.shape[1] < params.ngram_len:
            return {**out, "g_values": [], "context_repetition_mask": []}
        g = processor.compute_g_values(input_ids=ids)
        mask = processor.compute_context_repetition_mask(input_ids=ids)
        out["g_values"] = g[0].tolist()
        out["context_repetition_mask"] = [bool(v) for v in mask[0].tolist()]
        return out

    key_sets = {"configured_keys": keys, "wrong_keys": wrong_keys,
                "one_bit_flipped": one_bit_keys}
    sequences = {}
    for name, token_ids in SEQUENCES.items():
        entry = {"token_ids": token_ids, "per_key_set": {}}
        for key_name, kl in key_sets.items():
            proc = make(kl)
            described = describe(proc, token_ids)
            from synthid_ref import mean_g_score
            described["score"] = mean_g_score(proc, token_ids)
            entry["per_key_set"][key_name] = described
        sequences[name] = entry

    # ---- the pinned samples ----------------------------------------------------------
    with open(DATA_DIR / "texts.json", encoding="utf-8") as fh:
        texts = json.load(fh)
    from synthid_ref import mean_g_score
    sample_scores = {}
    for sample_name, sample in texts["samples"].items():
        sample_scores[sample_name] = {
            key_name: mean_g_score(make(kl), sample["token_ids"])
            for key_name, kl in key_sets.items()
        }

    payload = {
        "what": f"cross-language test vectors for the {construction_id} construction",
        "construction": construction_id,
        "implementation_provenance": "REFERENCE-IMPLEMENTATION-FAITHFUL",
        "watermark": params.as_dict(),
        "key_sets": key_sets,
        "chain_seeds": {k: str(int(v)) for k, v in chain_seeds.items()},
        "lcg_vectors": lcg_vectors,
        "sequences": sequences,
        "pinned_sample_scores": sample_scores,
        "provenance": provenance("make_test_vectors.py"),
    }

    suffix = "" if args.construction == "deepmind" else "-transformers"
    write_json(DATA_DIR / f"test-vectors{suffix}.json", payload)

    # ---- tokenizer vectors (identical under either construction) ---------------------
    if args.construction == "deepmind":
        tok = AutoTokenizer.from_pretrained(cfg["model"]["tokenizer_id"])
        cases = []
        for text in TOKENIZER_CASES:
            ids = tok(text, add_special_tokens=False).input_ids
            cases.append({
                "text": text,
                "token_ids": ids,
                # clean_up_tokenization_spaces would strip spaces before punctuation,
                # which makes decode() something other than the inverse of encode().
                # The browser implements the byte-level inverse, so that is what is pinned.
                "decoded": tok.decode(ids, clean_up_tokenization_spaces=False),
                "token_strings": tok.convert_ids_to_tokens(ids),
            })
        tokenizer_payload = {
            "what": "GPT-2 tokenizer differential vectors",
            "implementation_provenance": "REFERENCE-IMPLEMENTATION-FAITHFUL",
            "tokenizer_id": cfg["model"]["tokenizer_id"],
            "note": (
                "produced by the Hugging Face tokenizer; the browser tokenizer is a "
                "reimplementation and must reproduce every one of these exactly"
            ),
            "cases": cases,
            "cases_sha256": sha256_text(json.dumps(cases, sort_keys=True, ensure_ascii=False)),
            "provenance": provenance("make_test_vectors.py"),
        }
        write_json(DATA_DIR / "tokenizer-vectors.json", tokenizer_payload)

    print(f"{construction_id}: {len(lcg_vectors)} lcg vectors, {len(sequences)} sequences, "
          f"{len(sample_scores)} pinned samples")


if __name__ == "__main__":
    main()
