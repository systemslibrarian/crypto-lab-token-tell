"""Shared helpers for the offline capture scripts.

Every number this lab ships is produced by one of the scripts in this directory and
committed together with the provenance block built here. Nothing in the browser is
allowed to invent a distribution, a score or a transformation.

The watermarking itself is NOT reimplemented here: generation calls the reference
implementation shipped in `transformers`
(`transformers.generation.logits_process.SynthIDTextWatermarkLogitsProcessor`), so the
committed watermarked text is the reference implementation's output, not ours.
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
import subprocess
import sys
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "src" / "data" / "pinned"
TOOLS_DIR = REPO_ROOT / "tools"

# ---------------------------------------------------------------------------
# Watermark configuration
# ---------------------------------------------------------------------------
# These keys are PUBLISHED. They are demo keys and nothing about them is secret.
# A real deployment keeps the watermark configuration secret; a published key means
# the mark can be replicated by anyone, or removed.
CONFIG_PATH = REPO_ROOT / "src" / "data" / "watermark-config.json"


def load_config() -> dict[str, Any]:
    with open(CONFIG_PATH, encoding="utf-8") as fh:
        return json.load(fh)


# ---------------------------------------------------------------------------
# Provenance
# ---------------------------------------------------------------------------
def sha256_file(path: str | os.PathLike) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_json(obj: Any) -> str:
    return sha256_text(json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False))


def git_commit() -> str:
    try:
        out = subprocess.run(
            ["git", "-C", str(REPO_ROOT), "rev-parse", "HEAD"],
            capture_output=True, text=True, check=True,
        )
        return out.stdout.strip()
    except Exception:
        return "unknown"


def hub_revision(repo_id: str) -> str:
    """The exact commit sha of a Hugging Face repo, so a capture is re-runnable."""
    try:
        from huggingface_hub import model_info
        return model_info(repo_id).sha
    except Exception as exc:  # network-free re-runs still produce a record
        return f"unresolved: {exc}"


SYNTHID_TEXT_COMMIT = "addb4a158143c7c6851a1308f78b89fceed59683"


def library_versions() -> dict[str, str]:
    import torch
    import transformers
    versions = {
        "python": platform.python_version(),
        "torch": torch.__version__,
        "transformers": transformers.__version__,
    }
    try:
        import importlib.metadata as md
        versions["synthid-text"] = md.version("synthid-text")
        versions["synthid-text_commit"] = SYNTHID_TEXT_COMMIT
    except Exception:
        pass
    return versions


def provenance(script: str, **extra: Any) -> dict[str, Any]:
    script_path = TOOLS_DIR / script
    return {
        "capture_script": f"tools/{script}",
        "capture_script_sha256": sha256_file(script_path),
        "capture_repo_commit": git_commit(),
        "capture_timestamp_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "libraries": library_versions(),
        **extra,
    }


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1, ensure_ascii=False, sort_keys=False)
        fh.write("\n")
    print(f"wrote {path.relative_to(REPO_ROOT)}  ({path.stat().st_size} bytes)")


# ---------------------------------------------------------------------------
# Reference watermark plumbing
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class WatermarkParams:
    ngram_len: int
    keys: list[int]
    context_history_size: int
    num_leaves: int
    skip_first_ngram_calls: bool

    @staticmethod
    def from_config(cfg: dict[str, Any]) -> "WatermarkParams":
        w = cfg["watermark"]
        return WatermarkParams(
            ngram_len=w["ngram_len"],
            keys=list(w["keys"]),
            context_history_size=w["context_history_size"],
            num_leaves=w["num_leaves"],
            skip_first_ngram_calls=w["skip_first_ngram_calls"],
        )

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def make_processor(params: WatermarkParams, cfg: dict[str, Any],
                   keys: list[int] | None = None):
    """The official reference logits processor.

    google-deepmind/synthid-text @ addb4a1. Used for BOTH generation and offline
    scoring, so the pinned watermarked text is the reference implementation's output
    and the pinned reference scores are the reference implementation's numbers.
    """
    import torch
    from synthid_text import logits_processing
    dec = cfg["decoding"]
    return logits_processing.SynthIDLogitsProcessor(
        ngram_len=params.ngram_len,
        keys=list(keys if keys is not None else params.keys),
        context_history_size=params.context_history_size,
        temperature=float(dec["temperature"]),
        top_k=int(dec["top_k"]),
        device=torch.device("cpu"),
        skip_first_ngram_calls=params.skip_first_ngram_calls,
        num_leaves=params.num_leaves,
    )


GPT2_EOS_TOKEN_ID = 50256


def mean_g_score(processor, token_ids: list[int],
                 eos_token_id: int | None = GPT2_EOS_TOKEN_ID) -> dict[str, Any]:
    """Mean g-value over unmasked positions, computed by the reference implementation.

    Masking follows the reference detector (`SynthIDTextWatermarkDetector.__call__`),
    which combines the repeated-context mask with the end-of-text mask sliced by
    ngram_len - 1. Dropping the end-of-text half would score tokens the generator emitted
    after it had already stopped.

    Returns the score plus the position bookkeeping the page has to display: a score
    without its scored-position count is not interpretable.
    """
    import torch

    ids = torch.tensor([token_ids], dtype=torch.long)
    depth = len(processor.keys)  # depth is defined as the number of keys
    if ids.shape[1] < processor.ngram_len:
        return {
            "score": None, "g_sum": 0, "scored_positions": 0, "candidate_positions": 0,
            "masked_positions": 0, "depth": depth, "token_count": ids.shape[1],
        }
    g = processor.compute_g_values(input_ids=ids).long()            # [1, T-(n-1), depth]
    mask = processor.compute_context_repetition_mask(input_ids=ids)  # [1, T-(n-1)]
    if eos_token_id is not None:
        eos = processor.compute_eos_token_mask(
            input_ids=ids, eos_token_id=eos_token_id)[:, processor.ngram_len - 1:]
        mask = mask * eos.bool()
    kept = int(mask.sum())
    candidates = int(mask.shape[1])
    # Summed as integers, divided once. Accumulating in float32 -- which is what the
    # tensors default to -- loses the last few digits, and the browser then cannot be
    # held to the reference value at full double precision.
    g_sum = int((g * mask.unsqueeze(-1).long()).sum())
    score = None if kept == 0 else g_sum / (kept * depth)
    return {
        "score": score,
        "g_sum": g_sum,
        "scored_positions": kept,
        "candidate_positions": candidates,
        "masked_positions": candidates - kept,
        "depth": depth,
        "token_count": int(ids.shape[1]),
    }
