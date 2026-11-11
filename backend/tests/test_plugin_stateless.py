"""A CLAP plug-in without the state extension still renders through the engine: the engine always asks fwhost for the
state after a CLAP or VST3 render, and fwhost answered "the plugin keeps no state" for a plug-in that keeps none, so
every such plug-in failed. The host and the clap-gain fixture (no state extension, half level) are built with cargo."""
import json
import os
import shutil
import struct
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from app.services import plugins

HOST = Path(__file__).resolve().parents[2] / "native" / "formwav-host"
RATE = 48000


def _library(release: Path) -> Path:
    if sys.platform == "darwin":
        return release / "libclap_gain.dylib"
    if os.name == "nt":
        return release / "clap_gain.dll"
    return release / "libclap_gain.so"


@pytest.fixture(scope="module")
def built(tmp_path_factory) -> tuple[Path, Path]:
    if shutil.which("cargo") is None:
        pytest.skip("needs cargo to build fwhost and the clap-gain fixture")
    done = subprocess.run(["cargo", "build", "--locked", "--release", "-p", "fwhost", "-p", "clap-gain"], cwd=HOST, capture_output=True, timeout=1200)
    assert done.returncode == 0, done.stderr.decode(errors="replace")[-2000:]
    release = HOST / "target" / "release"
    folder = tmp_path_factory.mktemp("clap")
    shutil.copy(_library(release), folder / "gain.clap")
    return release / ("fwhost.exe" if os.name == "nt" else "fwhost"), folder


def _wav(x: np.ndarray) -> bytes:
    data = x.astype("<f4").tobytes()
    fmt = struct.pack("<IHHIIHH", 16, 3, 1, RATE, RATE * 4, 4, 32)
    return b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + fmt + b"data" + struct.pack("<I", len(data)) + data


def test_a_clap_plugin_without_state_renders_through_the_engine(client, built, monkeypatch):
    host, folder = built
    monkeypatch.setenv("FORMWAV_HOST_BIN", str(host))
    monkeypatch.setenv("FORMWAV_PLUGIN_PATH", str(folder))
    monkeypatch.setattr(plugins, "_scanned", None)
    path = str(folder / "gain.clap")
    name = f"plugin:clap:{path}"
    assert any(p.get("format") == "clap" and p.get("path") == path and "error" not in p for p in plugins.scan(refresh=True))
    x = (0.5 * np.sin(2 * np.pi * 440 * np.arange(RATE // 2) / RATE)).astype(np.float32)
    src = client.post("/api/media", content=_wav(x), headers={"X-Filename": "tone.wav"}).json()
    out = client.post(f"/api/media/{src['id']}/effect", params={"name": name, "params": json.dumps({})})
    assert out.status_code in (200, 201), out.text
    assert "plugin" not in out.json()
    from app.services.tools import _wav_view

    view, _ = _wav_view(out.json()["id"])
    y = np.asarray(view, dtype=np.float64)
    assert abs(float(np.max(np.abs(y))) - 0.25) < 1e-3
