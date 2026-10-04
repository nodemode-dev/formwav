"""PT-38, AA-11 (first part): a 5.1 surround mix. Each track is rendered alone through the core's chain (as the stems
export renders it) and placed among the five full-range speakers at ITU-R BS.775's angles (C 0, L and R 30 degrees
either side, Ls and Rs 110), by pairwise constant-power panning between the two speakers either side of its angle
(VBAP in two dimensions); a position nearer the middle of the room spreads it over all five, its power kept. A track
may also send to the LFE channel, which carries only what lies below 120 Hz. A track with no surround position keeps
its stereo image on L and R. The six channels are written in SMPTE order (L R C LFE Ls Rs) as a WAVE_FORMAT_EXTENSIBLE
file marked 5.1, so other software reads the layout. Master effects act on each track as in the stems export, not on
a six-channel master bus, which the core does not have yet."""

import math
import struct

import numpy as np

from . import render

CHANNELS = ("L", "R", "C", "LFE", "Ls", "Rs")
SPEAKERS = (("Ls", -110.0), ("L", -30.0), ("C", 0.0), ("R", 30.0), ("Rs", 110.0))
MASK_51_SIDE = 0x60F  # front left, front right, front centre, low frequency, side left, side right


def gains(x: float, y: float) -> dict[str, float]:
    """The five full-range speakers' gains for a source at (x, y): x from -1 (left) to 1 (right), y from -1 (behind)
    to 1 (in front); its angle chooses the speaker pair, its distance from the middle how far it spreads."""
    r = min(1.0, math.hypot(x, y))
    angle = math.degrees(math.atan2(x, y)) if r > 1e-9 else 0.0
    ring = list(SPEAKERS) + [("Ls", 250.0)]  # the gap behind, Rs (110) round to Ls (250, that is -110)
    a = angle if angle >= -110.0 else angle + 360.0
    point = {name: 0.0 for name, _ in SPEAKERS}
    for (n1, a1), (n2, a2) in zip(ring, ring[1:]):
        if a1 <= a <= a2:
            p = (a - a1) / (a2 - a1)
            point[n1] += math.cos(p * math.pi / 2)
            point[n2] += math.sin(p * math.pi / 2)
            break
    even = 1 / math.sqrt(len(SPEAKERS))
    spread = {k: r * v + (1 - r) * even for k, v in point.items()}
    norm = math.sqrt(sum(v * v for v in spread.values())) or 1.0
    return {k: v / norm for k, v in spread.items()}


FOLD = 1 / math.sqrt(2)  # ITU-R BS.775's downmix: centre and surrounds into the front pair at -3 dB, the LFE left out


def fold(x: float, y: float) -> tuple[float, float]:
    """A 5.1 position's stereo fold-down (Lo = L + 0.707 C + 0.707 Ls, Ro = R + 0.707 C + 0.707 Rs) as the core's
    clip gain in dB and pan: its pan law keeps the near side at 1 and turns the far side down by cos(pan * pi / 2), so
    a mono source reaches Lo and Ro exactly; a stereo source keeps its own image within that balance."""
    g = gains(x, y)
    lo = g["L"] + FOLD * g["C"] + FOLD * g["Ls"]
    ro = g["R"] + FOLD * g["C"] + FOLD * g["Rs"]
    near, far = max(lo, ro), min(lo, ro)
    if near <= 1e-12:
        return -120.0, 0.0
    pan = (2 / math.pi) * math.acos(max(0.0, min(1.0, far / near)))
    return 20 * math.log10(near), (-pan if lo >= ro else pan)


def _lowpass(x: np.ndarray, rate: int, cutoff: float = 120.0) -> np.ndarray:
    """The LFE send's low-pass: a fourth-order Butterworth's magnitude applied in the frequency domain, zero phase and
    fast at any length (a per-sample loop would take minutes on a long session)."""
    spectrum = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / rate)
    return np.fft.irfft(spectrum / np.sqrt(1 + (f / cutoff) ** 8), len(x))


def _stem(doc: dict, index: int) -> tuple[np.ndarray, int]:
    tracks = list(doc.get("tracks") or [])
    # the track's own sound: rendered with the session's fold-down off, or a placed track came back already folded
    # and was placed again (playback and the 5.1 export's fold-down differed by -15.6 dB)
    unfolded = {k: v for k, v in doc.items() if k != "surroundFold"}
    result = render.render({**unfolded, "tracks": [{**t, "solo": False, "mute": bool(t.get("mute")) if j == index else True} for j, t in enumerate(tracks)]})
    wav = result["wav"]
    i, chunks = 12, {}
    while i + 8 <= len(wav):
        cid, size = wav[i : i + 4], int.from_bytes(wav[i + 4 : i + 8], "little")
        chunks[cid] = wav[i + 8 : i + 8 + size]
        i += 8 + size + (size & 1)
    return np.frombuffer(chunks[b"data"], dtype="<f4").reshape(-1, 2).astype(np.float64), int(result.get("sampleRate") or doc.get("sampleRate") or 48000)


def wav_51(channels: np.ndarray, rate: int) -> bytes:
    """Six channels (frames by L R C LFE Ls Rs) as a 32-bit float WAVE_FORMAT_EXTENSIBLE file marked 5.1."""
    data = channels.astype("<f4").tobytes()
    guid = struct.pack("<IHH8s", 0x00000003, 0x0000, 0x0010, bytes([0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71]))  # IEEE float
    fmt = struct.pack("<HHIIHHHHI", 0xFFFE, 6, rate, rate * 24, 24, 32, 22, 32, MASK_51_SIDE) + guid
    body = b"WAVE" + b"fmt " + struct.pack("<I", len(fmt)) + fmt + b"data" + struct.pack("<I", len(data)) + data
    return b"RIFF" + struct.pack("<I", len(body)) + body


def render_51(doc: dict) -> dict:
    """{"wav": six-channel WAV bytes, "frames", "sampleRate", "levels": per-channel peak dBFS}."""
    tracks = list(doc.get("tracks") or [])
    if not tracks:
        raise render.RenderError("there are no tracks to mix")
    out = None
    rate = int(doc.get("sampleRate") or 48000)
    for i, track in enumerate(tracks):
        stem, rate = _stem(doc, i)
        if out is None or len(out) < len(stem):
            grown = np.zeros((len(stem), 6))
            if out is not None:
                grown[: len(out)] = out
            out = grown
        place = track.get("surround")
        if not isinstance(place, dict):
            out[: len(stem), 0] += stem[:, 0]  # no surround position: its stereo image on L and R
            out[: len(stem), 1] += stem[:, 1]
            continue
        mono = stem.mean(axis=1)
        g = gains(float(place.get("x", 0.0)), float(place.get("y", 1.0)))
        for name, gain in g.items():
            if gain > 1e-9:
                out[: len(stem), CHANNELS.index(name)] += gain * mono
        lfe = place.get("lfeDb")
        if lfe is not None and float(lfe) > -80:
            out[: len(stem), 3] += 10 ** (float(lfe) / 20) * _lowpass(mono, rate)
    assert out is not None
    levels = {name: round(20 * math.log10(max(1e-12, float(np.abs(out[:, k]).max()))), 2) for k, name in enumerate(CHANNELS)}
    return {"wav": wav_51(out, rate), "frames": len(out), "sampleRate": rate, "levels": levels}
