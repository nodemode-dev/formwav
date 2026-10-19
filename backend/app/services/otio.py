"""The session's timeline as OpenTimelineIO (PLAN_v14 W4; OpenTimelineIO is the Academy Software Foundation's open
interchange, Apache-2.0): an .otioz bundle, a zip holding content.otio
and the clips' audio under media/, so the timeline opens anywhere with its sound beside it.

Written by hand to the published schema (Timeline.1, Stack.1, Track.1, Clip.2, Gap.1, Marker.2, ExternalReference.1,
RationalTime.1, TimeRange.1) with no library in the engine; the tests read it back with the opentimelineio package.
Times on a track are the session's samples (rate the session's rate); a clip's source range is its media's samples
(rate the media's rate, as a clip's sourceIn counts them). OTIO's tracks are sequences, so clips that overlap on one
formwav track go to a further OTIO track named after it ("Vox 2"). A muted clip or an inactive track is disabled,
not left out; gains and fades travel as formwav metadata, and markers and regions as timeline markers.
"""

from __future__ import annotations

import io
import json
import zipfile

from . import media
from ..core.paths import media_dir


def _rt(value: float, rate: float) -> dict:
    return {"OTIO_SCHEMA": "RationalTime.1", "rate": float(rate), "value": float(value)}


def _range(start: float, duration: float, rate: float) -> dict:
    return {"OTIO_SCHEMA": "TimeRange.1", "start_time": _rt(start, rate), "duration": _rt(duration, rate)}


def _gap(length: int, rate: int) -> dict:
    return {"OTIO_SCHEMA": "Gap.1", "name": "", "metadata": {}, "source_range": _range(0, length, rate), "effects": [], "markers": [], "enabled": True}


def _lanes(clips: list[dict]) -> list[list[dict]]:
    lanes: list[list[dict]] = []
    for clip in sorted(clips, key=lambda c: (int(c["start"]), str(c.get("id")))):
        for lane in lanes:
            last = lane[-1]
            if int(last["start"]) + int(last["length"]) <= int(clip["start"]):
                lane.append(clip)
                break
        else:
            lanes.append([clip])
    return lanes


def timeline(doc: dict, name: str = "formwav session") -> tuple[dict, list[str]]:
    """The OTIO timeline of a session document, and the media ids its clips use."""
    rate = int(doc.get("sampleRate") or 48000)
    refs = doc.get("media") or {}
    used: list[str] = []
    tracks = []
    for track in doc.get("tracks") or []:
        lanes = _lanes([c for c in track.get("clips") or []])
        for k, lane in enumerate(lanes or [[]]):
            children = []
            at = 0
            for clip in lane:
                start, length = int(clip["start"]), int(clip["length"])
                if start > at:
                    children.append(_gap(start - at, rate))
                ref = refs.get(clip["mediaId"]) or {}
                mrate = int(ref.get("sampleRate") or rate)
                frames = int(ref.get("frames") or 0)
                if clip["mediaId"] not in used:
                    used.append(clip["mediaId"])
                meta = {k2: clip[k2] for k2 in ("gainDb", "fadeIn", "fadeOut", "fadeInShape", "fadeOutShape", "name", "notes") if k2 in clip}
                children.append({
                    "OTIO_SCHEMA": "Clip.2",
                    "name": str(clip.get("name") or str(ref.get("name") or clip["mediaId"]).rsplit(".", 1)[0]),
                    "metadata": {"formwav": {"clipId": clip.get("id"), **meta}},
                    "source_range": _range(int(clip.get("sourceIn") or 0), length * mrate / rate, mrate),
                    "effects": [],
                    "markers": [],
                    "enabled": not bool(clip.get("mute")),
                    "media_references": {"DEFAULT_MEDIA": {"OTIO_SCHEMA": "ExternalReference.1", "name": str(ref.get("name") or ""), "metadata": {}, "available_range": _range(0, frames, mrate) if frames else None, "available_image_bounds": None, "target_url": f"media/{clip['mediaId']}.wav"}},
                    "active_media_reference_key": "DEFAULT_MEDIA",
                })
                at = start + length
            tracks.append({
                "OTIO_SCHEMA": "Track.1",
                "name": str(track.get("name") or "Track") + (f" {k + 1}" if k else ""),
                "metadata": {"formwav": {k2: track[k2] for k2 in ("id", "gainDb", "pan", "mute", "solo") if k2 in track}},
                "source_range": None,
                "effects": [],
                "markers": [],
                "enabled": not bool(track.get("inactive")),
                "children": children,
                "kind": "Audio",
            })
    markers = []
    for m in doc.get("markers") or []:
        at = int(m.get("at") or 0)
        end = int(m.get("end") or at)
        markers.append({"OTIO_SCHEMA": "Marker.2", "name": str(m.get("label") or ""), "metadata": {"formwav": {"id": m.get("id")}}, "marked_range": _range(at, max(0, end - at), rate), "color": "RED" if end > at else "GREEN", "comment": str(m.get("comment") or "")})
    stack = {"OTIO_SCHEMA": "Stack.1", "name": "tracks", "metadata": {}, "source_range": None, "effects": [], "markers": markers, "enabled": True, "children": tracks}
    return {"OTIO_SCHEMA": "Timeline.1", "name": name, "metadata": {"formwav": {"sampleRate": rate}}, "global_start_time": _rt(0, rate), "tracks": stack}, used


def export_otioz(doc: dict, name: str = "formwav session") -> bytes:
    tl, used = timeline(doc, name)
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("version.txt", "1.0.0")
        z.writestr("content.otio", json.dumps(tl, indent=2))
        for mid in used:
            path = media_dir() / f"{mid}.wav"
            if not path.exists():
                raise media.MediaError(f"the audio of a clip ({mid}) is not in formwav's media folder")
            z.write(path, f"media/{mid}.wav", compress_type=zipfile.ZIP_STORED)
    return out.getvalue()
