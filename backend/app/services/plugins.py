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

import base64
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
        _scanned = _scanned + _lv2_scan()
    return _scanned


def lv2_binary() -> str:
    """AU-27: fwlv2 (native/formwav-lv2), the LV2 host; FORMWAV_FWLV2 names it in the desktop app."""
    return os.environ.get("FORMWAV_FWLV2") or str(Path(__file__).resolve().parents[3] / "native" / "formwav-lv2" / "fwlv2")


_lv2_listing: dict[str, dict] = {}


def _lv2_scan() -> list[dict]:
    """AU-27: the LV2 plugins lilv finds (LV2_PATH, else its default places), as scan entries (format lv2, path the
    plugin's URI); one fwlv2 cannot host is listed with the reason, as an unreadable CLAP or VST3 plugin is."""
    if not Path(lv2_binary()).is_file():
        return []
    try:
        done = subprocess.run([lv2_binary(), "list"], capture_output=True, timeout=120)
        rows = json.loads(done.stdout or b"[]") if done.returncode == 0 else []
    except (subprocess.TimeoutExpired, ValueError, OSError):
        return []
    entries = []
    for r in rows:
        _lv2_listing[r["uri"]] = r
        entry = {"format": "lv2", "path": r["uri"], "name": r["name"] or r["uri"].rsplit("/", 1)[-1], "instrument": r["audio_in"] == 0}
        if not r.get("supported"):
            entry["error"] = r.get("reason", "not hostable")
        entries.append(entry)
    return entries


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
        if "error" not in p and not p.get("instrument")
    ]
    return [{"group": "Plugins", "effects": effects}] if effects else []


def instruments() -> list[dict]:
    """PT-15: the CLAP instruments installed here, as note tracks offer them (plugin:<format>:<path> and a name)."""
    return [{"id": f"plugin:{p['format']}:{p['path']}", "name": p["name"]} for p in scan() if "error" not in p and p.get("instrument")]


