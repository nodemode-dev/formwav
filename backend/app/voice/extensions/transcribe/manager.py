"""Transcription manager.

Holds the ASR providers (built from the catalog), reports which are available
(model folder present + deps importable), tracks the active selection, and
routes transcribe() to it. Default = first available in catalog priority order
(Qwen3-ASR-0.6B unless its folder is missing).

The manager is what the /transcribe and /asr routes talk to. Providers are
lazy: constructing the manager does NOT load any model; the active provider
loads its model on the first transcription.
"""

from __future__ import annotations

import threading

from .catalog import (
    KIND_QWEN_ASR,
    KIND_WHISPER,
    list_asr_specs,
)
from .providers import QwenASRProvider, WhisperProvider


def _build_provider(spec, engine):
    if spec.kind == KIND_QWEN_ASR:
        return QwenASRProvider(spec, engine)
    if spec.kind == KIND_WHISPER:
        return WhisperProvider(spec, engine)
    raise ValueError(f"Unknown ASR kind: {spec.kind}")


class TranscriptionManager:
    def __init__(self, engine):
        self._engine = engine
        self._specs = list_asr_specs()
        self._providers = {s.id: _build_provider(s, engine) for s in self._specs}
        self._active_id: str | None = None
        self._lock = threading.Lock()
        # Pick the first available provider as the default.
        for s in self._specs:
            if self._providers[s.id].is_available():
                self._active_id = s.id
                break

    # ── introspection ────────────────────────────────────────────────────────

    def available_ids(self) -> list[str]:
        return [s.id for s in self._specs if self._providers[s.id].is_available()]

    def list_models(self) -> list[dict]:
        out = []
        for s in self._specs:
            out.append({
                "id": s.id,
                "name": s.name,
                "sub": s.sub,
                "available": self._providers[s.id].is_available(),
                "active": s.id == self._active_id,
            })
        return out

    @property
    def active_id(self) -> str | None:
        return self._active_id

    def has_any(self) -> bool:
        return self._active_id is not None

    # ── selection ────────────────────────────────────────────────────────────

    def set_active(self, asr_id: str) -> None:
        with self._lock:
            prov = self._providers.get(asr_id)
            if prov is None:
                raise ValueError(f"Unknown ASR model: {asr_id}")
            if not prov.is_available():
                raise ValueError(
                    f"ASR model '{asr_id}' is not available "
                    f"(missing local folder or dependency)."
                )
            self._active_id = asr_id

    # ── transcription with fallback ──────────────────────────────────────────

    def transcribe(self, wav_bytes: bytes) -> str:
        """Transcribe with the active provider; fall back through the catalog.

        If the active provider raises (e.g. a runtime/device error), try the
        remaining available providers in priority order so a single broken
        backend doesn't take transcription down entirely. The first success
        wins and becomes a one-shot result (active selection is unchanged).
        """
        if self._active_id is None:
            raise RuntimeError("No ASR backend available.")

        order = [self._active_id] + [
            s.id for s in self._specs if s.id != self._active_id
        ]
        errors = []
        for asr_id in order:
            prov = self._providers.get(asr_id)
            if prov is None or not prov.is_available():
                continue
            try:
                return prov.transcribe(wav_bytes)
            except Exception as e:
                errors.append(f"{asr_id}: {e}")
                continue
        raise RuntimeError(
            "All available ASR backends failed:\n" + "\n".join(errors)
        )
