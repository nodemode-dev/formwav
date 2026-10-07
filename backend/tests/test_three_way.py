import os
import platform
import struct
import subprocess
from pathlib import Path

import numpy as np
import pytest

from app.services import deepfilter, library, media, tiger_dnr
from conftest import BACKEND, FIXTURES

RATE = 48000
PARTS = ("speech", "music", "ambience")


def _wav(x: np.ndarray) -> bytes:
    ch = x.shape[1]
    data = x.astype("<f4").tobytes()
    return b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 3, ch, RATE, RATE * 4 * ch, 4 * ch, 32) + b"data" + struct.pack("<I", len(data)) + data


def _rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x**2)))


def _sisdr(est: np.ndarray, ref: np.ndarray) -> float:
    est, ref = est.ravel(), ref.ravel()
    a = np.dot(est, ref) / np.dot(ref, ref)
    return float(10 * np.log10(np.sum((a * ref) ** 2) / np.sum((a * ref - est) ** 2)))


def _music(n: int, rng: np.random.Generator) -> np.ndarray:
    t = np.arange(n) / RATE
    chords = [(220, 277.18, 329.63), (196, 246.94, 293.66), (174.61, 220, 261.63), (196, 246.94, 293.66)]
    music = np.zeros((n, 2))
    for k in range(n // (2 * RATE) + 1):
        a, b = k * 2 * RATE, min(n, (k + 1) * 2 * RATE)
        tt = t[a:b]
        tone = sum(np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(4 * np.pi * f * tt) for f in chords[k % 4]) / 3
        bass = 0.6 * np.sin(2 * np.pi * chords[k % 4][0] / 4 * tt)
        music[a:b, 0] += tone * 0.9 + bass
        music[a:b, 1] += tone * 1.1 + bass
    for beat in np.arange(0, n / RATE, 0.5):
        s = int(beat * RATE)
        e = min(n, s + int(0.12 * RATE))
        tt = np.arange(e - s) / RATE
        music[s:e] += (np.sin(2 * np.pi * 55 * tt) * np.exp(-tt * 30) * 1.5)[:, None]
        h0 = s + int(0.25 * RATE)
        h1 = min(n, h0 + int(0.03 * RATE))
        hat = np.diff(rng.standard_normal(h1 - h0) * np.exp(-np.arange(h1 - h0) / RATE * 150) * 0.4, prepend=0.0)
        music[h0:h1, 0] += hat
        music[h0:h1, 1] += hat
    return music


def _pink(n: int, rng: np.random.Generator) -> np.ndarray:
    w = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / RATE)
    w[1:] /= np.sqrt(f[1:])
    w[0] = 0
    return np.fft.irfft(w, n)


def _deepfilter() -> None:
    given = os.environ.get("FORMWAV_DEEPFILTER")
    asset = deepfilter._ASSETS.get((platform.system(), platform.machine()))
    root = Path(os.environ.get("FORMWAV_MODELS_ROOT", BACKEND / "models"))
    if not (given and Path(given).is_file()) and not (asset and (root / "deepfilter" / f"deep-filter-{deepfilter.VERSION}-{asset[0]}").is_file()):
        pytest.skip("needs DeepFilterNet in backend/models/deepfilter (Separate speech, music and effects fetches it on first use)")


