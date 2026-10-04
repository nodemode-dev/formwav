"""Third-party plugins (CLAP, VST3 and LADSPA) as effects, through formwav-host (native/formwav-host, `fwhost`).

The host runs as its own process for every job, so a plugin that crashes ends that job and never the engine. A scan
of the system's plugin folders (and FORMWAV_PLUGIN_PATH) lists what is installed; each plugin then appears in the
effect catalogue's "Plugins" group as `plugin:<format>:<path>`, so the Inspector, ranges in the repair area, the in-app
agent and the MCP server all reach plugins the way they reach any effect. Only a plugin the scan found can be loaded:
loading a library runs its code, so a path is never taken from a request. Applying one renders the media through it
offline (with an optional tail of silence to let reverbs and delays ring out) into new media; the source is kept.
FORMWAV_HOST_BIN names the host binary; otherwise the repository's build is used.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from . import media

REPO_HOST = Path(__file__).resolve().parents[3] / "native" / "formwav-host" / "target"
_scanned: list[dict] | None = None


def host_binary() -> str:
    named = os.environ.get("FORMWAV_HOST_BIN", "")
    if named and Path(named).is_file():
        return named
    for build in ("release", "debug"):
        candidate = REPO_HOST / build / "fwhost"
        if candidate.is_file():
            return str(candidate)
    found = shutil.which("fwhost")
    if found:
        return found
    raise media.MediaError("formwav's plugin host is not built: run `cargo build --release` in native/formwav-host (or set FORMWAV_HOST_BIN)")


def scan(refresh: bool = False) -> list[dict]:
    """The plugins installed here, cached until a refresh; a plugin that could not be read is listed with its reason."""
    global _scanned
    if _scanned is None or refresh:
        try:
            done = subprocess.run([host_binary(), "scan"], capture_output=True, timeout=180)
            _scanned = json.loads(done.stdout or b"[]") if done.returncode == 0 else []
        except (media.MediaError, subprocess.TimeoutExpired, ValueError, OSError):
            _scanned = []
    return _scanned


def catalogue_group() -> list[dict]:
    """The "Plugins" group of the effect catalogue, empty when nothing is installed or the host is not built."""
    effects = [
        {
            "id": f"plugin:{p['format']}:{p['path']}",
            "label": f"{p['name']} ({p['format'].upper()})",
            "params": [{"id": "tail", "label": "Tail", "min": 0, "max": 10, "default": 0, "unit": "s"}],
            "retimes": False,
            "learnsNoise": False,
        }
        for p in scan()
        if "error" not in p
    ]
    return [{"group": "Plugins", "effects": effects}] if effects else []


_params: dict[str, list[dict]] = {}


def _installed(name: str) -> tuple[str, str, dict]:
    """plugin:<format>:<path> resolved against the scan: only a plugin the scan found is ever loaded."""
    try:
        _, fmt, path = name.split(":", 2)
    except ValueError as err:
        raise media.MediaError(f"no effect named {name}") from err
    plugin = next((p for p in scan() if p.get("format") == fmt and p.get("path") == path and "error" not in p), None)
    if plugin is None:
        raise media.MediaError(f"no installed {fmt.upper()} plugin at {path} (rescan with GET /api/plugins?refresh=1)")
    return fmt, path, plugin


def params(name: str) -> list[dict]:
    """A plugin's parameters as the Inspector's controls (ids p<id>, beside the Tail control), listed by the host the
    first time they are asked for and kept: never during a scan, which would instantiate every installed plugin."""
    fmt, path, _ = _installed(name)
    if name not in _params:
        try:
            done = subprocess.run([host_binary(), "params", fmt, path], capture_output=True, timeout=120)
            if done.returncode != 0:
                return []  # not kept: a failure (an old host, a busy plugin) is asked again next time
            rows = json.loads(done.stdout or b"[]")
        except (subprocess.TimeoutExpired, ValueError, OSError):
            return []
        controls = []
        for r in rows[:64]:
            control = {"id": f"p{r['id']}", "label": r["name"], "min": r["min"], "max": r["max"], "default": r["default"], "unit": ""}
            if r.get("steps", 0) > 0:
                control["step"] = (r["max"] - r["min"]) / r["steps"]
            elif r["max"] > r["min"]:
                control["step"] = (r["max"] - r["min"]) / 1000
            controls.append(control)
        _params[name] = controls
    return _params[name]


def apply(media_id: str, name: str, params: dict | None = None) -> dict:
    """Renders a stored media file through the plugin `name` (plugin:<format>:<path>, as listed) into new media, with
    any parameter values chosen in its controls (p<id>) set at its first sample."""
    fmt, path, plugin = _installed(name)
    values = {k[1:]: float(v) for k, v in (params or {}).items() if k.startswith("p") and k[1:].isdigit()}
    tail = max(0.0, min(10.0, float((params or {}).get("tail", 0) or 0)))
    info = media.media_info(media_id)
    source = media.media_dir() / f"{media_id}.wav"
    with tempfile.TemporaryDirectory(prefix="formwav-plugin-") as tmp:
        out = Path(tmp) / "out.wav"
        try:
            command = [host_binary(), "process", fmt, path, str(source), str(out), f"{tail:g}"]
            if values:
                command.append(json.dumps(values))
            done = subprocess.run(command, capture_output=True, timeout=900)
        except subprocess.TimeoutExpired as err:
            raise media.MediaError(f"{plugin['name']} did not finish within 15 minutes") from err
        if done.returncode != 0 or not out.is_file():
            reason = (done.stderr or b"").decode(errors="replace").strip().splitlines()[-1:] or [f"exit status {done.returncode}"]
            if done.returncode < 0:
                reason = [f"the plugin crashed (signal {-done.returncode}); formwav is unaffected"]
            raise media.MediaError(f"{plugin['name']} failed: {reason[0][:300]}")
        stem = str(info.get("name", "clip")).rsplit(".", 1)[0]
        return media.import_wav(f"{stem} ({plugin['name']}).wav", out.read_bytes())
