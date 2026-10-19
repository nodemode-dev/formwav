"""AAF interchange (PT-30, an exchange format between editors) through pyaaf2 (MIT, pure Python): a session's timeline
written as an AAF, each track a sound slot of clips and fillers with its audio embedded, and an AAF's timeline read back
as tracks of clips, its embedded audio imported as media. Clip gain, fades and effects are not carried, only where each
clip sits and what part of its audio it plays. Audio an AAF only links to (a file outside it) cannot be resolved here and
is reported."""

import subprocess
import tempfile
from pathlib import Path

import numpy as np

from ..core.paths import media_dir
from . import media
from .aup_project import _wav_bytes


def export_aaf(doc: dict) -> bytes:
    """The session's timeline as AAF bytes, its audio embedded (24-bit PCM)."""
    import aaf2

    if not isinstance(doc, dict):
        raise media.MediaError("send the session to export")
    rate = int(doc.get("sampleRate") or 48000)
    tracks = [t for t in doc.get("tracks", []) if isinstance(t, dict)]
    used = {c.get("mediaId") for t in tracks for c in t.get("clips", []) if c.get("mediaId") in (doc.get("media") or {})}
    if not used:
        raise media.MediaError("the session has no audio clips to export")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "session.aaf"
        with aaf2.open(str(out), "w") as f:
            masters = {}
            for mid in sorted(used):
                # pyaaf2 reads integer PCM WAV: the stored audio converted to 24-bit at its own rate
                src, pcm = media_dir() / f"{mid}.wav", Path(tmp) / f"{mid}.wav"
                done = subprocess.run([media._tool("ffmpeg"), "-v", "error", "-nostdin", "-y", "-i", str(src), "-c:a", "pcm_s24le", str(pcm)], capture_output=True, timeout=600)
                if done.returncode != 0:
                    raise media.MediaError("an audio file could not be prepared for the AAF")
                info = media.media_info(mid)
                master = f.create.MasterMob(str(info.get("name") or mid))
                f.content.mobs.append(master)
                master.import_audio_essence(str(pcm), int(info.get("sampleRate") or rate))
                masters[mid] = master
            comp = f.create.CompositionMob(str(doc.get("name") or "formwav session"))
            comp.usage = "Usage_TopLevel"
            f.content.mobs.append(comp)
            for track in tracks:
                slot = comp.create_sound_slot(edit_rate=rate)
                slot.name = str(track.get("name") or "Track")
                seq = f.create.Sequence(media_kind="sound")
                slot.segment = seq
                pos = 0
                for clip in sorted((c for c in track.get("clips", []) if c.get("mediaId") in masters), key=lambda c: int(c.get("start", 0))):
                    start, source_in, length = int(clip.get("start", 0)), int(clip.get("sourceIn", 0)), int(clip.get("length", 0))
                    if start < pos:  # a sequence cannot overlap: the later clip loses what the earlier still covers
                        cut = pos - start
                        start, source_in, length = pos, source_in + cut, length - cut
                    if length <= 0:
                        continue
                    if start > pos:
                        seq.components.append(f.create.Filler("sound", start - pos))
                    seq.components.append(masters[clip["mediaId"]].create_source_clip(slot_id=1, start=source_in, length=length))
                    pos = start + length
        return out.read_bytes()


