"""Small JSON stores in the data folder (cloud.json, remote.json): read with a damaged file set aside rather than lost,
written whole and then moved into place, and, for stores holding tokens, readable by this user only."""

import json
import os
import tempfile
import time
from pathlib import Path


def read_json(path: Path, default: dict) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return dict(default)
    except ValueError:
        path.replace(path.with_suffix(f".damaged-{int(time.time())}"))
        return dict(default)


def write_json(path: Path, data: dict, private: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{path.stem}-", dir=path.parent)
    with os.fdopen(fd, "w", encoding="utf-8") as out:
        json.dump(data, out)
    if private:
        os.chmod(tmp, 0o600)
    os.replace(tmp, path)
