"""PLAN_v13 S7, MIDI editing: quantize with strength, swing, triplets and ends; the velocity and duration operations;
duplicates; the notes a split takes; note names; chords named from their notes and by bar; the real-time duration and
delay effects; the Standard MIDI File's tempo and meter; and the engine's rendering of an empty note clip. The note
operations run in Node as the interface runs them (engine/midi.ts, audio/notes.ts and the reducer)."""
import json
import shutil
import subprocess

import numpy as np
import pytest

from app.services import midi, tools
from conftest import BACKEND, ROOT

FRONTEND = ROOT / "frontend"
RATE = 48000
DOC = {"sampleRate": RATE, "media": {}, "markers": [], "tracks": []}


def _run(*cases: tuple) -> list:
    """Each (doc, fn, args) run in Node; a {"$set": [...]} argument arrives as a Set, the pick of notes."""
    node = shutil.which("node")
    if node is None:
        pytest.skip("needs Node on the PATH")
    if not (FRONTEND / "node_modules" / "vite").is_dir():
        pytest.skip("needs the interface's packages: npm ci in frontend")
    done = subprocess.run([node, str(BACKEND / "tests" / "editing.mjs"), str(FRONTEND)], input=json.dumps([{"doc": d, "fn": f, "args": a} for d, f, a in cases]), capture_output=True, text=True, timeout=300)
    assert done.returncode == 0, done.stderr[-2000:]
    return json.loads(done.stdout)


def _values(*cases: tuple) -> list:
    return [r["value"] for r in _run(*cases)]


def _note(at: int, length: int = 1000, pitch: int = 60, velocity: int = 100) -> dict:
    return {"at": at, "length": length, "pitch": pitch, "velocity": velocity}


NOTE = lambda q, triplet=False: {"kind": "note", "quarters": q, "dotted": False, "triplet": triplet}
QUANTIZE = lambda grid, strength=1, swing=0, ends=False: {"grid": grid, "strength": strength, "swing": swing, "ends": ends}


def test_quantize_moves_starts_by_the_strength_swings_every_second_line_to_the_triplet_and_can_take_the_ends():
    notes = [_note(5900), _note(6100), _note(8900), _note(9100)]
    straight, half, swung, half_swung, triplets, ends, picked = _values(
        (DOC, "quantizeNotes", [notes, None, QUANTIZE(NOTE(0.25)), 30]),
        (DOC, "quantizeNotes", [[_note(5000)], None, QUANTIZE(NOTE(0.25), strength=0.5), 30]),
        (DOC, "quantizeNotes", [[_note(15000), _note(11000), _note(7000), _note(37000)], None, QUANTIZE(NOTE(0.5), swing=1), 30]),
        (DOC, "quantizeNotes", [[_note(13000)], None, QUANTIZE(NOTE(0.5), swing=0.5), 30]),
        (DOC, "quantizeNotes", [[_note(7000), _note(17000)], None, QUANTIZE(NOTE(0.5, triplet=True)), 30]),
        (DOC, "quantizeNotes", [[_note(5900, 6200), _note(5900, 100)], None, QUANTIZE(NOTE(0.25), ends=True), 30]),
        (DOC, "quantizeNotes", [notes, {"$set": [1]}, QUANTIZE(NOTE(0.25)), 30]),
    )
    # a 1/16 at 120 BPM and 48 kHz is 6000 samples
    assert [n["at"] for n in straight] == [6000, 6000, 6000, 12000]
    assert half[0]["at"] == 5500
    # a 1/8 swung all the way: the second 1/8 of each beat moves a third of a step later, to the triplet's 16000
    assert [n["at"] for n in swung] == [16000, 16000, 0, 40000]
    assert half_swung[0]["at"] == 14000
    # a 1/8 triplet is 8000 samples
    assert [n["at"] for n in triplets] == [8000, 16000]
    # with the ends, a note keeps its length where its end would land on its start
    assert [(n["at"], n["length"]) for n in ends] == [(6000, 6000), (6000, 100)]
    assert [n["at"] for n in picked] == [5900, 6000, 8900, 9100]


