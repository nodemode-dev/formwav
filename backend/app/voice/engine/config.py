"""Engine configuration and device/dtype resolution.

Kept import-light: torch is imported lazily inside resolve_device() so the
catalog and types can be imported (e.g. by tests or the API schema layer)
without pulling in the whole ML stack.
"""

from __future__ import annotations

import contextlib
import io
import os
import sys
from dataclasses import dataclass
from pathlib import Path

from .types import DeviceInfo


@contextlib.contextmanager
def quiet_output(enabled: bool = True):
    """Buffer stdout/stderr during a noisy block; replay only if it raises.

    Upstream libraries (Qwen3-TTS, parakeet) print cosmetic banners at load
    time — e.g. the "flash-attn is not installed" notice, which is expected on
    Apple Silicon where flash-attn cannot build. This swallows that noise but
    re-emits everything if the wrapped block throws, so real load failures are
    never hidden.
    """
    if not enabled:
        yield
        return
    buf_out, buf_err = io.StringIO(), io.StringIO()
    old_out, old_err = sys.stdout, sys.stderr
    try:
        sys.stdout, sys.stderr = buf_out, buf_err
        yield
    except BaseException:
        sys.stdout, sys.stderr = old_out, old_err
        # Replay captured output so diagnostics survive on failure.
        sys.stdout.write(buf_out.getvalue())
        sys.stderr.write(buf_err.getvalue())
        raise
    finally:
        sys.stdout, sys.stderr = old_out, old_err


# Default location for downloaded checkpoints: backend/models/.
# engine/ -> app/ -> backend/, then /models.
_DEFAULT_MODELS_ROOT = Path(__file__).resolve().parents[3] / "models"  # formwav: app/voice/engine, one level deeper than formwave


@dataclass
class EngineConfig:
    """Construction-time configuration for the TTS engine.

    Attributes:
        models_root: directory holding the downloaded checkpoint folders.
        device: "auto" | "mps" | "cpu" | "cuda". "auto" prefers MPS on Apple
            Silicon, then CUDA, then CPU.
        dtype: "auto" | "float32" | "float16" | "bfloat16". "auto" picks a
            sensible default for the resolved device (float16 on MPS, bfloat16
            on CUDA, float32 on CPU).
        attn_implementation: attention kernel. "sdpa" is required on MPS
            (FlashAttention is unavailable on Apple Silicon).
        model_cache_size: how many loaded checkpoints to keep resident.
        max_text_chars: input length guard.
        max_audio_bytes: reference-audio upload size guard.
    """

    models_root: Path = _DEFAULT_MODELS_ROOT
    device: str = "auto"
    dtype: str = "auto"
    attn_implementation: str = "sdpa"
    model_cache_size: int = 2
    max_text_chars: int = 4000
    max_audio_bytes: int = 25 * 1024 * 1024

    @classmethod
    def from_env(cls) -> "EngineConfig":
        """Build config from environment variables (all optional)."""
        root = os.environ.get("FORMWAV_MODELS_ROOT")
        return cls(
            models_root=Path(root).expanduser() if root else _DEFAULT_MODELS_ROOT,
            device=os.environ.get("FORMWAV_DEVICE", "auto"),
            dtype=os.environ.get("FORMWAV_DTYPE", "auto"),
            attn_implementation=os.environ.get("FORMWAV_ATTN", "sdpa"),
            model_cache_size=int(os.environ.get("FORMWAV_MODEL_CACHE_SIZE", "2")),
            max_text_chars=int(os.environ.get("FORMWAV_MAX_TEXT_CHARS", "4000")),
            max_audio_bytes=int(
                os.environ.get("FORMWAV_MAX_AUDIO_BYTES", str(25 * 1024 * 1024))
            ),
        )


def resolve_device(cfg: EngineConfig) -> DeviceInfo:
    """Resolve the configured device/dtype to concrete torch values.

    Returns a DeviceInfo describing what will actually be used. torch is
    imported here, lazily, so this module stays cheap to import.
    """
    import torch

    requested = cfg.device.lower()
    has_mps = bool(getattr(torch.backends, "mps", None)) and torch.backends.mps.is_available()
    has_cuda = torch.cuda.is_available()

    if requested == "auto":
        device = "mps" if has_mps else ("cuda" if has_cuda else "cpu")
    elif requested == "mps":
        device = "mps" if has_mps else "cpu"
    elif requested == "cuda":
        device = "cuda" if has_cuda else "cpu"
    else:
        device = "cpu"

    # dtype selection
    requested_dtype = cfg.dtype.lower()
    if requested_dtype == "auto":
        if device == "mps":
            # float32 on MPS. fp16 on Metal is known to produce inf/nan in the
            # sampling step ("probability tensor contains inf/nan") for these
            # autoregressive models (PyTorch MPS fp16 numerics, issue #84364).
            # fp32 is correct and comfortably fits the 0.6B-1.7B models in 24 GB.
            # Users who want to experiment can still force FORMWAV_DTYPE=float16.
            dtype_name = "float32"
        elif device == "cuda":
            dtype_name = "bfloat16"
        else:
            dtype_name = "float32"
    else:
        dtype_name = requested_dtype

    # CPU can't do fp16 math meaningfully; force fp32 there for correctness.
    if device == "cpu" and dtype_name in ("float16", "bfloat16"):
        dtype_name = "float32"

    return DeviceInfo(
        device=device,
        dtype=dtype_name,
        attn_implementation=cfg.attn_implementation,
        mps_available=has_mps,
        cuda_available=has_cuda,
    )


def torch_dtype_for(dtype_name: str):
    """Map a dtype name to a torch dtype object (lazy torch import)."""
    import torch

    return {
        "float32": torch.float32,
        "float16": torch.float16,
        "bfloat16": torch.bfloat16,
    }.get(dtype_name, torch.float32)


def synchronize(device: str) -> None:
    """Device-appropriate synchronize. Safe no-op on CPU.

    On Apple Silicon this must be torch.mps.synchronize() — calling
    torch.cuda.synchronize() (as CUDA-only forks do) crashes on Metal.
    """
    import torch

    if device == "mps" and getattr(torch, "mps", None) is not None:
        torch.mps.synchronize()
    elif device == "cuda":
        torch.cuda.synchronize()
