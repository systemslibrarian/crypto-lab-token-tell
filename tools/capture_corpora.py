"""Measure what this configuration's scores look like, marked and unmarked.

A score is only interpretable against a null. This builds the corpus null — many
unwatermarked texts, one fixed key — which is the null a deployed detector actually
faces: "for this key, is this text unusual?"

It also builds the matched positive set: the same prompts, the same decoding parameters,
generated through the reference watermarking processor. With both in hand the detection
rate is a measurement (what fraction of watermarked texts clear a threshold set from the
unwatermarked ones) rather than one sample's trajectory dressed up as a curve.

The other null, the wrong-key one, is computed live in the browser and answers a
different question: "for this text, is this key special?" Both are shown, because
answering one and reporting it as the other is the standard way to overstate a detector.

Everything is scored at several truncation lengths, so the page can show how the evidence
accumulates and where this configuration's own measurements stop being decisive. The
thresholds that come out of this file are properties of THIS configuration and no other.
"""

from __future__ import annotations

import argparse
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from synthid_ref import (  # noqa: E402
    DATA_DIR, WatermarkParams, hub_revision, load_config, make_processor,
    mean_g_score, provenance, write_json,
)

LENGTHS = [10, 15, 20, 25, 40, 50, 75, 100, 150, 200, 250, 300, 320]

