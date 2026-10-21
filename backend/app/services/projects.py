import hashlib
import io
import json
import os
import re
import subprocess
import tempfile
import threading
import time
import zipfile
from pathlib import Path

from ..core.paths import data_dir, media_dir
from ..core.version import VERSION
from . import media

FORMAT = "formwav-session"
FORMAT_VERSION = 1
NAME = re.compile(r"^[\w][\w .,'()-]{0,79}$")


class ProjectError(ValueError):
    pass


class RevisionConflict(Exception):
    def __init__(self, current: int) -> None:
        super().__init__(f"the saved session is at revision {current}")
        self.current = current


_SAVE_LOCK = threading.Lock()


def _current_revision(path: Path) -> int:
    if not path.exists():
        return 0
    try:
        manifest, _doc, z = _read(path)
        z.close()
    except (ProjectError, zipfile.BadZipFile):
        return 1
    return int(manifest.get("revision", 1))


def projects_dir() -> Path:
    path = data_dir() / "projects"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _path(name: str) -> Path:
    clean = name.strip()
    if not NAME.match(clean):
        raise ProjectError("a session name is 1 to 80 letters, digits, spaces or . , ' ( ) - _ and starts with a letter or digit")
    return projects_dir() / f"{clean}.fmw"


def _media_ids(doc: object) -> set[str]:
    if not isinstance(doc, dict) or not isinstance(doc.get("tracks"), list) or not isinstance(doc.get("media"), dict):
        raise ProjectError("not a session document")
    if not isinstance(doc.get("sampleRate"), int) or doc["sampleRate"] <= 0:
        raise ProjectError("the session has no valid sample rate")
    ids = set(doc["media"].keys())
    for mid in ids:
        if not media.MEDIA_ID.match(mid):
            raise ProjectError("the session lists a malformed media id")
    for track in doc["tracks"]:
        for clip in track.get("clips", []) if isinstance(track, dict) else []:
            if clip.get("mediaId") not in ids:
                raise ProjectError("a clip refers to media the session does not list")
    return ids


def _summary(path: Path, manifest: dict, doc: dict) -> dict:
    return {
        "name": path.stem,
        "savedAt": manifest.get("savedAt"),
        "tracks": len(doc.get("tracks", [])),
        "bytes": path.stat().st_size,
        "appVersion": manifest.get("appVersion"),
        "revision": int(manifest.get("revision", 1)),
        "thumbnail": bool(manifest.get("thumbnail")),
    }


THUMBNAIL_MAX_SECONDS = 300


