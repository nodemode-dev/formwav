import os
import struct
import subprocess
from pathlib import Path

import numpy as np
import pytest

from app.services import adm
from conftest import BACKEND

RATE = 48000
SPEAKERS = ["M+030", "M-030", "M+000", "LFE1", "M+110", "M-110"]
EAR = Path(os.environ.get("FORMWAV_EAR_BIN", BACKEND / "tests" / ".venv-ear" / ("Scripts" if os.name == "nt" else "bin"))) / ("ear-render.exe" if os.name == "nt" else "ear-render")


def _tone(hz: float, seconds: float) -> np.ndarray:
    return 0.3 * np.sin(2 * np.pi * hz * np.arange(int(seconds * RATE)) / RATE)


def _read(raw: bytes) -> np.ndarray:
    pos, channels, bits, fmt = 12, 0, 0, 0
    while pos + 8 <= len(raw):
        tag, size = raw[pos : pos + 4], struct.unpack_from("<I", raw, pos + 4)[0]
        if tag == b"fmt ":
            fmt, channels, _, _, _, bits = struct.unpack_from("<HHIIHH", raw, pos + 8)
        elif tag == b"data":
            data = raw[pos + 8 : pos + 8 + size]
            if fmt == 1 and bits == 24:
                b = np.frombuffer(data, np.uint8).reshape(-1, 3).astype(np.int32)
                ints = (b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)) << 8 >> 8
                return (ints / 8388608.0).reshape(-1, channels)
            if fmt == 3 and bits == 32:
                return np.frombuffer(data, "<f4").reshape(-1, channels).astype(np.float64)
            raise AssertionError(f"an output format this reader does not take: tag {fmt}, {bits} bits")
        pos += 8 + size + (size % 2)
    raise AssertionError("no data chunk")


def _render(tmp_path: Path, bwf: bytes) -> np.ndarray:
    if not EAR.exists():
        pytest.skip("needs the EBU ADM Renderer in backend/tests/.venv-ear (pip install -r backend/tests/requirements_ear.txt into a Python 3.12 venv there)")
    source, out = tmp_path / "adm.wav", tmp_path / "rendered.wav"
    source.write_bytes(bwf)
    subprocess.run([str(EAR), "-s", "0+5+0", str(source), str(out)], check=True, capture_output=True)
    return _read(out.read_bytes())


def _shares(y: np.ndarray, hz: float, start: float = 0.0, end: float | None = None) -> dict:
    part = y[int(start * RATE) : int(end * RATE) if end else len(y)]
    freqs = np.fft.rfftfreq(len(part), 1 / RATE)
    band = (freqs > hz - 5) & (freqs < hz + 5)
    energy = [float(np.sum(np.abs(np.fft.rfft(part[:, ch] * np.hanning(len(part))))[band] ** 2)) for ch in range(part.shape[1])]
    total = sum(energy) or 1.0
    return {name: 100 * e / total for name, e in zip(SPEAKERS, energy)}


def test_objects_that_stand_still_play_from_their_speakers(tmp_path):
    objects = [{"name": "left", "samples": _tone(300, 2), "azimuth": 30.0}, {"name": "right", "samples": _tone(500, 2), "azimuth": -30.0}, {"name": "centre", "samples": _tone(700, 2), "azimuth": 0.0}]
    y = _render(tmp_path, adm.write_bwf(objects, RATE))
    for hz, speaker in ((300, "M+030"), (500, "M-030"), (700, "M+000")):
        assert _shares(y, hz)[speaker] > 99, (hz, _shares(y, hz))


def test_a_moving_object_glides_from_its_first_point_to_its_last(tmp_path):
    moving = {"name": "moving", "samples": _tone(500, 3), "azimuth": 30.0, "path": [(0.0, 30.0, 0.0), (2.0, -30.0, 0.0)]}
    y = _render(tmp_path, adm.write_bwf([moving], RATE))
    start, middle, end = _shares(y, 500, 0.0, 0.3), _shares(y, 500, 0.85, 1.15), _shares(y, 500, 2.2, 3.0)
    assert start["M+030"] > 95, start
    assert 40 < middle["M+030"] < 60 and 40 < middle["M-030"] < 60, middle
    assert end["M-030"] > 99, end


def test_a_bed_plays_from_its_own_channels(tmp_path):
    bed = [np.zeros(3 * RATE) for _ in range(6)]
    bed[2], bed[4] = _tone(700, 3), _tone(900, 3)
    y = _render(tmp_path, adm.write_bwf([], RATE, bed))
    assert _shares(y, 700)["M+000"] > 99 and _shares(y, 900)["M+110"] > 99


def test_the_session_export_route_writes_moving_objects_and_a_bed(client, tmp_path):
    tone = client.post("/api/generate", params={"kind": "tone", "seconds": 3, "freq": 500}).json()
    bed = client.post("/api/generate", params={"kind": "tone", "seconds": 3, "freq": 700}).json()
    clip = lambda cid, media: {"id": cid, "mediaId": media["id"], "start": 0, "sourceIn": 0, "length": 144000, "gainDb": 0}
    document = {"version": 1, "sampleRate": RATE, "media": {tone["id"]: tone, bed["id"]: bed}, "markers": [], "tracks": [
        {"id": "t1", "name": "moving", "gainDb": 0, "pan": 0, "mute": False, "solo": False, "clips": [clip("c1", tone)],
         "surround": {"x": -0.5, "y": 0.866, "path": [{"at": 0, "x": -0.5, "y": 0.866}, {"at": 96000, "x": 0.5, "y": 0.866}]}},
        {"id": "t2", "name": "bed", "gainDb": 0, "pan": 0, "mute": False, "solo": False, "clips": [clip("c2", bed)], "surround": {"x": 0, "y": 1, "bed": True}}]}
    reply = client.post("/api/render", params={"what": "adm"}, json=document)
    assert reply.status_code == 200, reply.text[:200]
    y = _render(tmp_path, reply.content)
    assert _shares(y, 500, 0.0, 0.3)["M+030"] > 95 and _shares(y, 500, 2.2, 2.9)["M-030"] > 99
    assert _shares(y, 700)["M+000"] > 99