PROMPTS = [
    "The library's new archival policy explains that",
    "A committee reviewing the museum's cataloguing practice found that",
    "The report on regional rainfall concluded that",
    "Visitors to the observatory are told that",
    "The manual for the printing press notes that",
    "Researchers studying migratory birds observed that",
    "The city council minutes record that",
    "An engineer inspecting the bridge reported that",
    "The guide to the botanical gardens mentions that",
    "A survey of local shopkeepers suggested that",
    "The instructions for the kiln warn that",
    "Historians of the canal system argue that",
    "The catalogue entry for the manuscript states that",
    "Teachers at the school observed that",
    "The maintenance log for the ferry shows that",
    "A study of household energy use found that",
    "The pamphlet on woodland management advises that",
    "Members of the choir were told that",
    "The inventory of the workshop lists that",
    "An account of the harvest festival describes that",
    "The specification for the water treatment plant requires that",
    "Volunteers at the wildlife centre noticed that",
    "The transcript of the hearing shows that",
    "A review of the transport timetable concluded that",
    "The handbook for new apprentices explains that",
    "Observers at the weather station recorded that",
    "The ledger from the old mill indicates that",
    "A note pinned to the noticeboard said that",
    "The plan for the community orchard proposes that",
    "Inspectors visiting the bakery found that",
    "The register of listed buildings notes that",
    "A letter to the editor complained that",
    "The syllabus for the evening class states that",
    "Staff at the sorting office reported that",
    "The design brief for the footbridge says that",
    "A leaflet about the recycling scheme explains that",
    "The annual report of the trust records that",
    "Delegates at the conference heard that",
    "The label on the specimen jar reads that",
    "A memo circulated to the department said that",
    "The rota for the lifeboat crew shows that",
    "Curators preparing the exhibition decided that",
    "The estimate from the roofing contractor stated that",
    "A blog post about urban foxes claimed that",
    "The minutes of the allotment association note that",
    "Passengers on the delayed service were told that",
    "The field notes from the excavation record that",
    "An advertisement in the local paper promised that",
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch-size", type=int, default=8)
    ap.add_argument("--seed", type=int, default=770914)
    ap.add_argument("--reuse", action="store_true",
                    help="re-score the corpora already committed instead of regenerating "
                         "them; the generation is deterministic from --seed, so this only "
                         "saves time")
    args = ap.parse_args()

    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    torch.set_grad_enabled(False)
    cfg = load_config()
    params = WatermarkParams.from_config(cfg)
    dec = cfg["decoding"]
    model_id = cfg["model"]["model_id"]

    tok = AutoTokenizer.from_pretrained(cfg["model"]["tokenizer_id"], padding_side="left")
    tok.pad_token = tok.eos_token
    model = AutoModelForCausalLM.from_pretrained(model_id)
    model.eval()

    max_new = int(dec["max_new_tokens"])
    temperature = float(dec["temperature"])
    top_k = int(dec["top_k"])

    existing = None
    if args.reuse and (DATA_DIR / "null-corpus.json").exists():
        import json as _json
        with open(DATA_DIR / "null-corpus.json", encoding="utf-8") as fh:
            existing = _json.load(fh)

    torch.manual_seed(args.seed)
    corpus: list[list[int]] = list(existing["corpus_token_ids"]) if existing else []
    for start in range(0, 0 if corpus else len(PROMPTS), args.batch_size):
        batch = PROMPTS[start:start + args.batch_size]
        enc = tok(batch, return_tensors="pt", padding=True)
        out = model.generate(
            **enc, do_sample=True, temperature=temperature, top_k=top_k,
            max_new_tokens=max_new, min_new_tokens=max_new,
            pad_token_id=tok.eos_token_id,
        )
        prompt_len = enc.input_ids.shape[1]
        for row in out[:, prompt_len:]:
            corpus.append(row.tolist())
        print(f"unwatermarked {len(corpus)}/{len(PROMPTS)}", flush=True)

    # The matched positive set. Each batch gets a fresh processor, because the
    # repeated-context history and the sliding context are per-generation state.
    torch.manual_seed(args.seed + 1)
    marked_corpus: list[list[int]] = (
        list(existing["watermarked_corpus_token_ids"])
        if existing and existing.get("watermarked_corpus_token_ids") else [])
    for start in range(0, 0 if marked_corpus else len(PROMPTS), args.batch_size):
        batch = PROMPTS[start:start + args.batch_size]
        enc = tok(batch, return_tensors="pt", padding=True)
        proc = make_processor(params, cfg)
        input_ids = enc.input_ids
        attention_mask = enc.attention_mask
        past = None
        for _ in range(max_new):
            step_ids = input_ids if past is None else input_ids[:, -1:]
            out = model(input_ids=step_ids, attention_mask=attention_mask,
                        past_key_values=past, use_cache=True)
            past = out.past_key_values
            logits = out.logits[:, -1, :].clone()
            logits[:, tok.eos_token_id] = float("-inf")
            scores, top_k_indices, _ = proc.watermarked_call(input_ids, logits)
            probs = torch.nn.functional.softmax(scores, dim=-1)
            picked = torch.multinomial(probs, num_samples=1)
            next_token = torch.gather(top_k_indices, 1, picked)
            input_ids = torch.cat([input_ids, next_token], dim=1)
            attention_mask = torch.cat(
                [attention_mask, torch.ones_like(next_token)], dim=1)
        prompt_len = enc.input_ids.shape[1]
        for row in input_ids[:, prompt_len:]:
            marked_corpus.append(row.tolist())
        print(f"watermarked {len(marked_corpus)}/{len(PROMPTS)}", flush=True)

    processor = make_processor(params, cfg)

    with open(DATA_DIR / "texts.json", encoding="utf-8") as fh:
        import json
        texts = json.load(fh)

    by_length = {}
    for length in LENGTHS:
        null_results = [mean_g_score(processor, t[:length]) for t in corpus]
        null_scores = sorted(r["score"] for r in null_results if r["score"] is not None)
        scored_positions = [r["scored_positions"] for r in null_results
                            if r["score"] is not None]
        marked_scores = sorted(
            r["score"] for r in (mean_g_score(processor, t[:length]) for t in marked_corpus)
            if r["score"] is not None)
        watermarked = {
            name: mean_g_score(processor, sample["token_ids"][:length])
            for name, sample in texts["samples"].items()
        }
        # Empirical thresholds, the way the paper reports detectability: take the
        # unwatermarked scores and cut at the top x%, then measure what fraction of the
        # watermarked ones clear that cut. Specific to this configuration, this model and
        # this corpus, and to nothing else.
        thr1 = quantile(null_scores, 0.99)
        thr5 = quantile(null_scores, 0.95)
        by_length[str(length)] = {
            "tokens": length,
            "null_sample_count": len(null_scores),
            "null_scores": null_scores,
            "null_mean": statistics.fmean(null_scores) if null_scores else None,
            "null_sd": statistics.stdev(null_scores) if len(null_scores) > 1 else None,
            # The independence prediction needs the positions that actually counted, not
            # the positions the window offered; masking removes some of them.
            "null_mean_scored_positions": (statistics.fmean(scored_positions)
                                           if scored_positions else None),
            "threshold_fpr_1_percent": thr1,
            "threshold_fpr_5_percent": thr5,
            "watermarked_sample_count": len(marked_scores),
            "watermarked_scores_corpus": marked_scores,
            "watermarked_mean": statistics.fmean(marked_scores) if marked_scores else None,
            "watermarked_sd": (statistics.stdev(marked_scores)
                               if len(marked_scores) > 1 else None),
            "tpr_at_fpr_1_percent": (
                sum(1 for s in marked_scores if s >= thr1) / len(marked_scores)
                if marked_scores and thr1 is not None else None),
            "tpr_at_fpr_5_percent": (
                sum(1 for s in marked_scores if s >= thr5) / len(marked_scores)
                if marked_scores and thr5 is not None else None),
            "watermarked_scores": watermarked,
        }
        entry = by_length[str(length)]
        print(f"len={length:4d} null {entry['null_mean']:.4f}+-{entry['null_sd']:.4f} "
              f"marked {entry['watermarked_mean']:.4f}+-{entry['watermarked_sd']:.4f} "
              f"thr@1%={thr1:.4f} TPR@1%={entry['tpr_at_fpr_1_percent']:.3f}", flush=True)

    payload = {
        "what": ("empirical detection data: matched unwatermarked and watermarked GPT-2 "
                 "corpora scored with the configured keys"),
        "implementation_provenance": "PINNED EMPIRICAL DATA",
        "how": (
            "unwatermarked continuations from the prompts listed in "
            "tools/capture_corpora.py, generated with the same decoding parameters as "
            "the pinned samples, scored by the reference implementation at each truncation "
            "length"
        ),
        "caveat": (
            "48 texts per class is enough to see the shape and to place a 5% threshold; a "
            "1% threshold estimated from 48 samples rests on the single highest of them, "
            "so it is reported with that limitation stated rather than presented as "
            "precise. A detection rate of 1.000 here means 48 of 48, which is not the same "
            "claim as a rate of 1."
        ),
        "watermark": params.as_dict(),
        "construction": cfg["construction"],
        "decoding": {k: v for k, v in dec.items() if not k.startswith("_")},
        "model": {
            "model_id": model_id,
            "model_revision": hub_revision(model_id),
        },
        "corpus_size": len(corpus),
        "watermarked_corpus_size": len(marked_corpus),
        # Both corpora travel with the summary. Without them the thresholds and detection
        # rates below would be numbers a reader has to take on trust; with them the page
        # can recompute every one of them in the browser, and so can anyone else.
        "corpus_token_ids": corpus,
        "watermarked_corpus_token_ids": marked_corpus,
        "prompts": PROMPTS,
        "seed": args.seed,
        "lengths": LENGTHS,
        "by_length": by_length,
        "provenance": provenance("capture_corpora.py"),
    }
    write_json(DATA_DIR / "null-corpus.json", payload)


def quantile(sorted_values: list[float], p: float) -> float | None:
    if not sorted_values:
        return None
    index = min(len(sorted_values) - 1, max(0, int(round(p * len(sorted_values))) - 1))
    return sorted_values[index]


if __name__ == "__main__":
    main()
