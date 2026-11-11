"""Tempo detection that holds on real music. The audio becomes an
onset-strength envelope (log-magnitude spectral flux at about 100 frames a second, its local mean removed), and each
candidate tempo from 60 to 200 BPM in 0.1 steps is scored by the envelope's autocorrelation averaged over every multiple
of its period within 12 s. Averaging over multiples sharpens the estimate and penalises a double tempo whose in-between
beats are empty; where half and whole tempo fit alike, a gentle preference for tempos near 120 decides. The confidence
is the chosen tempo's averaged autocorrelation (0 to 1).

It replaced a comb over discrete onset times, which scored every onset against one grid: on the owner's song it
returned confidence 0.08 to 0.18, while speech and irregular hits score about 0.03 here and the song 0.47. On that song
this reads 126.9 BPM in every 30 s window; librosa's tempo estimate reads 129.20 there, which is exactly the lag-20 bin
of its frame grid (60 x 22050 / 512 / 20), while librosa's own beat tracker spans 126.96 BPM from first beat to last.
The frame rate is used exactly (22050 / 220 = 100.227 a second); assuming 100 read every tempo 0.23% low."""

from __future__ import annotations

import math
import subprocess

import numpy as np

from ..core.paths import media_dir
from . import media

RATE = 22050
HOP = 220
FPS = RATE / HOP
FRAME = 2048


def _decode(media_id: str, start: float | None, end: float | None) -> np.ndarray:
    cmd = [media._tool("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin"]
    if start is not None and start > 0:
        cmd += ["-ss", f"{start:.6f}"]
    if end is not None and end > (start or 0):
        cmd += ["-t", f"{end - (start or 0):.6f}"]
    cmd += ["-i", str(media_dir() / f"{media_id}.wav"), "-ac", "1", "-ar", str(RATE), "-f", "f32le", "-"]
    done = subprocess.run(cmd, capture_output=True, timeout=300)
    if done.returncode != 0:
        raise media.MediaError(f"could not read the audio: {done.stderr.decode(errors='replace').strip()[-200:]}")
    return np.frombuffer(done.stdout, dtype="<f4")


def envelope(x: np.ndarray) -> np.ndarray:
    """Spectral flux at FPS, computed 4096 frames at a time so memory stays bounded for any length (the whole-signal
    version held every windowed frame and its spectrum at once: gigabytes for ten minutes); the result is identical."""
    frames = np.lib.stride_tricks.sliding_window_view(np.pad(x, (FRAME // 2, FRAME)), FRAME)[::HOP][: len(x) // HOP]
    if len(frames) < 3:
        return np.zeros(0)
    window = np.hanning(FRAME)
    flux = np.empty(len(frames) - 1)
    prev = None
    block = 4096
    for b in range(0, len(frames), block):
        mag = np.log1p(100 * np.abs(np.fft.rfft(frames[b : b + block] * window, axis=1)))
        steps = np.diff(mag, axis=0) if prev is None else np.diff(np.vstack([prev[None, :], mag]), axis=0)
        flux[max(0, b - 1) : max(0, b - 1) + len(steps)] = np.maximum(0, steps).sum(axis=1)
        prev = mag[-1]
    k = max(1, min(round(FPS / 2), len(flux)))
    return np.maximum(0, flux - np.convolve(flux, np.ones(k) / k, mode="same"))


def estimate(env: np.ndarray, lo: float = 60.0, hi: float = 200.0, prior: float = 120.0, octave_sd: float = 1.5) -> tuple[float, float]:
    """(bpm, confidence); confidence 0 when there is too little to measure."""
    m = len(env)
    if m < 4 * FPS:
        return 0.0, 0.0
    e = env - env.mean()
    acf = np.fft.irfft(np.abs(np.fft.rfft(e, 2 * m)) ** 2)[:m]
    if acf[0] <= 0:
        return 0.0, 0.0
    acf /= acf[0]
    lags = np.arange(m)
    horizon = min(m - 1, 12 * FPS)
    best = (0.0, -1.0, 0.0)
    for tenth in range(int(lo * 10), int(hi * 10) + 1):
        bpm = tenth / 10
        period = 60 * FPS / bpm
        count = int(horizon // period)
        if count < 1:
            continue
        comb = float(np.mean(np.interp(np.arange(1, count + 1) * period, lags, acf)))
        score = comb * math.exp(-0.5 * (math.log2(bpm / prior) / octave_sd) ** 2)
        if score > best[1]:
            best = (bpm, score, comb)
    return best[0], max(0.0, best[2])


def detect(media_id: str, start: float | None = None, end: float | None = None) -> dict:
    bpm, confidence = estimate(envelope(_decode(media_id, start, end)))
    return {"bpm": round(bpm, 1), "confidence": round(confidence, 3)}
