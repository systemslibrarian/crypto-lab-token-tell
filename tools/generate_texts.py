"""Generate the pinned watermarked and unwatermarked texts.

Generation needs the language model; detection does not. That asymmetry is the seam the
whole lab is built on, and it is also why this script exists: the browser never runs
GPT-2, so the watermarked sample it scores has to be produced here, once, and committed
with enough provenance that anyone can reproduce it.

Watermarking is performed by the official reference implementation
(google-deepmind/synthid-text @ addb4a1, `SynthIDLogitsProcessor.watermarked_call`).
This script does not reimplement tournament sampling. The decoding loop below mirrors
that repository's own `synthid_mixin._sample`: temperature and top-k are applied by the
processor, the watermarked scores come back over the top-k candidate set, and the next
token is drawn from a softmax over those scores and mapped back through the top-k
indices.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from synthid_ref import (  # noqa: E402
    DATA_DIR, WatermarkParams, hub_revision, load_config, make_processor,
    mean_g_score, provenance, sha256_text, write_json,
)

# Prompts are deliberately mundane. A prompt that is itself striking would let a reader
# credit the prompt rather than the mechanism for anything they notice in the output.
PROMPTS = {
    "watermarked": "The library's new archival policy explains that",
    "control": "The library's new archival policy explains that",
    "watermarked_alt": "A committee reviewing the museum's cataloguing practice found that",
}


def generate(model, tok, cfg, params, prompt: str, seed: int, watermarked: bool) -> dict:
    """One decoding loop, mirroring synthid_mixin._sample from the reference repository."""
    import torch

    dec = cfg["decoding"]
    processor = make_processor(params, cfg) if watermarked else None
    enc = tok(prompt, return_tensors="pt")
    input_ids = enc.input_ids
    prompt_len = input_ids.shape[1]
    torch.manual_seed(seed)

    past = None
    for step in range(dec["max_new_tokens"]):
        out = model(input_ids=input_ids if past is None else input_ids[:, -1:],
                    past_key_values=past, use_cache=True)
        past = out.past_key_values
        logits = out.logits[:, -1, :].clone()

        # min_new_tokens == max_new_tokens, so the end-of-text token is suppressed for the
        # whole run. It is suppressed before the processor sees the scores, because the
        # processor takes its own top-k and would otherwise be free to select it. Both
        # samples get the same treatment, so the pair still differs only in the watermark.
        logits[:, tok.eos_token_id] = float("-inf")

        if watermarked:
            # The processor scales by temperature, takes the top k, watermarks inside that
            # candidate set, and hands back scores over the top-k indices.
            scores, top_k_indices, _ = processor.watermarked_call(input_ids, logits)
            probs = torch.nn.functional.softmax(scores, dim=-1)
            picked = torch.multinomial(probs, num_samples=1)
            next_token = torch.gather(top_k_indices, 1, picked)
        else:
            # The control path applies the same temperature and top-k, and nothing else,
            # so the two samples differ in the watermark and in nothing else.
            scaled = logits / float(dec["temperature"])
            top = torch.topk(scaled, k=int(dec["top_k"]), dim=1)
            probs = torch.nn.functional.softmax(top.values, dim=-1)
            picked = torch.multinomial(probs, num_samples=1)
            next_token = torch.gather(top.indices, 1, picked)

        input_ids = torch.cat([input_ids, next_token], dim=1)

    continuation_ids = input_ids[0, prompt_len:].tolist()
    return {
        "prompt": prompt,
        "prompt_token_ids": enc.input_ids[0].tolist(),
        "seed": seed,
        "watermarked": watermarked,
        "token_ids": continuation_ids,
        # Decoded without space cleanup, so the committed text is exactly what the
        # committed token ids decode to and re-tokenizing it returns those same ids.
        "text": tok.decode(continuation_ids, clean_up_tokenization_spaces=False),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=20260819)
    args = ap.parse_args()

    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    torch.set_grad_enabled(False)
    cfg = load_config()
    params = WatermarkParams.from_config(cfg)
    model_id = cfg["model"]["model_id"]

    tok = AutoTokenizer.from_pretrained(cfg["model"]["tokenizer_id"])
    model = AutoModelForCausalLM.from_pretrained(model_id)
    model.eval()

    samples = {
        # The Hero pair: same prompt, same decoding parameters, same length. The only
        # difference between them is whether the watermarking processor ran.
        "watermarked": generate(model, tok, cfg, params, PROMPTS["watermarked"], args.seed, True),
        "control": generate(model, tok, cfg, params, PROMPTS["control"], args.seed + 1, False),
        # A second watermarked passage, so a reader can check the first was not a lucky
        # draw, and so the attack panel has something to work on that the Hero has not
        # already used.
        "watermarked_alt": generate(model, tok, cfg, params, PROMPTS["watermarked_alt"],
                                    args.seed + 2, True),
    }

    # Score each sample with the reference implementation, under the real keys and under
    # wrong keys. These are the numbers the browser must reproduce; a mismatch is a bug in
    # the browser scorer, not a tolerance to widen.
    right = make_processor(params, cfg)
    wrong_keys = [k ^ 0x5A5A5 for k in params.keys]
    wrong = make_processor(params, cfg, keys=wrong_keys)
    one_bit_one_key = list(params.keys)
    one_bit_one_key[0] ^= 1
    one_bit = make_processor(params, cfg, keys=one_bit_one_key)

    for s in samples.values():
        s["reference_scores"] = {
            "correct_key": mean_g_score(right, s["token_ids"]),
            "wrong_key": mean_g_score(wrong, s["token_ids"]),
            "one_bit_flipped_in_first_key": mean_g_score(one_bit, s["token_ids"]),
        }
        s["text_sha256"] = sha256_text(s["text"])

    payload = {
        "what": "pinned GPT-2 continuations: two watermarked, one unwatermarked control",
        "implementation_provenance": "REFERENCE-IMPLEMENTATION-FAITHFUL",
        "how": (
            "google-deepmind/synthid-text @ addb4a1 SynthIDLogitsProcessor.watermarked_call "
            "inside a decoding loop that mirrors that repository's synthid_mixin._sample; "
            "the control uses the same temperature and top-k with no watermarking"
        ),
        "detection_note": (
            "skip_first_ngram_calls is true, so the reference generator leaves the first "
            "ngram_len-1 generated tokens unwatermarked. Detection over the continuation "
            "alone scores positions ngram_len-1 onward, so the scored positions are exactly "
            "the watermarked ones and no zero-padded generation context is ever scored."
        ),
        "watermark": params.as_dict(),
        "wrong_key_used_for_reference_score": wrong_keys,
        "one_bit_key_used_for_reference_score": one_bit_one_key,
        "decoding": {k: v for k, v in cfg["decoding"].items() if not k.startswith("_")},
        "model": {
            "model_id": model_id,
            "model_revision": hub_revision(model_id),
            "tokenizer_id": cfg["model"]["tokenizer_id"],
            "tokenizer_revision": hub_revision(cfg["model"]["tokenizer_id"]),
        },
        "samples": samples,
        "provenance": provenance("generate_texts.py"),
    }
    write_json(DATA_DIR / "texts.json", payload)

    fmt = lambda v: "n/a" if v is None else f"{v:.4f}"
    for name, s in samples.items():
        rs = s["reference_scores"]
        print(f"{name:16s} tokens={len(s['token_ids'])} "
              f"correct={fmt(rs['correct_key']['score'])} "
              f"wrong={fmt(rs['wrong_key']['score'])} "
              f"one-bit={fmt(rs['one_bit_flipped_in_first_key']['score'])} "
              f"scored={rs['correct_key']['scored_positions']}/"
              f"{rs['correct_key']['candidate_positions']}")


if __name__ == "__main__":
    main()
