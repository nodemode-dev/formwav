import math
import struct

from ..core.paths import media_dir
from . import media


class RenderError(ValueError):
    pass


def plan(doc: object) -> tuple[int, dict[str, int], list[tuple], int, int]:
    if not isinstance(doc, dict) or not isinstance(doc.get("tracks"), list) or not isinstance(doc.get("media"), dict):
        raise RenderError("not a session document")
    rate = doc.get("sampleRate")
    if not isinstance(rate, int) or rate <= 0:
        raise RenderError("the session has no valid sample rate")
    tracks = [t for t in doc["tracks"] if isinstance(t, dict)]
    soloed = any(t.get("solo") for t in tracks)
    buses: dict[str, tuple[int, float, float]] = {}
    muted_buses: set[str] = set()
    for bus in doc.get("buses") or []:
        if not isinstance(bus, dict) or not isinstance(bus.get("id"), str):
            continue
        if bus.get("mute"):
            muted_buses.add(bus["id"])
            continue
        buses[bus["id"]] = (len(buses) + 1, math.pow(10, float(bus.get("gainDb", 0)) / 20), float(bus.get("pan") or 0))
    sources: dict[str, int] = {}
    clips: list[tuple] = []
    envelopes: list[tuple] = []
    end = 0
    skipped = 0
    for track in tracks:
        if track.get("mute") or (soloed and not track.get("solo")) or track.get("busId") in muted_buses:
            continue
        bus_index = buses[track["busId"]][0] if track.get("busId") in buses else 0
        automation = track.get("automation") or {}
        gain_env = pan_env = 0
        if automation.get("volume"):
            envelopes.append(([(int(p["time"]), float(p["value"])) for p in automation["volume"]], True))
            gain_env = len(envelopes)
        if automation.get("pan"):
            envelopes.append(([(int(p["time"]), float(p["value"])) for p in automation["pan"]], False))
            pan_env = len(envelopes)
        track_db = 0.0 if gain_env else float(track.get("gainDb", 0))
        track_pan = 0.0 if pan_env else float(track.get("pan") or 0)
        for clip in track.get("clips", []):
            info = doc["media"].get(clip.get("mediaId"))
            if not isinstance(info, dict):
                continue
            if info.get("sampleRate") != rate:
                skipped += 1
                continue
            source = sources.setdefault(clip["mediaId"], len(sources) + 1)
            gain = math.pow(10, (track_db + float(clip.get("gainDb", 0))) / 20)
            start, length = int(clip["start"]), int(clip["length"])
            fade_shape = {"linear": 0, "equal-power": 1, "s-curve": 2, "exponential": 3}.get(clip.get("fadeShape") or "linear", 0)
            clips.append((source, start, int(clip.get("sourceIn", 0)), length, gain, track_pan, int(clip.get("fadeIn") or 0), int(clip.get("fadeOut") or 0), fade_shape, bus_index, gain_env, pan_env))
            end = max(end, start + length)
    return rate, sources, clips, end, skipped, list(buses.values()), envelopes


def wav_float32_stereo(interleaved: bytes, rate: int) -> bytes:
    data_bytes = len(interleaved)
    header = b"RIFF" + struct.pack("<I", 36 + data_bytes) + b"WAVE"
    header += b"fmt " + struct.pack("<IHHIIHH", 16, 3, 2, rate, rate * 8, 8, 32)
    header += b"data" + struct.pack("<I", data_bytes)
    return header + interleaved


def dbfs(peak: float) -> str:
    return f"{20 * math.log10(peak):.2f}" if peak > 0 else "-inf"


def render(doc: object) -> dict:
    native = media._require_core()
    rate, sources, clips, end, skipped, buses, envelopes = plan(doc)
    loaded = []
    for media_id, source in sources.items():
        media._check_id(media_id)
        path = media_dir() / f"{media_id}.wav"
        if not path.exists():
            raise KeyError(media_id)
        loaded.append((source, path.read_bytes()))
    interleaved, peak_left, peak_right = native.render(loaded, clips, max(1, end), buses, envelopes)
    loudness = native.loudness(interleaved, 2, rate)
    return {
        "wav": wav_float32_stereo(interleaved, rate),
        "frames": max(1, end),
        "peakLeft": dbfs(peak_left),
        "peakRight": dbfs(peak_right),
        "loudness": f"{loudness:.2f}" if loudness is not None else "-inf",
        "skipped": skipped,
    }
