"""Extension: peak normalization.

id: peak-normalize
Contributes: an audio postprocessor that peak-normalizes final audio to a
target ceiling, off by default and toggled via env (FORMWAV_PEAK_NORMALIZE=1).

Demonstrates the audio-postprocessor seam. Adding DSP (de-click, fades,
loudness targeting) is the same shape: a function registered here.
"""

from __future__ import annotations

import os

import numpy as np

from ..registry import Extension, ExtensionContext, register


_TARGET_PEAK = float(os.environ.get("FORMWAV_PEAK_TARGET", "0.97"))


def _peak_normalize(audio: np.ndarray) -> np.ndarray:
    if audio.size == 0:
        return audio
    peak = float(np.max(np.abs(audio)))
    if peak <= 1e-6:
        return audio
    gain = _TARGET_PEAK / peak
    # Only bring down hot signals / gently lift quiet ones; never explode noise.
    gain = min(gain, 8.0)
    return (audio * gain).astype(np.float32)


def _setup(ctx: ExtensionContext) -> None:
    if os.environ.get("FORMWAV_PEAK_NORMALIZE", "0") == "1":
        ctx.add_audio_postprocessor(_peak_normalize)


register(
    Extension(
        id="peak-normalize",
        setup=_setup,
        description="Optional peak normalization (FORMWAV_PEAK_NORMALIZE=1).",
    )
)
