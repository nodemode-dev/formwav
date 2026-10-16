import io

import mido
import pytest

from app.services import midi


def song_bytes(fmt: int = 1) -> bytes:
    f = mido.MidiFile(type=fmt, ticks_per_beat=480)
    conductor = mido.MidiTrack([
        mido.MetaMessage("track_name", name="Song", time=0),
        mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(100), time=0),
        mido.MetaMessage("time_signature", numerator=6, denominator=8, time=0),
        mido.MetaMessage("key_signature", key="D", time=0),
        mido.MetaMessage("marker", text="Verse", time=960),
        mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(150), time=960),
    ])
    piano = mido.MidiTrack([
        mido.MetaMessage("track_name", name="Piano", time=0),
        mido.Message("program_change", channel=0, program=5, time=0),
        mido.Message("control_change", channel=0, control=7, value=100, time=0),
        mido.Message("note_on", channel=0, note=60, velocity=90, time=0),
        mido.Message("pitchwheel", channel=0, pitch=4096, time=240),
        mido.Message("note_off", channel=0, note=60, velocity=0, time=240),
        mido.Message("note_on", channel=0, note=64, velocity=80, time=0),
        mido.Message("note_on", channel=0, note=64, velocity=0, time=480),
    ])
    drums = mido.MidiTrack([
        mido.MetaMessage("track_name", name="Drums", time=0),
        mido.Message("note_on", channel=9, note=36, velocity=110, time=0),
        mido.Message("note_off", channel=9, note=36, time=240),
        mido.Message("note_on", channel=9, note=38, velocity=100, time=720),
        mido.Message("note_off", channel=9, note=38, time=240),
    ])
    f.tracks.extend([conductor, piano, drums])
    out = io.BytesIO()
    f.save(file=out)
    return out.getvalue()


def test_a_format_1_file_comes_back_as_named_tracks_with_its_tempo_map_meter_markers_key_and_controllers():
    song = midi.read_song(song_bytes())
    assert [t["name"] for t in song["tracks"]] == ["Piano", "Drums"]
    piano, drums = song["tracks"]
    assert [(n["pitch"], round(n["start"], 4), round(n["length"], 4), n["velocity"]) for n in piano["notes"]] == [(60, 0.0, 0.6, 90), (64, 0.6, 0.6, 80)]
    assert drums["drums"] and drums["channel"] == 9 and [round(n["start"], 4) for n in drums["notes"]] == [0.0, 1.2]
    assert [(round(t["time"], 4), round(t["bpm"], 3)) for t in song["tempos"]] == [(0.0, 100.0), (2.4, 150.0)]
    assert song["meters"] == [{"time": 0.0, "tick": 0, "numerator": 6, "denominator": 8}]
    assert [t["tick"] for t in song["tempos"]] == [0, round(4 * 960)]
    assert [(round(m["time"], 4), m["label"]) for m in song["markers"]] == [(1.2, "Verse")]
    assert song["keys"] == [{"time": 0.0, "tick": 0, "fifths": 2, "minor": False}]
    kinds = {(c["kind"], c["number"], c["value"], round(c["time"], 4)) for c in piano["controllers"]}
    assert kinds == {("program", 0, 5, 0.0), ("cc", 7, 100, 0.0), ("bend", 0, 4096, 0.3)}


def test_a_format_0_file_splits_its_channels_and_format_2_is_read():
    f = mido.MidiFile(type=0, ticks_per_beat=96)
    f.tracks.append(mido.MidiTrack([
        mido.MetaMessage("track_name", name="All", time=0),
        mido.Message("note_on", channel=0, note=60, velocity=64, time=0),
        mido.Message("note_on", channel=1, note=48, velocity=64, time=0),
        mido.Message("note_off", channel=0, note=60, time=96),
        mido.Message("note_off", channel=1, note=48, time=0),
    ]))
    out = io.BytesIO()
    f.save(file=out)
    song = midi.read_song(out.getvalue())
    assert [(t["name"], t["channel"], t["notes"][0]["pitch"]) for t in song["tracks"]] == [("All ch 1", 0, 60), ("All ch 2", 1, 48)]
    assert [t["name"] for t in midi.read_song(song_bytes(2))["tracks"]] == ["Piano", "Drums"]


def test_smpte_division_counts_ticks_in_frames_not_beats():
    body = mido.MidiTrack([mido.Message("note_on", note=60, velocity=64, time=1000), mido.Message("note_off", note=60, time=500)])
    raw = io.BytesIO()
    f = mido.MidiFile(type=0, ticks_per_beat=480)
    f.tracks.append(body)
    f.save(file=raw)
    data = bytearray(raw.getvalue())
    data[12:14] = bytes([256 - 25, 40])
    song = midi.read_song(bytes(data))
    note = song["tracks"][0]["notes"][0]
    assert song["smpte"] and round(note["start"], 6) == 1.0 and round(note["length"], 6) == 0.5


def test_the_import_route_renders_a_media_per_track_and_keeps_the_old_answer_shape(client):
    res = client.post("/api/midi/import?rate=48000", content=song_bytes(), headers={"X-Filename": "song.mid"})
    assert res.status_code == 201, res.text
    out = res.json()
    assert [t["media"]["name"] for t in out["tracks"]] == ["Piano.wav", "Drums.wav"]
    assert out["media"]["id"] == out["tracks"][0]["media"]["id"] and out["notes"] == out["tracks"][0]["notes"]
    assert round(out["tempo"], 3) == 100.0
    bad = client.post("/api/midi/import", content=b"MThd\x00\x00\x00\x06\x00\x01\x00\x01\x01\xe0", headers={"X-Filename": "empty.mid"})
    assert bad.status_code == 422 and "no notes" in bad.json()["detail"]


@pytest.mark.parametrize("data", [b"", b"RIFF0000", b"MThd\x00\x00\x00\x06\x00\x05\x00\x01\x01\xe0"])
def test_what_is_not_a_midi_file_is_refused_with_its_reason(data):
    with pytest.raises(midi.MidiError):
        midi.read_song(data)
