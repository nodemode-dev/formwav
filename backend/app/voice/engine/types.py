"""Plain value types returned by the engine.

These are framework-free dataclasses so the engine has no dependency on FastAPI
or Pydantic. The API layer converts these into response models.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class DeviceInfo:
    """Resolved device / dtype report."""

    device: str                  # "mps" | "cuda" | "cpu"
    dtype: str                   # "float32" | "float16" | "bfloat16"
    attn_implementation: str     # "sdpa" | "flash_attention_2" | ...
    mps_available: bool
    cuda_available: bool

    def as_dict(self) -> dict:
        return {
            "device": self.device,
            "dtype": self.dtype,
            "attn_implementation": self.attn_implementation,
            "mps_available": self.mps_available,
            "cuda_available": self.cuda_available,
            # The CUDA-graph fast path only exists on NVIDIA hardware; surface
            # this so the UI can explain why timings differ from the HF Space.
            "cuda_graphs": False,
        }


@dataclass
class GenerationResult:
    """Non-streaming synthesis result."""

    audio: np.ndarray            # float32 mono PCM in [-1, 1]
    sample_rate: int
    elapsed_ms: float            # wall-clock generation time
    audio_duration_s: float

    @property
    def rtf(self) -> float:
        """Real-time factor: audio seconds produced per second of compute."""
        secs = self.elapsed_ms / 1000.0
        return self.audio_duration_s / secs if secs > 0 else 0.0


@dataclass
class AudioChunk:
    """One streamed audio chunk plus running metrics."""

    audio: np.ndarray            # float32 mono PCM in [-1, 1]
    sample_rate: int
    index: int                   # 0-based chunk number
    ttfa_ms: float               # time to first audio (set from first chunk)
    rtf: float                   # running real-time factor
    total_audio_s: float         # cumulative audio produced so far
    elapsed_ms: float            # wall-clock since request start
    extra: dict = field(default_factory=dict)
