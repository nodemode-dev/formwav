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
    info = {"id": media_id, "name": name, "sampleRate": rate, "channels": channels, "frames": frames, "format": fmt}
    _write_atomic(folder / f"{media_id}.json", json.dumps(info).encode())
    return info


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
