from fastapi import APIRouter, Body, HTTPException, Response

from ..services import export, media, render

router = APIRouter()


def _safe(name: str) -> str:
    return "".join("-" if ch in '\\/:*?"<>|' else ch for ch in name).strip() or "track"


@router.post("/render/bounce", status_code=201)
def bounce_track(document: dict = Body(...), trackId: str = "", mode: str = "clips", start: int | None = None, end: int | None = None) -> dict:
    """PLAN_v13 S6: a track rendered into media of its own: Consolidate's clips in a range (mode clips) or Commit's
    whole track (mode track); services/bounce.py."""
    from ..services import bounce

    try:
        return bounce.bounce(document, trackId, mode, start, end)
    except KeyError as err:
        raise HTTPException(404, "the session uses media the engine does not have") from err
    except media.CoreMissing as err:
        raise HTTPException(503, str(err)) from err
    except bounce.BounceError as err:
        raise HTTPException(422, str(err)) from err
    except (render.RenderError, media.MediaError) as err:
        raise HTTPException(400, str(err)) from err


@router.post("/render/activity")
def track_activity(document: dict = Body(...), trackId: str = "", threshold: float | None = None, gap: float = 0.3, sensitivity: float = 20.0) -> dict:
    """Where a track is active: rendered alone (others muted, solos cleared), silences over `gap` seconds below the
    threshold found by ffmpeg's silencedetect and inverted. The threshold defaults to the track's loud level (the 90th
    percentile of 50 ms RMS windows) minus 20 dB, within -60 to -20 dBFS: a fixed -40 dBFS missed the JFK recording's
    pause, whose background sits at -41 to -39 dB. For automatic ducking
    (content-based ducking)."""
    import re
    import subprocess

    tracks = list(document.get("tracks") or [])
    if not any(t.get("id") == trackId for t in tracks):
        raise HTTPException(404, "no track with that id")
    try:
        result = render.render({**document, "tracks": [{**t, "solo": False, "mute": t.get("id") != trackId} for t in tracks]})
    except KeyError as err:
        raise HTTPException(404, "the session uses media the engine does not have") from err
    except media.CoreMissing as err:
        raise HTTPException(503, str(err)) from err
    except (render.RenderError, media.MediaError, ValueError) as err:
        raise HTTPException(400, str(err)) from err
    rate = int(document.get("sampleRate") or 48000)
    total = result["frames"] / rate
    if threshold is None:
        window = max(1, int(rate * 0.05))
        probe = subprocess.run([media._tool("ffmpeg"), "-hide_banner", "-nostdin", "-i", "pipe:0", "-af",
                                f"asetnsamples={window},astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level", "-f", "null", "-"],
                               input=result["wav"], capture_output=True, timeout=900)
        levels = sorted(float(v) for v in re.findall(r"RMS_level=(-?[0-9.]+)", probe.stderr.decode(errors="replace")))
        loud = levels[int(0.9 * (len(levels) - 1))] if levels else -20.0
        threshold = max(-60.0, min(-10.0, loud - max(3.0, min(sensitivity, 50.0))))
    done = subprocess.run([media._tool("ffmpeg"), "-hide_banner", "-nostdin", "-i", "pipe:0", "-af", f"silencedetect=noise={threshold}dB:d={gap}", "-f", "null", "-"],
                          input=result["wav"], capture_output=True, timeout=900)
    starts = [float(v) for v in re.findall(r"silence_start: (-?[0-9.]+)", done.stderr.decode(errors="replace"))]
    ends = [float(v) for v in re.findall(r"silence_end: ([0-9.]+)", done.stderr.decode(errors="replace"))]
    silences = [(max(0.0, s), ends[i] if i < len(ends) else total) for i, s in enumerate(starts)]
    regions, cursor = [], 0.0
    for s, e in silences:
        if s > cursor + 1e-3:
            regions.append([round(cursor, 4), round(s, 4)])
        cursor = max(cursor, e)
    if cursor < total - 1e-3:
        regions.append([round(cursor, 4), round(total, 4)])
    # Blips under 0.1 s are noise spikes, not content: a 2.6 ms one inside the JFK pause chained the ducking across it.
    regions = [r for r in regions if r[1] - r[0] >= 0.1]
    return {"seconds": round(total, 4), "thresholdDb": round(threshold, 1), "regions": regions}


