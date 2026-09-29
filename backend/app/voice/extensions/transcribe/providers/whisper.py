"""Whisper provider.

Wraps the standard transformers ASR pipeline, which both
`openai/whisper-large-v3-turbo` and the `whisper-bemba-stt` fine-tune use
identically:

    from transformers import pipeline
    pipe = pipeline("automatic-speech-recognition", model=path,
                    torch_dtype=..., device="mps")
    result = pipe(np_array)            # accepts a numpy array directly
    text = result["text"]

On Apple Silicon Whisper runs fine on MPS in fp16; we fall back to fp32 on CPU.

── UPSTREAM CALL SITE ── all transformers/pipeline calls are isolated here.
"""

from __future__ import annotations

import importlib
import threading

from ....engine.config import quiet_output, torch_dtype_for
from ..catalog import ASRSpec, decode_to_mono16k


class WhisperProvider:
    def __init__(self, spec: ASRSpec, engine):
        self.id = spec.id
        self._spec = spec
        self._engine = engine
        self._pipe = None
        self._lock = threading.Lock()

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
        return importlib.util.find_spec("transformers") is not None

    def _device_dtype(self):
        import os

        try:
            dev = self._engine.device_info.device
        except Exception:
            dev = "cpu"
        dev = os.environ.get("FORMWAV_TRANSCRIBE_DEVICE", dev)
        # Whisper is stable in fp16 on MPS; fp32 on CPU.
        dtype = "float16" if dev in ("mps", "cuda") else "float32"
        return dev, dtype

    def _ensure_loaded(self):
        if self._pipe is not None:
            return
        with self._lock:
            if self._pipe is not None:
                return
            self._pipe = self._load()

    def _load(self):
        transformers = importlib.import_module("transformers")
        pipeline = getattr(transformers, "pipeline")

        path = str(self._local_path() or self._spec.hf_id)
        dev, dtype_name = self._device_dtype()
        torch_dtype = torch_dtype_for(dtype_name)

        with quiet_output():
            return pipeline(
                "automatic-speech-recognition",
                model=path,
                torch_dtype=torch_dtype,
                device=dev,
            )

    def transcribe(self, wav_bytes: bytes) -> str:
        self._ensure_loaded()
        wav, _sr = decode_to_mono16k(wav_bytes)
        with quiet_output():
            # 16 kHz mono float32 array; chunk long audio so >30s clips work.
            result = self._pipe(wav, chunk_length_s=30, return_timestamps=False)
        if isinstance(result, dict):
            return (result.get("text") or "").strip()
        if isinstance(result, str):
            return result.strip()
        return str(result).strip()
