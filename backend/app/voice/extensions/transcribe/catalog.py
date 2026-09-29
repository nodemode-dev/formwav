"""Transcription (ASR) provider framework.

Defines the provider interface and the catalog of ASR models formwave can use
for reference-audio transcription, in priority order. Qwen3-ASR-0.6B is the
default — same model family as the TTS engine, small and fast — with the larger
Qwen and the Whisper models as ordered fallbacks.

Each provider isolates one upstream library/API (mirroring the TTS adapter
pattern) so swapping or adding an ASR backend is additive: drop a provider
module in `providers/`, list it in `ASR_CATALOG`, done. The engine core and the
rest of the app never change.
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field
from typing import Protocol

import numpy as np


# ── audio decode helper (shared by providers) ──────────────────────────────

def decode_to_mono16k(wav_bytes: bytes) -> tuple[np.ndarray, int]:
    """Decode arbitrary audio bytes to (mono float32 array, 16000)."""
    import soundfile as sf

    wav, sr = sf.read(io.BytesIO(wav_bytes), dtype="float32", always_2d=False)
    if getattr(wav, "ndim", 1) > 1:
        wav = wav.mean(axis=1)
    if sr != 16000:
        import torch
        import torchaudio

        t = torch.from_numpy(np.ascontiguousarray(wav)).unsqueeze(0)
        t = torchaudio.functional.resample(t, sr, 16000).squeeze(0)
        wav = t.numpy()
        sr = 16000
    return np.ascontiguousarray(wav, dtype=np.float32), sr


# ── provider interface ──────────────────────────────────────────────────────

class ASRProvider(Protocol):
    """One ASR backend. Lazy-loads its model on first transcribe()."""

    id: str

    def is_available(self) -> bool:
        """True if this provider's model folder + python deps are present."""
        ...

    def transcribe(self, wav_bytes: bytes) -> str:
        """Transcribe audio bytes to text. Raises if it cannot run."""
        ...


# ── catalog ──────────────────────────────────────────────────────────────────

# Backend kinds map to provider classes (see providers/).
KIND_QWEN_ASR = "qwen_asr"
KIND_WHISPER = "whisper"


@dataclass(frozen=True)
class ASRSpec:
    """Static description of one ASR model."""

    id: str                  # stable formwave id (also the selection value)
    name: str                # display name
    sub: str                 # one-line descriptor
    kind: str                # which provider class drives it
    folder: str              # local folder name under models_root
    hf_id: str = ""          # HF id (fallback if no local folder)
    aliases: tuple[str, ...] = field(default_factory=tuple)


# Priority order: first available provider becomes the active default.
ASR_CATALOG: tuple[ASRSpec, ...] = (
    ASRSpec(
        id="qwen3-asr-0.6b",
        name="Qwen3-ASR 0.6B",
        sub="Default - same family as the TTS, fast",
        kind=KIND_QWEN_ASR,
        folder="Qwen3-ASR-0.6B",
        hf_id="Qwen/Qwen3-ASR-0.6B",
    ),
    ASRSpec(
        id="qwen3-asr-1.7b",
        name="Qwen3-ASR 1.7B",
        sub="Higher accuracy, slower",
        kind=KIND_QWEN_ASR,
        folder="Qwen3-ASR-1.7B",
        hf_id="Qwen/Qwen3-ASR-1.7B",
    ),
    ASRSpec(
        id="whisper-large-v3-turbo",
        name="Whisper large-v3-turbo",
        sub="OpenAI multilingual fallback",
        kind=KIND_WHISPER,
        folder="whisper-large-v3-turbo",
        hf_id="openai/whisper-large-v3-turbo",
    ),
    ASRSpec(
        id="whisper-bemba-stt",
        name="Whisper Bemba STT",
        sub="Bemba-language fine-tune",
        kind=KIND_WHISPER,
        folder="whisper-bemba-stt",
        hf_id="AbelZimba/whisper-bemba-stt",
    ),
)


def list_asr_specs() -> list[ASRSpec]:
    return list(ASR_CATALOG)


def get_asr_spec(asr_id: str) -> ASRSpec | None:
    for spec in ASR_CATALOG:
        if spec.id == asr_id or asr_id in spec.aliases:
            return spec
    return None
