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
MASK_51_SIDE = 0x60F  # front left, front right, front centre, low frequency, side left, side right
#: S16: the session's spatialFormat values and the core's layout ids (crate::layout); absent is 5.1.
LAYOUT_IDS = {"5.1": 0, "foa": 1, "stereo": 2, "lcr": 3, "quad": 4, "5.0": 5, "6.1": 6, "7.1": 7, "5.1.2": 8, "5.1.4": 9, "7.1.2": 10, "7.1.4": 11, "9.1.6": 12}


def layout_id(doc: object) -> int:
    return LAYOUT_IDS.get(doc.get("spatialFormat") if isinstance(doc, dict) else None, 0)


def layouts() -> list[dict]:
    """S16: every layout the core renders: id, name, WAVE speaker mask and each channel in file order with its azimuth,
    elevation and share of the stereo fold-down, read from the core so the engine never holds a second copy."""
    from . import media

    out = []
    for lid, name, mask, chans in media._require_core().surround_layouts():
        out.append({"id": lid, "name": name, "mask": mask, "channels": [{"name": n, "az": round(az, 3), "el": round(el, 3), "fold": [round(fl, 6), round(fr, 6)]} for n, az, el, fl, fr in chans]})
    return out


def place_record(place: object) -> list[float] | None:
    """A track's place as the core's record: x, y, divergence (0 to 1), centre percent (0 to 100), elevation in degrees
    and LFE send in dB (-120 for none); the core computes every speaker's gain from it for the session's layout."""
    if not isinstance(place, dict):
        return None

    def num(key: str, default: float, lo: float, hi: float) -> float:
        try:
            v = float(place.get(key, default) if place.get(key) is not None else default)
        except (TypeError, ValueError):
            v = default
        return max(lo, min(hi, v)) if math.isfinite(v) else default

    lfe = place.get("lfeDb")
    return [num("x", 0.0, -1, 1), num("y", 1.0, -1, 1), num("div", 0.0, 0, 1), num("centre", 100.0, 0, 100), num("el", 0.0, -90, 90), float(lfe) if isinstance(lfe, (int, float)) and float(lfe) > -80 else -120.0]


def places_for(doc: dict, owners: list[int], fmt: int = 0) -> list[tuple[int, list[float]]]:
    """Each placed clip's place record by the clip's index in the plan (see place_record); clips of tracks without a
    position are left out (on L and R in a speaker layout, ahead in ambisonics). `fmt` is kept for older callers: the
    layout is given to the core separately."""
    tracks = [t for t in (doc.get("tracks") or []) if isinstance(t, dict)]
    out = []
    for index, owner in enumerate(owners):
        record = place_record(tracks[owner].get("surround")) if owner < len(tracks) else None
        if record is not None:
            out.append((index, record))
    return out


def bus_places_for(doc: dict, own_buses: list[tuple[int, int]]) -> list[tuple[int, list[float]]]:
    """S16: each placed track's own bus (a track whose chain must hear its sum: a compressor, an echo, a processor) by
    bus id with the track's place record, so the bus plays at the track's place rather than on L and R."""
    tracks = [t for t in (doc.get("tracks") or []) if isinstance(t, dict)]
    out = []
    for bus_id, owner in own_buses:
        record = place_record(tracks[owner].get("surround")) if owner < len(tracks) else None
        if record is not None:
            out.append((bus_id, record))
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
    channels are a sound field, not speaker feeds), as other editors and YouTube's 360 audio read it."""
    return wav_float(channels, rate, 0)


def render_51(doc: dict, start: int = 0, stop: int | None = None) -> dict:
    """{"wav": six-channel WAV bytes, "frames", "sampleRate", "levels": per-channel peak dBFS}: the session through the
    core's six-channel master bus (render.rs render_surround), so the master chain and fader act on the 5.1 mix (the
    chain on each pair of channels) as they do on the stereo one. Planned with the fold-down off, a placed track's
    position shaping its own sound; each clip takes its track's speaker gains and LFE send."""
    return render_layout(doc, 0, start, stop)


