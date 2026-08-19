"""Pin real GPT-2 next-token distributions.

Act I needs a real distribution to run a tournament over, and Act III needs two of them
that differ in how much freedom the model had. Both come from here, and both are labelled
for exactly what they are.

The labelling rule this file exists to enforce: what the browser receives is NOT the
model's unmodified distribution. It is the distribution after temperature scaling and
top-k truncation, which is what the reference logits processor watermarks over. The full
vocabulary entropy is recorded alongside so a reader can see how much the truncation
threw away.
"""

from __future__ import annotations

import hashlib
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from synthid_ref import (  # noqa: E402
    DATA_DIR, hub_revision, load_config, provenance, write_json,
)

# Contexts chosen to bracket the range, then reported with whatever entropy they turned
# out to have. Nothing here is selected to hit a target number.
CONTEXTS = {
    "high_entropy": "The library's new archival policy explains that",
    "low_entropy": "The Declaration of Independence was signed in the year seventeen seventy",
    "mid_entropy": "She opened the drawer and found a",
}


def entropy_bits(probabilities) -> float:
    return float(-sum(p * math.log2(p) for p in probabilities if p > 0))


def main() -> None:
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    torch.set_grad_enabled(False)
    cfg = load_config()
    dec = cfg["decoding"]
    model_id = cfg["model"]["model_id"]

    tok = AutoTokenizer.from_pretrained(cfg["model"]["tokenizer_id"])
    model = AutoModelForCausalLM.from_pretrained(model_id)
    model.eval()

    top_k = int(dec["top_k"])
    temperature = float(dec["temperature"])

    distributions = {}
    for name, prompt in CONTEXTS.items():
        enc = tok(prompt, return_tensors="pt")
        logits = model(**enc).logits[0, -1, :]

        raw_bytes = logits.detach().numpy().tobytes()
        full_probs = torch.softmax(logits, dim=-1)
        scaled = logits / temperature
        scaled_probs = torch.softmax(scaled, dim=-1)

        top = torch.topk(scaled, k=top_k)
        # The processor softmaxes the top-k scores, which is the same as renormalising the
        # scaled probabilities over the surviving candidates.
        candidate_probs = torch.softmax(top.values, dim=-1)

        candidates = []
        for idx, prob in zip(top.indices.tolist(), candidate_probs.tolist()):
            candidates.append({
                "token_id": idx,
                "token_string": tok.convert_ids_to_tokens([idx])[0],
                "token_text": tok.decode([idx], clean_up_tokenization_spaces=False),
                "probability": prob,
            })

        distributions[name] = {
            "label": (
                f"Pinned GPT-2 sampling distribution after temperature={temperature} "
                f"and top-k={top_k} preprocessing"
            ),
            "prompt": prompt,
            "context_token_ids": enc.input_ids[0].tolist(),
            "context_token_strings": tok.convert_ids_to_tokens(enc.input_ids[0].tolist()),
            "temperature": temperature,
            "top_k": top_k,
            "raw_logits_sha256": hashlib.sha256(raw_bytes).hexdigest(),
            "raw_logits_dtype": str(logits.dtype),
            "full_vocabulary_entropy_bits": entropy_bits(full_probs.tolist()),
            "scaled_full_vocabulary_entropy_bits": entropy_bits(scaled_probs.tolist()),
            "candidate_entropy_bits": entropy_bits(candidate_probs.tolist()),
            "mass_kept_by_top_k": float(scaled_probs[top.indices].sum()),
            "candidates": candidates,
        }
        print(f"{name:14s} full H={distributions[name]['full_vocabulary_entropy_bits']:.3f} bits  "
              f"top-{top_k} H={distributions[name]['candidate_entropy_bits']:.3f} bits  "
              f"mass kept={distributions[name]['mass_kept_by_top_k']:.4f}  "
              f"top token={candidates[0]['token_text']!r} p={candidates[0]['probability']:.4f}")

    payload = {
        "what": "pinned GPT-2 next-token distributions, after the preprocessing the watermark sees",
        "implementation_provenance": "PINNED EMPIRICAL DATA",
        "labelling_rule": (
            "These are NOT unmodified model distributions. Temperature scaling and top-k "
            "truncation were applied first, because that is what the reference logits "
            "processor watermarks over. Full-vocabulary entropy is recorded so the cost of "
            "the truncation is visible rather than hidden."
        ),
        "model": {
            "model_id": model_id,
            "model_revision": hub_revision(model_id),
            "tokenizer_id": cfg["model"]["tokenizer_id"],
            "tokenizer_revision": hub_revision(cfg["model"]["tokenizer_id"]),
        },
        "distributions": distributions,
        "provenance": provenance("capture_distributions.py"),
    }
    write_json(DATA_DIR / "distributions.json", payload)


if __name__ == "__main__":
    main()