def _synthetic(speech_48k: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """JFK's speech, synthetic music (chords, bass, kick and hat) 8 dB under it, decorrelated pink noise 14 dB under it."""
    rng = np.random.default_rng(3)
    speech = np.stack([speech_48k, speech_48k], axis=1).astype(np.float64)
    n = len(speech)
    music = _music(n, rng)
    ambience = np.stack([_pink(n, rng), _pink(n, rng)], axis=1) * (1 + 0.3 * np.sin(2 * np.pi * 0.2 * np.arange(n) / RATE))[:, None]
    music *= _rms(speech) / _rms(music) * 10 ** (-8 / 20)
    ambience *= _rms(speech) / _rms(ambience) * 10 ** (-14 / 20)
    return speech, music, ambience


def _recorded(speech_48k: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """JFK's speech, recorded music (fixtures/music_elevator.flac) 8 dB under it, and effects 6 dB under it: the stock
    library's impact, whoosh and riser placed across the stereo field over its air-conditioning room tone."""
    speech = np.stack([speech_48k, speech_48k], axis=1).astype(np.float64)
    n = len(speech)
    done = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-i", str(FIXTURES / "music_elevator.flac"), "-ar", str(RATE), "-ac", "1", "-f", "f32le", "-"], capture_output=True, check=True)
    tune = np.frombuffer(done.stdout, np.float32).astype(np.float64)[:n]
    music = np.stack([tune, tune], axis=1)
    effects = np.zeros((n, 2))
    for item, at, pan in (("impact", 1.0, (1.0, 0.6)), ("whoosh", 4.0, (0.6, 1.0)), ("riser", 6.5, (0.9, 0.9))):
        y = library.render(item, RATE)
        s = int(at * RATE)
        e = min(n, s + len(y))
        effects[s:e] += np.outer(y[: e - s], pan)
    air = np.tile(library.render("room-air", RATE), n // (30 * RATE) + 1)[:n]
    effects += np.stack([air, np.roll(air, 4800)], axis=1)
    music *= _rms(speech) / _rms(music) * 10 ** (-8 / 20)
    effects *= _rms(speech) / _rms(effects) * 10 ** (-6 / 20)
    return speech, music, effects


def _split(client, parts: tuple[np.ndarray, np.ndarray, np.ndarray]) -> tuple[np.ndarray, dict, dict, dict]:
    speech, music, third = parts
    mix = speech + music + third
    n = len(mix)
    source = client.post("/api/media", content=_wav(mix.astype(np.float32)), headers={"X-Filename": "three.wav"}).json()
    reply = client.post(f"/api/media/{source['id']}/three-way", json={})
    assert reply.status_code == 201, reply.text[:300]
    out = reply.json()
    stems = {}
    for part in PARTS:
        raw = (media.media_dir() / f"{out[part]['id']}.wav").read_bytes()
        stems[part] = np.frombuffer(raw[raw.index(b"data") + 8 :], "<f4").astype(np.float64).reshape(-1, 2)[:n]
    return mix.astype(np.float32).astype(np.float64), {"speech": speech, "music": music, "ambience": third}, stems, out


@pytest.fixture(scope="module")
def split(client, speech_48k):
    """The rule (harmonic-percussive music), as where the trained separator is not installed."""
    _deepfilter()
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(tiger_dnr, "installed", lambda: False)
        return _split(client, _synthetic(speech_48k))


@pytest.fixture(scope="module")
def trained(client, speech_48k):
    """TIGER-DnR's music (PLAN_v12 R1), on the synthetic mix and on the mix of recordings."""
    _deepfilter()
    if not tiger_dnr.installed():
        pytest.skip("needs the trained separator: Sounds > Models, Install a model on this machine (TIGER)")
    return {"synthetic": _split(client, _synthetic(speech_48k)), "recorded": _split(client, _recorded(speech_48k))}


def test_the_three_stems_add_up_to_the_clip(split):
    mix, _, stems, out = split
    assert np.max(np.abs(sum(stems.values()) - mix)) < 1e-6
    assert out["method"] == "rule"


@pytest.mark.parametrize(("part", "gain"), [("speech", 3.0), ("music", 6.0), ("ambience", 8.0)])
def test_each_stem_is_nearer_its_own_part_than_the_mix_was(split, part, gain):
    mix, truth, stems, _ = split
    assert _sisdr(stems[part], truth[part]) - _sisdr(mix, truth[part]) > gain


def test_the_trained_split_adds_up_and_names_its_third_part_effects(trained):
    for mix, _, stems, out in trained.values():
        assert np.max(np.abs(sum(stems.values()) - mix)) < 1e-6
        assert out["method"] == "trained"
        assert media.media_info(out["ambience"]["id"])["name"] == "three - effects.wav"


@pytest.mark.parametrize(("mix", "part", "gain"), [("recorded", "speech", 5.0), ("recorded", "music", 12.0), ("recorded", "ambience", 6.0), ("synthetic", "music", 10.0), ("synthetic", "ambience", 6.0)])
def test_the_trained_split_brings_each_part_nearer_its_own(trained, mix, part, gain):
    mixed, truth, stems, _ = trained[mix]
    assert _sisdr(stems[part], truth[part]) - _sisdr(mixed, truth[part]) > gain
