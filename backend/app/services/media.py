import hashlib
import json
import os
import re
import tempfile
from functools import lru_cache
from pathlib import Path

from ..core.paths import media_dir

try:
    import formwav_dsp as core
except ImportError:
    core = None

MEDIA_ID = re.compile(r"^[0-9a-f]{64}$")
MAX_IMPORT_BYTES = int(os.environ.get("FORMWAV_MAX_IMPORT_MB", "2048")) * 1024 * 1024


class CoreMissing(RuntimeError):
    pass


class MediaError(ValueError):
    pass


def core_version() -> str | None:
    return getattr(core, "__version__", None) if core is not None else None


def _require_core():
    if core is None:
        raise CoreMissing("the audio core is not built; run ./formwav_oc_install")
    return core


def _write_atomic(path: Path, data: bytes) -> None:
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def _check_id(media_id: str) -> None:
    if not MEDIA_ID.match(media_id):
        raise MediaError("a media id is 64 lowercase hex characters")


def import_wav(name: str, data: bytes) -> dict:
    native = _require_core()
    if len(data) > MAX_IMPORT_BYTES:
        raise MediaError("the file is larger than FORMWAV_MAX_IMPORT_MB allows")
    try:
        rate, channels, frames, fmt = native.probe(data)
    except ValueError as err:
        raise MediaError(f"not a readable WAV file: {err}") from err
    media_id = hashlib.sha256(data).hexdigest()
    folder = media_dir()
    audio = folder / f"{media_id}.wav"
    if not audio.exists():
        _write_atomic(audio, data)
    info = {"id": media_id, "name": name, "sampleRate": rate, "channels": channels, "frames": frames, "format": fmt, **_bwf_meta(data, rate)}
    _write_atomic(folder / f"{media_id}.json", json.dumps(info).encode())
    return info


def _bwf_meta(data: bytes, rate: int) -> dict:
    """PT-31: a field recorder's broadcast WAV metadata: the bext chunk's TimeReference (samples since midnight, at
    byte 338 of the chunk) as `timecode` in seconds, and iXML's TAPE, SCENE and TAKE when present; {} for other WAVs."""
    import re

    out: dict = {}
    if len(data) < 12 or data[:4] not in (b"RIFF", b"RF64") or data[8:12] != b"WAVE":
        return out
    i = 12
    while i + 8 <= len(data):
        cid, size = data[i : i + 4], int.from_bytes(data[i + 4 : i + 8], "little")
        body = data[i + 8 : i + 8 + min(size, 1 << 20)] if cid in (b"bext", b"iXML") else b""
        if cid == b"bext" and len(body) >= 346 and rate > 0:
            out["timecode"] = int.from_bytes(body[338:346], "little") / rate
        elif cid == b"iXML":
            text = body.decode("utf-8", "replace")
            for tag, key in (("TAPE", "tape"), ("SCENE", "scene"), ("TAKE", "take")):
                hit = re.search(rf"<{tag}>([^<]*)</{tag}>", text)
                if hit and hit.group(1).strip():
                    out[key] = hit.group(1).strip()
        if cid == b"data" and size > len(data):  # an unsized data chunk ends the walk
            break
        i += 8 + size + (size & 1)
    return out


#: Rates a new session may keep from its first file; anything else starts the session at 48 kHz.
STANDARD_RATES = (44100, 48000, 88200, 96000)


def _tool(name: str) -> str:
    import os
    import shutil

    exe = shutil.which(os.environ.get(f"FORMWAV_{name.upper()}", name))
    if not exe:
        raise MediaError(f"{name} is needed to read this file; install it (macOS: brew install ffmpeg) or import a WAV at the session's sample rate")
    return exe


def _probe_stream(path: Path) -> tuple[int, int]:
    """Sample rate and channel count of the first audio stream in any file ffmpeg reads."""
    import subprocess

    done = subprocess.run(
        [_tool("ffprobe"), "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate,channels", "-of", "json", str(path)],
        capture_output=True, text=True, timeout=120,
    )
    try:
        stream = json.loads(done.stdout or "{}").get("streams", [])[0]
        return int(stream["sample_rate"]), int(stream["channels"])
    except (IndexError, KeyError, ValueError) as err:
        raise MediaError("no audio stream found in this file") from err


def _has_video(path: Path) -> bool:
    """AP-02: whether a file carries a picture stream (an album cover attached to an audio file does not count)."""
    import subprocess

    done = subprocess.run(
        [_tool("ffprobe"), "-v", "error", "-select_streams", "v", "-show_entries", "stream=codec_type:stream_disposition=attached_pic", "-of", "json", str(path)],
        capture_output=True, text=True, timeout=120,
    )
    streams = json.loads(done.stdout or "{}").get("streams", [])
    return any(not (s.get("disposition") or {}).get("attached_pic") for s in streams)


