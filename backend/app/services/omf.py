"""OMF 2 interchange, reading (PLAN_v12 R11): an OMF 2.0 file's composition opened as a session, its embedded audio
imported as media. Written here from the Bento container's layout and the OMF object model as two open readers
implement them: Omfoo (David Miller, 2022, github.com/OmfooGuy/Omfoo, a zlib-style licence that asks for this
acknowledgment) and Hannes Breul's OMF import (zlib licence). No code of theirs is used.

The Bento layer: the file's last 24 bytes are its label (magic A4434DA5486472D7, flags, the TOC's block size in KB,
the major and minor version, the TOC's offset and size); major 2 is little-endian and 512 big-endian (OMF 1 is 1 and
256, not read here). The TOC is a byte stream of codes: 1 a new object, property and type; 2 a new property and type;
3 a new type; 4 a generation; 5 to 8 and 25, 26 a value at an offset (continued fragments join the one before); 9 to 14
a value of 0 to 4 bytes held in the TOC itself; 15 a reference list (bookkeeping); 24 the rest of the block is empty;
255 a filler. Property and type ids name objects whose own values (type 21, a string) are their names.

The OMF layer: every object has OMFI:OOBJ:ObjClass (four letters). A reference (omfi:ObjRef) is the target's object
id; an array of them (omfi:ObjRefArray) a 16-bit count and the ids. A composition mob (CMOB) has slots (MSLT), each a
segment (a SEQU of components, or one component) at an edit rate; a source clip (SCLP) names the mob it plays by
MobID, a track in it and a start; a filler (FILL) is silence. A clip's mob is followed through master mobs (MMOB) to
the file source mob (SMOB) whose media data (MDAT: WAVE or AIFC) the file carries, the whole audio file in
OMFI:WAVE:data or OMFI:AIFC:data. A file source mob with a WAVD or AIFD description and no media data is an outside
file: its audio comes from a zip of the .omf and its files, matched by file name, or it is named as missing. A NEST
(a nested scope) plays its first slot's clip. The session starts at the earliest clip.
"""

import struct

from . import media

MAGIC = bytes.fromhex("a4434da5486472d7")
SIZES = {1: 12, 2: 8, 3: 4, 4: 4, 5: 8, 6: 8, 7: 12, 8: 12, 9: 0, 10: 4, 11: 4, 12: 4, 13: 4, 14: 4, 15: 4, 16: 4, 17: 4,
         18: 8, 19: 8, 20: 8, 21: 12, 22: 12, 23: 12, 25: 16, 26: 16}


