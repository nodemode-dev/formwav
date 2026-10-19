"""PT-13, audio to MIDI (melodic, polyphonic and rhythmic conversions): a clip's audio as MIDI notes, in
seconds from the start of the clip's span, ready for the note clip MIDI import makes.

Melodic takes the single line the note editor finds (PT-10's pitch tracking); polyphonic takes every note inside played
chords (the chord note finder, services/polyphonic.py); rhythmic finds onsets by log-spectral flux and classes each hit
by where its first 60 ms of energy sits: below 150 Hz a kick (General MIDI 36), above 5 kHz with little low end a
hi-hat (42), otherwise a snare (38). Velocities follow each note's loudness against the loudest's."""

import numpy as np

from . import media


def _audio(media_id: str) -> tuple[np.ndarray, int]:
    from .polyphonic import _load

    x, rate = _load(media_id)
    return x.mean(axis=1), rate


def _velocity(level: float, top: float) -> int:
    return int(np.clip(round(127 * np.sqrt(level / top)) if top > 0 else 100, 30, 127))


def _pitched(media_id: str, poly: bool) -> list[dict]:
    if poly:
        from . import polyphonic

        found = polyphonic.find_notes(media_id)["notes"]
    else:
        from . import effects

        found = effects.detect_notes(media_id)["notes"]
    x, rate = _audio(media_id)
    level = [float(np.sqrt(np.mean(x[int(n["start"] * rate) : max(int(n["start"] * rate) + 1, int(n["end"] * rate))] ** 2))) for n in found]
    top = max(level, default=0.0)
    return [{"start": float(n["start"]), "length": max(0.02, float(n["end"]) - float(n["start"])), "pitch": int(round(float(n["midi"]))), "velocity": _velocity(v, top)} for n, v in zip(found, level)]


def _rhythmic(media_id: str) -> list[dict]:
    x, rate = _audio(media_id)
    n, hop = 1024, 256
    if len(x) < n:
        return []
    frames = np.lib.stride_tricks.sliding_window_view(x, n)[::hop] * np.hanning(n)
    mag = np.log1p(100 * np.abs(np.fft.rfft(frames, axis=1)))
    # the first frame against silence, so a hit on the very first sample counts; and the flux taken band by band, each
    # band against its own peak, then the strongest: summed over all bins, a kick's few low bins were drowned by the
    # snares' and hi-hats' broadband noise (its flux 0.038 against a threshold of 0.137)
    rise = np.maximum(0.0, np.diff(np.vstack([np.zeros_like(mag[0]), mag]), axis=0))
    bins = np.fft.rfftfreq(n, 1 / rate)
    bands = []
    for lo_hz, hi_hz in ((0, 200), (200, 2000), (2000, 8000), (8000, rate)):
        part = rise[:, (bins >= lo_hz) & (bins < hi_hz)].sum(axis=1)
        if part.max() > 0:
            bands.append(part / part.max())
    if not bands:
        return []
    flux = np.max(np.vstack(bands), axis=0)
    width = 16  # the threshold follows the local median over about 170 ms either side
    # padded with silence: padded with the edge, a hit on the first frame filled half its own median window and set its
    # threshold to 1.58 against its 1.0
    pad = np.pad(flux, width, mode="constant")
    local = np.array([np.median(pad[i : i + 2 * width + 1]) for i in range(len(flux))])
    gap = int(0.05 * rate / hop)
    onsets: list[int] = []
    for i in range(len(flux)):
        left = flux[i - 1] if i else 0.0
        right = flux[i + 1] if i + 1 < len(flux) else 0.0
        if flux[i] >= left and flux[i] > right and flux[i] > local[i] * 1.5 + 0.08 and (not onsets or i - onsets[-1] >= gap):
            onsets.append(i)
    ms = max(1, rate // 1000)
    span = int(0.06 * rate)
    nfft = 1 << int(np.ceil(np.log2(span)))
    f = np.fft.rfftfreq(nfft, 1 / rate)
    notes, levels = [], []
    for i in onsets:
        # the onset refined on the waveform: the first millisecond whose level passes 20% of the hit's peak (frame
        # positions alone read every hit about 9 ms early), the level taken from the first difference, a high-pass in
        # which an earlier kick's low tail barely shows (on the plain waveform hi-hats after kicks read 22 ms early)
        lo, hi = max(0, i * hop - hop), min(len(x), i * hop + n)
        env = np.sqrt(np.convolve(np.diff(x[lo:hi], prepend=x[lo - 1] if lo else 0.0) ** 2, np.ones(ms) / ms, mode="same"))
        if env.max() <= 0:
            continue
        start = lo + int(np.argmax(env > 0.2 * env.max()))
        after = x[start : start + span]
        if len(after) < 64:
            continue
        # classed by the energy that is new: the 60 ms after less the 60 ms before, so an earlier hit's ringing (a
        # kick's tail under a hi-hat) does not decide the class
        before = x[max(0, start - span) : start]
        p_after = np.abs(np.fft.rfft(after * np.hanning(len(after)), nfft)) ** 2
        p_before = np.abs(np.fft.rfft(before * np.hanning(len(before)), nfft)) ** 2 if len(before) >= 64 else 0.0
        new = np.maximum(0.0, p_after - p_before)
        total = new.sum() + 1e-12
        low, mid, high = new[f < 150].sum() / total, new[(f >= 150) & (f < 2000)].sum() / total, new[f > 5000].sum() / total
        # a hi-hat is high and nearly empty below 2 kHz; a snare's body and noise always reach into it
        pitch = 36 if low > 0.5 else 42 if high > 0.5 and mid < 0.05 else 38
        notes.append({"start": start / rate, "length": 0.1, "pitch": pitch, "velocity": 100})
        levels.append(float(np.sqrt(np.mean(after**2))))
    top = max(levels, default=0.0)
    for note, v in zip(notes, levels):
        note["velocity"] = _velocity(v, top)
    return notes


def to_notes(media_id: str, mode: str, start: float = 0.0, length: float | None = None) -> list[dict]:
    """The notes of the media's span from `start` for `length` seconds, timed from the span's start."""
    if mode not in ("melodic", "polyphonic", "rhythmic"):
        raise media.MediaError("audio to MIDI is melodic, polyphonic or rhythmic")
    notes = _rhythmic(media_id) if mode == "rhythmic" else _pitched(media_id, mode == "polyphonic")
    end = start + length if length is not None else float("inf")
    out = []
    for note in sorted(notes, key=lambda n: (n["start"], n["pitch"])):
        if start - 1e-6 <= note["start"] < end:
            out.append({**note, "start": round(note["start"] - start, 6), "length": round(min(note["length"], end - note["start"]), 6)})
    return out
