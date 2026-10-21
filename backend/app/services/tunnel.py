"""Guests from anywhere (PLAN_v12 R12): a quick tunnel that gives the recording room an HTTPS link reachable from any
network, so a guest need not share the host's network or a VPN. Browsers open a microphone only in a secure context,
which a plain address on the local network is not, and the tunnel's link is HTTPS.

formwav runs `cloudflared` (Apache-2.0), installed by the person (it is not bundled or downloaded here), as
`cloudflared tunnel --no-autoupdate --url http://127.0.0.1:<guest port>`: an account-free quick tunnel on
trycloudflare.com, meant for testing, with its limits (200 requests in flight, no server-sent events). It points at
the guest listener (routers/remote.py), which admits pairing and the room and nothing else; pairing still takes the
desktop's six-digit, five-minute, one-time code. The link is read from cloudflared's own log, and the tunnel lasts
until it is turned off or the engine stops.
"""

from __future__ import annotations

import atexit
import os
import re
import shutil
import subprocess
import threading
from collections import deque
from pathlib import Path

LINK = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
PLACES = ("/opt/homebrew/bin/cloudflared", "/usr/local/bin/cloudflared", "/usr/bin/cloudflared")
_lock = threading.Lock()
_state: dict = {"process": None, "url": "", "error": "", "log": deque(maxlen=20)}


def binary() -> str:
    """cloudflared, from FORMWAV_CLOUDFLARED, the PATH or the usual install places; empty when it is not installed."""
    given = os.environ.get("FORMWAV_CLOUDFLARED", "")
    if given:
        return given if Path(given).exists() else ""
    return shutil.which("cloudflared") or next((p for p in PLACES if Path(p).exists()), "")


def status() -> dict:
    with _lock:
        proc = _state["process"]
        running = proc is not None and proc.poll() is None
        if proc is not None and not running and not _state["error"]:
            _state["error"] = "the tunnel stopped: " + (" | ".join(list(_state["log"])[-2:]) or f"cloudflared exited {proc.returncode}")
            _state["url"] = ""
        return {"installed": bool(binary()), "running": running, "url": _state["url"] if running else "", "error": _state["error"]}


def _read(proc: subprocess.Popen) -> None:
    for raw in iter(proc.stdout.readline, b""):
        line = raw.decode(errors="replace").strip()
        with _lock:
            _state["log"].append(line[:300])
            found = LINK.search(line)
            if found and not _state["url"] and _state["process"] is proc:
                _state["url"] = found.group(0)


def start(open_guests, port: int) -> dict:
    """Open the guest listener and the tunnel to it, once; the link appears in status() when cloudflared has it."""
    exe = binary()
    if not exe:
        return {**status(), "error": "cloudflared is not installed: install it (on a Mac, brew install cloudflared), then turn this on again"}
    with _lock:
        proc = _state["process"]
        if proc is not None and proc.poll() is None:
            pass
        else:
            open_guests()
            _state.update(url="", error="")
            _state["log"].clear()
            proc = subprocess.Popen([exe, "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{port}"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL)
            _state["process"] = proc
            threading.Thread(target=_read, args=(proc,), name="formwav-tunnel", daemon=True).start()
    return status()


def stop() -> None:
    with _lock:
        proc, _state["process"] = _state["process"], None
        _state.update(url="", error="")
    if proc is not None and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


atexit.register(stop)  # the tunnel ends with the engine
