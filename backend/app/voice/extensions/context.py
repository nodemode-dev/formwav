"""Concrete ExtensionContext the app builds at startup.

Holds the registries that extensions contribute into (audio postprocessors,
export formats) and exposes them to the rest of the app (e.g. the export
helper, the generate routes). This is the single object passed to
`activate_all`.
"""

from __future__ import annotations

from typing import Callable

import numpy as np


class AppExtensionContext:
    """Live context handed to every extension's setup()."""

    def __init__(self, engine):
        self.engine = engine
        self._postprocessors: list[Callable[[np.ndarray], np.ndarray]] = []
        self._export_formats: dict[str, Callable[..., bytes]] = {}
        # Optional transcription manager (set by the transcribe extension).
        self._transcription = None

    # ── hooks extensions call ───────────────────────────────────────────────

    def add_audio_postprocessor(
        self, fn: Callable[[np.ndarray], np.ndarray]
    ) -> None:
        """Register a function applied to final audio before it is returned."""
        self._postprocessors.append(fn)

    def add_export_format(self, name: str, fn: Callable[..., bytes]) -> None:
        """Register an audio export encoder under a format name (e.g. 'mp3')."""
        self._export_formats[name.lower()] = fn

    def set_transcription_manager(self, manager) -> None:
        """Register the transcription manager (holds the ASR providers)."""
        self._transcription = manager

    # ── accessors used by the app ───────────────────────────────────────────

    def apply_postprocessors(self, audio: np.ndarray) -> np.ndarray:
        for fn in self._postprocessors:
            audio = fn(audio)
        return audio

    def export_formats(self) -> list[str]:
        return sorted(self._export_formats.keys())

    def encode(self, name: str, audio: np.ndarray, sample_rate: int) -> bytes:
        fn = self._export_formats.get(name.lower())
        if fn is None:
            raise ValueError(f"No exporter registered for format: {name}")
        return fn(audio=audio, sample_rate=sample_rate)

    def has_transcriber(self) -> bool:
        return self._transcription is not None and self._transcription.has_any()

    def transcribe(self, wav_bytes: bytes) -> str:
        if self._transcription is None or not self._transcription.has_any():
            raise RuntimeError("No transcriber registered.")
        return self._transcription.transcribe(wav_bytes)

    @property
    def transcription(self):
        """The transcription manager, or None if the extension isn't active."""
        return self._transcription
