import struct

import numpy as np
import pytest

from app.services import render

RATE = 48000
DEHUM = {"kind": "dehum", "baseHz": 60, "harmonics": 8, "q": 30}
DECLICK = {"kind": "declick", "sensitivity": 8, "maxMs": 1}
DEREVERB = {"kind": "dereverb", "t60": 0.8, "reductionDb": 6}
VOICE = {"kind": "voice", "strength": 1}
WORKING = {"declick": DECLICK, "dereverb": DEREVERB, "voice": VOICE}
TRANSPARENT = {"declick": {**DECLICK, "sensitivity": 30}, "dereverb": {**DEREVERB, "reductionDb": 0}, "voice": {**VOICE, "strength": 0}}
PHRASES = [(0.35, 2.24), (3.3, 4.38), (5.41, 7.62), (8.19, 10.59)]


def _wav(x: np.ndarray) -> bytes:
    data = x.astype("<f4").tobytes()
    return b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 3, 1, RATE, RATE * 4, 4, 32) + b"data" + struct.pack("<I", len(data)) + data


def _rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x**2)))


def _band(x: np.ndarray, hz: float) -> float:
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x))))
    freqs = np.fft.rfftfreq(len(x), 1 / RATE)
    return float(np.sum(spec[(freqs > hz - 2) & (freqs < hz + 2)] ** 2))


def _lag(y: np.ndarray, ref: np.ndarray, most: int = 2048) -> int:
    n = len(ref)
    xc = np.fft.irfft(np.fft.rfft(y[:n], 2 * n) * np.conj(np.fft.rfft(ref, 2 * n)), 2 * n)
    lags = list(range(-most, most + 1))
    return lags[int(np.argmax([xc[k % (2 * n)] for k in lags]))]


def _sisdr(est: np.ndarray, ref: np.ndarray) -> float:
    a = np.dot(est, ref) / np.dot(ref, ref)
    return float(10 * np.log10(np.sum((a * ref) ** 2) / np.sum((a * ref - est) ** 2)))


def _hum(n: int, under: float) -> np.ndarray:
    t = np.arange(n) / RATE
    hum = sum(np.sin(2 * np.pi * 60 * k * t) / k for k in range(1, 9))
    return hum * under / _rms(hum)


@pytest.fixture(scope="module")
def store(client):
    return lambda x: client.post("/api/media", content=_wav(x), headers={"X-Filename": "restoration.wav"}).json()


def _export(media: dict, fx: list, place: str = "track") -> np.ndarray:
    clip = {"id": "c1", "mediaId": media["id"], "start": 0, "sourceIn": 0, "length": media["frames"], "gainDb": 0}
    track = {"id": "t1", "name": "t", "gainDb": 0, "pan": 0, "mute": False, "solo": False, "clips": [clip]}
    doc = {"version": 1, "sampleRate": RATE, "media": {media["id"]: media}, "markers": [], "tracks": [track]}
    if place == "track":
        track["fx"] = fx
    elif place == "clip":
        clip["fx"] = fx
    elif place == "master":
        doc["masterFx"] = fx
    else:
        doc["buses"] = [{"id": "b1", "name": "b", "gainDb": 0, "pan": 0, "fx": fx if place == "bus" else []}]
        track["busId"] = "b1"
        if place == "track on a bus":
            track["fx"] = fx
    out = render.render(doc)["wav"]
    return np.frombuffer(out[44:], "<f4").reshape(-1, 2)[:, 0].astype(np.float64)


@pytest.fixture(scope="module")
def speech(store, speech_48k):
    x = speech_48k.astype(np.float64)
    return x, store(x)


def test_de_hum_takes_every_harmonic_of_the_hum_down(store, speech):
    hum = store(_hum(len(speech[0]), 0.05))
    before, after = _export(hum, []), _export(hum, [DEHUM])
    cut = [10 * np.log10(_band(after[RATE:], 60 * k) / _band(before[RATE:], 60 * k)) for k in range(1, 9)]
    assert max(cut) < -40, [round(c, 1) for c in cut]