def _overview_png(doc: dict, rate: int, end: int) -> bytes | None:
    """AU-32, sessions longer than THUMBNAIL_MAX_SECONDS: the same 320x64 picture showwavespic draws (bars about the
    centre on a square-root scale, 0xf97316 on transparent), from the clips' own files read at a stride, about 64 samples
    a column, each clip's and track's gain applied, muted and unsoloed tracks left out, the loudest across tracks per
    column. Rendering an hour's mix on every save would make saving slow; this reads a few thousand samples a clip."""
    import numpy as np

    from .tools import _wav_view

    width, height = 320, 64
    cols = np.zeros(width)
    span = end / width
    step = max(1, int(span // 64))
    tracks = doc.get("tracks", [])
    soloed = any(t.get("solo") and not t.get("inactive") for t in tracks)
    for t in tracks:
        if t.get("inactive") or t.get("mute") or (soloed and not t.get("solo") and not t.get("soloSafe")):
            continue
        for c in t.get("clips", []):
            if c.get("mediaId") not in (doc.get("media") or {}):
                continue
            view, _ = _wav_view(c["mediaId"])
            x = np.asarray(view)
            start, length, src = int(c.get("start", 0)), int(c.get("length", 0)), int(c.get("sourceIn", 0))
            pos = np.arange(start, start + length, step)
            if not len(pos) or not len(x):
                continue
            v = np.abs(x[np.clip(src + pos - start, 0, len(x) - 1)].astype(np.float64)).max(axis=1)
            if x.dtype == np.int16:
                v /= 32768.0
            v *= 10 ** ((float(t.get("gainDb") or 0) + float(t.get("trimDb") or 0) + float(c.get("gainDb") or 0)) / 20)
            np.maximum.at(cols, np.minimum(width - 1, (pos / span).astype(int)), v)
    half = np.round(np.sqrt(np.clip(cols, 0, 1)) * height / 2).astype(int)
    img = np.zeros((height, width, 4), dtype=np.uint8)
    for k in range(width):
        if half[k] > 0:
            img[height // 2 - half[k] : height // 2 + half[k], k] = (0xF9, 0x73, 0x16, 255)
    done = subprocess.run([media._tool("ffmpeg"), "-hide_banner", "-nostdin", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{width}x{height}",
                           "-i", "-", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"], input=img.tobytes(), capture_output=True, timeout=60)
    return done.stdout if done.returncode == 0 and done.stdout else None


def _thumbnail(doc: object) -> bytes | None:
    """A 320x64 PNG of the session's mix (ffmpeg's showwavespic over the engine's own render); a session longer than
    THUMBNAIL_MAX_SECONDS gets _overview_png's picture from its clips' files instead. None when the session is empty or
    nothing can be drawn; a save never fails for want of a picture."""
    from . import render

    try:
        rate = int(doc.get("sampleRate") or 0) if isinstance(doc, dict) else 0
        end = max((c.get("start", 0) + c.get("length", 0) for t in doc.get("tracks", []) for c in t.get("clips", [])), default=0) if isinstance(doc, dict) else 0
        if rate <= 0 or end <= 0:
            return None
        if end > THUMBNAIL_MAX_SECONDS * rate:
            return _overview_png(doc, rate, end)
        wav = render.render(doc)["wav"]
        with tempfile.TemporaryDirectory() as tmp:
            src, out = Path(tmp) / "mix.wav", Path(tmp) / "thumb.png"
            src.write_bytes(wav)
            done = subprocess.run(
                [media._tool("ffmpeg"), "-hide_banner", "-nostdin", "-loglevel", "error", "-i", str(src), "-filter_complex", "showwavespic=s=320x64:split_channels=0:scale=sqrt:colors=0xf97316", "-frames:v", "1", "-y", str(out)],
                capture_output=True, timeout=120,
            )
            return out.read_bytes() if done.returncode == 0 and out.exists() else None
    except Exception:  # noqa: BLE001 - a thumbnail is optional; the save goes ahead without one
        return None


def thumbnail(name: str) -> bytes:
    """The PNG stored in a saved session, or KeyError when the session has none."""
    path = file_path(name)
    with zipfile.ZipFile(path) as z:
        if "thumbnail.png" not in z.namelist():
            raise KeyError(name)
        return z.read("thumbnail.png")


def save(name: str, doc: object, base: int | None = None) -> dict:
    path = _path(name)
    ids = _media_ids(doc)
    for mid in ids:
        try:
            media.media_info(mid)
        except KeyError as err:
            raise ProjectError("the session uses media the engine no longer has") from err
    picture = _thumbnail(doc)
    with _SAVE_LOCK:
        current = _current_revision(path)
        if base is not None and base != current:
            raise RevisionConflict(current)
        manifest = {
            "format": FORMAT,
            "formatVersion": FORMAT_VERSION,
            "app": "formwav",
            "appVersion": VERSION,
            "name": path.stem,
            "revision": current + 1,
            "savedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            **({"thumbnail": "thumbnail.png"} if picture else {}),
        }
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=".fmw")
        try:
            with os.fdopen(fd, "wb") as fh:
                with zipfile.ZipFile(fh, "w", compression=zipfile.ZIP_DEFLATED) as z:
                    z.writestr("manifest.json", json.dumps(manifest, indent=2))
                    z.writestr("session.json", json.dumps(doc))
                    if picture:
                        z.writestr("thumbnail.png", picture, compress_type=zipfile.ZIP_STORED)
                    for mid in sorted(ids):
                        z.write(media_dir() / f"{mid}.wav", f"media/{mid}.wav", compress_type=zipfile.ZIP_STORED)
                fh.flush()
                os.fsync(fh.fileno())
            os.replace(tmp, path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
        return _summary(path, manifest, doc)


def _read(path: Path) -> tuple[dict, dict, zipfile.ZipFile]:
    z = zipfile.ZipFile(path)
    try:
        manifest = json.loads(z.read("manifest.json"))
        doc = json.loads(z.read("session.json"))
    except (KeyError, ValueError) as err:
        z.close()
        raise ProjectError("the file is not a readable formwav session") from err
    if manifest.get("format") != FORMAT:
        z.close()
        raise ProjectError("the file is not a formwav session")
    if int(manifest.get("formatVersion", 0)) > FORMAT_VERSION:
        z.close()
        raise ProjectError("the session was saved by a newer formwav")
    # Sessions saved before v2.18.5 were mixed with each fader on the clips, ahead of the track's effects; S17 moved it
    # after them. Marked as it is read, such a session plays and exports as it was mixed (player.ts and render.py read
    # the mark, and every later save keeps it): Glasshouse, saved by 2.16.6, came out 2.2 LU quieter without it.
    if isinstance(doc, dict) and "fadersBeforeInserts" not in doc and _older(str(manifest.get("appVersion", "")), (2, 18, 5)):
        doc["fadersBeforeInserts"] = True
    return manifest, doc, z


def _older(version: str, than: tuple[int, ...]) -> bool:
    """Whether a version string (2.16.6) is before `than`; an unreadable or missing one counts as older."""
    try:
        return tuple(int(p) for p in version.split(".")[:3]) < than
    except ValueError:
        return True


def open_project(name: str, near: list[Path] | None = None) -> dict:
    path = _path(name)
    if not path.exists():
        raise KeyError(name)
    try:
        manifest, doc, z = _read(path)
    except zipfile.BadZipFile as err:
        raise ProjectError("the file is damaged") from err
    with z:
        ids = _media_ids(doc)
        for mid in ids:
            try:
                data = z.read(f"media/{mid}.wav")
            except KeyError as err:
                raise ProjectError("a media file is missing from the session") from err
            if hashlib.sha256(data).hexdigest() != mid:
                raise ProjectError("a media file inside the session is damaged")
            media.import_wav(doc["media"][mid].get("name", f"{mid}.wav"), data)
    # PLAN_v13 S15: the picture is kept by reference; one gone from the store is looked for by name and size beside the
    # sessions, in the folders next to them and where the file was opened from, and named as missing when not found
    missing = []
    pic = doc.get("picture")
    if isinstance(pic, dict) and pic.get("id"):
        from . import picture

        folders = [*(near or []), path.parent, *[p for p in path.parent.parent.iterdir() if p.is_dir() and p != path.parent]]
        if not picture.relink(pic, folders):
            missing.append(str(pic.get("name", "")))
    return {"name": path.stem, "savedAt": manifest.get("savedAt"), "revision": int(manifest.get("revision", 1)), "document": doc, "missing": missing}


CLIPS_FORMAT = "formwav-clips"


def pack_clips(group: object) -> bytes:
    """PLAN_v13 S13, clip group files: clips from one or more tracks ({sampleRate, media, tracks: [{name, clips}]})
    and the media they play, as one file another session can bring in."""
    if not isinstance(group, dict) or not isinstance(group.get("tracks"), list) or not group["tracks"]:
        raise ProjectError("give the clips to keep, track by track")
    doc = {"sampleRate": group.get("sampleRate"), "media": group.get("media") or {}, "tracks": group["tracks"]}
    ids = _media_ids(doc)
    if not any(t.get("clips") for t in doc["tracks"] if isinstance(t, dict)):
        raise ProjectError("there are no clips to keep")
    for mid in ids:
        try:
            media.media_info(mid)
        except KeyError as err:
            raise ProjectError("the clips use media the engine no longer has") from err
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps({"format": CLIPS_FORMAT, "formatVersion": 1, "app": "formwav", "appVersion": VERSION}, indent=2))
        z.writestr("clips.json", json.dumps(doc))
        for mid in sorted(ids):
            z.write(media_dir() / f"{mid}.wav", f"media/{mid}.wav", compress_type=zipfile.ZIP_STORED)
    return out.getvalue()


def unpack_clips(data: bytes) -> dict:
    """A clip group file read back: its media brought into the engine (each checked against its id) and its clips."""
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        manifest = json.loads(z.read("manifest.json"))
        doc = json.loads(z.read("clips.json"))
    except (zipfile.BadZipFile, KeyError, ValueError) as err:
        raise ProjectError("the file is not a formwav clips file") from err
    if manifest.get("format") != CLIPS_FORMAT:
        raise ProjectError("the file is not a formwav clips file")
    if int(manifest.get("formatVersion", 0)) > 1:
        raise ProjectError("the clips were saved by a newer formwav")
    with z:
        for mid in _media_ids(doc):
            try:
                wav = z.read(f"media/{mid}.wav")
            except KeyError as err:
                raise ProjectError("a media file is missing from the clips file") from err
            if hashlib.sha256(wav).hexdigest() != mid:
                raise ProjectError("a media file inside the clips file is damaged")
            media.import_wav(doc["media"][mid].get("name", f"{mid}.wav"), wav)
    return doc


def open_file(path_text: str) -> dict:
    """A .fmw from anywhere on this machine (the desktop app hands over a session file the user opened): checked to be
    a formwav session, copied into the sessions under its own name, or "name (2)" and on when a different session
    already has it (the same file twice reuses its copy), then opened like any saved session."""
    source = Path(path_text).expanduser()
    if source.suffix.lower() != ".fmw" or not source.is_file():
        raise ProjectError("open a .fmw file that exists on this machine")
    return open_project(adopt(source, source.stem), [source.parent])


def _digest(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def adopt(source: Path, title: str, move: bool = False) -> str:
    """A .fmw checked to be a formwav session and put among the sessions under its own name, or "name (2)" and on when a
    different session already has it (the same file twice reuses its copy); its name. Copied, or moved for a file the
    engine received, in blocks: a session with its media is hundreds of MB, never read into memory whole."""
    import shutil

    try:
        _, _, z = _read(source)
        z.close()
    except zipfile.BadZipFile as err:
        raise ProjectError("the file is damaged or is not a formwav session") from err
    stem = re.sub(r"[^A-Za-z0-9 .,'()\-_]", "", title).strip()[:72] or "Session"
    if not stem[0].isalnum():
        stem = f"Session {stem}"[:72]
    size, digest = source.stat().st_size, None
    for n in range(1, 100):
        name = stem if n == 1 else f"{stem} ({n})"
        target = _path(name)
        if not target.exists():
            (shutil.move if move else shutil.copyfile)(str(source), str(target))
            return name
        if target.stat().st_size == size:
            digest = digest or _digest(source)
            if _digest(target) == digest:
                if move:
                    source.unlink()
                return name
    raise ProjectError("too many sessions share this name")


def list_projects() -> list[dict]:
    items = []
    for path in sorted(projects_dir().glob("*.fmw"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            manifest, doc, z = _read(path)
            z.close()
        except (ProjectError, zipfile.BadZipFile):
            continue
        items.append(_summary(path, manifest, doc))
    return items


def file_path(name: str) -> Path:
    path = _path(name)
    if not path.exists():
        raise KeyError(name)
    return path
