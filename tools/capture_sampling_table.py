"""Pin the SynthID-Text sampling table.

The reference implementation builds its g-value sampling table with a torch RNG:

    generator = torch.Generator(device=device).manual_seed(sampling_table_seed)
    self.sampling_table = torch.randint(low=0, high=2, size=(sampling_table_size,),
                                        generator=generator, device=device)

A browser cannot reproduce torch's RNG, so the table itself is captured here and
committed as pinned data. Everything else about the g-function -- the linear
congruential hash, the key mixing, the modulo indexing -- is recomputed in the browser.

Re-running this script with the same torch version must reproduce the same sha256.
"""

from __future__ import annotations

import base64
import hashlib
import sys

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))

from synthid_ref import DATA_DIR, load_config, provenance, write_json  # noqa: E402


def main() -> None:
    import torch

    cfg = load_config()
    w = cfg["watermark"]
    size, seed = w["sampling_table_size"], w["sampling_table_seed"]

    generator = torch.Generator(device="cpu").manual_seed(seed)
    table = torch.randint(low=0, high=2, size=(size,), generator=generator, device="cpu")

    bits = bytes(bytearray(table.numpy().astype("uint8")))
    packed = bytearray((size + 7) // 8)
    for i, b in enumerate(bits):
        if b:
            packed[i >> 3] |= 1 << (i & 7)

    payload = {
        "what": "SynthID-Text g-value sampling table, captured from the reference implementation",
        "implementation_provenance": "REFERENCE-IMPLEMENTATION-FAITHFUL",
        "size": size,
        "seed": seed,
        "generator": "torch.Generator(device='cpu').manual_seed(seed); torch.randint(0, 2, (size,))",
        "ones": int(table.sum()),
        "sha256_of_bytes": hashlib.sha256(bits).hexdigest(),
        "packing": "little-endian bit packing: bit i of byte i>>3 is table[i]",
        "sha256_of_packed": hashlib.sha256(bytes(packed)).hexdigest(),
        "packed_base64": base64.b64encode(bytes(packed)).decode("ascii"),
        "provenance": provenance("capture_sampling_table.py"),
    }
    write_json(DATA_DIR / "sampling-table.json", payload)
    print(f"ones={payload['ones']}/{size}  sha256(bytes)={payload['sha256_of_bytes']}")


if __name__ == "__main__":
    main()