#: Each platform's playback normalization (RX-44): its integrated loudness target and what it does to reach it.
#: Spotify (Normal): its support article "Loudness normalization on Spotify": -14 LUFS (ITU-R BS.1770); louder masters
#: turned down, softer ones lifted only until their true peak reaches -1 dBTP (its example: -20 LUFS at -5 dBTP is lifted
#: to -16). YouTube: -14 LUFS, turned down only, never lifted. Apple Music (Sound Check): -16 LUFS; sources disagree on
#: whether it lifts softer tracks, so it is modelled as turning down only, and the interface says so.
PLATFORMS = {
    "spotify": ("Spotify", -14.0, "up-to-peak"),
    "youtube": ("YouTube", -14.0, "down"),
    "apple": ("Apple Music", -16.0, "down"),
}


def _platform_gain(path: str, platform: str) -> tuple[float, float, float]:
    """(gain in dB the platform applies, the integrated loudness, the true peak) for a decoded preview."""
    from ..services.tools import _num, _run_text

    _, target, mode = PLATFORMS[platform]
    text = _run_text(["-i", path, "-af", "ebur128=peak=true"])
    loudness = _num(r"I:\s+(-?[0-9.]+) LUFS", text)
    peak = _num(r"True peak:\s+Peak:\s+(-?[0-9.]+) dBFS", text)
    if loudness is None or loudness <= -70 or peak is None:
        raise media.MediaError("the mix is too quiet to measure its loudness")
    gain = target - loudness
    if mode == "down":
        gain = min(0.0, gain)
    elif gain > 0:
        gain = min(gain, max(0.0, -1.0 - peak))
    return gain, loudness, peak


def _with_cues(wav: bytes, document: dict, start: int = 0, frames: int | None = None) -> bytes:
    """RX-29: the session's markers and regions written into a WAV as the cue points other editors read (a `cue `
    chunk, and a LIST adtl chunk with a `labl` per point and an `ltxt` giving each region its length), the RIFF size
    (or an RF64's ds64 size) updated; sample positions are the mix's frames, counted from a range's `start` and kept
    when they fall inside it."""
    import struct

    points = [(int(m.get("at", 0)), str(m.get("label") or ""), 0) for m in (document.get("markers") or [])]
    points += [(int(r.get("start", 0)), str(r.get("label") or ""), max(0, int(r.get("end", 0)) - int(r.get("start", 0)))) for r in (document.get("regions") or [])]
    if start or frames is not None:
        limit = frames if frames is not None else 1 << 62
        points = [(at - start, label, min(length, limit - (at - start))) for at, label, length in points if 0 <= at - start < limit]
    if not points or wav[:4] not in (b"RIFF", b"RF64"):
        return wav
    cue = struct.pack("<I", len(points)) + b"".join(struct.pack("<II4sIII", i + 1, at, b"data", 0, 0, at) for i, (at, _, _) in enumerate(points))
    adtl = b"adtl"
    for i, (_, label, length) in enumerate(points):
        text = label.encode("utf-8") + b"\0"
        body = struct.pack("<I", i + 1) + text + (b"\0" if len(text) % 2 else b"")
        adtl += b"labl" + struct.pack("<I", 4 + len(text)) + body
        if length:
            adtl += b"ltxt" + struct.pack("<I", 20) + struct.pack("<II4sHHHH", i + 1, length, b"rgn ", 0, 0, 0, 0)
    extra = b"cue " + struct.pack("<I", len(cue)) + cue + b"LIST" + struct.pack("<I", len(adtl)) + adtl
    out = bytearray(wav + extra)
    if out[:4] == b"RF64" and out[12:16] == b"ds64":
        out[20:28] = struct.pack("<Q", len(out) - 8)
    else:
        out[4:8] = struct.pack("<I", len(out) - 8)
    return bytes(out)


def _bext(document: dict, start: int, description: str) -> dict[str, str]:
    """BWF's bext fields (EBU Tech 3285) under ffmpeg's metadata names: the time reference is the session's timecode
    start (PT-26) plus the range's start, in samples since midnight, as editors spot a file by it."""
    import datetime

    from ..core.version import VERSION

    now = datetime.datetime.now()
    rate = int(document.get("sampleRate") or 48000)
    return {
        "description": description,
        "originator": "formwav",
        "originator_reference": f"formwav {VERSION}",
        "origination_date": now.strftime("%Y-%m-%d"),
        "origination_time": now.strftime("%H:%M:%S"),
        "time_reference": str(round(float(document.get("timecodeStart") or 0) * rate) + int(start)),
    }


