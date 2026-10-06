"""ADM BWF object export, the comparison page's Surround row (see HASHOUT_LOG)."""

import math
import struct
from html import escape

import numpy as np


def azimuth_of(x: float, y: float) -> float:
    return round(math.degrees(math.atan2(-x, y)), 3) if (x or y) else 0.0


def _pcm24(channels: list[np.ndarray], frames: int) -> bytes:
    block = np.zeros((frames, len(channels)), dtype=np.float64)
    for k, ch in enumerate(channels):
        block[: len(ch), k] = ch[:frames]
    ints = np.clip(np.round(block * 8388607.0), -8388608, 8388607).astype("<i4").reshape(-1)
    return ints.view(np.uint8).reshape(-1, 4)[:, :3].tobytes()


def _chunk(tag: bytes, body: bytes) -> bytes:
    return tag + struct.pack("<I", len(body)) + body + (b"\0" if len(body) % 2 else b"")


BED_TRACKS = ["AT_00010001_01", "AT_00010002_01", "AT_00010003_01", "AT_00010004_01", "AT_00010005_01", "AT_00010006_01"]
BED_PACK = "AP_00010003"  # ITU-R BS.2094's 5.1 (0+5+0): L, R, C, LFE, Ls, Rs, the order render_51 writes


def _tc(seconds: float) -> str:
    """An ADM time, hh:mm:ss.zzzzz."""
    seconds = max(0.0, seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h):02d}:{int(m):02d}:{s:08.5f}"


def _position(az: float, el: float, dist: float = 1.0) -> str:
    return f'<position coordinate="azimuth">{az:.3f}</position><position coordinate="elevation">{el:.3f}</position><position coordinate="distance">{dist:.3f}</position>'


def _blocks(n: str, obj: dict, total_s: float) -> str:
    """A static object's one block; a moving object's (L2) blocks: still until its first point, then one block per segment
    whose position is the segment's end, which a renderer reaches by interpolating over the block, then still again."""
    path = obj.get("path") or []
    if len(path) < 2:
        az, el = (path[0][1], path[0][2]) if path else (float(obj.get("azimuth", 0.0)), float(obj.get("elevation", 0.0)))
        return f'<audioBlockFormat audioBlockFormatID="AB_0003{n}_00000001">{_position(az, el, float(obj.get("distance", 1.0)))}</audioBlockFormat>'
    spans: list[tuple[float, float, float, float]] = []
    t0, az0, el0 = path[0]
    # a renderer interpolates from the previous block's position, so the first point needs a block of its own: still
    # until it, or 1 ms when the path starts at zero (without it EAR placed the object at its first destination at once)
    cursor = t0 if t0 > 0 else 0.001
    spans.append((0.0, cursor, az0, el0))
    for (ta, _, _), (tb, azb, elb) in zip(path, path[1:]):
        start = max(ta, cursor)
        if tb > start:
            spans.append((start, tb - start, azb, elb))
            cursor = tb
    t_last, az_last, el_last = path[-1]
    if total_s > t_last:
        spans.append((t_last, total_s - t_last, az_last, el_last))
    return "".join(f'<audioBlockFormat audioBlockFormatID="AB_0003{n}_{k + 1:08X}" rtime="{_tc(start)}" duration="{_tc(dur)}">{_position(az, el)}</audioBlockFormat>' for k, (start, dur, az, el) in enumerate(spans))


def _axml(objects: list[dict], rate: int, bed: bool = False, total_s: float = 0.0) -> bytes:
    parts = ['<?xml version="1.0" encoding="UTF-8"?>', '<ebuCoreMain xmlns="urn:ebu:metadata-schema:ebuCore_2016" xml:lang="en"><coreMetadata><format><audioFormatExtended>']
    first = 0x1002 if bed else 0x1001
    ids = (["AO_1001"] if bed else []) + [f"AO_{first + i:04X}" for i in range(len(objects))]
    parts.append('<audioProgramme audioProgrammeID="APR_1001" audioProgrammeName="formwav session"><audioContentIDRef>ACO_1001</audioContentIDRef></audioProgramme>')
    parts.append('<audioContent audioContentID="ACO_1001" audioContentName="formwav session">' + "".join(f"<audioObjectIDRef>{i}</audioObjectIDRef>" for i in ids) + "</audioContent>")
    if bed:
        # the bed: six channels on the common definitions (BS.2094), which a renderer knows by these ids
        parts.append('<audioObject audioObjectID="AO_1001" audioObjectName="Bed"><audioPackFormatIDRef>' + BED_PACK + "</audioPackFormatIDRef>" + "".join(f"<audioTrackUIDRef>ATU_{k + 1:08X}</audioTrackUIDRef>" for k in range(6)) + "</audioObject>")
        for k, tf in enumerate(BED_TRACKS):
            parts.append(f'<audioTrackUID UID="ATU_{k + 1:08X}" sampleRate="{rate}" bitDepth="24"><audioTrackFormatIDRef>{tf}</audioTrackFormatIDRef><audioPackFormatIDRef>{BED_PACK}</audioPackFormatIDRef></audioTrackUID>')
    offset = 6 if bed else 0
    for i, obj in enumerate(objects):
        n = f"{first + i:04X}"
        uid = f"ATU_{offset + i + 1:08X}"
        name = escape(str(obj.get("name") or f"Object {i + 1}"), quote=True)
        parts.append(f'<audioObject audioObjectID="AO_{n}" audioObjectName="{name}"><audioPackFormatIDRef>AP_0003{n}</audioPackFormatIDRef><audioTrackUIDRef>{uid}</audioTrackUIDRef></audioObject>')
        parts.append(f'<audioPackFormat audioPackFormatID="AP_0003{n}" audioPackFormatName="{name}" typeLabel="0003" typeDefinition="Objects"><audioChannelFormatIDRef>AC_0003{n}</audioChannelFormatIDRef></audioPackFormat>')
        parts.append(f'<audioChannelFormat audioChannelFormatID="AC_0003{n}" audioChannelFormatName="{name}" typeLabel="0003" typeDefinition="Objects">{_blocks(n, obj, total_s)}</audioChannelFormat>')
        parts.append(f'<audioStreamFormat audioStreamFormatID="AS_0003{n}" audioStreamFormatName="PCM_{name}" formatLabel="0001" formatDefinition="PCM"><audioChannelFormatIDRef>AC_0003{n}</audioChannelFormatIDRef><audioTrackFormatIDRef>AT_0003{n}_01</audioTrackFormatIDRef></audioStreamFormat>')
        parts.append(f'<audioTrackFormat audioTrackFormatID="AT_0003{n}_01" audioTrackFormatName="PCM_{name}" formatLabel="0001" formatDefinition="PCM"><audioStreamFormatIDRef>AS_0003{n}</audioStreamFormatIDRef></audioTrackFormat>')
        parts.append(f'<audioTrackUID UID="{uid}" sampleRate="{rate}" bitDepth="24"><audioTrackFormatIDRef>AT_0003{n}_01</audioTrackFormatIDRef><audioPackFormatIDRef>AP_0003{n}</audioPackFormatIDRef></audioTrackUID>')
    parts.append("</audioFormatExtended></format></coreMetadata></ebuCoreMain>")
    return "".join(parts).encode("utf-8")


