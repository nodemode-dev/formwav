"""PLAN_v13 S14: the subtractive and drum synths as note-track instruments (the core's table and the interface's held
equal, a note clip rendered through them by the engine exactly as the core renders it, a drum pattern's hits where its
notes are), and any live chain rendered into new media through the core exactly as the export plays it."""
import json
import struct

import numpy as np
import pytest

from app.services import core_effects, media, render
from test_tempo_map import _calls

RATE = 48000


def _wav(x: np.ndarray) -> bytes:
    data = x.astype("<f4").tobytes()
    return b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 3, 1, RATE, RATE * 4, 4, 32) + b"data" + struct.pack("<I", len(data)) + data


def _samples(media_id: str) -> np.ndarray:
    from app.services.tools import _wav_view

    view, _ = _wav_view(media_id)
    return np.asarray(view, dtype=np.float64)


def test_the_interface_and_the_core_list_the_same_parameters_in_the_same_order():
    core = media._require_core()
    got = _calls([{"module": "engine/instruments.ts", "fn": "instrumentParams", "args": [k]} for k in ("subtractive", "drums")])
    for kind, ui in zip(("subtractive", "drums"), got):
        native = json.loads(core.instrument_params(kind))
        assert [p["id"] for p in ui] == [p["id"] for p in native], kind
        for a, b in zip(ui, native):
            assert a["name"] == b["name"] and a["unit"] == b["unit"], a["id"]
            for key in ("min", "max", "default"):
                assert a[key] == pytest.approx(b[key], abs=1e-6), (kind, a["id"], key)
    values = _calls([{"module": "engine/instruments.ts", "fn": "instrumentValues", "args": ["subtractive", {"cutoff": 99999, "osc1": 1.4, "nope": 3}]}])[0]
    assert values[0] == 1 and values[5] == 20000 and len(values) == len(json.loads(core.instrument_params("subtractive")))


def test_a_note_clip_renders_through_the_subtractive_synth_exactly_as_the_core_plays_it(client):
    core = media._require_core()
    values = [0, 3, 12, -9, 0.5, 900, 0.7, 0.8, 0.01, 0.2, 0.5, 0.3, 0.0, 0.25, 0.1, 0.2, 80, 0.7, 0.6]
    notes = [{"start": 0.0, "length": 0.4, "pitch": 45, "velocity": 110}, {"start": 0.3, "length": 0.5, "pitch": 52, "velocity": 70}]
    res = client.post("/api/midi/render", json={"notes": notes, "rate": RATE, "name": "sub", "instrument": {"kind": "subtractive", "values": values}})
    assert res.status_code == 201, res.text
    got = _samples(res.json()["id"])
    frames = [(int(round(n["start"] * RATE)), int(round(n["length"] * RATE)), n["pitch"], n["velocity"]) for n in notes]
    want = np.frombuffer(core.render_instrument(frames, RATE, "subtractive", values), "<f4").astype(np.float64)
    assert got.shape == (len(want), 2)
    assert np.array_equal(got[:, 0], want) and np.array_equal(got[:, 1], want)
    assert np.sqrt(np.mean(want[: int(0.4 * RATE)] ** 2)) > 0.01
    assert client.post("/api/midi/render", json={"notes": notes, "instrument": {"kind": "organ"}}).status_code == 422


