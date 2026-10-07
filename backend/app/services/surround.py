"""PT-38, AA-11: a 5.1 surround mix. Each track is placed among the five full-range speakers at ITU-R BS.775's angles (C
0, L and R 30 degrees either side, Ls and Rs 110), by pairwise constant-power panning between the two speakers either
side of its angle (VBAP in two dimensions); a position nearer the middle of the room spreads it over all five, its
power kept. A track may also send to the LFE channel, which carries only what lies below 120 Hz. A track with no
surround position keeps its stereo image on L and R. The mix runs through the core's six-channel master bus
(render.rs render_surround), the master chain and fader acting on the 5.1 mix as on the stereo one, and is written in
SMPTE order (L R C LFE Ls Rs) as a WAVE_FORMAT_EXTENSIBLE file marked 5.1. A session hearing its 5.1 as a fold-down
gives the core the same placements with its fold mode on, so playback and the stereo mix are the bus folded to stereo
by ITU-R BS.775's downmix."""

import math
import struct

import numpy as np

from . import render

CHANNELS = ("L", "R", "C", "LFE", "Ls", "Rs")
SPEAKERS = (("Ls", -110.0), ("L", -30.0), ("C", 0.0), ("R", 30.0), ("Rs", 110.0))
MASK_51_SIDE = 0x60F  # front left, front right, front centre, low frequency, side left, side right


def foa_gains(x: float, y: float, el: float = 0.0) -> list[float]:
    """PT-42: a source's first-order ambisonic gains (AmbiX: W Y Z X, SN3D) from its place on the pad (x from left to
    right, y from behind to in front; its distance from the middle how focused it is, the middle all around) and its
    elevation in degrees (90 overhead, -90 below)."""
    r = min(1.0, math.hypot(x, y))
    az = math.atan2(-x, y)  # ambisonic azimuth: 0 ahead, positive to the left
    e = math.radians(max(-90.0, min(90.0, el)))
    return [1.0, r * math.sin(az) * math.cos(e), math.sin(e), r * math.cos(az) * math.cos(e)]


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


def places_for(doc: dict, owners: list[int], fmt: int = 0) -> list[tuple[int, list[float]]]:
    """Each placed clip's gains by the clip's index in the plan: for 5.1 (fmt 0) its speaker gains in SMPTE order (L R
    C LFE Ls Rs, the LFE's from its send in dB), for first-order ambisonics (fmt 1) its W Y Z X gains with its
    elevation; clips of tracks without a position are left out (on L and R in 5.1, ahead in ambisonics)."""
    tracks = [t for t in (doc.get("tracks") or []) if isinstance(t, dict)]
    out = []
    for index, owner in enumerate(owners):
        place = tracks[owner].get("surround") if owner < len(tracks) else None
        if not isinstance(place, dict):
            continue
        if fmt == 1:
            out.append((index, foa_gains(float(place.get("x", 0.0)), float(place.get("y", 1.0)), float(place.get("el") or 0.0)) + [0.0, 0.0]))
            continue
        g = gains(float(place.get("x", 0.0)), float(place.get("y", 1.0)))
        lfe = place.get("lfeDb")
        lfe_gain = 10 ** (float(lfe) / 20) if lfe is not None and float(lfe) > -80 else 0.0
        out.append((index, [g["L"], g["R"], g["C"], lfe_gain, g["Ls"], g["Rs"]]))
    return out


def wav_float(channels: np.ndarray, rate: int, mask: int) -> bytes:
    """Channels (frames by channels) as a 32-bit float WAVE_FORMAT_EXTENSIBLE file with the given speaker mask."""
    n = channels.shape[1]
    data = channels.astype("<f4").tobytes()
    guid = struct.pack("<IHH8s", 0x00000003, 0x0000, 0x0010, bytes([0x80, 0x00, 0x00, 0xAA, 0x00, 0x38, 0x9B, 0x71]))  # IEEE float
    fmt = struct.pack("<HHIIHHHHI", 0xFFFE, n, rate, rate * 4 * n, 4 * n, 32, 22, 32, mask) + guid
    body = b"WAVE" + b"fmt " + struct.pack("<I", len(fmt)) + fmt + b"data" + struct.pack("<I", len(data)) + data
    return b"RIFF" + struct.pack("<I", len(body)) + body


