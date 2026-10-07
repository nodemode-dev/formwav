import struct

import numpy as np
import pytest

RATE = 48000
TRUTH = {"late 2.317 ms": 0.002317, "early 37.5 ms": -0.0375, "late 450 ms": 0.450}


def _wav(x: np.ndarray) -> bytes:
    data = x.astype("<f4").tobytes()
    return b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 3, 1, RATE, RATE * 4, 4, 32) + b"data" + struct.pack("<I", len(data)) + data


def _delayed(x: np.ndarray, seconds: float) -> np.ndarray:
    n = len(x) + RATE
    spectrum = np.fft.rfft(np.concatenate([x, np.zeros(RATE)]))
    freqs = np.fft.rfftfreq(n, 1 / RATE)
    return np.fft.irfft(spectrum * np.exp(-2j * np.pi * freqs * seconds), n)[: len(x)]


@pytest.fixture(scope="module")
def lags(client, speech_48k):
    rng = np.random.default_rng(7)
    ref = speech_48k.astype(np.float64)
    kernel = np.hanning(33)
    kernel /= kernel.sum()

    def colour(x):
        return 0.5 * np.convolve(x, kernel, mode="same") + 0.003 * rng.standard_normal(len(x))

    def put(name, x):
        return client.post("/api/media", content=_wav(x), headers={"X-Filename": name}).json()["id"]

    reference = put("ref.wav", ref)
    others = [put(f"{name}.wav", colour(_delayed(ref, delay))) for name, delay in TRUTH.items()]
    others.append(put("noise.wav", 0.05 * rng.standard_normal(len(ref))))
    reply = client.post("/api/media/sync", json={"reference": {"media": reference}, "others": [{"media": m} for m in others], "seconds": 11})
    assert reply.status_code == 200, reply.text
    return reply.json()["lags"]


@pytest.mark.parametrize("name", list(TRUTH))
def test_a_known_delay_is_found_to_a_quarter_of_a_sample(lags, name):
    found = lags[list(TRUTH).index(name)]
    assert found["aligned"], found
    assert abs((found["lag"] - TRUTH[name]) * RATE) < 0.25, f"{name}: found {found['lag'] * 1000:.4f} ms"


def test_unrelated_noise_is_not_aligned(lags):
    assert not lags[-1]["aligned"], lags[-1]
