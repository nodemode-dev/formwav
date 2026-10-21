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
    media_data = {f.raw(o, "OMFI:MDAT:MobID")[:12]: o for o in f.props if f.has(o, "OMFI:MDAT:MobID")}
    comps = f.objects("CMOB")
    if not comps:
        raise media.MediaError("the OMF file holds no composition")
    # the top composition: the one no other composition's clip or nested scope points at (the rest are its parts)
    used = {f.raw(c, "OMFI:SCLP:SourceID")[:12] for c in f.objects("SCLP")}
    top = next((c for c in comps if f.mob_id(c) not in used), comps[0])
    imported: dict[bytes, dict | None] = {}
    missing: list[str] = []

    def resolve(mob_id: bytes, track: int, start: int, depth: int = 0) -> tuple[dict | None, int]:
        """The media a clip ends at, and where in it (in that media's edit units), following master mobs to the file."""
        mob = mobs.get(mob_id)
        if mob is None or depth > 8:
            return None, 0
        if mob_id in media_data:
            if mob_id not in imported:
                md = media_data[mob_id]
                audio = f.raw(md, "OMFI:WAVE:data") or f.raw(md, "OMFI:AIFC:data")
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
                return resolve(f.raw(clip, "OMFI:SCLP:SourceID")[:12], f.int(clip, "OMFI:SCLP:SourceTrackID"), start + f.int(clip, "OMFI:SCLP:StartTime"), depth + 1)
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

    tracks, rate, counter = [], 0, 0
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
                    per = info["sampleRate"] / edit
                    rate = rate or int(info["sampleRate"])
                    counter += 1
                    clips.append({"id": f"omf-clip-{counter}", "mediaId": info["id"], "start": round(pos * per), "sourceIn": round(src_start * per), "length": round(length * per), "gainDb": 0})
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
