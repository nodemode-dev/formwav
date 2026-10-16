"""PLAN_v13 S11, tempo and meter maps, held through the interface's own engine (frontend/src/engine/tempo.ts and the
modules that read it): ticks at 960 a quarter to samples across tempo changes, bars across meter changes (x/8 among
them), ramps written as steps, scaling and stretching, the grid and the Bars|Beats counter on the map, key changes, a
chord a bar, and the session's MIDI file carrying every tempo, meter and key."""
import io
import json
import shutil
import subprocess

import pytest

from conftest import BACKEND, ROOT
from test_automation_depth import _apply

RATE = 48000


def _calls(calls: list) -> list:
    node = shutil.which("node")
    if node is None or not (ROOT / "frontend" / "node_modules" / "vite").is_dir():
        pytest.skip("needs Node and the interface's packages")
    done = subprocess.run([node, str(BACKEND / "tests" / "engine_calls.mjs"), str(ROOT / "frontend")], input=json.dumps(calls), capture_output=True, text=True, timeout=120)
    assert done.returncode == 0, done.stderr[-2000:]
    return json.loads(done.stdout)


def _doc(**more) -> dict:
    return {"version": 1, "sampleRate": RATE, "media": {}, "markers": [], "tracks": [], "tempo": {"bpm": 120, "beatsPerBar": 4}, **more}


def test_ticks_become_samples_across_tempo_changes_and_bars_across_meter_changes():
    plain, slower, three = _doc(), _doc(tempoChanges=[{"tick": 3840, "bpm": 60}]), _doc(meterChanges=[{"bar": 2, "num": 3, "den": 4}])
    eighths = _doc(tempo={"bpm": 120, "beatsPerBar": 6, "beatUnit": 8})
    out = _calls([
        {"module": "engine/tempo.ts", "fn": "tickToSample", "args": [{"$map": plain}, 3840]},
        {"module": "engine/tempo.ts", "fn": "tickToSample", "args": [{"$map": slower}, 7680]},
        {"module": "engine/tempo.ts", "fn": "sampleToTick", "args": [{"$map": slower}, 288000]},
        {"module": "engine/tempo.ts", "fn": "barStartTick", "args": [{"$map": three}, 3]},
        {"module": "engine/tempo.ts", "fn": "barBeatAt", "args": [{"$map": three}, 10560 + 960 + 5]},
        {"module": "engine/tempo.ts", "fn": "barStartTick", "args": [{"$map": eighths}, 1]},
        {"module": "engine/tempo.ts", "fn": "barBeatAt", "args": [{"$map": eighths}, 2400]},
        {"module": "engine/timebase.ts", "fn": "formatPosition", "args": [10560 * 25, "bars_beats", {"$time": three}]},
    ])
    assert out[0] == 96000 and out[1] == 288000 and out[2] == 7680 and out[3] == 10560
    assert out[4] == {"bar": 3, "beat": 1, "ticks": 5, "num": 3, "den": 4}
    assert out[5] == 2880 and out[6] == {"bar": 0, "beat": 5, "ticks": 0, "num": 6, "den": 8}
    assert out[7] == "4| 1| 000"


def test_a_ramp_is_written_as_steps_and_keeps_the_tempo_after_and_stretch_and_scale_change_the_span_only():
    doc = _doc()
    ramp, stretch, scale = _calls([
        {"module": "engine/tempo.ts", "fn": "tempoCurve", "args": [doc, 0, 3840, 120, 160, "linear", 960]},
        {"module": "engine/tempo.ts", "fn": "scaleTempo", "args": [doc, 0, 3840, 0.5]},
        {"module": "engine/tempo.ts", "fn": "scaleTempo", "args": [_doc(tempoChanges=[{"tick": 960, "bpm": 100}]), 0, 1920, 1.1]},
    ])
    assert ramp == [{"tick": 0, "bpm": 120}, {"tick": 960, "bpm": 133.333}, {"tick": 1920, "bpm": 146.667}, {"tick": 2880, "bpm": 160}, {"tick": 3840, "bpm": 120}]
    assert scale == [{"tick": 0, "bpm": 132}, {"tick": 960, "bpm": 110}, {"tick": 1920, "bpm": 100}]
    ramped, stretched = _apply([{"doc": doc, "commands": [{"type": "set-tempo-map", "changes": ramp}]}, {"doc": doc, "commands": [{"type": "set-tempo-map", "changes": stretch}]}])
    assert ramped["tempo"]["bpm"] == 120 and ramped["tempoChanges"] == ramp[1:]
    assert stretched["tempo"]["bpm"] == 60 and stretched["tempoChanges"] == [{"tick": 3840, "bpm": 120}]
    at, after = _calls([{"module": "engine/tempo.ts", "fn": "tickToSample", "args": [{"$map": stretched}, 3840]}, {"module": "engine/tempo.ts", "fn": "tickToSample", "args": [{"$map": stretched}, 7680]}])
    assert at == 192000 and after == 288000


