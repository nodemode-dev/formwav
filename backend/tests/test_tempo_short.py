"""Tempo detection on a clip too short to hold a beat answers no tempo (0 BPM, confidence 0) instead of failing: the
spectral flux of a clip under about half a second is shorter than the 50-frame window its local mean is taken over."""
import struct

import numpy as np

from conftest import needs_ffmpeg

RATE = 48000


def _wav(x: np.ndarray) -> bytes:
    data = x.astype("<f4").tobytes()
    fmt = struct.pack("<IHHIIHH", 16, 3, 1, RATE, RATE * 4, 4, 32)
    return b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + fmt + b"data" + struct.pack("<I", len(data)) + data


@needs_ffmpeg
def test_a_clip_shorter_than_half_a_second_has_no_tempo(client):
    for seconds in (0.05, 0.2, 0.45):
        n = int(seconds * RATE)
        x = (0.3 * np.sin(2 * np.pi * 220 * np.arange(n) / RATE) * (np.arange(n) % 4800 < 400)).astype(np.float32)
        made = client.post("/api/media", content=_wav(x), headers={"X-Filename": "short.wav"}).json()
        res = client.get(f"/api/media/{made['id']}/tempo")
        assert res.status_code == 200, (seconds, res.text)
        assert res.json() == {"bpm": 0.0, "confidence": 0.0}, seconds
