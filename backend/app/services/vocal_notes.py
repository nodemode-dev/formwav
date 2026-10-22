"""A sung line as notes (DEV_PLAN_sung_lyrics L5). The melodic detector (effects.detect_notes, YIN every 5 ms, a note
closed when the pitch leaves its running median by half a semitone) was made for instruments: a singer's vibrato and
consonants break one held note into several, and a frame of octave error becomes a note of its own. Here its notes are
cleaned for a voice:

- a note under MIN_S whose pitch is SPIKE semitones or more from both neighbours is dropped (a tracking slip);
- a note is joined to the one before it when their pitches are within JOIN semitones, the gap between them is under
  GAP_S, and the level does not dip between them (a dip under DIP of the two notes' level is a consonant: a repeated
  note, kept apart);
- a note still under MIN_S is dropped;
- a held note is cut at a level valley under VALLEY of the peaks either side (a voiced consonant between two notes on
  one pitch, which the dip test above lets through).

Pitches are the median of the joined frames, rounded; velocities follow the level as audio_midi gives them.
"""

import numpy as np

from . import effects
from .audio_midi import _velocity
from .tools import _wav_view

MIN_S = 0.08
SPIKE = 3.0
JOIN = 0.75
GAP_S = 0.08
DIP = 0.5
EDGE_S = 0.12
VALLEY = 0.7


def _split(n: dict, mono: np.ndarray, rate: int) -> list[dict]:
    """A held note cut where a voiced consonant ("w", "n", "l") starts a repeated note on the same pitch: the deepest
    level valley (10 ms frames) at least EDGE_S from either end, kept only if it is under VALLEY of the highest level on
    both sides of it; each part cut again the same way."""
    if n["end"] - n["start"] < 2 * EDGE_S + 0.02:
        return [n]
    hop = int(rate * 0.01)
    a, b = int(n["start"] * rate), int(n["end"] * rate)
    frames = np.array([np.sqrt(np.mean(mono[i:i + hop] ** 2)) for i in range(a, b - hop, hop)])
    edge = int(EDGE_S / 0.01)
    if len(frames) <= 2 * edge:
        return [n]
    k = edge + int(np.argmin(frames[edge:len(frames) - edge]))
    if frames[k] >= VALLEY * min(frames[:k].max(), frames[k + 1:].max()):
        return [n]
    cut = n["start"] + k * 0.01
    return _split({**n, "end": cut}, mono, rate) + _split({**n, "start": cut}, mono, rate)


def to_notes(media_id: str, start: float = 0.0, length: float | None = None) -> tuple[list[dict], list[list[float]]]:
    """The span's notes ({start, length, pitch, velocity} from the span's start) and its pitch curve ([seconds, MIDI])."""
    found = effects.detect_notes(media_id)
    view, rate = _wav_view(media_id)
    mono = np.asarray(view, dtype=np.float64).mean(axis=1)
    level = lambda a, b: float(np.sqrt(np.mean(mono[int(a * rate): max(int(a * rate) + 1, int(b * rate))] ** 2)))
    raw = [{"start": n["start"], "end": n["end"], "midi": n["midi"]} for n in found["notes"]]
    kept = []
    for i, n in enumerate(raw):
        short = n["end"] - n["start"] < MIN_S
        near = [raw[j]["midi"] for j in (i - 1, i + 1) if 0 <= j < len(raw)]
        if short and near and all(abs(n["midi"] - m) >= SPIKE for m in near):
            continue
        kept.append(dict(n))
    joined: list[dict] = []
    for n in kept:
        if joined:
            p = joined[-1]
            gap = n["start"] - p["end"]
            if abs(n["midi"] - p["midi"]) < JOIN and gap < GAP_S:
                around = min(level(p["end"] - 0.03, p["end"] + 0.01), level(n["start"] - 0.01, n["start"] + 0.03)) if gap < 0.02 else level(p["end"], n["start"])
                body = (level(p["start"], p["end"]) + level(n["start"], n["end"])) / 2
                if around >= DIP * body:
                    span = (p["end"] - p["start"]) + (n["end"] - n["start"])
                    p["midi"] = (p["midi"] * (p["end"] - p["start"]) + n["midi"] * (n["end"] - n["start"])) / span
                    p["end"] = n["end"]
                    continue
        joined.append(n)
    joined = [n for n in joined if n["end"] - n["start"] >= MIN_S]
    joined = [part for n in joined for part in _split(n, mono, rate)]
    end = start + length if length is not None else float("inf")
    levels = [level(n["start"], n["end"]) for n in joined]
    top = max(levels, default=0.0)
    notes = [{"start": round(n["start"] - start, 4), "length": round(min(n["end"], end) - n["start"], 4), "pitch": int(round(n["midi"])), "velocity": _velocity(v, top)}
             for n, v in zip(joined, levels) if start - 1e-6 <= n["start"] < end]
    curve = [[round(t - start, 3), m] for t, m in found["curve"] if start <= t < end]
    return notes, curve