def test_a_drum_pattern_puts_its_kick_snare_and_hat_where_its_notes_are(client):
    core = media._require_core()
    notes = [{"start": 0.25, "length": 0.05, "pitch": 36, "velocity": 120}, {"start": 0.75, "length": 0.05, "pitch": 38, "velocity": 120}, {"start": 1.25, "length": 0.05, "pitch": 42, "velocity": 120}]
    res = client.post("/api/midi/render", json={"notes": notes, "rate": RATE, "name": "beat", "instrument": {"kind": "drums", "values": []}, "length": 2.0})
    assert res.status_code == 201, res.text
    x = _samples(res.json()["id"])[:, 0]
    assert len(x) >= 2 * RATE
    rate, onsets = core.onsets(_wav(x), 0.5)
    for at in (RATE // 4, 3 * RATE // 4, 5 * RATE // 4):
        assert any(abs(o - at) < 480 for o in onsets), f"no onset near {at}: {onsets}"
    spectrum = lambda seg: np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
    freqs = np.fft.rfftfreq(2400, 1 / RATE)
    kick, hat = spectrum(x[RATE // 4 + 240 : RATE // 4 + 2640]), spectrum(x[5 * RATE // 4 + 240 : 5 * RATE // 4 + 2640])
    centroid = lambda s: float(np.sum(freqs * s) / np.sum(s))
    assert centroid(kick) < 1000 < 4000 < centroid(hat), (centroid(kick), centroid(hat))


def test_a_live_chain_rendered_into_a_clip_plays_exactly_as_the_chain_live(tmp_path):
    t = np.arange(int(1.5 * RATE)) / RATE
    x = np.where(t < 0.6, 0.4 * np.sin(2 * np.pi * 330 * t) * np.exp(-3 * t), 0.0)
    ref = media.import_wav("burst.wav", _wav(x))
    chain = [{"kind": "echo", "delayMs": 180, "feedback": 0.4, "mix": 0.5}, {"kind": "reverb", "room": 0.7, "damping": 0.4, "mix": 0.3, "width": 1}, {"kind": "compressor", "thresholdDb": -24, "ratio": 3, "attackMs": 5, "releaseMs": 120, "makeupDb": 2}, {"kind": "processor", "id": "drive", "values": {}}, {"kind": "processor", "id": "maximizer", "values": {}}, {"kind": "lowpass", "freq": 3000, "q": 0.707, "bypass": True}]

    def export(media_ref: dict, fx: list) -> np.ndarray:
        clip = {"id": "c1", "mediaId": media_ref["id"], "start": 0, "sourceIn": 0, "length": media_ref["frames"], "gainDb": 0}
        track = {"id": "t1", "name": "t", "gainDb": 0, "pan": 0, "mute": False, "solo": False, "clips": [clip], "fx": fx}
        doc = {"version": 1, "sampleRate": RATE, "media": {media_ref["id"]: media_ref}, "markers": [], "tracks": [track]}
        return np.frombuffer(render.render(doc)["wav"][44:], "<f4").reshape(-1, 2).astype(np.float64)

    live = export(ref, chain)
    rendered = core_effects.render_chain(ref["id"], chain, "effects")
    assert rendered["frames"] == ref["frames"] and rendered["channels"] == 2
    after = export(rendered, [{**f, "bypass": True} for f in chain])
    n = min(len(live), len(after))
    assert np.max(np.abs(live[:n] - after[:n])) < 1e-6, np.max(np.abs(live[:n] - after[:n]))
    assert np.max(np.abs(live[: int(0.6 * RATE)] - np.stack([x, x], 1)[: int(0.6 * RATE)])) > 0.01


def test_every_live_effect_and_processor_is_in_the_catalogue_and_renders_one_alone(client):
    groups = client.get("/api/media/effects").json() if client.get("/api/media/effects").status_code == 200 else client.get("/api/effects").json()
    live = next(g for g in groups if g["group"] == "Live effects, rendered")
    ids = {e["id"] for e in live["effects"]}
    assert {"live:echo", "live:reverb", "live:compressor", "live:dereverb"} <= ids
    assert any(i.startswith("live:processor:") for i in ids)
    ref = media.import_wav("tone.wav", _wav(0.3 * np.sin(2 * np.pi * 220 * np.arange(RATE) / RATE)))
    out = core_effects.apply(ref["id"], "live:tremolo", {"rateHz": 5, "depth": 1})
    y = _samples(out["id"])[:, 0]
    env = np.array([np.max(np.abs(y[i : i + 480])) for i in range(0, len(y) - 480, 480)])
    assert env.max() > 0.25 and env.min() < 0.05
    with pytest.raises(media.MediaError):
        core_effects.apply(ref["id"], "live:organ", {})
