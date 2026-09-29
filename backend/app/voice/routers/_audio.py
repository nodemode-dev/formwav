"""Audio helpers shared by routers."""

from __future__ import annotations

import base64
import io

import numpy as np
import soundfile as sf


def to_wav_b64(audio: np.ndarray, sample_rate: int) -> str:
    """Encode mono float32 PCM to base64 WAV (PCM_16)."""
    a = np.asarray(audio, dtype=np.float32)
    if a.ndim > 1:
        a = a.squeeze()
    buf = io.BytesIO()
    sf.write(buf, a, sample_rate, format="WAV", subtype="PCM_16")
    return base64.b64encode(buf.getvalue()).decode()
