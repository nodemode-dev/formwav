"""PLAN_v14 W3, the enhancers under control: Amount mixes the original back under Enhance speech and the dialogue
isolate, and Keep laughter and breaths lets the original through where the processing took a sound down. The mixing
is judged on made signals with known parts; the effects themselves through the engine as the interface calls them."""
import struct

import numpy as np

from app.services import effects

RATE = 48000


def _wav(x: np.ndarray) -> bytes:
    data = x.astype("<f4").tobytes()
    fmt = struct.pack("<IHHIIHH", 16, 3, 1, RATE, RATE * 4, 4, 32)
    return b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + fmt + b"data" + struct.pack("<I", len(data)) + data


def _scene():
    """Four seconds: a quiet room (-66 dBFS noise), speech-like tones at 0.5 to 1.5 s and 2.5 to 3.5 s, and a laugh-like
    noise burst at 2.0 to 2.3 s; the 'processed' version keeps the speech and takes the burst and the room away."""
    rng = np.random.default_rng(7)
    t = np.arange(4 * RATE) / RATE
    room = 0.0005 * rng.standard_normal(len(t))
    speech = np.where(((t > 0.5) & (t < 1.5)) | ((t > 2.5) & (t < 3.5)), 0.2 * np.sin(2 * np.pi * 220 * t), 0.0)
    burst = np.where((t > 2.0) & (t < 2.3), 0.15 * rng.standard_normal(len(t)), 0.0)
    x = (room + speech + burst).astype(np.float32)[:, None]
    y = speech.astype(np.float32)[:, None]
    return t, x, y, burst


def _rms(a):
    return float(np.sqrt(np.mean(np.square(a, dtype=np.float64))))


def test_keep_lets_the_laugh_through_and_leaves_the_rest_as_processed():
    t, x, y, burst = _scene()
    kept = effects._controlled(x, y, RATE, {"amount": 100, "keep": 1})[:, 0]
    plain = effects._controlled(x, y, RATE, {"amount": 100, "keep": 0})[:, 0]
    laugh = (t > 2.05) & (t < 2.25)
    room = (t > 3.7) & (t < 3.95)
    assert np.array_equal(plain, y[:, 0])
    # the burst comes back within 1 dB of the original (the level match is the whole-file RMS ratio)
    gain = _rms(y) / _rms(x)
    assert abs(20 * np.log10(_rms(kept[laugh]) / (gain * _rms(burst[laugh])))) < 1.0
    # the room between sounds stays as processed, and the speech is untouched away from the burst
    assert _rms(kept[room]) < 1e-6
    speech = (t > 0.6) & (t < 1.4)
    assert np.max(np.abs(kept[speech] - y[speech, 0])) < 1e-6


def test_amount_mixes_the_level_matched_original_back_in():
    t, x, y, _ = _scene()
    half = effects._controlled(x, y, RATE, {"amount": 50, "keep": 0})[:, 0]
    gain = _rms(y) / _rms(x)
    expected = 0.5 * gain * x[:, 0] + 0.5 * y[:, 0]
    assert np.max(np.abs(half - expected)) < 1e-6
    none = effects._controlled(x, y, RATE, {"amount": 0, "keep": 0})[:, 0]
    assert np.max(np.abs(none - gain * x[:, 0])) < 1e-6


def test_a_mix_past_minus_one_dbfs_is_brought_down_by_one_gain():
    x = np.full((1000, 1), 0.95, dtype=np.float32)
    y = np.full((1000, 1), 0.95, dtype=np.float32)
    y[500:] = -0.95
    out = effects._controlled(x, y, RATE, {"amount": 50, "keep": 0})
    assert abs(float(np.max(np.abs(out))) - 0.891) < 1e-4


def test_enhance_speech_takes_amount_and_keep_through_the_engine(client):
    _, x, _, _ = _scene()
    src = client.post("/api/media", content=_wav(x[:, 0]), headers={"X-Filename": "scene.wav"}).json()
    for name in ("voice-clean", "dialogue-isolate"):
        params = effects.PARAMS[name][0]
        assert {"amount", "keep"} <= set(params), name
    import json

    out = client.post(f"/api/media/{src['id']}/effect", params={"name": "voice-clean", "params": json.dumps({"amount": 0, "keep": 0, "strength": 50})})
    assert out.status_code in (200, 201), out.text
    from app.services.tools import _wav_view

    view, _ = _wav_view(out.json()["id"])
    y = np.asarray(view, dtype=np.float64)[:, 0]
    # Amount 0: the original at the processed level, so it correlates with the source almost exactly
    corr = float(np.corrcoef(y[: len(x)], x[: len(y), 0])[0, 1])
    assert corr > 0.999
