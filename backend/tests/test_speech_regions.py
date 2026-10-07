import struct

import numpy as np
import pytest

from conftest import BACKEND, model

RATE = 48000
CHORDS = [(220, 277.2, 329.6), (196, 246.9, 293.7), (174.6, 220, 261.6), (196, 246.9, 293.7)]


def _wav(x: np.ndarray) -> bytes:
    data = x.astype("<f4").tobytes()
    return b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 3, 1, RATE, RATE * 4, 4, 32) + b"data" + struct.pack("<I", len(data)) + data


def _music_bed(n: int, level: float) -> np.ndarray:
    t = np.arange(n) / RATE
    bed = np.zeros(n)
    for k in range((n + RATE - 1) // RATE):
        a, b = k * RATE, min(n, (k + 1) * RATE)
        bed[a:b] = sum(np.sin(2 * np.pi * f * t[a:b]) for f in CHORDS[k % 4]) / 3 * (0.6 + 0.4 * np.exp(-3 * (t[a:b] - t[a])))
    return bed * level / np.sqrt(np.mean(bed**2))


def _overlap(x, y) -> float:
    return sum(max(0.0, min(r["end"], s["end"]) - max(r["start"], s["start"])) for r in x for s in y)


@pytest.fixture(scope="module")
def regions(client, speech_48k):
    model(BACKEND / "models" / "vad" / "silero_vad.onnx", "Mark where people speak downloads it on first use")
    speech = speech_48k.astype(np.float64)
    bed = _music_bed(len(speech), np.sqrt(np.mean(speech**2)) * 10 ** (-6 / 20))
    ids = {name: client.post("/api/media", content=_wav(x), headers={"X-Filename": f"{name}.wav"}).json()["id"] for name, x in (("speech", speech), ("under music", speech + bed), ("music", bed))}
    return ids, {name: client.get(f"/api/media/{mid}/speech").json()["regions"] for name, mid in ids.items()}


def test_speech_is_found_in_stretches_with_pauses_between(regions):
    _, found = regions
    assert len(found["speech"]) >= 2 and sum(r["end"] - r["start"] for r in found["speech"]) > 5


def test_speech_under_music_six_db_below_it_is_still_found(regions):
    _, found = regions
    agree = _overlap(found["speech"], found["under music"]) / sum(r["end"] - r["start"] for r in found["speech"])
    assert agree > 0.9, f"{agree:.1%} of the clean speech's time"


def test_music_alone_is_not_taken_for_speech(regions):
    _, found = regions
    assert found["music"] == []


def test_a_cut_inside_a_word_is_unsafe_and_one_in_a_pause_is_safe(client, regions):
    ids, found = regions
    first, second = found["speech"][0], found["speech"][1]
    inside = client.get(f"/api/media/{ids['speech']}/speech/cut", params={"at": (first["start"] + first["end"]) / 2}).json()
    pause = client.get(f"/api/media/{ids['speech']}/speech/cut", params={"at": (first["end"] + second["start"]) / 2}).json()
    assert inside["safe"] is False and pause["safe"] is True