def import_aaf(data: bytes) -> dict:
    """An AAF's top-level timeline as {"sampleRate", "media": {id: info}, "tracks": [{"name", "clips": [...]}],
    "missing": [names]}: each sound slot a track, each source clip a clip at its place (converted from the slot's edit
    rate to samples), the embedded audio imported as media; linked audio is listed in "missing" and its clips left out."""
    import aaf2

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "in.aaf"
        path.write_bytes(data)
        try:
            f = aaf2.open(str(path), "r")
        except Exception as err:  # noqa: BLE001 - any parse failure is a bad file
            raise media.MediaError(f"this is not an AAF formwav can read ({type(err).__name__})") from err
        with f:
            comps = list(f.content.compositionmobs())
            if not comps:
                raise media.MediaError("the AAF holds no timeline (no composition)")
            top = next((c for c in comps if str(getattr(c, "usage", "") or "").endswith("TopLevel")), comps[0])
            essence = {str(ess.mob_id): ess for ess in f.content.essencedata}
            imported: dict = {}
            missing: list[str] = []
            rate = 0

            def media_for(master) -> dict | None:
                key = str(master.mob_id)
                if key in imported:
                    return imported[key]
                # a master mob's slot is a clip of its source mob, which holds the descriptor and the essence
                seg = master.slots[0].segment if len(master.slots) else None
                source = getattr(seg, "mob", None)
                if source is not None and not hasattr(source, "descriptor"):
                    source = None
                ess = essence.get(str(source.mob_id)) if source is not None else None
                if source is None or ess is None:
                    missing.append(str(master.name))
                    imported[key] = None
                    return None
                d = source.descriptor
                sr = int(d["SampleRate"].value)
                channels = int(d["Channels"].value) if "Channels" in d.keys() else 1
                bits = int(d["QuantizationBits"].value) if "QuantizationBits" in d.keys() else 16
                raw = bytes(ess.open("r").read())
                if bits == 16:
                    pcm = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
                elif bits == 24:
                    b = np.frombuffer(raw[: len(raw) // 3 * 3], dtype=np.uint8).reshape(-1, 3).astype(np.int32)
                    v = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)
                    pcm = (np.where(v >= 1 << 23, v - (1 << 24), v)).astype(np.float32) / 8388608.0
                elif bits == 32:
                    pcm = np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483648.0
                else:
                    missing.append(str(master.name))
                    imported[key] = None
                    return None
                pcm = pcm[: len(pcm) // channels * channels].reshape(-1, channels)
                info = media.import_wav(f"{master.name or 'aaf audio'}.wav", _wav_bytes([pcm[:, c] for c in range(channels)], sr))
                imported[key] = info
                return info

            tracks = []
            for slot in top.slots:
                if str(getattr(slot, "media_kind", "")).lower() != "sound":
                    continue
                edit = float(slot.edit_rate)
                seg = slot.segment
                comps_in = list(seg.components) if hasattr(seg, "components") else [seg]
                clips, pos = [], 0
                for c in comps_in:
                    length = int(getattr(c, "length", 0) or 0)
                    if type(c).__name__ == "SourceClip" and getattr(c, "mob", None) is not None:
                        info = media_for(c.mob)
                        if info is not None:
                            per = info["sampleRate"] / edit  # samples per edit unit (1 when the slot runs at the audio rate)
                            rate = rate or int(info["sampleRate"])
                            clips.append({"mediaId": info["id"], "start": round(pos * per), "sourceIn": round(int(getattr(c, "start", 0) or 0) * per), "length": round(length * per)})
                    pos += length
                tracks.append({"name": str(getattr(slot, "name", "") or f"Track {len(tracks) + 1}"), "clips": clips})
            found = {i["id"]: i for i in imported.values() if i}
            if not found:
                raise media.MediaError("the AAF's audio is linked to files outside it, which cannot be reached here" if missing else "the AAF holds no audio clips")
            # a whole session, as the .aup import gives one: ids for tracks and clips, the usual track fields
            counter = 0
            session_tracks = []
            for n, t in enumerate(tracks, 1):
                clips = []
                for c in t["clips"]:
                    counter += 1
                    clips.append({"id": f"aaf-clip-{counter}", **c, "gainDb": 0})
                channels = max((int(found[c["mediaId"]].get("channels", 1)) for c in clips), default=1)
                session_tracks.append({"id": f"aaf-track-{n}", "name": t["name"], "channels": channels, "gainDb": 0, "mute": False, "solo": False, "pan": 0, "clips": clips})
            doc = {"sampleRate": rate or 48000, "tracks": session_tracks, "media": found, "markers": []}
            return {"name": str(top.name or "AAF session"), "document": doc, "tracks": len(session_tracks), "clips": counter, "missing": sorted(set(missing))}
