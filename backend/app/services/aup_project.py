""".aup (2.x) projects: the .aup XML and its _data folder of .au block files, zipped together, become a session document.

The .aup root is <project projname="X_data" rate="44100"> with <wavetrack name channel linked mute solo gain pan rate>
holding <waveclip offset="seconds"> holding <sequence sampleformat numsamples> holding <waveblock start="samples">
with one <simpleblockfile filename="e0000abcd.au" len="samples"/> or <silentblockfile len="samples"/>; <labeltrack> holds
<label t t1 title/>. Each .au block is a Sun audio file whose 24-byte header is written in the machine's own byte
order (little-endian on every machine that mattered, so the magic reads "dns." rather than ".snd"), with the samples at
the header's data offset, float32 for sampleformat 262159 and int16 for 131073 (the summary data sits between).
A linked pair of wavetracks (channel 0 with a non-zero linked: "1" in older projects, a link type in .aup3's;
then channel 1) becomes one stereo track when their clips line up.
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
        raise media.MediaError("a block file is not an .aup .au block")
    offset, _size, encoding, _rate, channels = struct.unpack(order + "IIIII", data[4:24])
    if channels != 1:
        raise media.MediaError("a block file holds more than one channel, which an .aup project never writes")
    if offset > len(data):
        raise media.MediaError("a block file's data offset lies past its end")
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


class _Aliases:
    """AU-34: the files uploaded beside an .aup, read as an aliased block: each file decoded once (its own
    channels and rate) and sliced by frame and channel; a file the project needs and the upload lacks is named."""

    def __init__(self, files: dict[str, bytes]):
        self.files = files
        self.decoded: dict[str, np.ndarray] = {}

    def read(self, path: str, start: int, count: int, channel: int) -> np.ndarray:
        import subprocess
        import tempfile

        name = path.replace("\\", "/").rsplit("/", 1)[-1]
        if name not in self.decoded:
            if name not in self.files:
                raise media.MediaError(f"this project reads audio from {name} in place (an aliased file, outside its _data folder); add {name} to the zip beside the .aup and import again")
            with tempfile.NamedTemporaryFile(suffix="." + name.rsplit(".", 1)[-1]) as tmp:
                tmp.write(self.files[name])
                tmp.flush()
                probe = subprocess.run([media._tool("ffprobe"), "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels", "-of", "csv=p=0", tmp.name], capture_output=True, text=True, timeout=60)
                channels = int((probe.stdout.strip() or "0").split(",")[0] or 0)
                pcm = subprocess.run([media._tool("ffmpeg"), "-v", "error", "-nostdin", "-i", tmp.name, "-f", "f32le", "-acodec", "pcm_f32le", "-"], capture_output=True, timeout=600)
            if probe.returncode != 0 or channels < 1 or pcm.returncode != 0:
                raise media.MediaError(f"could not read {name}, the audio this project reads in place")
            self.decoded[name] = np.frombuffer(pcm.stdout, dtype="<f4").reshape(-1, channels)
        audio = self.decoded[name]
        if channel >= audio.shape[1] or start < 0 or start + count > audio.shape[0]:
            raise media.MediaError(f"{name} is shorter than this project expects (frames {start} to {start + count}, channel {channel}); is it the same file?")
        return audio[start : start + count, channel].astype(np.float32)


def _clip_samples(clip: ElementTree.Element, blocks: dict[str, bytes], aliases: _Aliases | None = None) -> np.ndarray:
    parts: list[np.ndarray] = []
    for sequence in clip:
        if _tag(sequence) != "sequence":
            continue
        for block in sorted((b for b in sequence if _tag(b) == "waveblock"), key=lambda b: int(b.get("start", "0"))):
            if block.get("blockid") is not None and not len(block):
                # AU-33: an .aup3 block names a row of its sampleblocks table, decoded beforehand into samples
                key = f"#{block.get('blockid')}"
                if key not in blocks:
                    raise media.MediaError(f"sample block {block.get('blockid')} is missing from the project")
                parts.append(np.asarray(blocks[key], dtype=np.float32))
                continue
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
                elif kind in ("pcmaliasblockfile", "odpcmaliasblockfile") and aliases is not None:
                    # AU-34: .aup projects of 2.3.2 and earlier could read a WAV in place rather than copy it: the block names
                    # the file, the first frame, the length and the channel. The file comes in the upload beside the .aup,
                    # matched by its name (the path recorded is the machine's that made the project)
                    length = int(part.get("aliaslen", part.get("len", "0")))  # an alias block has aliaslen, not len
                    parts.append(aliases.read(part.get("aliasfile", ""), int(part.get("aliasstart", "0")), length, int(part.get("aliaschannel", "0"))))
                elif kind in ("pcmaliasblockfile", "odpcmaliasblockfile", "oddecodeblockfile"):
                    raise media.MediaError("this project references audio outside its _data folder (an aliased file); re-save the .aup project as a copy that embeds its audio, then import that")
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
    # AU-34: any other file in the upload may be audio the project reads in place (an aliased file), by its name
    others = {n.rsplit("/", 1)[-1]: n for n in names if not n.endswith("/") and not n.lower().endswith((".au", ".auf", ".aup"))}
    aliases = _Aliases({name: z.read(path) for name, path in others.items()})
    try:
        root = ElementTree.fromstring(z.read(aup_name))
    except ElementTree.ParseError as err:
        raise media.MediaError(f"the .aup is not well-formed XML: {err}") from err
    return _session_from_root(root, blocks, aup_name.rsplit("/", 1)[-1][:-4], aliases)


def _session_from_root(root: ElementTree.Element, blocks: dict, project_name: str, aliases: _Aliases | None = None) -> dict:
    """An .aup project's <project> element as a session document with its media stored, shared by .aup (block
    files by name) and .aup3 (sample blocks by id)."""
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
        # a stereo pair: older .aup files wrote linked="1", .aup3 a link type (2 grouped, 3 aligned; 3.4.2 wrote 3)
        partner = wave_tracks[i + 1] if t.get("linked", "0") not in ("0", "") and i + 1 < len(wave_tracks) else None
        clips_a = [c for c in t if _tag(c) == "waveclip"]
        clips_b = [c for c in partner if _tag(c) == "waveclip"] if partner is not None else []
        stereo = partner is not None and len(clips_a) == len(clips_b) and all(a.get("offset") == b.get("offset") for a, b in zip(clips_a, clips_b))
        track_rate = int(float(t.get("rate", str(rate))))
        clips: list[dict] = []
        for n, clip in enumerate(clips_a):
            left = _clip_samples(clip, blocks, aliases)
            channels = [left, _clip_samples(clips_b[n], blocks, aliases)] if stereo else [left]
            counter += 1
            name = f"{t.get('name', 'Audio Track')} clip {counter}.wav"
            ref = media.import_wav(name, _wav_bytes(channels, track_rate))
            start = int(round(float(clip.get("offset", "0")) * rate))
            frames = int(ref["frames"])
            # AU-34: the clip's volume envelope, its control points timed from the clip's start (2.4.2 stores a
            # point set at 2.5 s on a clip at 2 s as t="0.5") and linear in gain between points, as formwav's are; a
            # gain below formwav's -60 dB floor is held there
            points = [(float(p.get("t", "0")), float(p.get("val", "1"))) for e in clip if _tag(e) == "envelope" for p in e if _tag(p) == "controlpoint"]
            envelope = [{"at": int(round(at * track_rate)), "db": round(max(-60.0, min(12.0, 20 * math.log10(max(v, 1e-9)))), 4)} for at, v in points]
            clips.append({"id": f"aup-clip-{counter}", "mediaId": ref["id"], "start": start, "length": int(round(frames * rate / int(ref["sampleRate"]))), "sourceIn": 0, "gainDb": 0, **({"envelope": envelope} if envelope else {})})
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
    # AU-34: the view the project was left in: its zoom in pixels a second over formwav's 100 at zoom 1 (held to
    # its 0.25 to 16), its left edge h in seconds, its selection sel0 to sel1 (the same attributes in .aup and .aup3)
    view: dict = {}
    try:
        zoom, h = float(root.get("zoom", "0")), float(root.get("h", "0"))
        sel0, sel1 = float(root.get("sel0", "0")), float(root.get("sel1", "0"))
    except ValueError:
        zoom = h = sel0 = sel1 = 0.0
    if zoom > 0:
        view["zoom"] = round(max(0.25, min(16.0, zoom / 100.0)), 4)
    if h > 0:
        view["scrollSeconds"] = round(h, 3)
    if sel1 > sel0:
        view["selection"] = {"start": int(round(sel0 * rate)), "end": int(round(sel1 * rate))}
    if view:
        doc["view"] = view
    return {"name": project_name, "document": doc, "tracks": len(tracks), "clips": sum(len(t["clips"]) for t in tracks), "labels": len(markers) + len(regions)}


# AU-33: an .aup3 is one SQLite file: the project as a binary serialisation (a name dictionary and a
# document of tokens) in its project table, the audio in its sampleblocks table. The file is only ever read from a
# temporary copy, so the original is never changed (opening it in place would replay or take its log and lock).
_SAMPLE_FORMATS = {0x0004000F: "<f4", 0x00020001: "<i2", 0x00040001: "<i4"}  # float, 16-bit, 24-bit held in 32


def _decode_aup3(dict_blob: bytes, doc_blob: bytes) -> str:
    """The .aup3 serializer's tokens back into the project's XML, strictly: an unknown token, an attribute outside
    a tag or a mismatched end tag fails loudly rather than reading on misaligned. Widths as .aup3 files of 3.4.2 write them
    (attribute and tag names as 16-bit ids; int, long and size_t 32-bit; long long 64-bit; characters as the file's
    char-size token says)."""
    names: dict[int, str] = {}
    out: list[str] = []
    stack: list[str] = []
    state = {"char": 4, "open": False}

    def text(b: bytes) -> str:
        return b.decode({4: "utf-32-le", 2: "utf-16-le"}.get(state["char"], "utf-8"))

    def run(buf: bytes, emit: bool) -> None:
        i = 0
        while i < len(buf):
            t = buf[i]
            i += 1
            if t == 0:  # char size
                state["char"] = buf[i]
                i += 1
            elif t == 15:  # a name: id, length, text
                nid, n = struct.unpack_from("<HH", buf, i)
                i += 4
                names[nid] = text(buf[i : i + n])
                i += n
            elif t == 1:  # start tag
                (nid,) = struct.unpack_from("<H", buf, i)
                i += 2
                if state["open"]:
                    out.append(">")
                out.append(f"<{names[nid]}")
                stack.append(names[nid])
                state["open"] = True
            elif t == 2:  # end tag
                (nid,) = struct.unpack_from("<H", buf, i)
                i += 2
                if not stack or stack[-1] != names[nid]:
                    raise media.MediaError("the .aup3 project document is not one formwav can read (its tags do not nest)")
                stack.pop()
                out.append("/>" if state["open"] else f"</{names[nid]}>")
                state["open"] = False
            elif 3 <= t <= 10:  # an attribute: id, then its typed value
                (nid,) = struct.unpack_from("<H", buf, i)
                i += 2
                if t == 3:
                    (n,) = struct.unpack_from("<i", buf, i)
                    value: object = text(buf[i + 4 : i + 4 + n])
                    i += 4 + n
                elif t in (4, 6, 8):  # int, long, size_t
                    (value,) = struct.unpack_from("<i", buf, i)
                    i += 4
                elif t == 5:
                    value = int(buf[i])
                    i += 1
                elif t == 7:  # long long
                    (value,) = struct.unpack_from("<q", buf, i)
                    i += 8
                elif t == 9:  # float and its digits
                    (value,) = struct.unpack_from("<f", buf, i)
                    i += 8
                else:  # double and its digits
                    (value,) = struct.unpack_from("<d", buf, i)
                    i += 12
                if not state["open"]:
                    raise media.MediaError("the .aup3 project document is not one formwav can read (an attribute outside a tag)")
                out.append(f' {names[nid]}="{str(value).replace("&", "&amp;").replace(chr(34), "&quot;").replace("<", "&lt;")}"')
            elif t in (11, 12):  # data inside a tag, or raw text such as the XML declaration
                (n,) = struct.unpack_from("<i", buf, i)
                s = text(buf[i + 4 : i + 4 + n])
                i += 4 + n
                if t == 11:
                    if state["open"]:
                        out.append(">")
                        state["open"] = False
                    out.append(s.replace("&", "&amp;").replace("<", "&lt;"))
                elif emit:
                    out.append(s)
            elif t in (13, 14):  # push and pop
                continue
            else:
                raise media.MediaError(f"the .aup3 project document holds a token formwav does not know ({t})")

    run(dict_blob, False)
    run(doc_blob, True)
    if stack:
        raise media.MediaError("the .aup3 project document ends inside a tag")
    return "".join(out)


def import_aup3(data: bytes, project_name: str = "Imported project") -> dict:
    """An .aup3 project as a session document with its media stored, through the builder .aup uses: each
    clip's sample blocks joined (silent blocks, negative ids, as silence) and its trims applied, its offset moved by
    the left trim. Clips stretched by the 3.4 clip stretching are refused rather than read wrong."""
    import sqlite3
    import tempfile
    from pathlib import Path

    if not data.startswith(b"SQLite format 3\x00"):
        raise media.MediaError("this is not an .aup3 project (.aup3 files are SQLite databases)")
    with tempfile.TemporaryDirectory(prefix="formwav-aup3-") as tmp:
        copy = Path(tmp) / "project.aup3"
        copy.write_bytes(data)
        db = sqlite3.connect(str(copy))
        try:
            tables = {r[0] for r in db.execute("select name from sqlite_master where type='table'")}
            row = db.execute("select dict, doc from project").fetchone() if "project" in tables else None
            if row is None and "autosave" in tables:
                row = db.execute("select dict, doc from autosave").fetchone()
            if row is None:
                raise media.MediaError("the .aup3 holds no saved project")
            try:
                root = ElementTree.fromstring(_decode_aup3(bytes(row[0]), bytes(row[1])))
            except ElementTree.ParseError as err:
                raise media.MediaError(f"the .aup3 project document did not decode to well-formed XML: {err}") from err
            blocks: dict = {}
            cache: dict[int, np.ndarray] = {}

            def block(bid: int) -> np.ndarray:
                if bid <= 0:
                    return np.zeros(-bid, dtype=np.float32)  # a silent block's id is minus its length
                if bid not in cache:
                    hit = db.execute("select sampleformat, samples from sampleblocks where blockid = ?", (bid,)).fetchone()
                    if hit is None or int(hit[0]) not in _SAMPLE_FORMATS:
                        raise media.MediaError(f"sample block {bid} is missing from the .aup3 or in a format formwav does not read")
                    raw = np.frombuffer(bytes(hit[1]), dtype=_SAMPLE_FORMATS[int(hit[0])]).astype(np.float32)
                    cache[bid] = raw if int(hit[0]) == 0x0004000F else raw / (32768.0 if int(hit[0]) == 0x00020001 else 8388608.0)
                return cache[bid]

            n = 0
            for track in (t for t in root if _tag(t) == "wavetrack"):
                rate = float(track.get("rate", root.get("rate", "44100")))
                for clip in (c for c in track if _tag(c) == "waveclip"):
                    if abs(float(clip.get("clipStretchRatio", "1")) - 1) > 1e-9:
                        raise media.MediaError("this .aup3 project stretches a clip (the 3.4 clip stretching), which formwav does not read yet; render the stretch and save the .aup3 again first")
                    for sequence in (s for s in clip if _tag(s) == "sequence"):
                        wave_blocks = sorted((b for b in sequence if _tag(b) == "waveblock"), key=lambda b: int(b.get("start", "0")))
                        samples = np.concatenate([block(int(b.get("blockid", "0"))) for b in wave_blocks]) if wave_blocks else np.zeros(0, dtype=np.float32)
                        left = int(round(float(clip.get("trimLeft", "0")) * rate))
                        right = int(round(float(clip.get("trimRight", "0")) * rate))
                        samples = samples[left : max(left, len(samples) - right)]
                        n += 1
                        blocks[f"#aup3-{n}"] = samples
                        tag = wave_blocks[0].tag if wave_blocks else sequence.tag.replace("sequence", "waveblock")
                        for b in wave_blocks:
                            sequence.remove(b)
                        ElementTree.SubElement(sequence, tag, {"start": "0", "blockid": f"aup3-{n}"})
                    clip.set("offset", repr(float(clip.get("offset", "0")) + float(clip.get("trimLeft", "0"))))
            return _session_from_root(root, blocks, project_name)
        finally:
            db.close()
