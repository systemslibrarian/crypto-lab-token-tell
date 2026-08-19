"""Run the transformations that cannot be done in a browser, and pin what they produced.

Truncation, deletion and substitution are arithmetic on a token list, so the page does
them live. Back-translation and paraphrase need real models, so they happen here, once,
against pinned model revisions, and the exact input and output are committed.

Nothing here is allowed to aim at an outcome. The script records what the models
returned, including the cases where the watermark evidence survives.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from synthid_ref import (  # noqa: E402
    DATA_DIR, WatermarkParams, hub_revision, load_config, make_processor,
    mean_g_score, provenance, sha256_text, write_json,
)

SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")

BACK_TRANSLATION = [
    ("en->de", "Helsinki-NLP/opus-mt-en-de"),
    ("de->en", "Helsinki-NLP/opus-mt-de-en"),
]
PARAPHRASE_MODEL = "humarin/chatgpt_paraphraser_on_T5_base"
PARAPHRASE_INSTRUCTION = "paraphrase: "


def sentences(text: str) -> list[str]:
    parts = [s.strip() for s in SENTENCE_SPLIT.split(text.strip()) if s.strip()]
    return parts or [text.strip()]


def translate(pipe_model, pipe_tok, texts: list[str], max_new_tokens: int) -> list[str]:
    import torch
    out = []
    for chunk in texts:
        enc = pipe_tok(chunk, return_tensors="pt", truncation=True, max_length=512)
        with torch.no_grad():
            gen = pipe_model.generate(**enc, max_new_tokens=max_new_tokens, num_beams=4,
                                      do_sample=False)
        out.append(pipe_tok.decode(gen[0], skip_special_tokens=True))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="watermarked",
                    help="which pinned sample in texts.json to attack")
    args = ap.parse_args()

    import torch
    from transformers import (AutoModelForSeq2SeqLM, AutoTokenizer)

    torch.set_grad_enabled(False)
    cfg = load_config()
    params = WatermarkParams.from_config(cfg)
    gpt2_tok = AutoTokenizer.from_pretrained(cfg["model"]["tokenizer_id"])

    with open(DATA_DIR / "texts.json", encoding="utf-8") as fh:
        texts = json.load(fh)
    sample = texts["samples"][args.source]
    original = sample["text"]

    processor = make_processor(params, cfg)

    def score(text: str) -> dict:
        ids = gpt2_tok(text, add_special_tokens=False).input_ids
        result = mean_g_score(processor, ids)
        result["text_sha256"] = sha256_text(text)
        return result

    transformations = []

    # ---- back-translation: English -> German -> English -----------------------------
    hops = []
    current = sentences(original)
    for label, model_id in BACK_TRANSLATION:
        tok = AutoTokenizer.from_pretrained(model_id)
        model = AutoModelForSeq2SeqLM.from_pretrained(model_id)
        model.eval()
        current = translate(model, tok, current, max_new_tokens=512)
        hops.append({
            "hop": label,
            "model_id": model_id,
            "model_revision": hub_revision(model_id),
            "text": " ".join(current),
        })
    back_translated = " ".join(current)
    transformations.append({
        "id": "back-translation",
        "name": "Back-translation (English to German to English)",
        "kind": "pinned",
        "instructions": "each sentence translated independently, beam search, 4 beams, no sampling",
        "parameters": {"num_beams": 4, "do_sample": False, "max_new_tokens": 512,
                       "sentence_split": SENTENCE_SPLIT.pattern},
        "hops": hops,
        "original_text": original,
        "transformed_text": back_translated,
        "reference_score_original": score(original),
        "reference_score_transformed": score(back_translated),
    })

    # ---- paraphrase / regeneration ---------------------------------------------------
    para_tok = AutoTokenizer.from_pretrained(PARAPHRASE_MODEL)
    para_model = AutoModelForSeq2SeqLM.from_pretrained(PARAPHRASE_MODEL)
    para_model.eval()
    paraphrased_parts = []
    for sentence in sentences(original):
        enc = para_tok(PARAPHRASE_INSTRUCTION + sentence, return_tensors="pt",
                       truncation=True, max_length=512)
        gen = para_model.generate(**enc, max_new_tokens=256, num_beams=4, do_sample=False,
                                  repetition_penalty=1.0)
        paraphrased_parts.append(para_tok.decode(gen[0], skip_special_tokens=True))
    paraphrased = " ".join(paraphrased_parts)
    transformations.append({
        "id": "paraphrase",
        "name": "Paraphrase / regeneration",
        "kind": "pinned",
        "instructions": f"each sentence rewritten independently with the prefix {PARAPHRASE_INSTRUCTION!r}",
        "parameters": {"num_beams": 4, "do_sample": False, "max_new_tokens": 256,
                       "repetition_penalty": 1.0},
        "hops": [{
            "hop": "paraphrase",
            "model_id": PARAPHRASE_MODEL,
            "model_revision": hub_revision(PARAPHRASE_MODEL),
            "text": paraphrased,
        }],
        "original_text": original,
        "transformed_text": paraphrased,
        "reference_score_original": score(original),
        "reference_score_transformed": score(paraphrased),
    })

    payload = {
        "what": "transformations that need a model, applied to a pinned watermarked sample",
        "implementation_provenance": "PINNED EMPIRICAL DATA",
        "source_sample": args.source,
        "watermark": params.as_dict(),
        "construction": cfg["construction"],
        "tokenizer_id": cfg["model"]["tokenizer_id"],
        "measurement_note": (
            "Scores here are the reference implementation's, recorded so the browser's "
            "live recomputation can be checked against them. The page recomputes every "
            "number it shows; it does not read these."
        ),
        "transformations": transformations,
        "provenance": provenance("capture_attacks.py"),
    }
    write_json(DATA_DIR / "attacks.json", payload)

    for t in transformations:
        before = t["reference_score_original"]["score"]
        after = t["reference_score_transformed"]["score"]
        fmt = lambda v: "n/a" if v is None else f"{v:.4f}"
        print(f"{t['id']:18s} {fmt(before)} -> {fmt(after)}  "
              f"scored {t['reference_score_transformed']['scored_positions']}")


if __name__ == "__main__":
    main()