def _transcode(src: Path, out: Path, rate: int, channels: int) -> bytes:
    """Decodes `src` to 32-bit float WAV at `rate`: resampled with soxr (ffmpeg's own resampler if soxr is missing),
    mono kept mono, more than two channels downmixed to stereo. Output goes to a file, as a WAV header needs a seekable target."""
    import subprocess

    detail = ""
    for resampler in ("soxr:precision=28", "swr"):
        cmd = [_tool("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", str(src), "-map", "0:a:0", "-vn",
               "-af", f"aresample={rate}:resampler={resampler}", "-ac", str(min(channels, 2)), "-c:a", "pcm_f32le", str(out)]
        done = subprocess.run(cmd, capture_output=True, timeout=900)
        if done.returncode == 0 and out.exists() and out.stat().st_size > 44:
            return out.read_bytes()
        detail = done.stderr.decode(errors="replace").strip()[-300:]
    raise MediaError(f"could not decode this file: {detail}")


def import_audio(name: str, data: bytes, rate: int | None = None) -> dict:
    """Imports any audio (or the audio of a video) at `rate`, the session's rate. With no session yet, a file at a
    standard rate keeps it and anything else becomes 48 kHz. A WAV already at the target rate is stored byte for byte."""
    import tempfile

    native = _require_core()
    if len(data) > MAX_IMPORT_BYTES:
        raise MediaError("the file is larger than FORMWAV_MAX_IMPORT_MB allows")
    try:
        wav_rate = native.probe(data)[0]
        if (rate is None and wav_rate in STANDARD_RATES) or wav_rate == rate:
            return import_wav(name, data)
    except ValueError:
        pass
    suffix = "".join(c for c in Path(name).suffix[:12].lower() if c.isalnum() or c == ".") or ".mp4"
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / ("source" + suffix)
        src.write_bytes(data)
        native_rate, channels = _probe_stream(src)
        target = rate or (native_rate if native_rate in STANDARD_RATES else 48000)
        wav = _transcode(src, Path(tmp) / "decoded.wav", target, channels)
        picture = _has_video(src)
    info = import_wav(name, wav)
    if picture:
        # AP-02: the video kept beside its audio and named in the record, so the edited audio can be written back
        _write_atomic(media_dir() / f"{info['id']}.video{suffix}", data)
        info = {**info, "video": suffix}
        _write_atomic(media_dir() / f"{info['id']}.json", json.dumps(info).encode())
    return info


def resample_media(media_id: str, rate: int) -> dict:
    """A stored media file converted to `rate` (a new media id); the original is kept."""
    import tempfile

    info = media_info(media_id)
    if info["sampleRate"] == rate:
        return info
    with tempfile.TemporaryDirectory() as tmp:
        wav = _transcode(media_dir() / f"{media_id}.wav", Path(tmp) / "resampled.wav", rate, int(info["channels"]))
    out = import_wav(info["name"], wav)
    # PT-31: the transcode drops the bext and iXML chunks, so a recorder file's timecode and tape carry over here
    carried = {k: info[k] for k in ("timecode", "tape", "scene", "take") if k in info}
    if carried and any(k not in out for k in carried):
        out = {**out, **carried}
        _write_atomic(media_dir() / f"{out['id']}.json", json.dumps(out).encode())
    return out


def list_media(query: str = "", limit: int = 100, offset: int = 0) -> dict:
    """The stored media, newest first, optionally only names containing `query` (case-insensitive): a page of their
    infos and the total, so a caller (the MCP server's agents) can pick a handle without knowing it already."""
    q = query.lower().strip()
    infos = []
    for path in media_dir().glob("*.json"):
        if not MEDIA_ID.match(path.stem):
            continue
        try:
            info = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        if not q or q in str(info.get("name", "")).lower():
            infos.append((path.stat().st_mtime, info))
    infos.sort(key=lambda pair: pair[0], reverse=True)
    page = [info for _, info in infos[max(0, offset) : max(0, offset) + max(1, min(limit, 500))]]
    return {"total": len(infos), "offset": max(0, offset), "media": page}


def media_info(media_id: str) -> dict:
    _check_id(media_id)
    path = media_dir() / f"{media_id}.json"
    if not path.exists():
        raise KeyError(media_id)
    return json.loads(path.read_text())


@lru_cache(maxsize=8)
def _levels(media_id: str) -> tuple:
    native = _require_core()
    return tuple(native.peaks((media_dir() / f"{media_id}.wav").read_bytes()))


def peaks(media_id: str, samples_per_peak: int) -> tuple[int, int, int, bytes]:
    media_info(media_id)
    levels = _levels(media_id)
    if not levels:
        raise MediaError("the file has no audio frames")
    return next((level for level in levels if level[0] >= samples_per_peak), levels[-1])
