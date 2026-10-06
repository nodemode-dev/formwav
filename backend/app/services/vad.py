"""Where someone is speaking: Silero VAD (MIT, ONNX), ported from formcut 2.6.3 (backend/app/speech.py, the same author).

Silero gives a speech probability every 32 ms, music or not, which word times and loudness pauses cannot: formcut's notes
record a transcript placing a word a second early, and a loudness pause failing under a music bed. From the probabilities
come speech regions (above 0.5, at least 250 ms, gaps under 300 ms joined) and formcut's speech-safe cut rule: a cut is
unsafe when there is speech on both sides of it within 100 ms (mean probability above 0.5). The model (2.3 MB) is fetched
once from Silero's repository and checked against the hash it had when this was written; probabilities are kept per media.
"""

import hashlib
import json
import subprocess
import urllib.request
from pathlib import Path

import numpy as np

from . import media

URL = "https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx"
SHA256 = "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3"
RATE = 16000
CHUNK = 512  # Silero VAD's window at 16 kHz
STEP = CHUNK / RATE  # 32 ms between probabilities
_session = None


def model_path() -> Path:
    path = Path(__file__).resolve().parents[2] / "models" / "vad" / "silero_vad.onnx"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            data = urllib.request.urlopen(URL, timeout=60).read()
        except OSError as err:
            raise media.MediaError(f"the speech-detection model could not be fetched: {err}") from err
        if hashlib.sha256(data).hexdigest() != SHA256:
            raise media.MediaError("the speech-detection model did not match its known hash; not used")
        path.write_bytes(data)
    return path


def probabilities(media_id: str) -> np.ndarray:
    """Silero's speech probability for every 32 ms of the media, measured once and kept."""
    global _session
    cache = media.media_dir().parent / "speech" / f"{media_id}.vad.npy"
    if cache.exists():
        return np.load(cache)
    import onnxruntime as ort

    if _session is None:
        _session = ort.InferenceSession(str(model_path()), providers=["CPUExecutionProvider"])
    done = subprocess.run([media._tool("ffmpeg"), "-v", "error", "-nostdin", "-i", str(media.media_dir() / f"{media_id}.wav"), "-ac", "1", "-ar", str(RATE), "-f", "f32le", "-"], capture_output=True, timeout=1800)
    if done.returncode != 0:
        raise media.MediaError("the media could not be read for speech detection")
    samples = np.frombuffer(done.stdout, np.float32)
    state, context, out = np.zeros((2, 1, 128), np.float32), np.zeros(64, np.float32), []
    for start in range(0, len(samples) - CHUNK + 1, CHUNK):
        window = samples[start : start + CHUNK]
        chunk = np.concatenate([context, window])[None, :].astype(np.float32)
        probability, state = _session.run(None, {"input": chunk, "state": state, "sr": np.array(RATE, np.int64)})
        out.append(float(probability[0][0]))
        context = window[-64:]
    result = np.array(out, np.float32)
    cache.parent.mkdir(parents=True, exist_ok=True)
    np.save(cache, result)
    return result


def regions(media_id: str, threshold: float = 0.5, min_speech: float = 0.25, join_gap: float = 0.3) -> list[dict]:
    """Stretches of speech, in the media's own seconds."""
    p = probabilities(media_id)
    spans, start = [], None
    for i, v in enumerate(p):
        if v > threshold and start is None:
            start = i
        elif v <= threshold and start is not None:
            spans.append([start * STEP, i * STEP]); start = None
    if start is not None:
        spans.append([start * STEP, len(p) * STEP])
    joined: list[list[float]] = []
    for s in spans:
        if joined and s[0] - joined[-1][1] < join_gap:
            joined[-1][1] = s[1]
        else:
            joined.append(s)
    return [{"start": round(a, 3), "end": round(b, 3)} for a, b in joined if b - a >= min_speech]


def cut_is_safe(media_id: str, at: float, margin: float = 0.1) -> dict:
    """formcut's rule: a cut at `at` (media seconds) is unsafe when speech is on both sides of it within `margin`."""
    p = probabilities(media_id)
    i, k = int(round(at / STEP)), max(1, int(round(margin / STEP)))
    before = float(p[max(0, i - k):i].mean()) if i > 0 else 0.0
    after = float(p[i:i + k].mean()) if i < len(p) else 0.0
    return {"at": at, "safe": not (before > 0.5 and after > 0.5), "before": round(before, 3), "after": round(after, 3)}
