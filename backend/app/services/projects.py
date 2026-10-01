import hashlib
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


def _thumbnail(doc: object) -> bytes | None:
    """A 320x64 PNG of the session's mix (ffmpeg's showwavespic over the engine's own render), or None when the session
    is empty, longer than THUMBNAIL_MAX_SECONDS, or cannot be rendered; a save never fails for want of a picture."""
    from . import render

    try:
        rate = int(doc.get("sampleRate") or 0) if isinstance(doc, dict) else 0
        end = max((c.get("start", 0) + c.get("length", 0) for t in doc.get("tracks", []) for c in t.get("clips", [])), default=0) if isinstance(doc, dict) else 0
        if rate <= 0 or end <= 0 or end > THUMBNAIL_MAX_SECONDS * rate:
            return None
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
    return manifest, doc, z


def open_project(name: str) -> dict:
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
    return {"name": path.stem, "savedAt": manifest.get("savedAt"), "revision": int(manifest.get("revision", 1)), "document": doc}


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
