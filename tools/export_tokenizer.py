"""Export the GPT-2 byte-level BPE vocabulary and merge list for the browser.

The detector needs to tokenize arbitrary pasted text, so the tokenizer has to run in
the browser. It is a reimplementation, and a reimplementation is only worth what its
differential test proves -- tools/make_test_vectors.py pins encode() vectors produced
by the Hugging Face tokenizer at the revision recorded here, and the unit suite makes
the browser tokenizer reproduce them.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from synthid_ref import DATA_DIR, hub_revision, load_config, provenance, sha256_text, write_json  # noqa: E402


def main() -> None:
    from transformers import AutoTokenizer

    cfg = load_config()
    model_id = cfg["model"]["tokenizer_id"]
    tok = AutoTokenizer.from_pretrained(model_id)

    vocab = tok.get_vocab()  # token string -> id
    size = max(vocab.values()) + 1
    by_id: list[str | None] = [None] * size
    for token, idx in vocab.items():
        by_id[idx] = token
    missing = [i for i, t in enumerate(by_id) if t is None]
    if missing:
        raise SystemExit(f"vocabulary has holes at ids {missing[:8]}...")

    # The merge list, in rank order, straight from the tokenizer's own files.
    files = tok.save_pretrained(str(Path(DATA_DIR) / "_tokenizer_tmp"))
    merges_path = next((Path(f) for f in files if f.endswith("merges.txt")), None)
    if merges_path is None:
        # Fast tokenizers serialize merges inside tokenizer.json instead.
        tj = next(Path(f) for f in files if f.endswith("tokenizer.json"))
        with open(tj, encoding="utf-8") as fh:
            merges = json.load(fh)["model"]["merges"]
        merges = [" ".join(m) if isinstance(m, list) else m for m in merges]
    else:
        with open(merges_path, encoding="utf-8") as fh:
            lines = fh.read().split("\n")
        merges = [ln for ln in lines if ln and not ln.startswith("#version")]

    vocab_blob = "\n".join(by_id)
    merges_blob = "\n".join(merges)

    payload = {
        "what": "GPT-2 byte-level BPE vocabulary and merge ranks",
        "tokenizer_id": model_id,
        "tokenizer_revision": hub_revision(model_id),
        "vocab_size": size,
        "merge_count": len(merges),
        "vocab_sha256": sha256_text(vocab_blob),
        "merges_sha256": sha256_text(merges_blob),
        "note": (
            "vocab is newline-joined token strings in id order; a token containing a "
            "newline would corrupt this encoding, so the export asserts none does"
        ),
        "provenance": provenance("export_tokenizer.py"),
    }
    if any("\n" in t for t in by_id):
        raise SystemExit("a vocabulary entry contains a newline; the flat encoding is unsafe")

    write_json(DATA_DIR / "tokenizer-meta.json", payload)
    (DATA_DIR / "gpt2-vocab.txt").write_text(vocab_blob, encoding="utf-8")
    (DATA_DIR / "gpt2-merges.txt").write_text(merges_blob, encoding="utf-8")
    print(f"vocab {size} entries, {len(merges)} merges")

    import shutil
    shutil.rmtree(Path(DATA_DIR) / "_tokenizer_tmp", ignore_errors=True)


if __name__ == "__main__":
    main()