def test_velocity_set_scale_limit_ramp_and_humanize_stay_within_one_to_127():
    notes = [_note(0, velocity=100), _note(1000, velocity=50), _note(2000, velocity=120)]
    set_, scale, limit, ramp, hum, again, other, high, low, picked = _values(
        (None, "changeVelocity", [notes, None, {"kind": "set", "value": 64}]),
        (None, "changeVelocity", [notes, None, {"kind": "scale", "percent": 50, "offset": 10}]),
        (None, "changeVelocity", [notes, None, {"kind": "limit", "min": 60, "max": 110}]),
        (None, "changeVelocity", [notes, None, {"kind": "ramp", "from": 20, "to": 120}]),
        (None, "changeVelocity", [notes, None, {"kind": "humanize", "amount": 10, "seed": 42}]),
        (None, "changeVelocity", [notes, None, {"kind": "humanize", "amount": 10, "seed": 42}]),
        (None, "changeVelocity", [notes, None, {"kind": "humanize", "amount": 10, "seed": 7}]),
        (None, "changeVelocity", [notes, None, {"kind": "set", "value": 200}]),
        (None, "changeVelocity", [notes, None, {"kind": "set", "value": 0}]),
        (None, "changeVelocity", [notes, {"$set": [0]}, {"kind": "set", "value": 1}]),
    )
    v = lambda ns: [n["velocity"] for n in ns]
    assert v(set_) == [64, 64, 64]
    assert v(scale) == [60, 35, 70]
    assert v(limit) == [100, 60, 110]
    assert v(ramp) == [20, 70, 120]
    assert all(abs(a - b) <= 10 for a, b in zip(v(hum), v(notes))) and v(hum) == v(again) and v(hum) != v(other)
    assert v(high) == [127] * 3 and v(low) == [1] * 3
    assert v(picked) == [1, 50, 120]


def test_duration_set_scale_limit_legato_overlaps_and_humanize():
    notes = [_note(0, 2000, 60), _note(1000, 3000, 62), _note(1500, 1000, 60), _note(5000, 500, 64)]
    set_, scale, limit, legato, overlap, hum = _values(
        (None, "changeDuration", [notes, None, {"kind": "set", "frames": 2000}]),
        (None, "changeDuration", [notes, None, {"kind": "scale", "percent": 50}]),
        (None, "changeDuration", [notes, None, {"kind": "limit", "min": 800, "max": 2000}]),
        (None, "changeDuration", [notes, None, {"kind": "legato", "gap": 100}]),
        (None, "changeDuration", [notes, None, {"kind": "overlap"}]),
        (None, "changeDuration", [notes, None, {"kind": "humanize", "percent": 20, "seed": 7}]),
    )
    ln = lambda ns: [n["length"] for n in ns]
    assert ln(set_) == [2000] * 4
    assert ln(scale) == [1000, 1500, 500, 250]
    assert ln(limit) == [2000, 2000, 1000, 800]
    # legato: each runs to the next start less the gap; the last keeps its own
    assert ln(legato) == [900, 400, 3400, 500]
    # overlaps: the first C ends where the next C begins; the other pitches are left
    assert ln(overlap) == [1500, 3000, 1000, 500]
    assert all(0.8 * b <= a <= 1.2 * b for a, b in zip(ln(hum), ln(notes)))


def test_duplicates_keep_the_longest_then_the_louder_and_a_split_takes_a_range_or_each_chords_top_or_bottom():
    dupes = [_note(0, 1000, 60, 100), _note(20, 1500, 60, 90), _note(30, 1500, 60, 110), _note(0, 1000, 64), _note(5000, 1000, 60)]
    chords = [_note(0, pitch=60), _note(0, pitch=64), _note(5, pitch=67), _note(9600, pitch=62), _note(9600, pitch=65), _note(20000, pitch=72)]
    within, exact, top, bottom, rng, reversed_, picked = _values(
        (None, "duplicateNotes", [dupes, None, 48]),
        (None, "duplicateNotes", [dupes, None, 0]),
        (None, "splitNotes", [chords, None, {"kind": "top"}, 48]),
        (None, "splitNotes", [chords, None, {"kind": "bottom"}, 48]),
        (None, "splitNotes", [chords, None, {"kind": "range", "low": 62, "high": 65}]),
        (None, "splitNotes", [chords, None, {"kind": "range", "low": 65, "high": 62}]),
        (None, "splitNotes", [chords, {"$set": [0, 1]}, {"kind": "top"}, 48]),
    )
    assert within == [0, 1] and exact == []
    assert top == [2, 4, 5] and bottom == [0, 3, 5]
    assert rng == reversed_ == [1, 3, 4]
    assert picked == [1]


def test_note_names_read_and_write_with_middle_c_as_c4():
    names = _values(*[(None, "noteName", [p]) for p in (60, 61, 0, 127)])
    parsed = _values(*[(None, "parseNoteName", [t]) for t in ("C4", "F#3", "Bb2", "e-1", " 64 ", "128", "H2", "G9", "G#9", "")])
    assert names == ["C4", "C#4", "C-1", "G9"]
    assert parsed == [60, 54, 46, 4, 64, None, None, 127, None, None]


