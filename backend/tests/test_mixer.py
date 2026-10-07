"""PLAN_v13 S2, mixer basics, heard in the export: a time-based effect on a track's sum rings past its clip's end,
polarity and input trim ahead of the track's inserts, solo safe, the pan law for a mono source, automation Off, and a
filter's automation on a track whose chain runs on its own bus."""
import struct

import numpy as np
import pytest

from app.services import render

RATE = 48000


def _wav(x: np.ndarray) -> bytes:
    channels = 1 if x.ndim == 1 else x.shape[1]
    data = x.astype("<f4").tobytes()
    fmt = struct.pack("<IHHIIHH", 16, 3, channels, RATE, RATE * 4 * channels, 4 * channels, 32)
    return b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + fmt + b"data" + struct.pack("<I", len(data)) + data


def _tone(hz: float, seconds: float = 1.0, amp: float = 0.25) -> np.ndarray:
    return amp * np.sin(2 * np.pi * hz * np.arange(int(seconds * RATE)) / RATE)


def _noise(seconds: float = 1.0, amp: float = 0.2, seed: int = 3) -> np.ndarray:
    return amp * np.random.default_rng(seed).standard_normal(int(seconds * RATE))


def _rms_db(x: np.ndarray) -> float:
    return 10 * np.log10(np.mean(x.astype(np.float64) ** 2))


def _band(x: np.ndarray, lo: float, hi: float) -> float:
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    freqs = np.fft.rfftfreq(len(x), 1 / RATE)
    return float(np.sum(spec[(freqs >= lo) & (freqs < hi)]))


@pytest.fixture(scope="module")
def store(client):
    return lambda x: client.post("/api/media", content=_wav(x), headers={"X-Filename": "mixer.wav"}).json()


def _clip(cid: str, ref: dict, start: int = 0, **more) -> dict:
    return {"id": cid, "mediaId": ref["id"], "start": start, "sourceIn": 0, "length": ref["frames"], "gainDb": 0, **more}


def _track(tid: str, clips: list, **more) -> dict:
    return {"id": tid, "name": tid, "gainDb": 0, "pan": 0, "mute": False, "solo": False, "clips": clips, **more}


def _mix(refs: list, tracks: list, **more) -> np.ndarray:
    doc = {"version": 1, "sampleRate": RATE, "media": {r["id"]: r for r in refs}, "markers": [], "tracks": tracks, **more}
    out = render.render(doc)["wav"]
    return np.frombuffer(out[44:], "<f4").reshape(-1, 2).astype(np.float64)


ECHO = {"kind": "echo", "delayMs": 250, "feedback": 0.3, "mix": 0.35}
COMPRESSOR = {"kind": "compressor", "thresholdDb": -30, "ratio": 6, "attackMs": 5, "releaseMs": 80, "makeupDb": 0}
SWEEP = {"kind": "lowpass", "freq": 300, "gainDb": 0, "q": 0.707, "automation": {"freq": [{"time": 0, "value": 300}, {"time": RATE, "value": 12000}]}}
UNITY = {"kind": "processor", "id": "gain", "values": {"gain": 0}}


