"""Key detection with Camelot codes. Chroma is measured from the harmonic part of the audio (a spectrogram's
time-median against its frequency-median, the usual harmonic-percussive split), in 150 Hz to 4 kHz so bass roots,
which rarely carry the third that decides the mode, do not outweigh the harmony, with linear magnitudes, since log
compression lifts overtones until a note's third harmonic reads as the pitch a fifth above. The chroma is correlated
with Temperley's major and minor key profiles in all 24 keys; the confidence is the best correlation's margin over the
runner-up.

Tuned on the owner's song (F minor, Camelot 4A, from the owner's analysis software) and on synthetic progressions in
C major, A minor, F minor and Ab major. Log-compressed chroma read everything a fifth high (the song as C minor); with
linear chroma and a 55 Hz floor the song's mode was a coin toss (margin 0.02); the 150 Hz floor made Temperley's and
Krumhansl's profiles agree on F minor (margins 0.24 and 0.23) and harmonic separation kept that. One real song is a
thin basis, which is stated wherever this is recorded."""

from __future__ import annotations

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

from . import tempo

FRAME = 8192
HOP = 2048
LOW, HIGH = 150.0, 4000.0
MAJOR = np.array([5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0])
MINOR = np.array([5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0])
MAJOR_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
MINOR_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"]


def camelot(pitch_class: int, mode: str) -> str:
    """Camelot wheel code: majors B (C = 8B), minors A (A minor = 8A); a minor shares its relative major's number."""
    major_pc = pitch_class if mode == "major" else (pitch_class + 3) % 12
    number = (7 * major_pc + 8) % 12 or 12
    return f"{number}{'B' if mode == 'major' else 'A'}"


def _median(S: np.ndarray, k: int, axis: int) -> np.ndarray:
    pad = k // 2
    P = np.pad(S, ((pad, pad), (0, 0)) if axis == 0 else ((0, 0), (pad, pad)), mode="edge")
    out = np.empty_like(S)
    for i in range(0, S.shape[0], 128):
        rows = P[i : i + 128 + 2 * pad] if axis == 0 else P[i : i + 128]
        out[i : i + 128] = np.median(sliding_window_view(rows, k, axis=axis), axis=-1)
    return out


def chroma(x: np.ndarray, rate: int) -> np.ndarray:
    if len(x) < FRAME:
        return np.zeros(12)
    f = np.fft.rfftfreq(FRAME, 1 / rate)
    band = (f >= LOW) & (f <= HIGH)
    frames = sliding_window_view(x, FRAME)[::HOP]
    S = np.abs(np.fft.rfft(frames * np.hanning(FRAME), axis=1))[:, band]
    harmonic = _median(S, 17, 0) >= _median(S, 17, 1)
    pc = ((np.round(12 * np.log2(f[band] / 440.0)) + 9) % 12).astype(int)
    acc = np.bincount(pc, weights=(S * harmonic).sum(axis=0), minlength=12)
    total = acc.sum()
    return acc / total if total > 0 else acc


def estimate(c: np.ndarray) -> dict:
    if not c.any():
        return {"key": None, "tonic": None, "mode": None, "camelot": None, "confidence": 0.0}
    scores = []
    for t in range(12):
        for mode, profile in (("major", MAJOR), ("minor", MINOR)):
            scores.append((float(np.corrcoef(c, np.roll(profile, t))[0, 1]), t, mode))
    scores.sort(reverse=True)
    r, t, mode = scores[0]
    tonic = (MAJOR_NAMES if mode == "major" else MINOR_NAMES)[t]
    return {"key": f"{tonic} {mode}", "tonic": tonic, "mode": mode, "camelot": camelot(t, mode), "confidence": round(r - scores[1][0], 3)}


def detect(media_id: str, start: float | None = None, end: float | None = None) -> dict:
    return estimate(chroma(tempo._decode(media_id, start, end), tempo.RATE))
