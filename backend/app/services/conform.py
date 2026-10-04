"""PT-31, field recorder audio matched to picture edits (Pro Tools' Field Recorder workflow): a picture editor's CMX3600
EDL conformed to the field recorder's own broadcast WAV files. Each audio event's source timecode is found in the
recorder file whose timecode (its bext TimeReference) covers it, a file whose tape (iXML TAPE, or its name) matches the
event's reel preferred; the clip is placed where the event sits on the record side, counted from the edit's first
event, to the sample; each channel of a polyphonic recorder file can go on its own track (boom, lavaliers). Events
nothing covers are listed, not dropped silently. Drop-frame timecode is refused rather than read wrong."""

import re
import subprocess
import tempfile
from pathlib import Path

from . import media

_TC = r"(\d{1,2})[:;.](\d{2})[:;.](\d{2})[:;.](\d{2})"
_EVENT = re.compile(r"^\s*(\d{1,6})\s+(\S+)\s+(\S+)\s+(C|D|W\d{3}|K\S*)\s+(?:\d{3}\s+)?" + r"\s+".join([_TC] * 4) + r"\s*$")


def _seconds(parts: tuple[str, ...], fps: float) -> float:
    h, m, s, f = (int(p) for p in parts)
    if f >= fps:
        raise media.MediaError(f"a timecode has frame {f}, more than {fps:g} frames a second allow; check the edit's frame rate")
    return h * 3600 + m * 60 + s + f / fps


def parse_edl(text: str, fps: float) -> list[dict]:
    """The EDL's audio events: number, reel, track, source in and out, record in and out (seconds); the clip name from
    a following "* FROM CLIP NAME:" comment when there is one."""
    if re.search(r"^FCM:\s*DROP FRAME", text, re.M | re.I):
        raise media.MediaError("this edit list uses drop-frame timecode, which formwav does not conform yet")
    events: list[dict] = []
    for line in text.splitlines():
        hit = _EVENT.match(line)
        if hit:
            g = hit.groups()
            track = g[2].upper()
            if "A" not in track and track != "B":  # video-only events carry no sound
                continue
            tcs = [g[4 + 4 * k : 8 + 4 * k] for k in range(4)]
            src_in, src_out, rec_in, rec_out = (_seconds(t, fps) for t in tcs)
            if src_out <= src_in or rec_out <= rec_in:
                continue
            events.append({"event": g[0], "reel": g[1], "track": track, "srcIn": src_in, "srcOut": src_out, "recIn": rec_in, "recOut": rec_out})
        elif events and line.strip().upper().startswith("* FROM CLIP NAME:"):
            events[-1]["clip"] = line.split(":", 1)[1].strip()
    if not events:
        raise media.MediaError("the edit list holds no audio events (CMX3600 lines with A, AA, A2 or B tracks)")
    return events


def _channel(info: dict, ch: int) -> dict:
    """One channel of a recorder file as its own media (kept for reuse: the same file's channel is imported once)."""
    with tempfile.TemporaryDirectory(prefix="formwav-conform-") as tmp:
        out = Path(tmp) / "channel.wav"
        done = subprocess.run([media._tool("ffmpeg"), "-v", "error", "-nostdin", "-y", "-i", str(media.media_dir() / f"{info['id']}.wav"), "-af", f"pan=mono|c0=c{ch}", "-c:a", "pcm_f32le", str(out)],
                              capture_output=True, timeout=600)
        if done.returncode != 0:
            raise media.MediaError("a recorder channel could not be separated")
        stem = str(info["name"]).rsplit(".", 1)[0]
        return media.import_wav(f"{stem} channel {ch + 1}.wav", out.read_bytes())


def conform(edl: str, media_ids: list[str], fps: float = 25.0, split_channels: bool = False, rate: int = 48000) -> dict:
    """{"document", "events", "matched", "unmatched"}: the session the edit describes, built from the recorder files."""
    # whole rates only: at 23.976, 29.97 and 59.94 timecode runs 0.1% off real time, and a recorder's samples since
    # midnight do not map onto the edit's timecode simply, so those are refused rather than conformed subtly wrong
    if fps not in (24.0, 25.0, 30.0, 48.0, 50.0, 60.0):
        raise media.MediaError("the edit's frame rate should be 24, 25, 30, 48, 50 or 60 (pull-down rates such as 29.97 are not conformed yet)")
    nominal = int(fps)
    files = []
    for mid in dict.fromkeys(media_ids):
        try:
            info = media.media_info(mid)
        except KeyError:
            continue
        if "timecode" in info:
            files.append(info)
    if not files:
        raise media.MediaError("none of the session's files carries a recorder timecode (a broadcast WAV's bext chunk); import the field recorder's own files first")
    events = parse_edl(edl, nominal)
    start = min(e["recIn"] for e in events)
    width = max((int(f.get("channels", 1)) for f in files), default=1) if split_channels else 1
    tracks = [{"id": f"conform-{k + 1}", "name": f"Recorder channel {k + 1}" if split_channels else "Production audio", "channels": 1 if split_channels else 2, "gainDb": 0, "mute": False, "solo": False, "pan": 0, "clips": []} for k in range(width)]
    used: dict = {}
    split_cache: dict = {}
    unmatched = []
    eps = 0.5 / nominal  # half a frame of slack at either end
    for e in events:
        covering = [f for f in files if f["timecode"] - eps <= e["srcIn"] and e["srcOut"] <= f["timecode"] + f["frames"] / f["sampleRate"] + eps]
        reel = e["reel"].upper()
        named = [f for f in covering if str(f.get("tape", "")).upper() == reel or str(f["name"]).upper().startswith(reel)]
        pick = (named or covering or [None])[0]
        if pick is None:
            unmatched.append({"event": e["event"], "reel": e["reel"], "source": round(e["srcIn"], 3)})
            continue
        source_in = max(0, round((e["srcIn"] - pick["timecode"]) * pick["sampleRate"]))
        clip = {"start": round((e["recIn"] - start) * rate), "sourceIn": source_in, "length": round((e["recOut"] - e["recIn"]) * rate), "gainDb": 0}
        channels = int(pick.get("channels", 1))
        for k in range(width if split_channels else 1):
            if split_channels:
                if k >= channels:
                    continue
                key = (pick["id"], k)
                if key not in split_cache:
                    split_cache[key] = _channel(pick, k)
                ref = split_cache[key]
            else:
                ref = pick
            used[ref["id"]] = ref
            tracks[k]["clips"].append({"id": f"conform-{e['event']}-{k + 1}", "mediaId": ref["id"], **clip})
    if not split_channels and tracks[0]["clips"]:
        tracks[0]["channels"] = min(2, max(int(used[c["mediaId"]].get("channels", 1)) for c in tracks[0]["clips"]))
    tracks = [t for t in tracks if t["clips"]]
    if not tracks:
        raise media.MediaError("no event of the edit falls inside any recorder file's timecode")
    doc = {"sampleRate": rate, "tracks": tracks, "media": used, "markers": [{"id": f"conform-marker-{e['event']}", "at": round((e["recIn"] - start) * rate), "label": e.get("clip") or f"Event {e['event']}"} for e in events]}
    return {"document": doc, "events": len(events), "matched": len(events) - len(unmatched), "unmatched": unmatched}
