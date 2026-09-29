"""Extension: audio export formats.

id: audio-export
Contributes: WAV, FLAC, and (if the system encoder is available) MP3 export
encoders, registered under the context's export-format hook. The /export route
uses whatever formats are registered here.

This is a model for how features drop in: it imports nothing from the engine
internals, only the registry types, and registers itself.
"""

from __future__ import annotations

import io

import numpy as np
import soundfile as sf

from ..registry import Extension, ExtensionContext, register


def _ensure_int16(audio: np.ndarray) -> np.ndarray:
    a = np.asarray(audio, dtype=np.float32)
    a = np.clip(a, -1.0, 1.0)
    return a


def _encode_wav(audio: np.ndarray, sample_rate: int) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, _ensure_int16(audio), sample_rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def _encode_flac(audio: np.ndarray, sample_rate: int) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, _ensure_int16(audio), sample_rate, format="FLAC")
    return buf.getvalue()


def _encode_mp3(audio: np.ndarray, sample_rate: int) -> bytes:
    """MP3 via libsndfile if built with MP3 support, else raise.

    libsndfile >= 1.1 supports MP3 write. If unavailable, the format simply
    isn't offered (the route filters by registered formats), so this raising is
    a safety net, not the primary gate.
    """
    buf = io.BytesIO()
    sf.write(buf, _ensure_int16(audio), sample_rate, format="MP3")
    return buf.getvalue()


def _setup(ctx: ExtensionContext) -> None:
    ctx.add_export_format("wav", _encode_wav)
    ctx.add_export_format("flac", _encode_flac)
    # Probe MP3 support once; only register if libsndfile can actually write it.
    try:
        _encode_mp3(np.zeros(16, dtype=np.float32), 24000)
        ctx.add_export_format("mp3", _encode_mp3)
    except Exception:
        pass


register(
    Extension(
        id="audio-export",
        setup=_setup,
        description="WAV/FLAC/MP3 export encoders.",
    )
)
