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
    end = 0
    skipped = 0
    for track in tracks:
        if track.get("mute") or (soloed and not track.get("solo")) or track.get("busId") in muted_buses:
            continue
        bus_index = buses[track["busId"]][0] if track.get("busId") in buses else 0
        for clip in track.get("clips", []):
            info = doc["media"].get(clip.get("mediaId"))
            if not isinstance(info, dict):
                continue
            if info.get("sampleRate") != rate:
                skipped += 1
                continue
            source = sources.setdefault(clip["mediaId"], len(sources) + 1)
            gain = math.pow(10, (float(track.get("gainDb", 0)) + float(clip.get("gainDb", 0))) / 20)
            start, length = int(clip["start"]), int(clip["length"])
            fade_shape = 1 if clip.get("fadeShape") == "equal-power" else 0
            clips.append((source, start, int(clip.get("sourceIn", 0)), length, gain, float(track.get("pan") or 0), int(clip.get("fadeIn") or 0), int(clip.get("fadeOut") or 0), fade_shape, bus_index))
            end = max(end, start + length)
    return rate, sources, clips, end, skipped, list(buses.values())


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
    rate, sources, clips, end, skipped, buses = plan(doc)
    loaded = []
    for media_id, source in sources.items():
        media._check_id(media_id)
        path = media_dir() / f"{media_id}.wav"
        if not path.exists():
            raise KeyError(media_id)
        loaded.append((source, path.read_bytes()))
    interleaved, peak_left, peak_right = native.render(loaded, clips, max(1, end), buses)
    loudness = native.loudness(interleaved, 2, rate)
    return {
        "wav": wav_float32_stereo(interleaved, rate),
        "frames": max(1, end),
        "peakLeft": dbfs(peak_left),
        "peakRight": dbfs(peak_right),
        "loudness": f"{loudness:.2f}" if loudness is not None else "-inf",
        "skipped": skipped,
    }