def _measure(wav: bytes) -> tuple[float, float, float | None, float | None]:
    """A float WAV's sample peak on each side, its true peak in dBTP (4x oversampled in the core) and its integrated
    loudness."""
    import numpy as np

    x, rate = export.frames_of(wav)
    raw = np.ascontiguousarray(x).tobytes()
    native = media._require_core()
    return float(np.abs(x[:, 0]).max(initial=0.0)), float(np.abs(x[:, -1]).max(initial=0.0)), native.true_peak(raw, x.shape[1], rate), native.loudness(raw, x.shape[1], rate)


@router.post("/render")
def render_session(document: dict = Body(...), format: str = "wav", what: str = "mix", platform: str = "", channels: str = "",
                   start: int | None = None, end: int | None = None, normalize: float | None = None, dither: bool = True) -> Response:
    # PLAN_v13 S3: a range of the session's frames (start to end), a peak to normalise the mix to, and a TPDF dither
    # switch for the 16 and 24-bit formats
    if (start is not None or end is not None) and what in ("adm", "preview"):
        raise HTTPException(422, "a range applies to the mix, stems, multichannel, 5.1 and ambisonics")
    if normalize is not None and (what != "mix" or not -60 <= normalize <= 0):
        raise HTTPException(422, "peak normalisation applies to the mix, to a peak from -60 to 0 dBFS")
    a = start or 0
    try:
        if what == "ambisonic":
            # PT-42: the session as first-order ambisonics, an AmbiX file (W Y Z X, SN3D; services/surround.py)
            import json

            from ..services import surround

            out = surround.render_foa(document, a, end)
            return Response(content=out["wav"], media_type="audio/wav", headers={"Content-Disposition": 'attachment; filename="ambisonic-foa.wav"', "X-Channel-Peaks": json.dumps(out["levels"])})
        if what == "adm":
            from ..services import adm

            tracks = list(document.get("tracks") or [])

            def alone(i: int) -> dict:
                return render.render({**document, "tracks": [{**t, "solo": False, "mute": bool(t.get("mute")) if j == i else True} for j, t in enumerate(tracks)]})

            try:
                data = adm.export_session(document, alone)
            except ValueError as err:
                raise HTTPException(422, str(err)) from err
            return Response(content=data, media_type="audio/wav", headers={"Content-Disposition": 'attachment; filename="objects-adm.wav"'})
        if what == "surround51":
            # PT-38, AA-11: the session as a 5.1 mix, six channels in SMPTE order (services/surround.py)
            import json

            from ..services import surround

            out = surround.render_51(document, a, end)
            return Response(content=out["wav"], media_type="audio/wav", headers={"Content-Disposition": 'attachment; filename="surround-5.1.wav"', "X-Channel-Peaks": json.dumps(out["levels"])})
        if what in ("stems", "multichannel"):
            import io
            import zipfile

            tracks = list(document.get("tracks") or [])
            if not tracks:
                raise render.RenderError("there are no tracks to export")
            stems_out = [
                render.render({**document, "tracks": [{**t, "solo": False, "mute": bool(t.get("mute")) if j == i else True} for j, t in enumerate(tracks)]}, a, end)
                for i in range(len(tracks))
            ]
            stems = [s["wav"] for s in stems_out]
            if what == "multichannel":
                if channels.strip():
                    # AU-50: the output's channels by track number (1 is the first track), in order; a track may
                    # fill several channels
                    try:
                        order = [int(c) for c in channels.split(",") if c.strip()]
                    except ValueError as err:
                        raise HTTPException(422, "the channel order is a comma list of track numbers") from err
                    if not order or len(order) > 32 or any(i < 1 or i > len(stems) for i in order):
                        raise HTTPException(422, f"each channel names a track from 1 to {len(stems)} (32 channels at most)")
                    stems = [stems[i - 1] for i in order]
                data, ext, mime = export.multichannel(stems, format, max(s["frames"] for s in stems_out), dither=dither, bext=_bext(document, a, "formwav multichannel, a channel per track"))
                headers = {"X-Stems": str(len(stems)), "Content-Disposition": f'attachment; filename="multichannel.{ext}"'}
                return Response(content=data, media_type=mime, headers=headers)
            session_frames = max(s["frames"] for s in stems_out)
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as bundle:
                for i, (t, wav) in enumerate(zip(tracks, stems), start=1):
                    data, ext, _ = export.encode(wav, format, session_frames, dither=dither, bext=_bext(document, a, f"formwav stem {i}: {t.get('name') or 'track'}"), seed=i)
                    bundle.writestr(f"{i:02d} {_safe(str(t.get('name') or 'track'))}.{ext}", data)
            return Response(content=buffer.getvalue(), media_type="application/zip", headers={"X-Stems": str(len(stems)), "Content-Disposition": 'attachment; filename="stems.zip"'})
        result = render.render(document, a, end)
        if what == "preview":
            # The streaming preview: the mix as it sounds after a lossy codec, decoded back into new media.
            if format not in ("mp3", "mp3-192", "ogg", "m4a"):
                raise render.RenderError("a streaming preview needs a lossy format: MP3, OGG or M4A")
            import subprocess
            import tempfile
            from pathlib import Path

            encoded, ext, _ = export.encode(result["wav"], format)
            rate = int(document.get("sampleRate") or 48000)
            with tempfile.TemporaryDirectory() as tmp:
                src, dst = Path(tmp) / f"enc.{ext}", Path(tmp) / "dec.wav"
                src.write_bytes(encoded)
                done = subprocess.run([media._tool("ffmpeg"), "-v", "error", "-nostdin", "-y", "-i", str(src), "-ar", str(rate), "-c:a", "pcm_f32le", str(dst)], capture_output=True, timeout=900)
                if done.returncode != 0:
                    raise media.MediaError(done.stderr.decode(errors="replace").strip()[-300:])
                if not platform:
                    return media.import_wav(f"Streaming preview ({export.FORMATS[format][3]}).wav", dst.read_bytes())
                if platform not in PLATFORMS:
                    raise render.RenderError(f"no platform named {platform} (one of {', '.join(PLATFORMS)})")
                gain, loudness, peak = _platform_gain(str(dst), platform)
                level = Path(tmp) / "level.wav"
                done = subprocess.run([media._tool("ffmpeg"), "-v", "error", "-nostdin", "-y", "-i", str(dst), "-af", f"volume={gain:.4f}dB", "-c:a", "pcm_f32le", str(level)], capture_output=True)
                if done.returncode != 0:
                    raise media.MediaError(done.stderr.decode(errors="replace").strip()[-300:])
                name = PLATFORMS[platform][0]
                out = media.import_wav(f"Streaming preview ({export.FORMATS[format][3]}, {name} {gain:+.1f} dB).wav", level.read_bytes())
                return {**out, "platform": name, "loudness": round(loudness, 1), "truePeak": round(peak, 1), "gainDb": round(gain, 2)}
        mix, gain = export.normalized(result["wav"], normalize) if normalize is not None else (result["wav"], 0.0)
        peak_left, peak_right, true_peak, loudness = _measure(mix)
        data, ext, mime = export.encode(mix, format, dither=dither, bext=_bext(document, a, "formwav mix"))
        if ext == "wav":
            data = _with_cues(data, document, a, result["frames"])
    except KeyError as err:
        raise HTTPException(404, "the session uses media the engine does not have") from err
    except media.CoreMissing as err:
        raise HTTPException(503, str(err)) from err
    except (render.RenderError, media.MediaError, ValueError) as err:
        raise HTTPException(400, str(err)) from err
    headers = {
        "X-Frames": str(result["frames"]),
        "X-Range-Start": str(a),
        "X-Peak-Left-dBFS": render.dbfs(peak_left),
        "X-Peak-Right-dBFS": render.dbfs(peak_right),
        "X-True-Peak-dBTP": f"{true_peak:.2f}" if true_peak is not None else "-inf",
        "X-Normalize-dB": f"{gain:.2f}",
        "X-Skipped-Clips": str(result["skipped"]),
        "X-Loudness-LUFS": f"{loudness:.2f}" if loudness is not None else "-inf",
        "Content-Disposition": f'attachment; filename="mix.{ext}"',
    }
    return Response(content=data, media_type=mime, headers=headers)
