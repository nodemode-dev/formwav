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


def _axml(objects: list[dict], rate: int) -> bytes:
    parts = ['<?xml version="1.0" encoding="UTF-8"?>', '<ebuCoreMain xmlns="urn:ebu:metadata-schema:ebuCore_2016" xml:lang="en"><coreMetadata><format><audioFormatExtended>']
    parts.append('<audioProgramme audioProgrammeID="APR_1001" audioProgrammeName="formwav session"><audioContentIDRef>ACO_1001</audioContentIDRef></audioProgramme>')
    parts.append('<audioContent audioContentID="ACO_1001" audioContentName="formwav objects">' + "".join(f"<audioObjectIDRef>AO_{0x1001 + i:04X}</audioObjectIDRef>" for i in range(len(objects))) + "</audioContent>")
    for i, obj in enumerate(objects):
        n = f"{0x1001 + i:04X}"
        name = escape(str(obj.get("name") or f"Object {i + 1}"), quote=True)
        az, el, dist = float(obj.get("azimuth", 0.0)), float(obj.get("elevation", 0.0)), float(obj.get("distance", 1.0))
        parts.append(f'<audioObject audioObjectID="AO_{n}" audioObjectName="{name}"><audioPackFormatIDRef>AP_0003{n}</audioPackFormatIDRef><audioTrackUIDRef>ATU_{i + 1:08X}</audioTrackUIDRef></audioObject>')
        parts.append(f'<audioPackFormat audioPackFormatID="AP_0003{n}" audioPackFormatName="{name}" typeLabel="0003" typeDefinition="Objects"><audioChannelFormatIDRef>AC_0003{n}</audioChannelFormatIDRef></audioPackFormat>')
        parts.append(
            f'<audioChannelFormat audioChannelFormatID="AC_0003{n}" audioChannelFormatName="{name}" typeLabel="0003" typeDefinition="Objects">'
            f'<audioBlockFormat audioBlockFormatID="AB_0003{n}_00000001"><position coordinate="azimuth">{az:.3f}</position>'
            f'<position coordinate="elevation">{el:.3f}</position><position coordinate="distance">{dist:.3f}</position></audioBlockFormat></audioChannelFormat>'
        )
        parts.append(f'<audioStreamFormat audioStreamFormatID="AS_0003{n}" audioStreamFormatName="PCM_{name}" formatLabel="0001" formatDefinition="PCM"><audioChannelFormatIDRef>AC_0003{n}</audioChannelFormatIDRef><audioTrackFormatIDRef>AT_0003{n}_01</audioTrackFormatIDRef></audioStreamFormat>')
        parts.append(f'<audioTrackFormat audioTrackFormatID="AT_0003{n}_01" audioTrackFormatName="PCM_{name}" formatLabel="0001" formatDefinition="PCM"><audioStreamFormatIDRef>AS_0003{n}</audioStreamFormatIDRef></audioTrackFormat>')
        parts.append(f'<audioTrackUID UID="ATU_{i + 1:08X}" sampleRate="{rate}" bitDepth="24"><audioTrackFormatIDRef>AT_0003{n}_01</audioTrackFormatIDRef><audioPackFormatIDRef>AP_0003{n}</audioPackFormatIDRef></audioTrackUID>')
    parts.append("</audioFormatExtended></format></coreMetadata></ebuCoreMain>")
    return "".join(parts).encode("utf-8")


def _chna(count: int) -> bytes:
    body = struct.pack("<HH", count, count)
    for i in range(count):
        n = f"{0x1001 + i:04X}"
        body += struct.pack("<H", i + 1) + f"ATU_{i + 1:08X}".encode() + f"AT_0003{n}_01".encode() + f"AP_0003{n}".encode() + b"\0"
    return body


def write_bwf(objects: list[dict], rate: int) -> bytes:
    if not objects:
        raise ValueError("no objects to write")
    channels = [np.asarray(o["samples"], dtype=np.float64).reshape(-1) for o in objects]
    frames = max(len(c) for c in channels)
    count = len(channels)
    fmt = struct.pack("<HHIIHH", 1, count, rate, rate * count * 3, count * 3, 24)
    body = b"WAVE" + _chunk(b"fmt ", fmt) + _chunk(b"chna", _chna(count)) + _chunk(b"data", _pcm24(channels, frames)) + _chunk(b"axml", _axml(objects, rate))
    return b"RIFF" + struct.pack("<I", len(body)) + body
