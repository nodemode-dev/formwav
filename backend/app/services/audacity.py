"""Audacity 2.x projects: the .aup XML and its _data folder of .au block files, zipped together, become a session document.

The .aup root is <project projname="X_data" rate="44100"> with <wavetrack name channel linked mute solo gain pan rate>
holding <waveclip offset="seconds"> holding <sequence sampleformat numsamples> holding <waveblock start="samples">
with one <simpleblockfile filename="e0000abcd.au" len="samples"/> or <silentblockfile len="samples"/>; <labeltrack> holds
<label t t1 title/>. Each .au block is a Sun audio file whose 24-byte header Audacity writes in the machine's own byte
order (little-endian on every machine that mattered, so the magic reads "dns." rather than ".snd"), with the samples at
the header's data offset, float32 for sampleformat 262159 and int16 for 131073 (the summary data sits between).
A linked pair of wavetracks (channel 0 with linked="1", then channel 1) becomes one stereo track when their clips line up.
"""

from __future__ import annotations

import io
import math
import struct
import zipfile
from xml.etree import ElementTree

import numpy as np

from . import media

AU_FLOAT = 6
AU_INT16 = 3


def _tag(element: ElementTree.Element) -> str:
    return element.tag.rsplit("}", 1)[-1]


def _read_au(data: bytes, count: int) -> np.ndarray:
    if len(data) < 24:
        raise media.MediaError("a block file is shorter than its header")
    magic = data[:4]
    if magic == b".snd":
        order = ">"
    elif magic == b"dns.":
        order = "<"
    else:
        raise media.MediaError("a block file is not an Audacity .au block")
    offset, _size, encoding, _rate, channels = struct.unpack(order + "IIIII", data[4:24])
    if channels != 1:
        raise media.MediaError("a block file holds more than one channel, which Audacity never writes")
    if encoding == AU_FLOAT:
        samples = np.frombuffer(data, dtype=order + "f4", offset=offset, count=min(count, (len(data) - offset) // 4)).astype(np.float32)
    elif encoding == AU_INT16:
        samples = (np.frombuffer(data, dtype=order + "i2", offset=offset, count=min(count, (len(data) - offset) // 2)).astype(np.float32) / 32768.0)
    else:
        raise media.MediaError(f"a block file uses .au encoding {encoding}, which this reader does not take (float and 16-bit only)")
    if len(samples) < count:
        samples = np.concatenate([samples, np.zeros(count - len(samples), dtype=np.float32)])
    return samples


def _wav_bytes(channels: list[np.ndarray], rate: int) -> bytes:
    frames = min(len(c) for c in channels)
    inter = np.stack([c[:frames] for c in channels], axis=1).astype("<f4").tobytes()
    header = struct.pack("<4sI4s4sIHHIIHH4sI", b"RIFF", 36 + len(inter), b"WAVE", b"fmt ", 16, 3, len(channels), rate, rate * 4 * len(channels), 4 * len(channels), 32, b"data", len(inter))
    return header + inter


def _clip_samples(clip: ElementTree.Element, blocks: dict[str, bytes]) -> np.ndarray:
    parts: list[np.ndarray] = []
    for sequence in clip:
        if _tag(sequence) != "sequence":
            continue
        for block in sorted((b for b in sequence if _tag(b) == "waveblock"), key=lambda b: int(b.get("start", "0"))):
            for part in block:
                kind = _tag(part)
                count = int(part.get("len", "0"))
                if kind == "simpleblockfile":
                    name = part.get("filename", "")
                    if name not in blocks:
                        raise media.MediaError(f"the block file {name} is missing from the zip; zip the .aup with its whole _data folder")
                    parts.append(_read_au(blocks[name], count))
                elif kind == "silentblockfile":
                    parts.append(np.zeros(count, dtype=np.float32))
                elif kind in ("pcmaliasblockfile", "odpcmaliasblockfile", "oddecodeblockfile"):
                    raise media.MediaError("this project references audio outside its _data folder (an aliased file); open it in Audacity and save a copy that embeds its audio first")
    return np.concatenate(parts) if parts else np.zeros(0, dtype=np.float32)


def import_aup_zip(data: bytes) -> dict:
    """The zipped .aup project and its _data folder, as a session document with its media stored."""
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as err:
        raise media.MediaError("the file is not a zip; zip the .aup with its _data folder and import that") from err
    names = [n for n in z.namelist() if "__MACOSX" not in n]
    aups = [n for n in names if n.lower().endswith(".aup")]
    if not aups:
        raise media.MediaError("the zip holds no .aup project; zip the .aup file together with its _data folder")
    aup_name = aups[0]
    blocks = {n.rsplit("/", 1)[-1]: z.read(n) for n in names if n.lower().endswith(".au")}
    try:
        root = ElementTree.fromstring(z.read(aup_name))
    except ElementTree.ParseError as err:
        raise media.MediaError(f"the .aup is not well-formed XML: {err}") from err
    if _tag(root) != "project":
        raise media.MediaError("the .aup does not start with a <project> element")
    rate = int(float(root.get("rate", "44100")))
    tracks: list[dict] = []
    markers: list[dict] = []
    regions: list[dict] = []
    wave_tracks = [t for t in root if _tag(t) == "wavetrack"]
    i = 0
    counter = 0
    while i < len(wave_tracks):
        t = wave_tracks[i]
        partner = wave_tracks[i + 1] if t.get("linked") == "1" and i + 1 < len(wave_tracks) else None
        clips_a = [c for c in t if _tag(c) == "waveclip"]
        clips_b = [c for c in partner if _tag(c) == "waveclip"] if partner is not None else []
        stereo = partner is not None and len(clips_a) == len(clips_b) and all(a.get("offset") == b.get("offset") for a, b in zip(clips_a, clips_b))
        track_rate = int(float(t.get("rate", str(rate))))
        clips: list[dict] = []
        for n, clip in enumerate(clips_a):
            left = _clip_samples(clip, blocks)
            channels = [left, _clip_samples(clips_b[n], blocks)] if stereo else [left]
            counter += 1
            name = f"{t.get('name', 'Audio Track')} clip {counter}.wav"
            ref = media.import_wav(name, _wav_bytes(channels, track_rate))
            start = int(round(float(clip.get("offset", "0")) * rate))
            frames = int(ref["frames"])
            clips.append({"id": f"aup-clip-{counter}", "mediaId": ref["id"], "start": start, "length": int(round(frames * rate / int(ref["sampleRate"]))), "sourceIn": 0, "gainDb": 0})
        gain = float(t.get("gain", "1"))
        tracks.append(
            {
                "id": f"aup-track-{len(tracks) + 1}",
                "name": t.get("name", "Audio Track"),
                "channels": 2 if stereo else 1,
                "gainDb": round(20 * math.log10(gain), 2) if gain > 0 else -60,
                "mute": t.get("mute") == "1",
                "solo": t.get("solo") == "1",
                "pan": float(t.get("pan", "0")),
                "clips": clips,
            }
        )
        i += 2 if stereo else 1
    for lt in (t for t in root if _tag(t) == "labeltrack"):
        for label in (l for l in lt if _tag(l) == "label"):
            a, b = float(label.get("t", "0")), float(label.get("t1", label.get("t", "0")))
            title = label.get("title", "")
            if b > a:
                regions.append({"id": f"aup-region-{len(regions) + 1}", "start": int(round(a * rate)), "end": int(round(b * rate)), "label": title})
            else:
                markers.append({"id": f"aup-marker-{len(markers) + 1}", "at": int(round(a * rate)), "label": title})
    media_refs = {c["mediaId"]: media.media_info(c["mediaId"]) for t in tracks for c in t["clips"]}
    doc = {"sampleRate": rate, "tracks": tracks, "media": media_refs, "markers": markers, **({"regions": regions} if regions else {})}
    return {"name": aup_name.rsplit("/", 1)[-1][:-4], "document": doc, "tracks": len(tracks), "clips": sum(len(t["clips"]) for t in tracks), "labels": len(markers) + len(regions)}
