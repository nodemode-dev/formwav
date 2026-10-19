"""A stock library of sounds the engine synthesises, royalty-free by construction: line-up tones and timing, room
tones, transitions, a stinger and a music bed. Every item is rendered with numpy from a fixed recipe and a seed taken
from its id, so the same item at the same rate is the same audio every time (and import stores it once)."""

from __future__ import annotations

import zlib

import numpy as np

from . import media
from .aup_project import _wav_bytes

ITEMS: dict[str, tuple[str, str, float]] = {
    "reference-tone": ("Reference tone, 1 kHz at -18 dBFS", "Line-up and timing", 10.0),
    "click-120": ("Click track, 120 BPM, 4 bars of 4/4", "Line-up and timing", 8.0),
    "countdown": ("Countdown, three beeps and a go", "Line-up and timing", 4.0),
    "room-quiet": ("Room tone, quiet room", "Room tone", 30.0),
    "room-air": ("Room tone, air conditioning with mains hum", "Room tone", 30.0),
    "riser": ("Riser, noise sweeping up", "Transitions", 4.0),
    "whoosh": ("Whoosh", "Transitions", 2.0),
    "impact": ("Impact, low drop", "Transitions", 3.0),
    "bell": ("Bell stinger", "Stingers", 3.0),
    "drone-a-minor": ("Drone bed, A minor", "Music beds", 20.0),
}


def catalogue() -> list[dict]:
    return [{"id": key, "name": name, "category": category, "seconds": seconds} for key, (name, category, seconds) in ITEMS.items()]


def _db(x: float) -> float:
    return 10 ** (x / 20)


def _peak_to(x: np.ndarray, db: float) -> np.ndarray:
    return x * (_db(db) / max(float(np.max(np.abs(x))), 1e-12))


def _rms_to(x: np.ndarray, db: float) -> np.ndarray:
    return x * (_db(db) / max(float(np.sqrt(np.mean(x**2))), 1e-12))


def _fade(x: np.ndarray, rate: int, seconds: float) -> np.ndarray:
    k = min(int(seconds * rate), len(x) // 2)
    if k > 0:
        ramp = np.linspace(0.0, 1.0, k)
        x[:k] *= ramp
        x[-k:] *= ramp[::-1]
    return x


def _shaped_noise(n: int, rate: int, rng: np.random.Generator, db_per_octave: float, cutoff: float | None = None) -> np.ndarray:
    """Noise whose power falls by `db_per_octave` (0 white, -3 pink, -6 brown), optionally under a second-order low-pass."""
    f = np.fft.rfftfreq(n, 1 / rate)
    f[0] = f[1]
    gain = (f / 1000.0) ** (db_per_octave / (20 * np.log10(2)))
    if cutoff:
        gain = gain / np.sqrt(1 + (f / cutoff) ** 4)
    return np.fft.irfft(np.fft.rfft(rng.standard_normal(n)) * gain, n)


def _sweep_lowpass(x: np.ndarray, rate: int, cutoffs: np.ndarray) -> np.ndarray:
    """A one-pole low-pass whose cutoff follows `cutoffs` sample by sample."""
    alpha = 1.0 - np.exp(-2 * np.pi * cutoffs / rate)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += alpha[i] * (x[i] - acc)
        y[i] = acc
    return y


def render(item: str, rate: int = 48000) -> np.ndarray:
    if item not in ITEMS:
        raise KeyError(item)
    if not 8000 <= rate <= 192000:
        raise media.MediaError("the library renders at 8 to 192 kHz")
    rng = np.random.default_rng(zlib.crc32(item.encode()))
    seconds = ITEMS[item][2]
    n = int(round(seconds * rate))
    t = np.arange(n) / rate
    if item == "reference-tone":
        return _db(-18) * np.sin(2 * np.pi * 1000 * t)
    if item in ("click-120", "countdown"):
        x = np.zeros(n)
        hits = [(b * 0.5, 0.01, 1500 if b % 4 == 0 else 1000, 0.6 if b % 4 == 0 else 0.4) for b in range(16)] if item == "click-120" else [(0, 0.15, 1000, 0.4), (1, 0.15, 1000, 0.4), (2, 0.15, 1000, 0.4), (3, 0.5, 2000, 0.5)]
        for at, length, freq, amp in hits:
            s, k = int(round(at * rate)), int(round(length * rate))
            env = np.ones(k)
            r = max(1, int(0.002 * rate))
            env[:r] = np.linspace(0, 1, r)
            env[-r:] = np.linspace(1, 0, r)
            x[s : s + k] += amp * env * np.sin(2 * np.pi * freq * np.arange(k) / rate)
        return x
    if item == "room-quiet":
        return _fade(_rms_to(_shaped_noise(n, rate, rng, -3, cutoff=1000), -50), rate, 0.05)
    if item == "room-air":
        bed = _rms_to(_shaped_noise(n, rate, rng, -6), -46) + _db(-60) * np.sin(2 * np.pi * 60 * t) + _rms_to(rng.standard_normal(n), -62)
        return _fade(bed, rate, 0.05)
    if item == "riser":
        y = _sweep_lowpass(rng.standard_normal(n), rate, 200 * (8000 / 200) ** (t / seconds))
        return _fade(_peak_to(y * (t / seconds) ** 2, -6), rate, 0.02)
    if item == "whoosh":
        shape = np.sin(np.pi * t / seconds)
        y = _sweep_lowpass(rng.standard_normal(n), rate, 300 + 5700 * shape)
        return _peak_to(y * shape**2, -9)
    if item == "impact":
        freq = 40 + 80 * np.exp(-t / 0.15)
        body = np.sin(2 * np.pi * np.cumsum(freq) / rate) * np.exp(-t / 0.6)
        hit = rng.standard_normal(n) * np.exp(-t / 0.01)
        return _fade(_peak_to(body + 0.3 * hit, -3), rate, 0.005)
    if item == "bell":
        partials = [(1.0, 1.0, 1.2), (2.76, 0.6, 0.8), (5.40, 0.4, 0.5), (8.93, 0.25, 0.3)]
        y = sum(a * np.exp(-t / d) * np.sin(2 * np.pi * 880 * r * t) for r, a, d in partials)
        y[: max(1, int(0.002 * rate))] *= np.linspace(0, 1, max(1, int(0.002 * rate)))
        return _peak_to(y, -6)
    # drone-a-minor: A2, C3, E3, A3 with a slow swell
    y = sum(np.sin(2 * np.pi * f * t) for f in (110.0, 130.81, 164.81, 220.0)) * (1 + 0.15 * np.sin(2 * np.pi * 0.2 * t))
    return _fade(_peak_to(y, -12), rate, 2.0)


def wav(item: str, rate: int = 48000) -> bytes:
    return _wav_bytes([render(item, rate).astype(np.float32)], rate)


def add(item: str, rate: int = 48000) -> dict:
    """The item stored as media at `rate`, named after it."""
    name = ITEMS[item][0] if item in ITEMS else item
    return media.import_wav(f"{name}.wav", wav(item, rate))
