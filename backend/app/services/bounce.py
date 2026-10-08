"""PLAN_v13 S6: a track's audio rendered by the core into media of its own. Consolidate takes the clips in a range as they
play before anything of the track touches them (Pro Tools' Consolidate); Commit takes what the track plays, through its
trim, fader, pan, automation and effects, which the core runs before the track meets a bus, and keeps its tail for as
long as it stays above a 24-bit file's least step (-144 dBFS), at most ten seconds past the last clip."""

from __future__ import annotations

from . import export, media, render

TAIL_LIMIT_SECONDS = 10.0
SILENT = 2.0**-24


class BounceError(ValueError):
    pass


def _track(doc: dict, track_id: str) -> dict:
    for t in doc.get("tracks") or []:
        if isinstance(t, dict) and t.get("id") == track_id:
            return t
    raise BounceError("no track with that id")


def clips_alone(doc: dict, track_id: str) -> dict:
    """The track's clips with their gain, fades, envelopes and effects and nothing around them: a session of that track
    alone at 0 dB, centred, under the balance law, without its effects, automation, sends, bus or VCA."""
    t = _track(doc, track_id)
    track = {"id": t["id"], "name": t.get("name", ""), "channels": t.get("channels", 2), "gainDb": 0, "mute": False, "solo": False, "clips": t.get("clips") or []}
    return {"sampleRate": doc["sampleRate"], "media": doc["media"], "markers": [], "tracks": [track]}


def track_alone(doc: dict, track_id: str) -> dict:
    """The track as the mix hears it before a bus or the master: the session with that track alone, its sends left out
    (the committed track keeps them), its bus kept plain (unity, centred, no effects) so its effects are placed as the
    mix places them, its VCA's level kept; no master effects or fader and no time track."""
    t = _track(doc, track_id)
    if isinstance(t.get("surround"), dict):
        raise BounceError("a track placed on the surround pad is committed off it: take it off the pad first")
    track = {k: v for k, v in t.items() if k not in ("sends", "inactive", "hidden")}
    track.update(mute=False, solo=False)
    buses = [{"id": b["id"], "name": b.get("name", ""), "gainDb": 0} for b in doc.get("buses") or [] if isinstance(b, dict) and t.get("busId") and b.get("id") == t["busId"]]
    vcas = [{**v, "mute": False} for v in doc.get("vcas") or [] if isinstance(v, dict) and t.get("vcaId") and v.get("id") == t["vcaId"]]
    kept = {k: doc[k] for k in ("sampleRate", "media", "panLaw") if k in doc}
    return {**kept, "markers": [], "tracks": [track], "buses": buses, "vcas": vcas}


def bounce(doc: dict, track_id: str, mode: str, start: int | None = None, end: int | None = None) -> dict:
    """The rendered audio stored as media (32-bit float at the session's rate; a consolidated mono track stays mono)."""
    if not isinstance(doc, dict) or not isinstance(doc.get("media"), dict) or not isinstance(doc.get("sampleRate"), int):
        raise BounceError("not a session document")
    t = _track(doc, track_id)
    if mode == "clips":
        if start is None or end is None or start < 0 or end <= start:
            raise BounceError("the range to consolidate starts at 0 or later and ends after it starts")
        alone, a, b = clips_alone(doc, track_id), start, end
    elif mode == "track":
        alone = track_alone(doc, track_id)
        last = max((int(c["start"]) + int(c["length"]) for c in alone["tracks"][0]["clips"] if not c.get("mute")), default=0)
        if last <= 0:
            raise BounceError("the track has nothing to commit")
        a, b = 0, last + round(TAIL_LIMIT_SECONDS * doc["sampleRate"])
    else:
        raise BounceError("mode is clips or track")
    result = render.render(alone, a, b)
    if result.get("skipped"):
        raise BounceError("a clip in it is at another sample rate than the session's")
    frames, rate = export.frames_of(result["wav"])
    import numpy as np

    if mode == "track":
        loud = np.flatnonzero(np.max(np.abs(frames), axis=1) > SILENT)
        keep = max(last, int(loud[-1]) + 1 + rate // 100 if loud.size else last)
        frames = frames[: min(keep, len(frames))]
    out = frames[:, :1] if mode == "clips" and int(t.get("channels") or 2) == 1 else frames

    wav = render.wav_float32_stereo(np.ascontiguousarray(out, dtype="<f4").tobytes(), rate, out.shape[1])
    return media.import_wav(f"{t.get('name') or 'Track'} {'consolidated' if mode == 'clips' else 'committed'}.wav", wav)
