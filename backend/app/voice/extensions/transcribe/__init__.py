"""Extension: reference-audio transcription (multi-backend).

id: transcribe
Contributes: a TranscriptionManager (registered via
ctx.set_transcription_manager) holding multiple ASR providers — Qwen3-ASR-0.6B
(default), Qwen3-ASR-1.7B, Whisper large-v3-turbo, and Whisper Bemba — selected
by local-folder + dependency availability, in priority order. The /transcribe
and /asr routes use it.

Replaces the earlier single-model parakeet transcriber. Adding another ASR
backend = a provider in providers/ + a row in catalog.py; nothing else changes.
"""

from __future__ import annotations

from ..registry import Extension, ExtensionContext, register
from .manager import TranscriptionManager


def _setup(ctx: ExtensionContext) -> None:
    manager = TranscriptionManager(ctx.engine)
    ctx.set_transcription_manager(manager)


register(
    Extension(
        id="transcribe",
        setup=_setup,
        description="Multi-backend ASR (Qwen3-ASR default; Whisper fallbacks).",
    )
)