def _chna(entries: list[tuple[str, str, str]]) -> bytes:
    """One entry per track: its UID, track format and pack (the bed's from the common definitions)."""
    body = struct.pack("<HH", len(entries), len(entries))
    for k, (uid, track, pack) in enumerate(entries):
        body += struct.pack("<H", k + 1) + uid.encode() + track.encode().ljust(14, b"\0") + pack.encode().ljust(11, b"\0") + b"\0"
    return body


def _float_wav(wav: bytes) -> tuple[np.ndarray, int]:
    i, rate, channels = 12, 0, 0
    while i + 8 <= len(wav):
        tag, size = wav[i : i + 4], struct.unpack_from("<I", wav, i + 4)[0]
        if tag == b"fmt ":
            channels, rate = struct.unpack_from("<HI", wav, i + 10)
        elif tag == b"data" and channels:
            return np.frombuffer(wav, "<f4", count=size // 4, offset=i + 8).reshape(-1, channels), rate
        i += 8 + size + (size % 2)
    raise ValueError("the render held no audio")


def export_session(document: dict, render_alone) -> bytes:
    """Objects from the tracks placed in the room (moving along their surround path when they have one, L2) and a 5.1 bed
    from the tracks marked as bed, mixed by render_51 as the session's 5.1 export mixes them."""
    objects, rate = [], 0
    doc_rate = float(document.get("sampleRate") or 48000)
    bed_tracks = []
    for i, track in enumerate(document.get("tracks") or []):
        place = track.get("surround") if isinstance(track, dict) else None
        if not isinstance(place, dict):
            continue
        if place.get("bed"):
            bed_tracks.append(track)
            continue
        audio, rate = _float_wav(render_alone(i)["wav"])
        x, y = float(place.get("x", 0.0)), float(place.get("y", 1.0))
        path = sorted(((float(p.get("at", 0)) / doc_rate, azimuth_of(float(p.get("x", 0.0)), float(p.get("y", 1.0))), float(p.get("el") or 0.0)) for p in place.get("path") or [] if isinstance(p, dict)), key=lambda p: p[0])
        objects.append({"name": track.get("name") or f"Track {i + 1}", "samples": audio.mean(axis=1), "azimuth": azimuth_of(x, y), "elevation": float(place.get("el") or 0.0), "path": path})
    bed = None
    if bed_tracks:
        from . import surround

        bed_audio, rate = _float_wav(surround.render_51({**document, "tracks": bed_tracks})["wav"])
        bed = [bed_audio[:, c] for c in range(6)]
    if not objects and bed is None:
        raise ValueError("place at least one track on the surround pad to export it as an object, or mark one as bed")
    return write_bwf(objects, rate, bed)


def write_bwf(objects: list[dict], rate: int, bed: list[np.ndarray] | None = None) -> bytes:
    if not objects and bed is None:
        raise ValueError("no objects to write")
    channels = (list(bed) if bed is not None else []) + [np.asarray(o["samples"], dtype=np.float64).reshape(-1) for o in objects]
    frames = max(len(c) for c in channels)
    count = len(channels)
    first = 0x1002 if bed is not None else 0x1001
    entries = ([(f"ATU_{k + 1:08X}", BED_TRACKS[k], BED_PACK) for k in range(6)] if bed is not None else []) + [(f"ATU_{(6 if bed is not None else 0) + i + 1:08X}", f"AT_0003{first + i:04X}_01", f"AP_0003{first + i:04X}") for i in range(len(objects))]
    fmt = struct.pack("<HHIIHH", 1, count, rate, rate * count * 3, count * 3, 24)
    body = b"WAVE" + _chunk(b"fmt ", fmt) + _chunk(b"chna", _chna(entries)) + _chunk(b"data", _pcm24(channels, frames)) + _chunk(b"axml", _axml(objects, rate, bed is not None, frames / rate))
    return b"RIFF" + struct.pack("<I", len(body)) + body
