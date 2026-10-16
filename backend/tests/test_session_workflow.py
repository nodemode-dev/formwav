"""PLAN_v13 S13, session and workflow, in the engine: clip gain bypassed in the export, clip gain rendered into the
audio playing exactly as the gain did, and a session as a template (no audio, everything else kept)."""
import struct

import numpy as np
import pytest

from app.services import render
from test_tempo_map import _calls

RATE = 48000


def _wav(x: np.ndarray) -> bytes:
    data = x.astype("<f4").tobytes()
    fmt = struct.pack("<IHHIIHH", 16, 3, 1, RATE, RATE * 4, 4, 32)
    return b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + fmt + b"data" + struct.pack("<I", len(data)) + data


@pytest.fixture(scope="module")
def ref(client):
    t = np.arange(2 * RATE) / RATE
    return client.post("/api/media", content=_wav(0.4 * np.sin(2 * np.pi * 220 * t)), headers={"X-Filename": "tone.wav"}).json()


def _doc(ref: dict, clip: dict) -> dict:
    return {"version": 1, "sampleRate": RATE, "media": {ref["id"]: ref}, "markers": [], "tracks": [{"id": "t1", "name": "t", "gainDb": 0, "pan": 0, "mute": False, "solo": False, "clips": [{"id": "c1", "mediaId": ref["id"], "start": 0, "sourceIn": 0, "length": ref["frames"], "gainDb": 0, **clip}]}]}


def _mix(doc: dict) -> np.ndarray:
    return np.frombuffer(render.render(doc)["wav"][44:], "<f4").reshape(-1, 2)[:, 0].astype(np.float64)


LINE = [{"at": 0, "db": 0}, {"at": RATE // 2, "db": -18}, {"at": RATE, "db": -6}]


def test_bypassed_clip_gain_plays_at_0_db_and_rendered_clip_gain_plays_as_the_gain_did(client, ref):
    plain = _mix(_doc(ref, {}))
    shaped = _mix(_doc(ref, {"gainDb": -5, "envelope": LINE}))
    bypassed = _mix(_doc(ref, {"gainDb": -5, "envelope": LINE, "gainBypass": True}))
    assert np.array_equal(bypassed, plain) and not np.allclose(shaped, plain)
    res = client.post(f"/api/media/{ref['id']}/clip-gain", json={"gainDb": -5, "envelope": LINE})
    assert res.status_code == 201, res.text
    baked = res.json()
    assert baked["frames"] == ref["frames"] and baked["id"] != ref["id"]
    rendered = _mix({**_doc(ref, {}), "media": {ref["id"]: ref, baked["id"]: baked}, "tracks": [{**_doc(ref, {})["tracks"][0], "clips": [{**_doc(ref, {})["tracks"][0]["clips"][0], "mediaId": baked["id"]}]}]})
    assert np.max(np.abs(rendered - shaped)) < 2e-4, np.max(np.abs(rendered - shaped))
    assert client.post("/api/media/" + "0" * 64 + "/clip-gain", json={"gainDb": 1}).status_code == 404


def test_a_template_keeps_the_sessions_shape_and_leaves_its_audio_out(ref):
    doc = {
        **_doc(ref, {"gainDb": -3}),
        "buses": [{"id": "b1", "name": "Verb", "gainDb": -2, "pan": 0}],
        "loop": {"start": 0, "end": 1000, "enabled": True},
        "markers": [{"id": "m1", "at": 100, "label": "Verse"}],
        "tempo": {"bpm": 98, "beatsPerBar": 3},
    }
    doc["tracks"][0] |= {"fx": [{"kind": "lowpass", "freq": 900, "gainDb": 0, "q": 0.7}], "sends": [{"busId": "b1", "gainDb": -9}], "instrument": {"kind": "sampler", "media": ref["id"], "root": 60}, "playlists": [{"name": "Take 2", "clips": []}], "playlist": "Main"}
    (out,) = _calls([{"module": "engine/template.ts", "fn": "templateOf", "args": [doc]}])
    t = out["tracks"][0]
    assert out["template"] is True and out["media"] == {} and t["clips"] == [] and "loop" not in out
    assert t["fx"] == doc["tracks"][0]["fx"] and t["sends"] == doc["tracks"][0]["sends"] and "instrument" not in t and "playlists" not in t
    assert out["buses"] == doc["buses"] and out["markers"] == doc["markers"] and out["tempo"] == doc["tempo"]