def render_layout(doc: dict, layout: int, start: int = 0, stop: int | None = None) -> dict:
    """S16: {"wav", "frames", "sampleRate", "levels", "names", "mask"}: the session through the core's master bus in a
    speaker layout (crate::layout ids 0 and 2 to 12), written in the layout's channel order as a WAVE_FORMAT_EXTENSIBLE
    file with its speaker mask, the levels keyed by channel name."""
    table = {row["id"]: row for row in layouts()}
    row = table.get(layout) or table[0]
    out, rate = _bus(doc, row["id"], start, stop)
    names = [c["name"] for c in row["channels"]]
    levels = {name: round(20 * math.log10(max(1e-12, float(np.abs(out[:, k]).max()))), 2) for k, name in enumerate(names)}
    return {"wav": wav_float(out, rate, row["mask"]), "frames": len(out), "sampleRate": rate, "levels": levels, "names": names, "mask": row["mask"], "layout": row["name"]}


FOA_CHANNELS = ["W", "Y", "Z", "X"]


def render_foa(doc: dict, start: int = 0, stop: int | None = None) -> dict:
    """PT-42: {"wav": four-channel AmbiX WAV bytes, "frames", "sampleRate", "levels"}: the session as first-order
    ambisonics through the same bus, each placed track encoded by its direction and elevation, unplaced ones ahead."""
    out, rate = _bus(doc, 1, start, stop)
    foa = out[:, :4]
    levels = {name: round(20 * math.log10(max(1e-12, float(np.abs(foa[:, k]).max()))), 2) for k, name in enumerate(FOA_CHANNELS)}
    return {"wav": wav_foa(foa, rate), "frames": len(foa), "sampleRate": rate, "levels": levels}


def _bus(doc: dict, fmt: int, start: int = 0, stop: int | None = None) -> tuple[np.ndarray, int]:
    """The session through the core's six-channel bus in the given format (0 for 5.1, 1 for first-order ambisonics):
    its six channels (frames by six), or the frames from `start` to `stop` of them, and the rate."""
    from . import media
    from ..core.paths import media_dir

    tracks = [t for t in (doc.get("tracks") or []) if isinstance(t, dict)]
    if not tracks:
        raise render.RenderError("there are no tracks to mix")
    native = media._require_core()
    unfolded = {k: v for k, v in doc.items() if k != "surroundFold"}
    own_buses: list = []
    routes: list = []
    rate, sources, clips, end, _skipped, buses, envelopes, fx, chains, fx_auto, comps, owners, bus_auto = render.plan(unfolded, own_buses, routes)
    loaded = []
    for media_id, source in sources.items():
        media._check_id(media_id)
        path = media_dir() / f"{media_id}.wav"
        if not path.exists():
            raise KeyError(media_id)
        loaded.append((source, path.read_bytes()))
    chains = chains + [(2, 0, *s) for s in (render._stage(f) for f in (doc.get("masterFx") or [])) if s]
    places = places_for(doc, owners, fmt)
    on_buses = bus_places_for(doc, own_buses)
    if not places:
        places = [(len(clips), [0.0, 1.0, 0.0, 100.0, 0.0, -120.0])]  # nothing placed on a clip: still the bus
    chains, processors = render.native_chains(chains)
    chains, hosted = render.native_plugins(chains)
    if start < 0 or (stop is not None and stop <= start):
        raise render.RenderError("the range must start at 0 or later and end after it starts")
    length = max(1, end) if stop is None else max(1, end, int(stop))
    master_db, master_pts = render.master_lane(doc)
    if master_pts:
        envelopes.append((master_pts, True))
    interleaved, _, _ = native.render(loaded, clips, length, buses, envelopes, master_db, float(rate), fx, [], chains, fx_auto, comps, places, False, fmt, processors, bus_auto, render.PAN_LAWS.get(doc.get("panLaw"), 0), len(envelopes) if master_pts else 0, render.bus_outs(doc) + routes, on_buses, hosted)
    out = np.frombuffer(bytes(interleaved), dtype="<f4").reshape(-1, native.surround_channels(fmt)).astype(np.float64)
    if start >= len(out):
        raise render.RenderError("the range starts after the session ends")
    return out[start : len(out) if stop is None else int(stop)], rate