def test_an_echo_on_a_track_rings_on_past_its_clips_end(store):
    ref = store(_tone(440, 0.5))
    clips = [_clip("c1", ref), _clip("c2", ref, int(1.5 * RATE))]
    dry = _mix([ref], [_track("t1", clips)])[:, 0]
    wet = _mix([ref], [_track("t1", clips, fx=[ECHO])])[:, 0]
    assert np.max(np.abs(dry[RATE // 2 : 3 * RATE // 2])) == 0
    # after the clip, its repeats 250 ms apart, each 0.3 of the one before (10.5 dB down)
    quarters = [_rms_db(wet[RATE // 2 + k * RATE // 4 : RATE // 2 + (k + 1) * RATE // 4]) for k in range(3)]
    assert quarters[0] > -30
    assert all(8 < a - b < 13 for a, b in zip(quarters, quarters[1:])), quarters


def test_a_track_placed_in_5_1_keeps_its_place_with_an_echo(store):
    from app.services import surround

    ref = store(_tone(440, 0.5))

    def six(fx: list) -> np.ndarray:
        doc = {"version": 1, "sampleRate": RATE, "media": {ref["id"]: ref}, "markers": [], "tracks": [_track("t1", [_clip("c1", ref)], fx=fx, surround={"x": 0, "y": 1})]}
        return surround._bus(doc, 0)[0]

    wet, dry = six([ECHO]), six([])
    # the echo stays in the clip's chain, at the track's place (C); on a bus of its own it would play on L and R
    assert _rms_db(wet[:, 2]) > -20 and not np.allclose(wet[:, 2], dry[:, 2], atol=1e-4)
    assert np.max(np.abs(wet[:, [0, 1, 3, 4, 5]])) < 1e-9


def test_a_track_with_its_polarity_inverted_nulls_its_duplicate_before_and_through_its_inserts(store):
    ref = store(_noise())
    for fx in ([], [COMPRESSOR, ECHO]):
        plain = _mix([ref], [_track("t1", [_clip("c1", ref)], fx=fx)])
        both = _mix([ref], [_track("t1", [_clip("c1", ref)], fx=fx), _track("t2", [_clip("c2", ref)], fx=fx, invert=True)])
        assert _rms_db(plain) > -40
        assert np.max(np.abs(both)) < 1e-6, fx


def test_input_trim_raises_a_track_by_its_decibels_ahead_of_its_inserts(store):
    ref = store(_tone(220, amp=0.125))
    plain = _mix([ref], [_track("t1", [_clip("c1", ref)])])
    trimmed = _mix([ref], [_track("t1", [_clip("c1", ref)], trimDb=6)])
    assert _rms_db(trimmed) - _rms_db(plain) == pytest.approx(6.0, abs=0.005)
    # ahead of a limiter at -18 dBFS: the tone, trimmed to a -12 dBFS peak, meets the ceiling (after it, -12 would pass)
    limited = _mix([ref], [_track("t1", [_clip("c1", ref)], trimDb=6, fx=[{"kind": "limiter", "ceilingDb": -18, "releaseMs": 50}])])
    settled = np.max(np.abs(limited[RATE // 5 :, 0]))
    assert 20 * np.log10(settled) == pytest.approx(-18.0, abs=0.05)


def test_a_solo_safe_track_plays_through_another_tracks_solo(store):
    a, b, c = store(_tone(300)), store(_tone(700)), store(_tone(1100))
    tracks = [_track("t1", [_clip("c1", a)], solo=True), _track("t2", [_clip("c2", b)], soloSafe=True), _track("t3", [_clip("c3", c)])]
    mix = _mix([a, b, c], tracks)[:, 0]
    total = _band(mix, 20, 20000)
    assert _band(mix, 250, 350) > 0.45 * total and _band(mix, 650, 750) > 0.45 * total
    assert _band(mix, 1050, 1150) < 1e-9 * total


@pytest.mark.parametrize("law,db", [(None, 0.0), ("-3", -3.0103), ("-4.5", -4.5154), ("-6", -6.0206)])
def test_the_pan_law_sets_a_centred_mono_tracks_level_in_each_side_and_leaves_stereo_alone(store, law, db):
    mono = _tone(500)
    ref = store(mono)
    stereo = store(np.stack([mono, mono], axis=1))
    more = {"panLaw": law} if law else {}
    out = _mix([ref], [_track("t1", [_clip("c1", ref)])], **more)
    for side in (0, 1):
        assert _rms_db(out[:, side]) - _rms_db(mono) == pytest.approx(db, abs=0.01)
    assert np.allclose(_mix([stereo], [_track("t1", [_clip("c1", stereo)])], **more)[:, 0], mono, atol=1e-6)


def test_automation_off_plays_the_fader_as_set_and_keeps_the_lanes(store):
    ref = store(_tone(330))
    ramp = {"volume": [{"time": 0, "value": -40}, {"time": RATE, "value": 0}]}
    read = _mix([ref], [_track("t1", [_clip("c1", ref)], gainDb=-6, automation=ramp)])[:, 0]
    off = _mix([ref], [_track("t1", [_clip("c1", ref)], gainDb=-6, automation=ramp, autoOff=True)])[:, 0]
    first, last = slice(0, RATE // 4), slice(3 * RATE // 4, RATE)
    assert _rms_db(read[last]) - _rms_db(read[first]) > 12
    assert _rms_db(off[first]) == pytest.approx(_rms_db(off[last]), abs=0.01)
    assert _rms_db(off) - _rms_db(_tone(330)) == pytest.approx(-6.0, abs=0.01)


def test_a_filters_automation_sweeps_it_on_a_track_whose_chain_runs_on_its_own_bus(store):
    ref = store(_noise())
    first, last = slice(0, RATE // 5), slice(4 * RATE // 5, RATE)

    def opening(fx: list, **more) -> tuple[float, np.ndarray]:
        y = _mix([ref], [_track("t1", [_clip("c1", ref)], fx=fx, **more)])[:, 0]
        return 10 * np.log10(_band(y[last], 4000, 20000) / _band(y[first], 4000, 20000)), y

    on_bus, y_bus = opening([SWEEP, UNITY])
    on_clip, y_clip = opening([SWEEP])
    assert on_bus > 18
    # the same sweep as on the clip's chain, on the same 32-sample grid
    assert on_clip == pytest.approx(on_bus) and np.max(np.abs(y_bus - y_clip)) < 1e-6
    held, _ = opening([SWEEP, UNITY], autoOff=True)
    assert abs(held) < 1
