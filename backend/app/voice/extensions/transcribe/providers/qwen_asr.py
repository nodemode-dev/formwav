"""Qwen3-ASR provider.

Wraps the upstream `qwen_asr.Qwen3ASRModel` (the ASR sibling of the Qwen3-TTS
model). API mirrors the TTS one:

    from qwen_asr import Qwen3ASRModel
    m = Qwen3ASRModel.from_pretrained(path, dtype=..., device_map=..., max_new_tokens=...)
    results = m.transcribe(audio=(np_array, sr), language=None)
    text = results[0].text

Configured for Apple Silicon: device_map="mps" (or CPU), SDPA attention (no
flash-attn on macOS). Loaded lazily on first use so app startup stays fast.

── UPSTREAM CALL SITE ── all qwen_asr calls are isolated here.
"""

from __future__ import annotations

import importlib
import threading

from ....engine.config import quiet_output, torch_dtype_for
from ..catalog import ASRSpec, decode_to_mono16k


class QwenASRProvider:
    def __init__(self, spec: ASRSpec, engine):
        self.id = spec.id
        self._spec = spec
        self._engine = engine
        self._model = None
        self._lock = threading.Lock()

    # ── availability ─────────────────────────────────────────────────────────

    def _local_path(self):
        try:
            root = self._engine.config.models_root
        except Exception:
            return None
        p = root / self._spec.folder
        return p if p.exists() else None

    def is_available(self) -> bool:
        if self._local_path() is None:
            return False
        return importlib.util.find_spec("qwen_asr") is not None

    # ── device/dtype (reuse engine resolution; ASR can run fp32 on MPS) ───────

    def _device_dtype(self):
        import os

        try:
            dev = self._engine.device_info.device
        except Exception:
            dev = "cpu"
        dev = os.environ.get("FORMWAV_TRANSCRIBE_DEVICE", dev)
        # fp32 on MPS for the same numerical-safety reason as the TTS side;
        # bf16 on CUDA; fp32 on CPU.
        if dev == "mps":
            dtype = "float32"
        elif dev == "cuda":
            dtype = "bfloat16"
        else:
            dtype = "float32"
        return dev, dtype

    # ── load ───────────────────────────────────────────────────────────────

    def _ensure_loaded(self):
        if self._model is not None:
            return
        with self._lock:
            if self._model is not None:
                return
            self._model = self._load()

    def _load(self):
        qwen_asr = importlib.import_module("qwen_asr")
        model_cls = getattr(qwen_asr, "Qwen3ASRModel", None)
        if model_cls is None:
            raise RuntimeError("qwen_asr.Qwen3ASRModel not found.")

        path = str(self._local_path() or self._spec.hf_id)
        dev, dtype_name = self._device_dtype()
        torch_dtype = torch_dtype_for(dtype_name)

        kwargs = dict(
            dtype=torch_dtype,
            device_map=dev,
            attn_implementation="sdpa",
            max_new_tokens=256,
        )
        with quiet_output():
            try:
                return model_cls.from_pretrained(path, **kwargs)
            except TypeError:
                # Older/newer signature variants: try torch_dtype, drop unknowns.
                for drop in ("attn_implementation", "max_new_tokens"):
                    kwargs.pop(drop, None)
                kwargs.pop("dtype", None)
                kwargs["torch_dtype"] = torch_dtype
                return model_cls.from_pretrained(path, **kwargs)

    # ── transcribe ────────────────────────────────────────────────────────────

    def transcribe(self, wav_bytes: bytes) -> str:
        self._ensure_loaded()
        wav, sr = decode_to_mono16k(wav_bytes)
        with quiet_output():
            # Pass audio as an (ndarray, sr) tuple per the qwen_asr API.
            results = self._model.transcribe(audio=(wav, sr), language=None)
        return _extract_text(results)


def _extract_text(results) -> str:
    """Pull text out of qwen_asr results (list of objects with .text)."""
    if results is None:
        return ""
    if isinstance(results, str):
        return results.strip()
    if isinstance(results, (list, tuple)) and results:
        first = results[0]
        text = getattr(first, "text", None)
        if isinstance(text, str):
            return text.strip()
        if isinstance(first, str):
            return first.strip()
    text = getattr(results, "text", None)
    if isinstance(text, str):
        return text.strip()
    return str(results).strip()
