"""PLAN_v13 S15: the session's picture. A movie is kept once in the media store's pictures folder under the SHA-256 of
its bytes, with a record of its name, size, codec, frame size, length and rate; one the page cannot play (ProRes,
Motion JPEG, anything but H.264, VP8, VP9 and AV1) gets an all-intra H.264 proxy beside it, which the page plays.
Thumbnails are cut from the proxy (or the movie) at the times asked for, as one strip. A session keeps its picture by
reference (name, size and id), and a movie missing from the store is looked for by name and size near the session."""

from __future__ import annotations

import hashlib
import json
import subprocess
from collections import OrderedDict
from pathlib import Path

from ..core.paths import media_dir
from . import media

PLAYABLE = {"h264", "vp8", "vp9", "av1"}
_sprites: OrderedDict[str, bytes] = OrderedDict()


def folder() -> Path:
    path = media_dir() / "pictures"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _check(pid: str) -> None:
    if not media.MEDIA_ID.match(pid):
        raise KeyError(pid)


def record(pid: str) -> dict:
    _check(pid)
    path = folder() / f"{pid}.json"
    if not path.exists():
        raise KeyError(pid)
    return json.loads(path.read_text())


def movie_path(pid: str) -> Path:
    """What the page plays: the proxy when there is one, else the movie itself."""
    info = record(pid)
    proxy = folder() / f"{pid}.proxy.mp4"
    path = proxy if info.get("proxy") and proxy.exists() else folder() / f"{pid}{info['suffix']}"
    if not path.exists():
        raise KeyError(pid)
    return path


def _probe(path: Path) -> dict:
    done = subprocess.run(
        [media._tool("ffprobe"), "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,avg_frame_rate,r_frame_rate:stream_disposition=attached_pic:format=duration", "-of", "json", str(path)],
        capture_output=True, text=True, timeout=120,
    )
    data = json.loads(done.stdout or "{}")
    streams = [s for s in data.get("streams", []) if not (s.get("disposition") or {}).get("attached_pic")]
    if not streams:
        raise media.MediaError("the file has no picture")
    s = streams[0]

    def ratio(text: str) -> float:
        try:
            num, den = (float(v) for v in str(text).split("/"))
            return num / den if den else 0.0
        except ValueError:
            return 0.0

    fps = ratio(s.get("avg_frame_rate", "0/0")) or ratio(s.get("r_frame_rate", "0/0"))
    return {"codec": s.get("codec_name", ""), "width": int(s.get("width") or 0), "height": int(s.get("height") or 0), "fps": round(fps, 5), "duration": float((data.get("format") or {}).get("duration") or 0)}


def _proxy(src: Path, out: Path) -> None:
    tmp = out.with_suffix(".tmp.mp4")
    done = subprocess.run(
        [media._tool("ffmpeg"), "-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", str(src), "-map", "0:v:0", "-an", "-vf", "scale='min(1280,iw)':-2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-g", "1", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(tmp)],
        capture_output=True, timeout=3600,
    )
    if done.returncode != 0 or not tmp.exists():
        tmp.unlink(missing_ok=True)
        raise media.MediaError(f"could not make a proxy of the picture: {done.stderr.decode(errors='replace').strip()[-300:]}")
    tmp.replace(out)


def import_picture(name: str, data: bytes) -> dict:
    """A movie kept (once) as a picture, with a proxy made when the page cannot play its codec; its record."""
    pid = hashlib.sha256(data).hexdigest()
    suffix = "".join(c for c in Path(name).suffix[:12].lower() if c.isalnum() or c == ".") or ".mov"
    try:
        known = record(pid)
        if (folder() / f"{pid}{known['suffix']}").exists():
            return known
    except KeyError:
        pass
    src = folder() / f"{pid}{suffix}"
    media._write_atomic(src, data)
    try:
        info = _probe(src)
    except media.MediaError:
        src.unlink(missing_ok=True)
        raise
    proxy = info["codec"] not in PLAYABLE
    if proxy:
        _proxy(src, folder() / f"{pid}.proxy.mp4")
    out = {"id": pid, "name": Path(name).name, "size": len(data), "suffix": suffix, **info, "proxy": proxy}
    media._write_atomic(folder() / f"{pid}.json", json.dumps(out).encode())
    return out


def sprite(pid: str, times: list[float], height: int) -> bytes:
    """One PNG strip of frames at `times` (seconds into the movie, each clamped into it), `height` pixels tall, the
    frames side by side in order."""
    info = record(pid)
    path = movie_path(pid)
    height = max(16, min(240, int(height))) // 2 * 2
    last = max(0.0, info["duration"] - 1.0 / max(1.0, info.get("fps") or 25.0))
    times = [min(last, max(0.0, float(t))) for t in times[:64]]
    if not times:
        raise media.MediaError("no times asked for")
    key = f"{pid}|{height}|{','.join(f'{t:.4f}' for t in times)}"
    if key in _sprites:
        _sprites.move_to_end(key)
        return _sprites[key]
    cmd = [media._tool("ffmpeg"), "-hide_banner", "-nostdin", "-loglevel", "error"]
    for t in times:
        cmd += ["-ss", f"{t:.4f}", "-i", str(path)]
    scaled = ";".join(f"[{i}:v]scale=-2:{height},setsar=1,trim=end_frame=1,setpts=PTS-STARTPTS[v{i}]" for i in range(len(times)))
    joined = f"{scaled};{''.join(f'[v{i}]' for i in range(len(times)))}hstack=inputs={len(times)}[out]" if len(times) > 1 else f"{scaled.replace('[v0]', '[out]')}"
    cmd += ["-filter_complex", joined, "-map", "[out]", "-frames:v", "1", "-f", "image2", "-c:v", "png", "pipe:1"]
    done = subprocess.run(cmd, capture_output=True, timeout=300)
    if done.returncode != 0 or not done.stdout:
        raise media.MediaError(f"could not cut the thumbnails: {done.stderr.decode(errors='replace').strip()[-300:]}")
    _sprites[key] = done.stdout
    while len(_sprites) > 256:
        _sprites.popitem(last=False)
    return done.stdout


def _candidates(folders: list[Path], name: str, size: int):
    seen: set[Path] = set()
    for base in folders:
        if not base.is_dir():
            continue
        for depth in ("*", "*/*", "*/*/*"):
            for path in base.glob(depth):
                if path.name == name and path not in seen and path.is_file():
                    seen.add(path)
                    try:
                        if path.stat().st_size == size:
                            yield path
                    except OSError:
                        continue


def relink(picture: dict, folders: list[Path]) -> bool:
    """Whether the session's picture is in the store, bringing it in from a file of its name and size in `folders`
    (and up to two folders down) when it is not; the file found must be the same movie (its SHA-256 is its id)."""
    pid = str(picture.get("id", ""))
    try:
        movie_path(pid)
        return True
    except KeyError:
        pass
    for path in _candidates(folders, str(picture.get("name", "")), int(picture.get("size") or -1)):
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() == pid:
            import_picture(path.name, data)
            return True
    return False