def play_instrument(name: str, notes: list[tuple[int, int, int, int]], rate: int, label: str) -> dict:
    """PT-15: notes (first frame, length, key, velocity) played on the instrument `name` (as listed) into new media."""
    fmt, path, plugin = _installed(name)
    if not plugin.get("instrument"):
        raise media.MediaError(f"{plugin['name']} is not an instrument")
    with tempfile.TemporaryDirectory(prefix="formwav-instrument-") as tmp:
        listing = Path(tmp) / "notes.txt"
        listing.write_text("".join(f"{s} {n} {k} {v}\n" for s, n, k, v in notes))
        out = Path(tmp) / "out.wav"
        try:
            seconds = max(s + n for s, n, _, _ in notes) / rate + 2.0  # two seconds past the last note-off, for its release
            done = subprocess.run([host_binary(), "instrument", path, str(listing), str(out), str(rate), f"{seconds:g}"], capture_output=True, timeout=900)
        except subprocess.TimeoutExpired as err:
            raise media.MediaError(f"{plugin['name']} did not finish within 15 minutes") from err
        if done.returncode != 0 or not out.is_file():
            reason = (done.stderr or b"").decode(errors="replace").strip().splitlines()[-1:] or [f"exit status {done.returncode}"]
            if done.returncode < 0:
                reason = [f"the plugin crashed (signal {-done.returncode}); formwav is unaffected"]
            raise media.MediaError(f"{plugin['name']} failed: {reason[0][:300]}")
        return media.import_wav(f"{label}.wav", out.read_bytes())


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
    if fmt == "lv2":  # AU-27: the control inputs fwlv2 listed, by port index; integer and toggled ones step by 1
        controls = []
        for c in _lv2_listing.get(path, {}).get("controls", [])[:64]:
            lo = c["min"] if c["min"] is not None else 0.0
            hi = c["max"] if c["max"] is not None else max(1.0, lo + 1.0)
            step = 1 if (c.get("integer") or c.get("toggled")) else ((hi - lo) / 1000 if hi > lo else 0.001)
            controls.append({"id": f"p{c['index']}", "label": c["name"] or c["symbol"], "min": lo, "max": hi, "default": c["default"], "unit": "", "step": step})
        return controls
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
    any parameter values chosen in its controls (p<id>) set at its first sample. S17, CLAP plugins: `state` (base64,
    as a previous render returned it) is loaded before the render, `automation` ({"p<id>": [[seconds, value], ...]})
    moves parameters along the clip, and the plugin and its state after the render come back as `plugin` ({"name",
    "state"}), which the interface keeps on the media it made, so the session saves it."""
    fmt, path, plugin = _installed(name)
    values = {k[1:]: float(v) for k, v in (params or {}).items() if k.startswith("p") and k[1:].isdigit()}
    tail = max(0.0, min(10.0, float((params or {}).get("tail", 0) or 0)))
    state = (params or {}).get("state")
    automation = (params or {}).get("automation") or {}
    if (state or automation) and fmt not in ("clap", "vst3"):
        raise media.MediaError(f"{plugin['name']}: automation and saved state are kept for CLAP and VST3 plugins only")
    info = media.media_info(media_id)
    rate = int(info.get("sampleRate") or 48000)
    source = media.media_dir() / f"{media_id}.wav"
    with tempfile.TemporaryDirectory(prefix="formwav-plugin-") as tmp:
        out = Path(tmp) / "out.wav"
        saved = Path(tmp) / "out.state"
        try:
            if fmt == "lv2":  # AU-27: fwlv2, controls by port index, the tail as seconds of silence after the clip
                command = [lv2_binary(), "run", path, str(source), str(out), "--tail", f"{tail:g}"] + [f"{k}={v:g}" for k, v in values.items()]
            else:
                command = [host_binary(), "process", fmt, path, str(source), str(out), f"{tail:g}", json.dumps(values)]
                if fmt in ("clap", "vst3"):
                    lines =[f"{max(0, round(float(t) * rate))} {k[1:]} {float(v):g}" for k, pts in automation.items() if k.startswith("p") and k[1:].isdigit() for t, v in pts]
                    auto_file = Path(tmp) / "automation.txt"
                    auto_file.write_text("\n".join(lines))
                    state_file = Path(tmp) / "in.state"
                    if state:
                        state_file.write_bytes(base64.b64decode(state))
                    command += [str(auto_file) if lines else "-", str(state_file) if state else "-", str(saved)]
            done = subprocess.run(command, capture_output=True, timeout=900)
        except subprocess.TimeoutExpired as err:
            raise media.MediaError(f"{plugin['name']} did not finish within 15 minutes") from err
        if done.returncode != 0 or not out.is_file():
            reason = (done.stderr or b"").decode(errors="replace").strip().splitlines()[-1:] or [f"exit status {done.returncode}"]
            if done.returncode < 0:
                reason = [f"the plugin crashed (signal {-done.returncode}); formwav is unaffected"]
            raise media.MediaError(f"{plugin['name']} failed: {reason[0][:300]}")
        stem = str(info.get("name", "clip")).rsplit(".", 1)[0]
        made = media.import_wav(f"{stem} ({plugin['name']}).wav", out.read_bytes())
        if saved.is_file() and saved.stat().st_size:
            made = {**made, "plugin": {"name": name, "state": base64.b64encode(saved.read_bytes()).decode()}}
        return made


# PT-24: ARA plug-ins, hosted through their CLAP binding by formwav-host (fwhost ara-check, ara-store, ara-render)
_ara: dict[str, dict] = {}


def ara_plugins(refresh: bool = False) -> list[dict]:
    """The installed CLAP plug-ins that offer ARA: each one the scan found asked once (fwhost ara-check, kept until a
    refresh), named plugin:clap:<path> as the other plug-ins are, with what it can analyze."""
    found = []
    for p in scan(refresh):
        if p.get("format") != "clap" or "error" in p:
            continue
        path = p["path"]
        if refresh or path not in _ara:
            try:
                done = subprocess.run([host_binary(), "ara-check", path], capture_output=True, timeout=60)
                _ara[path] = json.loads(done.stdout or b"{}") if done.returncode == 0 else {}
            except (media.MediaError, subprocess.TimeoutExpired, ValueError, OSError):
                _ara[path] = {}
        info = _ara[path]
        if info.get("ara") and info.get("factories"):
            f = info["factories"][0]
            found.append({"name": f"plugin:clap:{path}", "label": f.get("name") or p.get("name"), "version": f.get("version"), "manufacturer": f.get("manufacturer"), "analyzable": f.get("analyzable", []), "archiveId": f.get("document_archive_id")})
    return found


def _ara_run(command: list[str], label: str) -> subprocess.CompletedProcess:
    try:
        done = subprocess.run(command, capture_output=True, timeout=900)
    except subprocess.TimeoutExpired as err:
        raise media.MediaError(f"{label} did not finish within 15 minutes") from err
    if done.returncode != 0:
        reason = (done.stderr or b"").decode(errors="replace").strip().splitlines()[-1:] or [f"exit status {done.returncode}"]
        if done.returncode < 0:
            reason = [f"the plug-in crashed (signal {-done.returncode}); formwav is unaffected"]
        raise media.MediaError(f"{label} failed: {reason[0][:300]}")
    return done


def _ara_installed(name: str) -> tuple[str, str]:
    """An ARA plug-in the scan found (plugin:clap:<path>): only those are ever loaded."""
    match = next((a for a in ara_plugins() if a["name"] == name), None)
    if match is None:
        raise media.MediaError(f"no installed ARA plug-in named {name} (rescan with GET /api/ara/plugins?refresh=1)")
    return name.split(":", 2)[2], match["label"]


def ara_analyze(media_id: str, name: str) -> dict:
    """The media analyzed by the ARA plug-in, which then stores its state: the notes it found, and its archive (base64,
    its format's id first) for the session to keep on the clip, so the plug-in's state comes back with the session."""
    path, label = _ara_installed(name)
    media.media_info(media_id)
    source = media.media_dir() / f"{media_id}.wav"
    with tempfile.TemporaryDirectory(prefix="formwav-ara-") as tmp:
        archive = Path(tmp) / "state.archive"
        done = _ara_run([host_binary(), "ara-store", path, str(source), str(archive)], label)
        result = json.loads(done.stdout or b"{}")
        return {"notes": len(result.get("notes", [])), "archiveId": result.get("archive_id", ""), "archive": base64.b64encode(archive.read_bytes()).decode()}


def ara_render(media_id: str, name: str, archive: str | None = None) -> dict:
    """The media rendered by the ARA plug-in as its playback renderer into new media, its state first restored from the
    archive the session keeps (so its edits are what is heard)."""
    path, label = _ara_installed(name)
    info = media.media_info(media_id)
    source = media.media_dir() / f"{media_id}.wav"
    with tempfile.TemporaryDirectory(prefix="formwav-ara-") as tmp:
        out = Path(tmp) / "out.wav"
        command = [host_binary(), "ara-render", path, str(source), str(out)]
        if archive:
            state = Path(tmp) / "state.archive"
            try:
                state.write_bytes(base64.b64decode(archive, validate=True))
            except ValueError as err:
                raise media.MediaError("the clip's ARA archive is not valid base64") from err
            command.append(str(state))
        _ara_run(command, label)
        stem = str(info.get("name", "clip")).rsplit(".", 1)[0]
        return media.import_wav(f"{stem} ({label} ARA).wav", out.read_bytes())
