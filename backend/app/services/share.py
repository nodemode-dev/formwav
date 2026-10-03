"""Shareable video of a session (DS-08, Descript's clips for social): the session's mix, or a span of it, as an MP4
with its waveform drawn in formwav's orange, a title, and the transcript's words burned in as captions, in a square,
portrait or landscape layout."""

import subprocess
import tempfile
from pathlib import Path

from . import media, render

LAYOUTS = {"square": (1080, 1080), "portrait": (1080, 1920), "landscape": (1920, 1080)}
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
MAX_SECONDS = 15 * 60


def _clock(t: float) -> str:
    t = max(0.0, t)
    h, rest = divmod(t, 3600)
    m, s = divmod(rest, 60)
    return f"{int(h)}:{int(m):02d}:{s:05.2f}"


def caption_lines(words: list[dict], start: float, end: float) -> list[tuple[float, float, str]]:
    """The words inside [start, end] (seconds) as caption lines, times from `start`: a line ends after six words, at a
    pause of 0.6 s, at a sentence's end or once it has run 3 s."""
    inside = [w for w in words if isinstance(w, dict) and str(w.get("text", "")).strip() and float(w.get("end", 0)) > start and float(w.get("start", 0)) < end]
    lines: list[tuple[float, float, str]] = []
    run: list[dict] = []
    for i, w in enumerate(inside):
        run.append(w)
        nxt = inside[i + 1] if i + 1 < len(inside) else None
        text = str(w["text"]).strip()
        if (
            nxt is None
            or len(run) >= 6
            or text[-1:] in ".?!"
            or float(nxt["start"]) - float(w["end"]) >= 0.6
            or float(w["end"]) - float(run[0]["start"]) >= 3.0
        ):
            lines.append((max(0.0, float(run[0]["start"]) - start), min(end, float(run[-1]["end"])) - start, " ".join(str(x["text"]).strip() for x in run)))
            run = []
    return lines


def _ass(lines: list[tuple[float, float, str]], width: int, height: int) -> str:
    size = round(min(width, height) * 0.06)
    margin = round(height * 0.1)
    head = (
        "[Script Info]\nScriptType: v4.00+\n"
        f"PlayResX: {width}\nPlayResY: {height}\nWrapStyle: 0\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
        "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        f"Style: Caption,DejaVu Sans,{size},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,3,0,2,60,60,{margin},1\n\n"
        "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
    )
    clean = lambda s: s.replace("\\", "").replace("{", "(").replace("}", ")").replace("\n", " ")
    return head + "".join(f"Dialogue: 0,{_clock(a)},{_clock(b)},Caption,,0,0,0,,{clean(t)}\n" for a, b, t in lines if b > a)


def into_video(doc: object, media_id: str, at: float = 0.0) -> bytes:
    """AP-02: the session's mix written back into the video `media_id`'s audio came from: the picture copied untouched
    (re-encoded only if its codec cannot go into MP4), the audio replaced by the mix from `at` seconds (where the video's
    first frame falls in the session; before 0 the mix is delayed instead), padded with silence to the video's end."""
    from ..core.paths import media_dir

    info = media.media_info(media_id)
    suffix = info.get("video")
    source = media_dir() / f"{media_id}.video{suffix}" if suffix else None
    if not source or not source.exists():
        raise media.MediaError("this audio did not come from a video, or its video is no longer stored")
    mix = render.render(doc)
    with tempfile.TemporaryDirectory() as tmp:
        src, out = Path(tmp) / "mix.wav", Path(tmp) / "out.mp4"
        src.write_bytes(mix["wav"])
        lead = ["-ss", f"{at:.3f}"] if at > 0 else []
        pad = f"adelay={round(-at * 1000)}:all=1,apad" if at < 0 else "apad"
        for video_codec in (["-c:v", "copy"], ["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p"]):
            done = subprocess.run(
                [media._tool("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", str(source), *lead, "-i", str(src),
                 "-map", "0:v:0", "-map", "1:a:0", *video_codec, "-af", pad, "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", str(out)],
                capture_output=True, timeout=1800,
            )
            if done.returncode == 0 and out.exists():
                return out.read_bytes()
        raise media.MediaError(f"the audio could not be written into the video: {done.stderr.decode(errors='replace').strip()[-300:]}")


def video(doc: object, words: list, layout: str = "square", title: str = "", start: float | None = None, end: float | None = None) -> bytes:
    """The session (or [start, end] seconds of it) as a captioned waveform MP4 in `layout`."""
    if layout not in LAYOUTS:
        raise media.MediaError("layout is square, portrait or landscape")
    width, height = LAYOUTS[layout]
    mix = render.render(doc)
    length = int(mix["frames"]) / int(doc.get("sampleRate") or 48000) if isinstance(doc, dict) else 0.0
    a = max(0.0, float(start or 0.0))
    b = min(length, float(end)) if end is not None else length
    if b - a < 0.2:
        raise media.MediaError("share at least 0.2 s of audio")
    if b - a > MAX_SECONDS:
        raise media.MediaError("share at most 15 minutes at a time")
    wave_w, wave_h = width - 160, round(height * 0.22)
    wave_y = round(height * 0.38)
    with tempfile.TemporaryDirectory() as tmp:
        src, subs, label, out = Path(tmp) / "mix.wav", Path(tmp) / "captions.ass", Path(tmp) / "title.txt", Path(tmp) / "share.mp4"
        src.write_bytes(mix["wav"])
        subs.write_text(_ass(caption_lines(words if isinstance(words, list) else [], a, b), width, height), encoding="utf-8")
        label.write_text((title or "").strip()[:80], encoding="utf-8")
        graph = (
            f"color=c=0x111318:s={width}x{height}:r=30[bg];"
            # draw=full: showwaves' default (scale) blends each sample faintly, which left a dim grey on the dark ground
            f"[0:a]showwaves=s={wave_w}x{wave_h}:mode=cline:draw=full:colors=0xf97316:rate=30,format=rgba[w];"
            f"[bg][w]overlay=x={(width - wave_w) // 2}:y={wave_y}:shortest=1[v1];"
            f"[v1]drawtext=fontfile={FONT}:textfile={label}:fontcolor=white:fontsize={round(min(width, height) * 0.055)}:x=(w-text_w)/2:y={round(height * 0.14)}[v2];"
            f"[v2]ass={subs}[v]"
        )
        done = subprocess.run(
            [media._tool("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-ss", f"{a:.3f}", "-t", f"{b - a:.3f}", "-i", str(src),
             "-filter_complex", graph, "-map", "[v]", "-map", "0:a", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
             "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", str(out)],
            capture_output=True, timeout=900,
        )
        if done.returncode != 0 or not out.exists():
            raise media.MediaError(f"the video could not be made: {done.stderr.decode(errors='replace').strip()[-300:]}")
        return out.read_bytes()
