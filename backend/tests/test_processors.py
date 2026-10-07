"""PLAN_v13 S1: formwav's studio processors (native/formwav-studio) in the core, heard in the export where a track,
a bus or the master carries it, each judged by a measurement of what it is for; and its table held equal between the
core and the interface."""
import json
import re
import struct

import numpy as np
import pytest

from app.services import media, render
from conftest import ROOT

RATE = 48000
TABLE = ROOT / "frontend" / "src" / "engine" / "processors.ts"
FX_RS = ROOT / "native" / "formwav-dsp" / "src" / "fx.rs"


def _wav(x: np.ndarray) -> bytes:
    data = x.astype("<f4").tobytes()
    return b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 3, 1, RATE, RATE * 4, 4, 32) + b"data" + struct.pack("<I", len(data)) + data


def _tone(hz: float, seconds: float = 1.0, amp: float = 0.5) -> np.ndarray:
    return amp * np.sin(2 * np.pi * hz * np.arange(int(seconds * RATE)) / RATE)


def _band(x: np.ndarray, hz: float, width: float = 20) -> float:
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    freqs = np.fft.rfftfreq(len(x), 1 / RATE)
    return float(np.sum(spec[(freqs > hz - width) & (freqs < hz + width)]))


def _peak_hz(x: np.ndarray) -> float:
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    freqs = np.fft.rfftfreq(len(x), 1 / RATE)
    spec[freqs < 30] = 0
    return float(freqs[int(np.argmax(spec))])


def _lag(y: np.ndarray, ref: np.ndarray, most: int = 400) -> int:
    n = len(ref)
    xc = np.fft.irfft(np.fft.rfft(y[:n], 2 * n) * np.conj(np.fft.rfft(ref, 2 * n)), 2 * n)
    lags = list(range(-most, most + 1))
    return lags[int(np.argmax([xc[k % (2 * n)] for k in lags]))]


def _proc(pid: str, bypass: bool = False, **values) -> dict:
    return {"kind": "processor", "id": pid, "values": values, **({"bypass": True} if bypass else {})}


@pytest.fixture(scope="module")
def store(client):
    return lambda x: client.post("/api/media", content=_wav(x), headers={"X-Filename": "processors.wav"}).json()


def _export(ref: dict, fx: list, place: str = "track", clip_fx: list | None = None) -> np.ndarray:
    clip = {"id": "c1", "mediaId": ref["id"], "start": 0, "sourceIn": 0, "length": ref["frames"], "gainDb": 0, **({"fx": clip_fx} if clip_fx else {})}
    track = {"id": "t1", "name": "t", "gainDb": 0, "pan": 0, "mute": False, "solo": False, "clips": [clip]}
    doc = {"version": 1, "sampleRate": RATE, "media": {ref["id"]: ref}, "markers": [], "tracks": [track]}
    if place == "track":
        track["fx"] = fx
    elif place == "master":
        doc["masterFx"] = fx
    else:
        doc["buses"] = [{"id": "b1", "name": "b", "gainDb": 0, "pan": 0, "fx": fx}]
        track["busId"] = "b1"
    out = render.render(doc)["wav"]
    return np.frombuffer(out[44:], "<f4").reshape(-1, 2)[:, 0].astype(np.float64)


def test_the_interface_lists_the_processors_the_core_has():
    text = TABLE.read_text(encoding="utf-8")
    start = text.index("ProcessorInfo[] = [") + len("ProcessorInfo[] = ")
    body = re.sub(r",\s*\]$", "]", text[start : text.index("\n];", start) + 2].strip())
    assert json.loads(body) == json.loads(media._require_core().processors())
    assert len(json.loads(body)) == 24


def test_a_processor_has_one_code_in_the_export_and_the_core():
    core = int(re.search(r"^pub const PROCESSOR: u8 = (\d+);", FX_RS.read_text(encoding="utf-8"), re.M).group(1))
    assert render.FX_KINDS["processor"] == core == 20
    assert render._stage(_proc("gain", gain=-6)) == (20, "gain;gain=-6", 0.0, 0.0, 0.0, 0.0)
    assert render._stage(_proc("gain", bypass=True, gain=-6)) is None


@pytest.mark.parametrize("place", ["track", "bus", "master"])
def test_the_maximizer_drives_a_tone_into_its_ceiling(store, place):
    x = _tone(220, amp=0.7)
    ref = store(x)
    y = _export(ref, [_proc("maximizer", threshold=-12, ceiling=-1, release=50)], place)
    settled = y[RATE // 10 :]
    assert np.max(np.abs(y)) <= 10 ** (-1 / 20) * 1.001
    assert np.sqrt(np.mean(settled**2)) > 1.15 * np.sqrt(np.mean(x[RATE // 10 :] ** 2))


def test_a_notch_takes_out_its_own_frequency_only(store):
    x = _tone(1000, amp=0.3) + _tone(300, amp=0.3)
    ref = store(x)
    y = _export(ref, [_proc("band_eq", type=3, freq=1000, q=5)])
    s = slice(RATE // 4, RATE)
    assert 10 * np.log10(_band(y[s], 1000) / _band(x[s], 1000)) < -30
    assert abs(10 * np.log10(_band(y[s], 300) / _band(x[s], 300))) < 1


def test_the_pitch_shifter_moves_a_tone_up_an_octave(store):
    ref = store(_tone(440))
    y = _export(ref, [_proc("pitch", semitones=12)])
    assert abs(_peak_hz(y[RATE // 5 :]) - 880) < 6


def test_the_rectifier_folds_a_tone_to_twice_its_frequency(store):
    ref = store(_tone(100))
    y = _export(ref, [_proc("rectify", mode=0)], "bus")
    assert abs(_peak_hz(y[RATE // 5 :]) - 200) < 3


def test_the_de_esser_takes_down_sibilance_and_leaves_the_voice(store):
    n = RATE
    bursts = np.where((np.arange(n) // 4800) % 2 == 0, 1.0, 0.0)
    x = _tone(300, amp=0.3) + _tone(7000, amp=0.3) * bursts
    ref = store(x)
    y = _export(ref, [_proc("de_esser", freq=6000, depth=20, threshold=-40)])
    s = slice(RATE // 4, RATE)
    assert 10 * np.log10(_band(y[s], 7000) / _band(x[s], 7000)) < -6
    assert abs(10 * np.log10(_band(y[s], 300) / _band(x[s], 300))) < 1


def test_a_bypassed_processor_and_one_given_to_a_clip_leave_the_export_as_it_was(store):
    ref = store(_tone(220, amp=0.4))
    plain = _export(ref, [])
    assert np.array_equal(_export(ref, [_proc("maximizer", bypass=True, threshold=-20)]), plain)
    # a processor runs on a track's sum, a bus or the master; the interface drops one given to a clip, as does the export
    assert np.array_equal(_export(ref, [], clip_fx=[_proc("gain", gain=-12)]), plain)


def test_a_delaying_processor_is_on_time_on_a_track_and_late_by_its_latency_on_the_master(store):
    rng = np.random.default_rng(7)
    x = 0.3 * rng.standard_normal(RATE // 2)
    ref = store(x)
    lookahead = [_proc("compressor", threshold=0, ratio=1, lookahead=5, knee=0)]
    assert _lag(_export(ref, lookahead, "track"), x) == 0
    assert _lag(_export(ref, lookahead, "bus"), x) == 0
    # the master chain is not read ahead yet (PLAN_v13 S17): 5 ms of lookahead plays 240 samples late there
    assert _lag(_export(ref, lookahead, "master"), x) == 240