def test_chords_are_named_over_their_bass_and_by_bar_only_where_they_change():
    cases = {
        "C": [60, 64, 67],
        "Am": [57, 60, 64],
        "G7": [55, 59, 62, 65],
        "Cmaj7": [60, 64, 67, 71],
        "Bdim": [59, 62, 65],
        "Csus4": [60, 65, 67],
        "C/E": [64, 67, 72],
        "C6": [60, 64, 67, 69],
        "Am7": [57, 60, 64, 67],
        "Dm7": [62, 65, 69, 72],
        "C5": [48, 55],
    }
    named = _values(*[(None, "chordName", [p]) for p in cases.values()], (None, "chordName", [[60, 62]]), (None, "chordName", [[60]]), (None, "chordName", [[]]))
    assert named == [*cases.keys(), None, None, None]
    bar = 96000
    notes = [_note(0, 2 * bar, p) for p in (48, 64, 67)] + [_note(2 * bar, bar, p) for p in (57, 60, 64)] + [_note(2 * bar + 1000, 6000, 62)]
    by_bar, three_four = _values((DOC, "chordsByBar", [notes, 0, 3 * bar]), ({**DOC, "tempo": {"bpm": 120, "beatsPerBar": 3}}, "chordsByBar", [[_note(0, 72000, p) for p in (60, 64, 67)] + [_note(72000, 72000, p) for p in (55, 59, 62)], 0, 144000]))
    # a passing D, sounding less than a quarter of the bar, leaves the A minor bar as A minor
    assert by_bar == [{"at": 0, "name": "C"}, {"at": 2 * bar, "name": "Am"}]
    assert three_four == [{"at": 0, "name": "C"}, {"at": 72000, "name": "G"}]


def test_the_duration_and_delay_effects_change_what_sounds_and_the_cleaning_holds_their_ranges():
    fx = [{"kind": "duration", "percent": 50}, {"kind": "delay", "ms": 10}]
    later, earlier = _values((None, "applyMidiFx", [[_note(1000)], fx, RATE]), (None, "applyMidiFx", [[_note(1000)], [{"kind": "delay", "ms": -100}], RATE]))
    assert later == [_note(1480, 500)] and earlier == [_note(0)]
    doc = {**DOC, "tracks": [{"id": "t", "name": "t", "channels": 2, "gainDb": 0, "mute": False, "solo": False, "clips": []}]}
    (cleaned,) = _run((doc, "apply", [{"type": "set-track-midi-fx", "trackId": "t", "midiFx": [{"kind": "duration", "percent": 1000}, {"kind": "delay", "ms": -2500.4}, {"kind": "duration"}, {"kind": "arpeggio"}]}]))
    assert cleaned["after"]["tracks"][0]["midiFx"] == [{"kind": "duration", "percent": 400}, {"kind": "delay", "ms": -1000}, {"kind": "duration", "percent": 100}]


def test_a_midi_file_carries_the_sessions_tempo_and_meter_and_reads_back():
    notes = [_note(0, 24000, 60, 100), _note(24000, 24000, 64, 90)]
    (data,) = _values((None, "midiFile", [notes, RATE, 90, 480, 3]))
    raw = bytes(data)
    tempo = round(60_000_000 / 90)
    assert bytes([0xFF, 0x51, 0x03, tempo >> 16, (tempo >> 8) & 0xFF, tempo & 0xFF]) in raw
    assert bytes([0xFF, 0x58, 0x04, 3, 2, 24, 8]) in raw
    song = midi.read(raw)
    assert abs(song["tempo"] - 90) < 1e-3
    assert [(n["pitch"], n["velocity"]) for n in song["notes"]] == [(60, 100), (64, 90)]
    assert [round(n["start"], 4) for n in song["notes"]] == [0, 0.5] and [round(n["length"], 4) for n in song["notes"]] == [0.5, 0.5]


def test_an_empty_note_clip_renders_as_silence_of_its_length_and_notes_are_padded_to_it(client):
    empty = client.post("/api/midi/render", json={"notes": [], "rate": RATE, "name": "Notes", "length": 1.5})
    assert empty.status_code == 201, empty.text
    view, rate = tools._wav_view(empty.json()["id"])
    assert rate == RATE and view.shape == (72000, 2) and not np.any(view)
    padded = client.post("/api/midi/render", json={"notes": [{"start": 0, "length": 0.25, "pitch": 69, "velocity": 100}], "rate": RATE, "length": 2})
    assert padded.status_code == 201
    view, _ = tools._wav_view(padded.json()["id"])
    assert view.shape[0] == 2 * RATE and np.any(view[:RATE // 4]) and not np.any(view[RATE:])
    refused = client.post("/api/midi/render", json={"notes": [], "rate": RATE})
    assert refused.status_code == 422 and refused.json()["detail"] == "no notes to render"


def test_an_empty_note_list_still_makes_a_note_clip():
    media = {"id": "n", "name": "Notes.wav", "sampleRate": RATE, "frames": RATE, "channels": 2, "format": "wav"}
    empty, audio = _run((DOC, "apply", [{"type": "import-media", "media": media, "at": 4800, "notes": []}]), (DOC, "apply", [{"type": "import-media", "media": media, "at": 0}]))
    clip = empty["after"]["tracks"][0]["clips"][0]
    assert clip["notes"] == [] and clip["start"] == 4800 and clip["length"] == RATE
    assert "notes" not in audio["after"]["tracks"][0]["clips"][0]