def wav_51(channels: np.ndarray, rate: int) -> bytes:
    """Six channels (frames by L R C LFE Ls Rs) as a 32-bit float WAVE_FORMAT_EXTENSIBLE file marked 5.1."""
    return wav_float(channels, rate, MASK_51_SIDE)


def wav_foa(channels: np.ndarray, rate: int) -> bytes:
    """PT-42: four channels (frames by W Y Z X) as an AmbiX file: ACN order, SN3D gains, no speaker mask (the
    channels are a sound field, not speaker feeds), as Pro Tools, Reaper and YouTube's 360 audio read it."""
    return wav_float(channels, rate, 0)


def render_51(doc: dict) -> dict:
    """{"wav": six-channel WAV bytes, "frames", "sampleRate", "levels": per-channel peak dBFS}: the session through the
    core's six-channel master bus (render.rs render_surround), so the master chain and fader act on the 5.1 mix (the
    chain on each pair of channels) as they do on the stereo one. Planned with the fold-down off, a placed track's
    position shaping its own sound; each clip takes its track's speaker gains and LFE send."""
    out, rate = _bus(doc, 0)
    levels = {name: round(20 * math.log10(max(1e-12, float(np.abs(out[:, k]).max()))), 2) for k, name in enumerate(CHANNELS)}
    return {"wav": wav_51(out, rate), "frames": len(out), "sampleRate": rate, "levels": levels}


FOA_CHANNELS = ["W", "Y", "Z", "X"]


def render_foa(doc: dict) -> dict:
    """PT-42: {"wav": four-channel AmbiX WAV bytes, "frames", "sampleRate", "levels"}: the session as first-order
    ambisonics through the same bus, each placed track encoded by its direction and elevation, unplaced ones ahead."""
    out, rate = _bus(doc, 1)
    foa = out[:, :4]
    levels = {name: round(20 * math.log10(max(1e-12, float(np.abs(foa[:, k]).max()))), 2) for k, name in enumerate(FOA_CHANNELS)}
    return {"wav": wav_foa(foa, rate), "frames": len(foa), "sampleRate": rate, "levels": levels}


def _bus(doc: dict, fmt: int) -> tuple[np.ndarray, int]:
    """The session through the core's six-channel bus in the given format (0 for 5.1, 1 for first-order ambisonics):
    its six channels (frames by six) and the rate."""
    from . import media
    from ..core.paths import media_dir

    tracks = [t for t in (doc.get("tracks") or []) if isinstance(t, dict)]
    if not tracks:
        raise render.RenderError("there are no tracks to mix")
    native = media._require_core()
    unfolded = {k: v for k, v in doc.items() if k != "surroundFold"}
    rate, sources, clips, end, _skipped, buses, envelopes, fx, chains, fx_auto, comps, owners = render.plan(unfolded)
    loaded = []
    for media_id, source in sources.items():
        media._check_id(media_id)
        path = media_dir() / f"{media_id}.wav"
        if not path.exists():
            raise KeyError(media_id)
        loaded.append((source, path.read_bytes()))
    chains = chains + [(2, 0, *s) for s in (render._stage(f) for f in (doc.get("masterFx") or [])) if s]
    places = places_for(doc, owners, fmt)
    if not places:
        places = [(len(clips), [0.0] * 6)]  # nothing placed: still the bus (5.1: the stereo on L and R; ambisonics: ahead)
    chains, processors = render.native_chains(chains)
    interleaved, _, _ = native.render(loaded, clips, max(1, end), buses, envelopes, float(doc.get("masterGainDb") or 0), float(rate), fx, [], chains, fx_auto, comps, places, False, fmt, processors)
    return np.frombuffer(bytes(interleaved), dtype="<f4").reshape(-1, 6).astype(np.float64), rate
