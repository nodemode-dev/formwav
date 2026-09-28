import os
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[2]


def data_dir() -> Path:
    raw = os.environ.get("FORMWAV_DATA_DIR")
    return Path(raw).expanduser() if raw else BACKEND_ROOT / "data"


def media_dir() -> Path:
    path = data_dir() / "media"
    path.mkdir(parents=True, exist_ok=True)
    return path
