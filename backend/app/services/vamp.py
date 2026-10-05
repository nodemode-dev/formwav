"""AU-40: Vamp analysis plugins (as Audacity's Analyze menu runs them), through native/formwav-vamp/fwvamp.

fwvamp follows the Vamp SDK's own reference host (sizes, adapters, processing, feature timing) and was compared with it
output by output (sidecar verification/vamp_vs_reference). Plugins are found on the Vamp path: VAMP_PATH if set, else the
SDK's defaults (on a Mac ~/Library/Audio/Plug-Ins/Vamp and /Library/Audio/Plug-Ins/Vamp; on Linux ~/vamp,
/usr/local/lib/vamp and /usr/lib/vamp).
"""

from __future__ import annotations

import glob
import json
import os
import subprocess
import sys
from pathlib import Path

from . import media

_ROOT = Path(__file__).resolve().parents[3] / "native" / "formwav-vamp"


def binary() -> str:
    return os.environ.get("FORMWAV_FWVAMP") or str(_ROOT / "fwvamp")


def _run(args: list[str], timeout: float):
    if not Path(binary()).is_file():
        raise media.MediaError("Vamp hosting is not built here (native/formwav-vamp/build_fwvamp makes fwvamp)")
    env = os.environ.copy()
    if sys.platform.startswith("linux") and not env.get("VAMP_PATH"):
        # Debian and Ubuntu install Vamp plugins in a multiarch directory (/usr/lib/x86_64-linux-gnu/vamp), which the
        # SDK's own default path leaves out (their packaged SDK is patched for it, the vendored one is not): the
        # installed Linux app found none. The SDK's defaults, then every multiarch directory there is.
        home = os.path.expanduser("~")
        dirs = [f"{home}/vamp", f"{home}/.vamp", "/usr/local/lib/vamp", "/usr/lib/vamp"] + sorted(glob.glob("/usr/lib/*-linux-gnu/vamp"))
        env["VAMP_PATH"] = ":".join(dirs)
    try:
        done = subprocess.run([binary(), *args], capture_output=True, timeout=timeout, env=env)
    except subprocess.TimeoutExpired as err:
        raise media.MediaError("the Vamp plugin did not finish in time") from err
    if done.returncode != 0:
        tail = [ln for ln in (done.stderr or b"").decode("utf-8", errors="replace").splitlines() if ln.strip()][-1:]
        raise media.MediaError("Vamp: " + (tail[0] if tail else f"exit status {done.returncode}")[:300])
    return json.loads(done.stdout)


def list_plugins() -> list[dict]:
    """Every Vamp plugin on the path: key, name, maker, description, parameters (id, name, unit, range, default,
    quantize step, choices) and outputs (id, name, unit, bins, timing type, whether features have durations)."""
    return _run(["list"], 120)


def run(media_id: str, key: str, params: dict | None = None) -> dict:
    """The plugin `key` run on the media's audio with `params` (id to value): every output's features, each with its
    time and frame in the media, duration where it has one, values and label."""
    path = media.media_dir() / f"{media_id}.wav"
    if not path.is_file():
        raise KeyError(media_id)
    if not key or ":" not in key:
        raise media.MediaError("a Vamp plugin key looks like library:plugin")
    args = ["run", key, str(path)] + [f"{k}={float(v)}" for k, v in (params or {}).items()]
    return _run(args, 1800)
