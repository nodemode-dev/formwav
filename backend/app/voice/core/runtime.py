"""Runtime environment setup.

Imported FIRST (before torch / qwen_tts / nano_parakeet) so the settings below
take effect before those libraries initialize. Two jobs:

1. Enable the PyTorch MPS CPU fallback so any op a model hits that Metal doesn't
   implement runs on CPU instead of crashing.

2. Suppress cosmetic third-party warnings that are noise on Apple Silicon:
   - The "flash-attn is not installed" notice. Standard flash-attn (Dao-AILab)
     is CUDA-only and cannot build on Apple Silicon (no nvcc), so SDPA is the
     correct attention path here — the warning is expected, not actionable.
   - The "`torch_dtype` is deprecated! Use `dtype` instead!" notice emitted from
     inside the upstream package. formwave itself passes `dtype`; this comes from
     upstream code we don't edit (SEDO), so we silence the deprecation rather
     than patch their source.

These are filtered narrowly by message/category so real warnings still show.
"""

from __future__ import annotations

import os
import warnings


def configure_runtime() -> None:
    # 1. MPS CPU fallback for unimplemented Metal ops.
    os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
    # Quieter tokenizers; avoids an unrelated fork-warning spam on some setups.
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

    # 2a. Silence the torch_dtype deprecation notice (emitted by upstream code).
    warnings.filterwarnings(
        "ignore",
        message=r".*torch_dtype.*deprecated.*",
        category=Warning,
    )
    # 2b. Silence flash-attn "not installed" UserWarnings (expected on macOS).
    warnings.filterwarnings(
        "ignore",
        message=r".*flash[-_ ]?attn.*",
        category=Warning,
    )


configure_runtime()