class OmfFile:
    """An OMF 2 file's objects: props[object][property name] = (type name, [fragments]), each fragment either bytes
    held in the TOC or an (offset, length) into the file."""

    def __init__(self, data: bytes):
        if len(data) < 256 or data[-24:-16] != MAGIC:
            raise media.MediaError("the file is not an OMF file (no Bento label at its end)")
        major = struct.unpack("<H", data[-12:-10])[0]
        if major in (1, 256):
            raise media.MediaError("the file is OMF 1, which formwav does not read; save it as OMF 2")
        if major not in (2, 512):
            raise media.MediaError("the file's Bento label is not one formwav knows")
        self.E = "<" if major == 2 else ">"
        self.data = data
        block = struct.unpack(self.E + "H", data[-14:-12])[0] << 10
        at, size = struct.unpack(self.E + "II", data[-8:])
        if at + size > len(data) or block == 0:
            raise media.MediaError("the OMF file is cut short or damaged")
        raw: dict[int, dict[int, tuple[int, list]]] = {}
        toc, i, obj, prop, typ = data[at: at + size], 0, 0, 0, 0
        E = self.E
        while i < len(toc):
            c = toc[i]
            if c == 0xFF:
                i += 1
                continue
            if c == 24:
                i = (i // block + 1) * block
                continue
            if c not in SIZES:
                raise media.MediaError(f"the OMF file's table of contents is damaged (code {c})")
            body = toc[i + 1: i + 1 + SIZES[c]]
            frag = None
            if c == 1:
                obj, prop, typ = struct.unpack(E + "III", body)
            elif c == 2:
                prop, typ = struct.unpack(E + "II", body)
            elif c == 3:
                (typ,) = struct.unpack(E + "I", body)
            elif c in (5, 6):
                frag = struct.unpack(E + "II", body)
            elif c in (7, 8):
                frag = struct.unpack(E + "QI", body)
            elif c in (25, 26):
                frag = struct.unpack(E + "QQ", body)
            elif 9 <= c <= 13:
                frag = body[: c - 9]
            elif c == 14:
                frag = body
            if frag is not None:
                entry = raw.setdefault(obj, {}).setdefault(prop, (typ, []))
                entry[1].append(frag)
            i += 1 + SIZES[c]
        # names: a property or type id is an object whose string value is its name
        names = {}
        for o, ps in raw.items():
            for _, (t, frags) in ps.items():
                if t == 21:
                    names[o] = self._bytes(frags).split(b"\0", 1)[0].decode("latin-1")
        self.props = {o: {names.get(p, str(p)): (names.get(t, str(t)), frags) for p, (t, frags) in ps.items()} for o, ps in raw.items()}

    def _bytes(self, frags: list) -> bytes:
        return b"".join(f if isinstance(f, bytes) else self.data[f[0]: f[0] + f[1]] for f in frags)

    def has(self, o: int, name: str) -> bool:
        return name in self.props.get(o, {})

    def raw(self, o: int, name: str) -> bytes:
        return self._bytes(self.props[o][name][1]) if self.has(o, name) else b""

    def cls(self, o: int) -> str:
        return self.raw(o, "OMFI:OOBJ:ObjClass")[:4].decode("latin-1")

    def int(self, o: int, name: str, default: int = 0) -> int:
        b = self.raw(o, name)
        fmt = {1: "b", 2: "h", 4: "i", 8: "q"}.get(len(b))
        return struct.unpack(self.E + fmt, b)[0] if fmt else default

    def ref(self, o: int, name: str) -> int:
        b = self.raw(o, name)
        return struct.unpack(self.E + "I", b[:4])[0] if len(b) >= 4 else 0

    def refs(self, o: int, name: str) -> list[int]:
        b = self.raw(o, name)
        if len(b) < 2:
            return []
        n = struct.unpack(self.E + "H", b[:2])[0]
        return list(struct.unpack(self.E + "I" * n, b[2: 2 + 4 * n]))

    def string(self, o: int, name: str) -> str:
        return self.raw(o, name).split(b"\0", 1)[0].decode("latin-1", errors="replace")

    def rational(self, o: int, name: str) -> float:
        b = self.raw(o, name)
        if len(b) < 8:
            return 0.0
        num, den = struct.unpack(self.E + "ii", b[:8])
        return num / den if den else 0.0

    def mob_id(self, o: int) -> bytes:
        return self.raw(o, "OMFI:MOBJ:MobID")[:12]

    def objects(self, cls: str) -> list[int]:
        return [o for o in self.props if self.cls(o) == cls]


def _track_id(f: OmfFile, slot: int) -> int:
    return f.int(f.ref(slot, "OMFI:MSLT:TrackDesc"), "OMFI:TRKD:TrackID")


def _clip_of(f: OmfFile, segment: int) -> int:
    """The source clip a segment plays: itself, the first in a sequence, or the first segment of a nested scope."""
    for _ in range(8):
        kind = f.cls(segment)
        if kind == "SCLP":
            return segment
        if kind == "NEST":
            nested = f.refs(segment, "OMFI:NEST:Slots")
            segment = nested[0] if nested else 0
            continue
        if kind == "SEQU":
            segment = next((c for c in f.refs(segment, "OMFI:SEQU:Components") if f.cls(c) in ("SCLP", "NEST")), 0)
            continue
        return 0
    return 0


def import_omf(data: bytes, beside: dict[str, bytes] | None = None) -> dict:
    """An OMF 2 file's top composition as a session: one track per sound slot, its clips where they sit (the session
    starting at the first clip, as editors place a composition at a timecode an hour or more in), their audio from the
    file's own media data, or from the files that came with it (`beside`, by the source's file name)."""
    beside = {k.rsplit("/", 1)[-1].lower(): v for k, v in (beside or {}).items()}
    f = OmfFile(data)
    mobs = {f.mob_id(o): o for o in f.props if f.has(o, "OMFI:MOBJ:MobID")}
    # media data objects: OMFI:MDAT:MobID in OMF 2 (some writers name it by the class, OMFI:WAVE:MobID)
    media_data = {f.raw(o, k)[:12]: o for o in f.props for k in f.props[o] if k.endswith(":MobID") and k != "OMFI:MOBJ:MobID"}
    comps = f.objects("CMOB")
    if not comps:
        raise media.MediaError("the OMF file holds no composition")
    # the top composition: the one no other composition's clip or nested scope points at (the rest are its parts)
    used = {f.raw(c, "OMFI:SCLP:SourceID")[:12] for c in f.objects("SCLP")}
    top = next((c for c in comps if f.mob_id(c) not in used), comps[0])
    imported: dict[bytes, dict | None] = {}
    missing: list[str] = []

    def slot_rate(mob: int, track: int) -> float:
        for s in f.refs(mob, "OMFI:MOBJ:Slots"):
            if not track or _track_id(f, s) in (track, 0):
                return f.rational(s, "OMFI:MSLT:EditRate")
        return 0.0

    def resolve(mob_id: bytes, track: int, units: int, carry: float = 0.0, depth: int = 0) -> tuple[dict | None, float]:
        """The media a clip ends at, and where in it in seconds, following master mobs to the file: each clip's start
        counts the edit units of the slot it points into, so it becomes seconds by that slot's edit rate."""
        mob = mobs.get(mob_id)
        if mob is None or depth > 8:
            return None, 0
        here = slot_rate(mob, track)
        if not here:
            here = f.rational(f.ref(mob, "OMFI:SMOB:MediaDescription"), "OMFI:MDFL:SampleRate") or 48000.0
        start = carry + units / here
        if mob_id in media_data:
            if mob_id not in imported:
                md = media_data[mob_id]
                # the payload: OMFI:WAVE:AudioData or OMFI:AIFC:AudioData in OMF 2, ...:Data in some writers; where it
                # holds samples alone, the description's summary (the file's header) goes in front
                key = next((k for k in f.props[md] if k.endswith(":AudioData")), None) or next((k for k in f.props[md] if k.endswith(":Data")), None)
                audio = f.raw(md, key) if key else b""
                if audio and audio[:4] not in (b"RIFF", b"FORM"):
                    desc = f.ref(mob, "OMFI:SMOB:MediaDescription")
                    summary = f.raw(desc, "OMFI:WAVD:Summary") or f.raw(desc, "OMFI:AIFD:Summary")
                    audio = summary + audio if summary[:4] in (b"RIFF", b"FORM") else b""
                name = f.string(mob, "OMFI:MOBJ:Name") or "omf audio"
                try:
                    imported[mob_id] = media.import_audio(f"{name}.wav" if audio[:4] == b"RIFF" else f"{name}.aif", audio) if audio else None
                except media.MediaError:
                    imported[mob_id] = None
                if imported[mob_id] is None:
                    missing.append(name)
            return imported[mob_id], start
        # a file source mob is where the chain ends, though its own slot names the source it was taken from
        if f.cls(f.ref(mob, "OMFI:SMOB:MediaDescription")) in ("WAVD", "AIFD"):
            return outside(mob_id, mob), start
        for slot in f.refs(mob, "OMFI:MOBJ:Slots"):
            if track and _track_id(f, slot) not in (track, 0):
                continue
            clip = _clip_of(f, f.ref(slot, "OMFI:MSLT:Segment"))
            if clip:
                return resolve(f.raw(clip, "OMFI:SCLP:SourceID")[:12], f.int(clip, "OMFI:SCLP:SourceTrackID"), f.int(clip, "OMFI:SCLP:StartTime"), start, depth + 1)
        return None, 0

    def outside(mob_id: bytes, mob: int) -> dict | None:
        """A file source mob's audio, from the files that came with the .omf (by its file name), or noted as missing."""
        name = f.string(mob, "OMFI:MOBJ:Name") or "an outside file"
        if mob_id not in imported:
            audio = beside.get(name.lower())
            try:
                imported[mob_id] = media.import_audio(name, audio) if audio else None
            except media.MediaError:
                imported[mob_id] = None
            if imported[mob_id] is None:
                missing.append(name)
        return imported[mob_id]

    # the session's rate: the composition's sound edit rate where it is an audio rate (positions then stay exact),
    # 48 kHz where it counts frames
    sound_rate = next((f.rational(s, "OMFI:MSLT:EditRate") for s in f.refs(top, "OMFI:MOBJ:Slots") if "sound" in f.string(f.ref(f.ref(s, "OMFI:MSLT:Segment"), "OMFI:CPNT:DataKind"), "OMFI:DDEF:DataKindID").lower()), 0.0)
    rate = int(sound_rate) if sound_rate >= 8000 else 48000
    tracks, counter = [], 0
    for slot in f.refs(top, "OMFI:MOBJ:Slots"):
        seg = f.ref(slot, "OMFI:MSLT:Segment")
        kind = f.string(f.ref(seg, "OMFI:CPNT:DataKind"), "OMFI:DDEF:DataKindID")
        if "sound" not in kind.lower():
            continue
        edit = f.rational(slot, "OMFI:MSLT:EditRate") or 48000.0
        parts = f.refs(seg, "OMFI:SEQU:Components") if f.cls(seg) == "SEQU" else [seg]
        clips, pos = [], 0
        for c in parts:
            length = f.int(c, "OMFI:CPNT:Length")
            clip = _clip_of(f, c) if f.cls(c) in ("SCLP", "NEST") else 0
            if clip:
                info, src_start = resolve(f.raw(clip, "OMFI:SCLP:SourceID")[:12], f.int(clip, "OMFI:SCLP:SourceTrackID"), f.int(clip, "OMFI:SCLP:StartTime"))
                if info:
                    # start and length in the session's samples, the source's start in the media's own (CLAUDE.md)
                    per = rate / edit
                    counter += 1
                    clips.append({"id": f"omf-clip-{counter}", "mediaId": info["id"], "start": round(pos * per), "sourceIn": round(src_start * info["sampleRate"]), "length": round(length * per), "gainDb": 0})
            if f.cls(c) == "TRAN":
                pos -= length  # a transition overlaps the components on either side
            else:
                pos += length
        trkd = f.ref(slot, "OMFI:MSLT:TrackDesc")
        tracks.append({"name": f.string(trkd, "OMFI:TRKD:TrackName") or f"Track {len(tracks) + 1}", "clips": clips})
    found = {i["id"]: i for i in imported.values() if i}
    if not found:
        raise media.MediaError(f"the OMF's audio is in files outside it ({', '.join(sorted(set(missing))[:4])}): zip the .omf with its audio files and import the zip" if missing else "the OMF holds no audio clips")
    first = min((c["start"] for t in tracks for c in t["clips"]), default=0)
    for t in tracks:
        for c in t["clips"]:
            c["start"] -= first
    session_tracks = []
    for n, t in enumerate(tracks, 1):
        channels = max((int(found[c["mediaId"]].get("channels", 1)) for c in t["clips"]), default=1)
        session_tracks.append({"id": f"omf-track-{n}", "name": t["name"], "channels": channels, "gainDb": 0, "mute": False, "solo": False, "pan": 0, "clips": t["clips"]})
    doc = {"sampleRate": rate or 48000, "tracks": session_tracks, "media": found, "markers": []}
    return {"name": f.string(top, "OMFI:MOBJ:Name") or "OMF session", "document": doc, "tracks": len(session_tracks), "clips": counter, "missing": sorted(set(missing))}


class _Bento:
    """An OMF 2 file being written: objects of (property name, type name, value bytes), laid out as an editor's OMF
    lays them out (the values, then the TOC in 1 KB blocks, then the 24-byte label; object 1 the TOC object and the
    HEAD; property and type names as objects from 65536 up)."""

    def __init__(self):
        self.objects: dict[int, list[tuple[str, str, bytes]]] = {1: []}
        self.names: dict[tuple[int, str], int] = {}
        self.next_id = 65536

    def new(self) -> int:
        self.next_id += 1
        self.objects[self.next_id - 1] = []
        return self.next_id - 1

    def put(self, obj: int, prop: str, typ: str, value: bytes) -> None:
        self.objects[obj].append((prop, typ, value))

    def _name(self, kind: int, text: str) -> int:
        # kind 24 a property's name, 23 a type's (Bento's global names)
        if (kind, text) not in self.names:
            self.names[(kind, text)] = self.new()
        return self.names[(kind, text)]

    def build(self) -> bytes:
        for o in list(self.objects):
            for prop, typ, _ in self.objects[o]:
                self._name(24, prop)
                self._name(23, typ)
        data = bytearray()
        # object, property, type, and the value: bytes held in the TOC, or (offset, length) into the values
        entries: list[tuple[int, int, int, bytes | tuple[int, int]]] = []

        def value(o: int, p: int, t: int, v: bytes) -> None:
            if len(v) <= 4:
                entries.append((o, p, t, v))
            else:
                if len(data) + len(v) > 0xFFFFFFFF:
                    raise media.MediaError("the OMF would pass 4 GB, which OMF 2 files cannot hold")
                entries.append((o, p, t, (len(data), len(v))))
                data.extend(v)
                if len(data) % 2:
                    data.append(0)

        named = {oid: key for key, oid in self.names.items()}
        for o in sorted(self.objects):
            if o in named:
                kind, text = named[o]
                value(o, kind, 21, text.encode("latin-1") + b"\0")
            for prop, typ, v in self.objects[o]:
                value(o, self.names[(24, prop)], self.names[(23, typ)], v)

        def toc_bytes(toc_at: int, toc_size: int, file_size: int) -> bytes:
            out = bytearray()

            def emit(code: int, body: bytes) -> None:
                if len(out) % 1024 + 1 + len(body) > 1024:
                    out.append(24)
                    out.extend(b"\0" * (-len(out) % 1024))
                out.append(code)
                out.extend(body)

            # the TOC object's own properties first (seed, minimum seed, the TOC, the container, nothing deleted)
            bento = [(1, 2, 19, struct.pack("<I", self.next_id)), (1, 3, 19, struct.pack("<I", 65536)), (1, 4, 19, (toc_at, toc_size)),
                     (1, 5, 19, (0, file_size)), (1, 6, 19, struct.pack("<I", 0))]
            last = None
            for n, (o, p, t, v) in enumerate(bento + entries):
                if o != last:
                    emit(1, struct.pack("<III", o, p, t))
                else:
                    emit(2, struct.pack("<II", p, t))
                if n == 0:
                    emit(4, struct.pack("<I", 1))
                last = o
                if isinstance(v, tuple):
                    emit(5, struct.pack("<II", *v))
                else:
                    emit(9 + len(v), v.ljust(4, b"\0") if v else b"")
            return bytes(out)

        toc_at = len(data)
        size = len(toc_bytes(0, 0, 0))  # fixed-size entries: the real values do not change the length
        toc = toc_bytes(toc_at, size, toc_at + size + 24)
        label = MAGIC + struct.pack("<HHHHII", 0x0101, 1, 2, 0, toc_at, len(toc))
        return bytes(data) + toc + label


def _uid(n: int, stamp: int) -> bytes:
    # a MobID: prefix 42 (as editors write it), the time, and a running number
    return struct.pack("<iII", 42, stamp, n)


def export_omf(doc: dict) -> bytes:
    """The session's timeline as an OMF 2 file with its audio embedded: per channel of each track an OMF sound track
    (a session track of two channels becomes two, as OMF carries audio mono), each clip a source clip on a master mob
    whose file source mob's media data is that channel as a 24-bit WAV. Clip gain, fades and effects are not carried."""
    import subprocess
    import tempfile
    import time
    from pathlib import Path

    from ..core.paths import media_dir

    if not isinstance(doc, dict):
        raise media.MediaError("send the session to export")
    rate = int(doc.get("sampleRate") or 48000)
    tracks = [t for t in doc.get("tracks", []) if isinstance(t, dict)]
    known = doc.get("media") or {}
    used = sorted({c.get("mediaId") for t in tracks for c in t.get("clips", []) if c.get("mediaId") in known})
    if not used:
        raise media.MediaError("the session has no audio clips to export")
    stamp = int(time.time())
    w = _Bento()
    serial = [0]

    def uid() -> bytes:
        serial[0] += 1
        return _uid(serial[0], stamp)

    def u32(n: int) -> bytes:
        if not 0 <= n <= 0x7FFFFFFF:
            raise media.MediaError("a clip lies beyond what OMF 2's 32-bit positions reach")
        return struct.pack("<I", n)

    def obj(cls: str) -> int:
        o = w.new()
        w.put(o, "OMFI:OOBJ:ObjClass", "omfi:ClassID", cls.encode())
        return o

    def refs(ids: list[int]) -> bytes:
        return struct.pack("<H", len(ids)) + b"".join(struct.pack("<I", i) for i in ids)

    when = struct.pack("<IB", stamp, 1)
    sound = obj("DDEF")
    w.put(sound, "OMFI:DDEF:DataKindID", "omfi:UniqueName", b"omfi:data:Sound\0")
    kind = struct.pack("<I", sound)

    def segment(cls: str, length: int) -> int:
        o = obj(cls)
        w.put(o, "OMFI:CPNT:DataKind", "omfi:ObjRef", kind)
        w.put(o, "OMFI:CPNT:Length", "omfi:Length32", u32(length))
        return o

    def clip(length: int, source: bytes, track: int, start: int) -> int:
        o = segment("SCLP", length)
        w.put(o, "OMFI:SCLP:SourceID", "omfi:UID", source)
        w.put(o, "OMFI:SCLP:SourceTrackID", "omfi:UInt32", u32(track))
        w.put(o, "OMFI:SCLP:StartTime", "omfi:Position32", u32(start))
        return o

    def slot(seg: int, edit: int, track: int, name: str = "") -> int:
        o, d = obj("MSLT"), obj("TRKD")
        w.put(d, "OMFI:TRKD:Origin", "omfi:Position32", u32(0))
        w.put(d, "OMFI:TRKD:TrackID", "omfi:UInt32", u32(track))
        w.put(d, "OMFI:TRKD:PhysicalTrack", "omfi:UInt32", u32(track))
        if name:
            w.put(d, "OMFI:TRKD:TrackName", "omfi:String", name.encode("latin-1", "replace") + b"\0")
        w.put(o, "OMFI:MSLT:Segment", "omfi:ObjRef", struct.pack("<I", seg))
        w.put(o, "OMFI:MSLT:EditRate", "omfi:Rational", struct.pack("<ii", edit, 1))
        w.put(o, "OMFI:MSLT:TrackDesc", "omfi:ObjRef", struct.pack("<I", d))
        return o

    def mob(cls: str, name: str, slots: list[int], mob_id: bytes) -> int:
        o = obj(cls)
        w.put(o, "OMFI:MOBJ:MobID", "omfi:UID", mob_id)
        w.put(o, "OMFI:MOBJ:Name", "omfi:String", name.encode("latin-1", "replace") + b"\0")
        w.put(o, "OMFI:MOBJ:CreationTime", "omfi:TimeStamp", when)
        w.put(o, "OMFI:MOBJ:LastModified", "omfi:TimeStamp", when)
        w.put(o, "OMFI:MOBJ:Slots", "omfi:ObjRefArray", refs(slots))
        return o

    mobs, media_objs, masters = [], [], {}
    with tempfile.TemporaryDirectory() as tmp:
        for mid in used:
            info = media.media_info(mid) or {}
            channels, own_rate = max(1, int(info.get("channels") or 1)), int(info.get("sampleRate") or rate)
            name = str(info.get("name") or mid).rsplit(".", 1)[0]
            master_id, master_slots = uid(), []
            for ch in range(channels):
                pcm = Path(tmp) / f"{mid}-{ch}.wav"
                done = subprocess.run([media._tool("ffmpeg"), "-v", "error", "-nostdin", "-y", "-i", str(media_dir() / f"{mid}.wav"),
                                       "-af", f"pan=mono|c0=c{ch}", "-c:a", "pcm_s24le", "-ar", str(own_rate), str(pcm)], capture_output=True, timeout=600)
                if done.returncode != 0:
                    raise media.MediaError("an audio file could not be prepared for the OMF")
                wav = pcm.read_bytes()
                at = wav.find(b"data", 12)
                frames = struct.unpack("<I", wav[at + 4: at + 8])[0] // 3
                file_name = f"{name}{'' if channels == 1 else f'.{ch + 1}'}.wav"
                desc = obj("WAVD")
                w.put(desc, "OMFI:MDFL:IsOMFI", "omfi:Boolean", b"\x01")
                w.put(desc, "OMFI:MDFL:SampleRate", "omfi:Rational", struct.pack("<ii", own_rate, 1))
                w.put(desc, "OMFI:MDFL:Length", "omfi:Length32", u32(frames))
                w.put(desc, "OMFI:WAVD:Summary", "omfi:DataValue", wav[: at + 8])
                file_id = uid()
                # the file source mob's own slot: the original recording, which this file is all of (a null source)
                source = mob("SMOB", file_name, [slot(clip(frames, b"\0" * 12, 0, 0), own_rate, 1)], file_id)
                w.put(source, "OMFI:SMOB:MediaDescription", "omfi:ObjRef", struct.pack("<I", desc))
                data = obj("WAVE")
                w.put(data, "OMFI:MDAT:MobID", "omfi:UID", file_id)
                w.put(data, "OMFI:WAVE:AudioData", "omfi:DataValue", wav)
                media_objs.append(data)
                mobs.append(source)
                master_slots.append(slot(clip(frames, file_id, 1, 0), own_rate, ch + 1))
            mobs.append(mob("MMOB", name, master_slots, master_id))
            masters[mid] = (master_id, channels)
        comp_slots, n = [], 0
        for track in tracks:
            clips = sorted((c for c in track.get("clips", []) if c.get("mediaId") in masters), key=lambda c: int(c.get("start", 0)))
            channels = max((masters[c["mediaId"]][1] for c in clips), default=1)
            for ch in range(channels):
                parts, pos = [], 0
                for c in clips:
                    start, source_in, length = int(c.get("start", 0)), int(c.get("sourceIn", 0)), int(c.get("length", 0))
                    if start < pos:  # a sequence cannot overlap: the later clip loses what the earlier still covers
                        cut = pos - start
                        start, source_in, length = pos, source_in + cut, length - cut
                    if length <= 0:
                        continue
                    if start > pos:
                        parts.append(segment("FILL", start - pos))
                    master_id, have = masters[c["mediaId"]]
                    parts.append(clip(length, master_id, min(ch, have - 1) + 1, source_in))
                    pos = start + length
                seq = segment("SEQU", pos)
                w.put(seq, "OMFI:SEQU:Components", "omfi:ObjRefArray", refs(parts))
                n += 1
                label = str(track.get("name") or f"Track {n}") + ("" if channels == 1 else f" {ch + 1}")
                comp_slots.append(slot(seq, rate, n, label))
        comp = mob("CMOB", str(doc.get("name") or "formwav session"), comp_slots, uid())
        mobs.append(comp)
    ident = obj("IDNT")
    w.put(ident, "OMFI:IDNT:CompanyName", "omfi:String", b"nodemode\0")
    w.put(ident, "OMFI:IDNT:ProductName", "omfi:String", b"formwav\0")
    from ..core.version import VERSION

    w.put(ident, "OMFI:IDNT:ProductVersionString", "omfi:String", VERSION.encode() + b"\0")
    w.put(ident, "OMFI:IDNT:Date", "omfi:TimeStamp", when)
    w.put(ident, "OMFI:IDNT:IDByteOrder", "omfi:Int16", b"II")
    w.put(1, "OMFI:OOBJ:ObjClass", "omfi:ClassID", b"HEAD")
    w.put(1, "OMFI:HEAD:Version", "omfi:VersionType", b"\x02\x00")
    w.put(1, "OMFI:HEAD:ByteOrder", "omfi:Int16", b"II")
    w.put(1, "OMFI:HEAD:LastModified", "omfi:TimeStamp", when)
    w.put(1, "OMFI:HEAD:DefinitionObjects", "omfi:ObjRefArray", refs([sound]))
    w.put(1, "OMFI:HEAD:IdentificationList", "omfi:ObjRefArray", refs([ident]))
    w.put(1, "OMFI:HEAD:Mobs", "omfi:ObjRefArray", refs(mobs))
    w.put(1, "OMFI:HEAD:PrimaryMobs", "omfi:ObjRefArray", refs([comp]))
    w.put(1, "OMFI:HEAD:MediaData", "omfi:ObjRefArray", refs(media_objs))
    return w.build()