def test_de_hum_leaves_the_speech_alone(speech):
    x, media = speech
    y = _export(media, [DEHUM])
    assert abs(20 * np.log10(_rms(y[RATE:]) / _rms(x[RATE:]))) < 0.5
    a, b = (np.abs(np.fft.rfft(s[RATE : len(x)] * np.hanning(len(x) - RATE))) for s in (x, y))
    freqs = np.fft.rfftfreq(len(x) - RATE, 1 / RATE)
    away = np.all([np.abs(freqs - 60 * k) > 6 for k in range(1, 9)], axis=0) & (a > a.max() * 1e-4)
    assert np.mean(np.abs(20 * np.log10(b[away] / a[away]))) < 0.1


def test_de_click_repairs_clicks_where_they_were(store, speech):
    x = speech[0]
    rng = np.random.default_rng(7)
    sites = sorted(rng.choice(np.arange(RATE // 2, len(x) - RATE // 2), 40, replace=False))
    clicked = x.copy()
    for s in sites:
        clicked[s] += 0.6 * rng.choice([-1, 1])
        clicked[s + 1] -= 0.3
    y = _export(store(clicked), [DECLICK])
    worst = max(np.max(np.abs(y[s - 3 : s + 5] - x[s - 3 : s + 5])) for s in sites)
    assert worst < 0.05, f"the worst repaired click is {worst:.3f} from the clean speech (the clicks were 0.6)"


def test_de_click_leaves_clean_speech_nearly_untouched(speech):
    x, media = speech
    y = _export(media, [DECLICK])[: len(x)]
    assert np.mean(np.abs(y - x) > 1e-6) < 5e-4


def test_de_reverb_takes_a_rooms_tail_down_and_brings_the_speech_closer(store, speech):
    dry = speech[0]
    rng = np.random.default_rng(11)
    t = np.arange(int(1.2 * RATE)) / RATE
    tail = rng.standard_normal(len(t)) * np.exp(-6.9078 * t / 0.8)
    tail[: int(0.005 * RATE)] = 0
    rir = tail / np.sqrt(np.sum(tail**2))
    rir[0] += 1.0
    m = 1 << int(np.ceil(np.log2(len(dry) + len(rir))))
    wet = np.fft.irfft(np.fft.rfft(dry, m) * np.fft.rfft(rir, m), m)[: len(dry)]
    wet *= _rms(dry) / _rms(wet)
    room = store(wet)
    before, after = _export(room, [])[: len(dry)], _export(room, [DEREVERB])[: len(dry)]

    def tail_db(x: np.ndarray) -> float:
        gaps = sum(np.sum(x[int((e + 0.1) * RATE) : int((e + 0.5) * RATE)] ** 2) for _, e in PHRASES[:3]) / (0.4 * RATE * 3)
        said = sum(np.sum(x[int(a * RATE) : int(b * RATE)] ** 2) for a, b in PHRASES) / sum((b - a) * RATE for a, b in PHRASES)
        return float(10 * np.log10(gaps / said))

    assert tail_db(after) < tail_db(before) - 1.5, (tail_db(before), tail_db(after))
    assert _sisdr(after, dry) > _sisdr(before, dry) + 0.8, (_sisdr(before, dry), _sisdr(after, dry))


@pytest.mark.parametrize("place", ["track", "bus"])
@pytest.mark.parametrize("kind", sorted(WORKING))
def test_a_stage_that_delays_its_signal_plays_on_time(speech, kind, place):
    x, media = speech
    dry = _export(media, [], place)
    assert _lag(_export(media, [WORKING[kind]], place), dry) == 0
    assert np.max(np.abs(_export(media, [TRANSPARENT[kind]], place)[: len(x)] - dry[: len(x)])) < (1e-4 if kind == "dereverb" else 1e-6)


@pytest.mark.parametrize(
    ("place", "kind"),
    [("clip", "declick"), ("clip", "dereverb"), ("master", "declick"), ("master", "dereverb"), ("track on a bus", "declick"), ("track on a bus", "dereverb")],
)
@pytest.mark.xfail(strict=True, reason="the core reads a chain's input ahead only on a bus: a clip's chain, the master's and a track's routed to a user bus play late by the stage's latency")
def test_a_stage_that_delays_its_signal_where_nothing_reads_ahead(speech, kind, place):
    _, media = speech
    assert _lag(_export(media, [WORKING[kind]], place), _export(media, [], place)) == 0
