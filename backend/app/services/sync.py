"""Takes from different devices lined up by their sound (the comparison's Multitrack recording row: devices keep their
own clocks and land a few milliseconds apart, and a remote room's takes line up by a shared clock only to within the
network's round trip).

Two stages. Coarse: formcut 2.6.3's multicam sync (best_lag, ported with its sign, its normalisation and its rule that
among near-equal peaks the smallest lag wins, so a repeating sound cannot pull a take a beat away) on loudness envelopes
ten milliseconds a step, with its confidence floor: a weak match is reported and its take left where it is. Fine: the
waveforms at full rate, cross-correlated with the phase transform (GCC-PHAT, which whitens both so the peak is sharp
however differently the microphones colour the sound) a few envelope steps either side of the coarse lag, the peak placed
between samples by a parabola.
"""

import numpy as np

from .align import _decode

HOP = 0.010
MAX_LAG = 2.0
FLOOR = 0.4


def _envelope(x: np.ndarray, rate: int) -> np.ndarray:
    step = max(1, int(round(HOP * rate)))
    n = len(x) // step
    return np.sqrt(np.mean(np.square(x[: n * step].reshape(n, step)), axis=1)) if n else np.zeros(0)


def best_lag(reference: np.ndarray, other: np.ndarray, hop: float = HOP, max_lag: float = MAX_LAG, centre: float = 0.0) -> tuple[float, float]:
    """formcut's best_lag: the lag (seconds, positive when `other` runs late) with the best normalised match, and that
    match in 0..1; the search runs `max_lag` either way around `centre`."""
    a = reference - reference.mean()
    b = other - other.mean()
    if not len(a) or not len(b) or not a.std() or not b.std():
        return 0.0, 0.0
    a = a / (a.std() * len(a))
    b = b / b.std()
    n = len(a) + len(b) - 1
    size = 1 << (n - 1).bit_length()
    corr = np.fft.irfft(np.fft.rfft(a, size) * np.conj(np.fft.rfft(b, size)), size)
    limit = int(max_lag / hop)
    middle = round(-centre / hop)
    lags = np.arange(middle - limit, middle + limit + 1)
    values = corr[np.mod(lags, size)]
    top = float(values.max())
    near = np.flatnonzero(values >= top * 0.97)
    best = int(near[np.argmin(np.abs(lags[near]))])
    return float(-lags[best] * hop), float(max(0.0, min(1.0, values[best])))


def fine_lag(reference: np.ndarray, other: np.ndarray, rate: int, coarse: float, span: float = 3 * HOP) -> float:
    """The lag in samples (positive when `other` runs late), near the coarse lag, to a fraction of a sample."""
    n = min(len(reference), len(other))
    a, b = reference[:n] - reference[:n].mean(), other[:n] - other[:n].mean()
    size = 1 << (2 * n - 1).bit_length()
    cross = np.conj(np.fft.rfft(a, size)) * np.fft.rfft(b, size)
    corr = np.fft.irfft(cross / (np.abs(cross) + 1e-12), size)  # corr[k] pairs a[i] with b[i + k]: k > 0, other late
    centre, limit = int(round(coarse * rate)), int(round(span * rate))
    lags = np.arange(centre - limit, centre + limit + 1)
    values = corr[np.mod(lags, size)]
    i = int(np.argmax(values))
    if 0 < i < len(values) - 1:
        y0, y1, y2 = values[i - 1], values[i], values[i + 1]
        denom = y0 - 2 * y1 + y2
        return float(lags[i] + (0.5 * (y0 - y2) / denom if denom else 0.0))
    return float(lags[i])


def sync(reference: dict, others: list[dict], rate: int = 48000, seconds: float = 120.0, max_lag: float = MAX_LAG) -> list[dict]:
    """Each other take's offset against the reference, from the stretch where both sound: each item names a media id and
    where its clip starts in that media (seconds); the answer is how far the other's clip must move (seconds, positive
    to the left: it ran late), with the match's strength and whether it is strong enough to act on."""
    ref = _decode(reference["media"], reference.get("in", 0.0), seconds, rate, 1)[:, 0]
    ref_env = _envelope(ref, rate)
    out = []
    for o in others:
        x = _decode(o["media"], o.get("in", 0.0), seconds, rate, 1)[:, 0]
        coarse, confidence = best_lag(ref_env, _envelope(x, rate), HOP, max_lag)
        lag = fine_lag(ref, x, rate, coarse) / rate if confidence >= FLOOR else coarse
        out.append({"media": o["media"], "lag": round(lag, 7), "confidence": round(confidence, 3), "aligned": confidence >= FLOOR})
    return out
