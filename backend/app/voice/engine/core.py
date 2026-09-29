"""TTSEngine — the decoupled power engine.

Owns the model cache, the resolved device, and all generation. Has no
dependency on FastAPI; it can be driven from a test or a CLI. The API layer is
a thin caller over this.

Concurrency note: generation is single-flight on the GPU. The engine exposes a
`generation_lock` the caller holds around a generate call so concurrent
requests queue instead of racing for device memory. The engine does not block
internally — the caller decides the queueing policy — but it provides the lock
so policy lives in one place.
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from typing import Callable, Iterator

import numpy as np

from .adapter import QwenMPSAdapter
from .catalog import MODE_VOICE_CLONE, get_spec, list_known_models
from .config import EngineConfig, resolve_device
from .params import GenerationParams
from .types import AudioChunk, DeviceInfo, GenerationResult


class TTSEngine:
    """Headless TTS engine with an LRU model cache."""

    def __init__(self, config: EngineConfig | None = None):
        self.config = config or EngineConfig()
        self.device_info: DeviceInfo = resolve_device(self.config)
        self._cache: "OrderedDict[str, QwenMPSAdapter]" = OrderedDict()
        self._active_id: str | None = None
        self._loading: bool = False
        self._lock = threading.RLock()
        # Caller-facing single-flight lock for generation.
        self.generation_lock = threading.Lock()

    # ── introspection ────────────────────────────────────────────────────────

    @property
    def active_model_id(self) -> str | None:
        return self._active_id

    @property
    def is_loading(self) -> bool:
        return self._loading

    @property
    def loaded_ids(self) -> list[str]:
        return list(self._cache.keys())

    def available_models(self) -> list[dict]:
        """Catalog entries that have a local folder present under models_root.

        Falls back to the whole catalog if nothing is found on disk, so the UI
        still renders (the load call will then surface a clear error).
        """
        present = []
        for spec in list_known_models():
            folder = spec.id.split("/", 1)[-1]
            if (self.config.models_root / folder).exists():
                present.append(self._spec_dict(spec, on_disk=True))
        if present:
            return present
        return [self._spec_dict(s, on_disk=False) for s in list_known_models()]

    def supported_speakers(self) -> list[str]:
        with self._lock:
            adapter = self._cache.get(self._active_id) if self._active_id else None
        return adapter.supported_speakers() if adapter else []

    def status(self) -> dict:
        adapter = self._cache.get(self._active_id) if self._active_id else None
        spec = get_spec(self._active_id) if self._active_id else None
        return {
            "loaded": adapter is not None,
            "model": self._active_id,
            "loading": self._loading,
            "available_models": [m["id"] for m in self.available_models()],
            "model_modes": list(spec.modes) if spec else [],
            "speakers": self.supported_speakers(),
            "cached_models": self.loaded_ids,
            "sample_rate": adapter.sample_rate if adapter else None,
            "device": self.device_info.as_dict(),
            "device_report": adapter.device_report() if adapter else None,
        }

    @staticmethod
    def _spec_dict(spec, on_disk: bool) -> dict:
        return {
            "id": spec.id,
            "name": spec.name,
            "sub": spec.sub,
            "modes": list(spec.modes),
            "params": spec.params,
            "on_disk": on_disk,
        }

    # ── model loading ─────────────────────────────────────────────────────────

    def load(self, model_id: str) -> str:
        """Load (or activate) a checkpoint. Returns a short status string.

        Thread-safe and idempotent. Evicts the LRU model when the cache is full.
        """
        with self._lock:
            if model_id in self._cache:
                self._active_id = model_id
                self._cache.move_to_end(model_id)
                return "already_loaded"

            if get_spec(model_id) is None:
                raise ValueError(f"Unknown model id: {model_id}")

            self._loading = True

        try:
            adapter = QwenMPSAdapter(self.config, self.device_info)
            adapter.load(model_id)
            with self._lock:
                while len(self._cache) >= max(1, self.config.model_cache_size):
                    evicted_id, evicted = self._cache.popitem(last=False)
                    evicted.unload()
                self._cache[model_id] = adapter
                self._cache.move_to_end(model_id)
                self._active_id = model_id
            return "loaded"
        finally:
            with self._lock:
                self._loading = False

    def _active_adapter(self) -> QwenMPSAdapter:
        with self._lock:
            adapter = self._cache.get(self._active_id) if self._active_id else None
        if adapter is None:
            raise RuntimeError("No model loaded. Load a model first.")
        return adapter

    # ── generation ──────────────────────────────────────────────────────────

    def generate(self, params: GenerationParams) -> GenerationResult:
        """Non-streaming synthesis."""
        self._validate(params)
        adapter = self._active_adapter()
        params.non_streaming_mode = params.resolved_non_streaming()

        t0 = time.perf_counter()
        audio, sr = adapter.generate(params)
        elapsed_ms = (time.perf_counter() - t0) * 1000.0
        dur = len(audio) / sr if sr else 0.0
        return GenerationResult(
            audio=audio,
            sample_rate=sr,
            elapsed_ms=elapsed_ms,
            audio_duration_s=dur,
        )

    def generate_streaming(
        self, params: GenerationParams
    ) -> Iterator[AudioChunk]:
        """Streaming synthesis yielding AudioChunk with running metrics."""
        self._validate(params)
        adapter = self._active_adapter()
        params.non_streaming_mode = params.resolved_non_streaming()

        t0 = time.perf_counter()
        total_audio_s = 0.0
        ttfa_ms = 0.0
        idx = 0

        for audio, sr in adapter.generate_streaming(params):
            now_ms = (time.perf_counter() - t0) * 1000.0
            if idx == 0:
                ttfa_ms = now_ms
            dur = len(audio) / sr if sr else 0.0
            total_audio_s += dur
            secs = now_ms / 1000.0
            rtf = total_audio_s / secs if secs > 0 else 0.0
            yield AudioChunk(
                audio=audio,
                sample_rate=sr,
                index=idx,
                ttfa_ms=ttfa_ms,
                rtf=rtf,
                total_audio_s=total_audio_s,
                elapsed_ms=now_ms,
            )
            idx += 1

    # ── validation ────────────────────────────────────────────────────────────

    def _validate(self, params: GenerationParams) -> None:
        if not params.text or not params.text.strip():
            raise ValueError("Text is empty.")
        if len(params.text) > self.config.max_text_chars:
            raise ValueError(
                f"Text too long ({len(params.text)} chars). "
                f"Maximum is {self.config.max_text_chars}."
            )
        spec = get_spec(self._active_id) if self._active_id else None
        if spec and params.mode not in spec.modes:
            raise ValueError(
                f"Active model '{spec.name}' does not support mode "
                f"'{params.mode}'. It supports: {', '.join(spec.modes)}."
            )

        # Voice-clone specific guards.
        if params.mode == MODE_VOICE_CLONE:
            if not params.ref_audio_path:
                raise ValueError(
                    "Voice clone needs a reference clip. Upload or record audio first."
                )
            # Advanced (ICL) clone uses xvec_only=False, which the upstream model
            # requires a transcript (ref_text) for. If the transcript is empty,
            # transparently fall back to the xvec-only path instead of erroring,
            # so an empty Advanced transcript still produces audio.
            if not params.xvec_only and not (params.ref_text or "").strip():
                params.xvec_only = True