def test_the_reducer_keeps_one_change_a_place_and_the_grid_and_chords_follow_the_map():
    doc = _doc(tracks=[{"id": "t1", "name": "Keys", "gainDb": 0, "mute": False, "solo": False, "clips": [{"id": "c1", "mediaId": "m", "start": 192000, "sourceIn": 0, "length": 72000, "gainDb": 0, "notes": [{"at": 0, "length": 72000, "pitch": p, "velocity": 90} for p in (57, 60, 64)]}]}])
    changed = _apply([{"doc": doc, "commands": [
        {"type": "set-meter-change", "bar": 2, "num": 3, "den": 4},
        {"type": "set-meter-change", "bar": 4, "num": 7, "den": 8},
        {"type": "set-meter-change", "bar": 4, "num": 7, "den": 8, "remove": True},
        {"type": "set-tempo-change", "tick": 7680, "bpm": 120},
        {"type": "set-tempo-change", "tick": 11520, "bpm": 90},
        {"type": "set-key-change", "tick": 7680, "key": "A minor"},
        {"type": "set-key-change", "tick": 11520, "key": "E minor"},
        {"type": "set-key-change", "tick": 11520, "key": None},
    ]}])[0]
    assert changed["meterChanges"] == [{"bar": 2, "num": 3, "den": 4}]
    assert changed["tempoChanges"] == [{"tick": 11520, "bpm": 90}]
    assert changed["keyChanges"] == [{"tick": 7680, "key": "A minor"}]
    snap, lines, chords, key = _calls([
        {"module": "engine/grid.ts", "fn": "snapToGrid", "args": [changed, {"kind": "note", "quarters": "bar", "dotted": False, "triplet": False}, 192000 + 70000, 30]},
        {"module": "engine/grid.ts", "fn": "gridLines", "args": [changed, {"kind": "note", "quarters": 1, "dotted": False, "triplet": False}, 192000, 288000, 30]},
        {"module": "engine/midi.ts", "fn": "chordsPerBar", "args": [changed]},
        {"module": "engine/tempo.ts", "fn": "keyAt", "args": [changed, 9000]},
    ])
    assert snap == 264000
    assert lines == [192000, 216000, 240000, 264000, 288000]
    assert chords == [{"at": 192000, "name": "Am"}] and key == "A minor"


def test_the_sessions_midi_file_carries_every_tempo_meter_and_key_where_it_falls():
    mido = pytest.importorskip("mido")
    doc = _doc(tempoChanges=[{"tick": 3840, "bpm": 60}], meterChanges=[{"bar": 2, "num": 3, "den": 4}], key={"name": "D major", "camelot": "10B"}, keyChanges=[{"tick": 7680, "key": "E minor"}])
    data, sig = _calls([{"module": "engine/smf.ts", "fn": "sessionMidi", "args": [doc, "Map"]}, {"module": "engine/smf.ts", "fn": "keySignature", "args": ["Bb major"]}])
    f = mido.MidiFile(file=io.BytesIO(bytes(data)))
    at, meta = 0, []
    for m in f.tracks[0]:
        at += m.time
        if m.type in ("set_tempo", "time_signature", "key_signature"):
            meta.append((at, m.type, round(mido.tempo2bpm(m.tempo), 3) if m.type == "set_tempo" else f"{m.numerator}/{m.denominator}" if m.type == "time_signature" else m.key))
    assert meta == [(0, "set_tempo", 120), (0, "time_signature", "4/4"), (0, "key_signature", "D"), (1920, "set_tempo", 60), (3840, "time_signature", "3/4"), (3840, "key_signature", "Em")]
    assert sig == [-2, 0]
