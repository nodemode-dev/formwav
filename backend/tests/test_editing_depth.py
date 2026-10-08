"""PLAN_v13 S5, editing depth: the grid and nudge values, fades from a selection with a crossfade at a butt splice, a
shape for each fade and the logarithmic one, range copy and paste, clip mute, the locks, rename, Space Clips, snapping
to neighbours, memory locations and the track commands; each run in Node as the interface runs it (engine/editing.ts,
engine/grid.ts and the reducer), and rendered by the export where the sound is the point."""
import json
import shutil
import struct
import subprocess

import numpy as np
import pytest

from app.services import export, render
from conftest import BACKEND, ROOT

FRONTEND = ROOT / "frontend"
RATE = 48000


def _media(mid: str, frames: int = 10 * RATE) -> dict:
    return {"id": mid, "name": f"{mid}.wav", "sampleRate": RATE, "frames": frames, "channels": 1, "format": "wav"}


def _clip(cid: str, start: int, length: int, source_in: int = 0, mid: str = "m", **more) -> dict:
    return {"id": cid, "mediaId": mid, "start": start, "length": length, "sourceIn": source_in, "gainDb": 0, **more}


def _track(tid: str, clips: list, **more) -> dict:
    return {"id": tid, "name": tid, "channels": 1, "gainDb": 0, "mute": False, "solo": False, "clips": clips, **more}


def _doc(tracks: list, media: list | None = None, **more) -> dict:
    refs = media or [_media("m")]
    return {"sampleRate": RATE, "media": {r["id"]: r for r in refs}, "markers": [], "tracks": tracks, **more}


def _edit(*cases: tuple) -> list:
    """Each (doc, fn, args) run by engine/editing.ts or engine/grid.ts in Node, a command it returns applied as the
    engine dispatches it (fn "apply" applies args[0])."""
    node = shutil.which("node")
    if node is None:
        pytest.skip("needs Node on the PATH")
    if not (FRONTEND / "node_modules" / "vite").is_dir():
        pytest.skip("needs the interface's packages: npm ci in frontend")
    done = subprocess.run([node, str(BACKEND / "tests" / "editing.mjs"), str(FRONTEND)], input=json.dumps([{"doc": d, "fn": f, "args": a} for d, f, a in cases]), capture_output=True, text=True, timeout=300)
    assert done.returncode == 0, done.stderr[-2000:]
    return json.loads(done.stdout)


def _wav(x: np.ndarray) -> bytes:
    data = x.astype("<f4").tobytes()
    fmt = struct.pack("<IHHIIHH", 16, 3, 1, RATE, RATE * 4, 4, 32)
    return b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + fmt + b"data" + struct.pack("<I", len(data)) + data


@pytest.fixture(scope="module")
def media(client) -> dict:
    def store(x: np.ndarray) -> dict:
        return client.post("/api/media", content=_wav(x), headers={"X-Filename": "depth.wav"}).json()

    t = np.arange(10 * RATE) / RATE
    return {"tone": store(0.25 * np.sin(2 * np.pi * 440 * t) * (0.6 + 0.4 * np.sin(2 * np.pi * 0.7 * t))), "level": store(np.full(RATE, 0.5))}


def _mix(doc: dict, start: int = 0, stop: int | None = None) -> np.ndarray:
    return export.frames_of(render.render(doc, start, stop)["wav"])[0][:, 0].astype(np.float64)


def _spans(track: dict) -> list:
    return [(c["start"], c["length"], c["sourceIn"]) for c in track["clips"]]


NOTE = lambda q, dotted=False, triplet=False: {"kind": "note", "quarters": q, "dotted": dotted, "triplet": triplet}


def test_grid_values_give_their_steps_snap_to_the_nearest_line_and_restart_at_each_bar():
    doc = _doc([])
    steps = _edit(
        (doc, "gridStepOf", [NOTE(0.5), 30]),
        (doc, "gridStepOf", [NOTE(2, triplet=True), 30]),
        (doc, "gridStepOf", [NOTE(0.5, dotted=True), 30]),
        (doc, "gridStepOf", [{"kind": "frames", "frames": 1}, 24]),
        (doc, "gridStepOf", [{"kind": "frames", "frames": 2}, 30000 / 1001]),
        (doc, "snapToGrid", [NOTE(0.5), 5900, 30]),
        (doc, "snapToGrid", [NOTE(0.5), 6100, 30]),
        (doc, "snapToGrid", [{"kind": "seconds", "seconds": 0.5}, 37000, 25]),
        (doc, "gridLines", [NOTE(0.5), 0, 47999, 30]),
        (doc, "gridLines", [NOTE(2, dotted=True), 0, 200000, 30]),
        ({**doc, "tempo": {"bpm": 140, "beatsPerBar": 7}}, "gridLines", [NOTE("bar"), 0, 300000, 30]),
        (None, "parseGrid", ["1/16."]),
        (None, "parseGrid", ["0.01s"]),
        (None, "parseGrid", ["1/3"]),
    )
    values = [s["value"] for s in steps]
    # in samples at 48 kHz and 120 BPM: a 1/8, a 1/2 triplet, a dotted 1/8, a frame at 24 fps, two at 29.97
    assert values[:4] == [12000, 32000, 18000, 2000]
    assert abs(values[4] - 3203.2) < 1e-9
    assert values[5:8] == [0, 12000, 48000]
    assert values[8] == [0, 12000, 24000, 36000]
    # a dotted half does not divide a 4/4 bar: its lines start again at each bar line
    assert values[9] == [0, 72000, 96000, 168000, 192000]
    # bars of seven at 140 BPM are three seconds long
    assert values[10] == [0, 144000, 288000]
    assert values[11] == {"kind": "note", "quarters": 0.25, "dotted": True, "triplet": False} and values[12] == {"kind": "seconds", "seconds": 0.01} and values[13] is None


def test_nudge_moves_the_selected_clips_by_the_nudge_value_stops_at_the_start_and_leaves_locked_clips():
    doc = _doc([_track("t1", [_clip("a", RATE, RATE), _clip("b", 3 * RATE, RATE), _clip("c", 5 * RATE, RATE, lock="time")])])
    later, earlier, locked = _edit((doc, "nudgeClips", [["a", "b"], 4800]), (doc, "nudgeClips", [["a", "b"], -2 * RATE]), (doc, "nudgeClips", [["c"], 4800]))
    assert [c["start"] for c in later["after"]["tracks"][0]["clips"]] == [RATE + 4800, 3 * RATE + 4800, 5 * RATE]
    assert later["value"]["label"] == "Nudged clips later"
    assert [c["start"] for c in earlier["after"]["tracks"][0]["clips"]] == [0, 2 * RATE, 5 * RATE]
    assert locked["value"] is None


def test_space_clips_lays_clips_out_and_snap_moves_a_clip_against_its_neighbour():
    spaced = _doc([_track("t1", [_clip("a", 400, 120), _clip("b", 1300, 240, 1300), _clip("c", 3000, 60, 3000)])])
    three = _doc([_track("t1", [_clip("a", 200, 150), _clip("b", 900, 200, 900), _clip("c", 2400, 80, 2400)])])
    gap, starts, prev, nxt, locked = _edit(
        (spaced, "spaceClips", [["a", "b", "c"], 25, False]),
        (spaced, "spaceClips", [["a", "b", "c"], 1500, True]),
        (three, "snapClips", [["b"], "previous"]),
        (three, "snapClips", [["b"], "next"]),
        (_doc([_track("t1", [_clip("a", 200, 150), _clip("b", 900, 200, 900, lock="edit")])]), "snapClips", [["b"], "previous"]),
    )
    # the first clip stays; 25 samples apart end to start, 1500 apart start to start; b against a's end, then c's start
    assert [c["start"] for c in gap["after"]["tracks"][0]["clips"]] == [400, 545, 810]
    assert [c["start"] for c in starts["after"]["tracks"][0]["clips"]] == [400, 1900, 3400]
    assert [c["start"] for c in prev["after"]["tracks"][0]["clips"]] == [200, 350, 2400]
    assert [c["start"] for c in nxt["after"]["tracks"][0]["clips"]] == [200, 2200, 2400]
    assert locked["value"] is None


def test_create_fades_crossfades_a_butt_splice_from_the_handles_and_a_linear_one_renders_as_the_unsplit_clip(media):
    tone = media["tone"]
    whole = _doc([_track("t1", [_clip("w", 0, 6 * RATE, mid=tone["id"])])], [tone])
    split = _doc([_track("t1", [_clip("l", 0, 3 * RATE, mid=tone["id"]), _clip("r", 3 * RATE, 3 * RATE, 3 * RATE, mid=tone["id"])])], [tone])
    cross, linear, inside = _edit(
        (split, "createFades", [{"trackId": "t1", "start": 3 * RATE - 4800, "end": 3 * RATE + 4800}, "equal-power"]),
        (split, "createFades", [{"trackId": "t1", "start": 3 * RATE - 4800, "end": 3 * RATE + 4800}, "linear"]),
        (split, "createFades", [{"trackId": "t1", "start": RATE, "end": 2 * RATE}, "linear"]),
    )
    # a range 0.1 s each side of a split at 3 s: both clips reach into the other's side as far as the range, each fading
    # over the whole overlap, on the edges that meet alone
    l, r = cross["after"]["tracks"][0]["clips"]
    assert (l["start"], l["length"], l["sourceIn"], l["fadeOut"], l.get("fadeOutShape"), l.get("fadeShape")) == (0, 3 * RATE + 4800, 0, 9600, "equal-power", "linear")
    assert (r["start"], r["length"], r["sourceIn"], r["fadeIn"], r["fadeShape"], r.get("fadeOutShape")) == (3 * RATE - 4800, 3 * RATE + 4800, 3 * RATE - 4800, 9600, "equal-power", "linear")
    # linear gains add to one over the overlap, so the two pieces of one file play as the file did
    assert np.max(np.abs(_mix(linear["after"]) - _mix(whole))) < 1e-6
    assert inside["value"] is None


def test_fades_from_a_range_fade_to_the_playhead_and_delete_fades(media):
    tone = media["tone"]
    doc = _doc([_track("t1", [_clip("a", RATE, 2 * RATE, mid=tone["id"]), _clip("b", 4 * RATE, RATE, mid=tone["id"], fadeOut=480, fadeOutShape="exponential")])], [tone])
    fin, fout, start, end, gone = _edit(
        (doc, "createFades", [{"trackId": "t1", "start": RATE // 2, "end": RATE + 12000}, "logarithmic"]),
        (doc, "createFades", [{"trackId": "t1", "start": 2 * RATE, "end": 3 * RATE + 100}, "s-curve"]),
        (doc, "fadeToPlayhead", [{"range": None, "clipIds": ["a"]}, RATE + 24000, "start"]),
        (doc, "fadeToPlayhead", [{"range": None, "clipIds": ["a"]}, RATE + 24000, "end"]),
        (doc, "deleteFades", [{"range": None, "clipIds": ["a", "b"]}]),
    )
    a = fin["after"]["tracks"][0]["clips"][0]
    assert (a["fadeIn"], a["fadeShape"], a.get("fadeOutShape")) == (12000, "logarithmic", "linear")
    a = fout["after"]["tracks"][0]["clips"][0]
    assert (a["fadeOut"], a.get("fadeOutShape")) == (RATE, "s-curve")
    assert start["after"]["tracks"][0]["clips"][0]["fadeIn"] == 24000 and end["after"]["tracks"][0]["clips"][0]["fadeOut"] == 2 * RATE - 24000
    assert gone["value"]["label"] == "Deleted fades"
    b = gone["after"]["tracks"][0]["clips"][1]
    assert (b["fadeIn"], b["fadeOut"], b["fadeOutShape"]) == (0, 0, "exponential")


def test_each_fade_renders_its_own_shape_and_the_logarithmic_one_is_log10_of_one_plus_nine_x(media):
    level = media["level"]
    doc = _doc([_track("t1", [_clip("a", 0, RATE, mid=level["id"], fadeIn=1000, fadeOut=2000, fadeShape="linear", fadeOutShape="logarithmic")])], [level])
    mixed = _mix(doc)
    for k in (100, 500, 900):
        assert abs(mixed[k] - 0.5 * k / 1000) < 1e-6
    for k in (RATE - 1500, RATE - 1000, RATE - 500):
        x = (RATE - k) / 2000
        assert abs(mixed[k] - 0.5 * np.log10(1 + 9 * x)) < 1e-6
    # the same edge with the session's other shapes, as before: a fade code below 16 keeps one shape for both edges
    same = _doc([_track("t1", [_clip("a", 0, RATE, mid=level["id"], fadeIn=1000, fadeOut=1000, fadeShape="logarithmic")])], [level])
    mixed = _mix(same)
    half = 0.5 * np.log10(5.5)
    assert abs(mixed[500] - half) < 1e-6 and abs(mixed[RATE - 500] - half) < 1e-6


def test_a_muted_clip_is_silent_in_the_export_and_stays_where_it_is(media):
    tone = media["tone"]
    both = _doc([_track("t1", [_clip("a", 0, RATE, mid=tone["id"]), _clip("b", RATE, RATE, RATE, mid=tone["id"])])], [tone])
    (muted,) = _edit((both, "muteClips", [["b"]]))
    assert muted["value"]["label"] == "Muted clips"
    clips = muted["after"]["tracks"][0]["clips"]
    assert clips[1]["mute"] is True and _spans(muted["after"]["tracks"][0]) == _spans(both["tracks"][0])
    alone = _doc([_track("t1", [_clip("a", 0, RATE, mid=tone["id"])])], [tone])
    full = _mix(muted["after"], 0, 2 * RATE)
    assert np.max(np.abs(full[RATE:])) == 0 and np.array_equal(full[:RATE], _mix(alone, 0, RATE))
    (unmuted,) = _edit((muted["after"], "muteClips", [["b"]]))
    assert "mute" not in unmuted["after"]["tracks"][0]["clips"][1] and unmuted["value"]["label"] == "Unmuted clips"


def test_range_copy_and_paste_overwrites_the_destination_and_brings_the_automation(media):
    tone = media["tone"]
    ramp = {"volume": [{"time": 0, "value": -12}, {"time": 2 * RATE, "value": 0}]}
    doc = _doc([_track("A", [_clip("a", 0, 2 * RATE, mid=tone["id"])], automation=ramp), _track("B", [_clip("b", 0, 6 * RATE, 3 * RATE, mid=tone["id"])])], [tone])
    (copied,) = _edit((doc, "copyRange", [{"trackId": "A", "start": RATE // 2, "end": RATE * 3 // 2}]))
    clip = copied["value"]
    assert (clip["start"], clip["length"], [(p["start"], p["length"], p["sourceIn"]) for p in clip["pieces"]]) == (24000, RATE, [(0, RATE, 24000)])
    (pasted,) = _edit((doc, "pasteRange", [clip, "B", 3 * RATE, False]))
    assert pasted["value"]["label"] == "Pasted a range"
    b = next(t for t in pasted["after"]["tracks"] if t["id"] == "B")
    assert _spans(b) == [(0, 3 * RATE, 3 * RATE), (3 * RATE, RATE, 24000), (4 * RATE, 2 * RATE, 7 * RATE)]
    only = lambda d, tid: {**d, "tracks": [t for t in d["tracks"] if t["id"] == tid]}
    # B from 3 s plays what A played from 0.5 s, its ramp with it (lanes keep 0.01 dB); before and after, B as it was
    there = _mix(only(pasted["after"], "B"), 3 * RATE, 4 * RATE)
    source = _mix(only(doc, "A"), RATE // 2, RATE * 3 // 2)
    assert np.max(np.abs(there - source)) < 5e-4
    assert np.array_equal(_mix(only(pasted["after"], "B"), 0, 3 * RATE), _mix(only(doc, "B"), 0, 3 * RATE))
    assert np.max(np.abs(_mix(only(pasted["after"], "B"), 4 * RATE, 6 * RATE) - _mix(only(doc, "B"), 4 * RATE, 6 * RATE))) < 1e-6
    # with Shuffle the paste opens time: B's audio after 3 s moves a second later
    (shuffled,) = _edit((doc, "pasteRange", [clip, "B", 3 * RATE, True]))
    b = next(t for t in shuffled["after"]["tracks"] if t["id"] == "B")
    assert _spans(b) == [(0, 3 * RATE, 3 * RATE), (3 * RATE, RATE, 24000), (4 * RATE, 3 * RATE, 6 * RATE)]


def test_the_locks_refuse_what_they_should_and_nothing_else():
    doc = _doc([_track("t1", [_clip("x", RATE, RATE, RATE, lock="time"), _clip("y", 4 * RATE, RATE, 4 * RATE, lock="edit"), _clip("z", 7 * RATE, RATE, 7 * RATE)])])
    cases = [
        ({"type": "move-clip", "trackId": "t1", "clipId": "x", "start": 0}, False),
        ({"type": "set-clip-bounds", "trackId": "t1", "clipId": "x", "start": RATE + 100, "sourceIn": RATE + 100, "length": RATE - 100}, True),
        ({"type": "set-clip-bounds", "trackId": "t1", "clipId": "x", "start": RATE + 100, "sourceIn": RATE, "length": RATE - 100}, False),
        ({"type": "split-clip", "trackId": "t1", "clipId": "x", "at": RATE + 24000}, True),
        ({"type": "set-clip-gain", "trackId": "t1", "clipId": "y", "gainDb": -3}, True),
        ({"type": "set-clip-bounds", "trackId": "t1", "clipId": "y", "start": 4 * RATE + 100, "sourceIn": 4 * RATE + 100, "length": RATE - 100}, False),
        ({"type": "split-clip", "trackId": "t1", "clipId": "y", "at": 4 * RATE + 24000}, False),
        ({"type": "remove-clip", "trackId": "t1", "clipId": "y"}, False),
        ({"type": "set-clip-fades", "trackId": "t1", "clipId": "y", "fadeIn": 100, "fadeOut": 0}, False),
        ({"type": "clear-range", "trackId": "t1", "start": RATE + 100, "end": RATE + 200, "ripple": False}, True),
        ({"type": "clear-range", "trackId": "t1", "start": 4 * RATE + 100, "end": 4 * RATE + 200, "ripple": False}, False),
        ({"type": "clear-range", "trackId": "t1", "start": 100, "end": 200, "ripple": True}, False),
        ({"type": "insert-time", "trackIds": ["t1"], "at": 6 * RATE, "length": 100}, True),
        ({"type": "insert-time", "trackIds": ["t1"], "at": 0, "length": 100}, False),
        ({"type": "move-clip", "trackId": "t1", "clipId": "z", "start": 9 * RATE}, True),
    ]
    out = _edit(*[(doc, "apply", [c]) for c, _ in cases])
    for (command, allowed), r in zip(cases, out):
        assert (r["after"] != doc) == allowed, command
    unlocked, still = _edit((doc, "lockClips", [["x"], "time"]), (doc, "lockClips", [["x", "z"], "time"]))
    assert "lock" not in unlocked["after"]["tracks"][0]["clips"][0] and unlocked["value"]["label"] == "Unlocked clips"
    assert [c.get("lock") for c in still["after"]["tracks"][0]["clips"]] == ["time", "edit", "time"]


def test_an_edit_whose_parts_depend_on_each_other_is_refused_whole_by_a_lock_and_one_made_clip_by_clip_skips_it():
    doc = _doc([_track("t1", [_clip("a", 0, RATE, lock="edit"), _clip("b", RATE, RATE, RATE), _clip("c", 3 * RATE, RATE, 3 * RATE, lock="time")])])
    piece = {"start": 0, "length": RATE // 2, "pieces": [{"mediaId": "m", "start": 0, "length": RATE // 2, "sourceIn": 5 * RATE, "gainDb": 0}]}
    over, crossed, repeated, free = _edit(
        (doc, "pasteRange", [piece, "t1", RATE // 2, False]),
        (doc, "createFades", [{"trackId": "t1", "start": RATE - 4800, "end": RATE + 4800}, "linear"]),
        (doc, "repeatSpan", [{"range": None, "clipIds": ["b"]}, 1, True]),
        (doc, "repeatSpan", [{"range": None, "clipIds": ["b"]}, 1, False]),
    )
    # a paste over the edit-locked clip, a crossfade into it and a Shuffle duplicate that would move the time-locked one
    # leave the session as it was, rather than a paste on top of it, half a crossfade or copies over audio left in place
    for r in (over, crossed, repeated):
        assert r["value"]["whole"] is True and r["after"] == doc, r["value"]["label"]
    assert _spans(free["after"]["tracks"][0]) == [(0, RATE, 0), (RATE, RATE, RATE), (2 * RATE, RATE, RATE), (3 * RATE, RATE, 3 * RATE)]
    fades = lambda cid: {"type": "set-clip-fades", "trackId": "t1", "clipId": cid, "fadeIn": 100, "fadeOut": 0}
    (each,) = _edit((doc, "apply", [{"type": "batch", "commands": [fades("a"), fades("b")]}]))
    assert [c.get("fadeIn", 0) for c in each["after"]["tracks"][0]["clips"]] == [0, 100, 0]


def test_rename_a_clip_and_clear_its_name():
    doc = _doc([_track("t1", [_clip("a", 0, RATE)])])
    (named,) = _edit((doc, "apply", [{"type": "rename-clip", "trackId": "t1", "clipId": "a", "name": "  Intro take  "}]))
    assert named["after"]["tracks"][0]["clips"][0]["name"] == "Intro take"
    (cleared,) = _edit((named["after"], "apply", [{"type": "rename-clip", "trackId": "t1", "clipId": "a", "name": ""}]))
    assert "name" not in cleared["after"]["tracks"][0]["clips"][0]


def test_memory_locations_are_numbered_recalled_and_stepped_through():
    doc = _doc([_track("t1", [_clip("a", 0, RATE)])], markers=[{"id": "old", "at": 5 * RATE, "label": "made before numbers"}])
    one, two = _edit(
        (doc, "apply", [{"type": "add-marker", "at": RATE, "label": "Verse"}]),
        (doc, "apply", [{"type": "add-region", "start": 2 * RATE, "end": 3 * RATE, "label": "Chorus"}]),
    )
    # the marker made before numbers counts as 1, so the new one takes 2
    assert [(m["label"], m.get("number")) for m in one["after"]["markers"]] == [("Verse", 2), ("made before numbers", None)]
    both = {**one["after"], "regions": two["after"]["regions"]}
    region = both["regions"][0]
    assert region["number"] == 2
    renumbered, found, after, before, refused, coloured = _edit(
        (both, "apply", [{"type": "set-region", "regionId": region["id"], "number": 3}]),
        (both, "findMemory", [1]),
        (both, "nextMemory", [RATE, 1]),
        (both, "nextMemory", [5 * RATE, -1]),
        (both, "apply", [{"type": "set-region", "regionId": region["id"], "number": 1}]),
        (both, "apply", [{"type": "set-marker", "markerId": "old", "comment": "keep", "color": "amber"}]),
    )
    assert renumbered["after"]["regions"][0]["number"] == 3
    assert found["value"]["id"] == "old" and found["value"]["number"] == 1
    assert (after["value"]["kind"], after["value"]["start"]) == ("region", 2 * RATE) and before["value"]["kind"] == "region"
    assert refused["after"]["regions"][0]["number"] == 2
    old = next(m for m in coloured["after"]["markers"] if m["id"] == "old")
    assert (old["comment"], old["color"]) == ("keep", "amber")
    (cleared,) = _edit((coloured["after"], "apply", [{"type": "set-marker", "markerId": "old", "comment": "", "color": ""}]))
    assert "comment" not in next(m for m in cleared["after"]["markers"] if m["id"] == "old")


def test_track_duplicate_move_hide_height_and_comments(media):
    tone = media["tone"]
    fx = [{"kind": "peak", "freq": 1000, "gainDb": 3, "q": 1}]
    doc = _doc(
        [_track("t1", [_clip("a", 0, RATE, mid=tone["id"], groupId="g")], fx=fx, automation={"volume": [{"time": 0, "value": -6}]}), _track("t2", [_clip("b", RATE, RATE, mid=tone["id"])])],
        [tone],
    )
    dup, moved, hidden, tall, noted = _edit(
        (doc, "apply", [{"type": "duplicate-track", "trackId": "t1"}]),
        (doc, "apply", [{"type": "move-track", "trackId": "t2", "to": 0}]),
        (doc, "apply", [{"type": "set-tracks-hidden", "trackIds": ["t2"], "hidden": True}]),
        (doc, "apply", [{"type": "set-track-height", "trackId": "t1", "height": "jumbo"}]),
        (doc, "apply", [{"type": "set-track-comments", "trackId": "t1", "comments": "Lav, take 3"}]),
    )
    tracks = dup["after"]["tracks"]
    assert [t["name"] for t in tracks] == ["t1", "t1 copy", "t2"]
    copy = tracks[1]
    assert copy["id"] != "t1" and copy["fx"] == fx and copy["automation"] == doc["tracks"][0]["automation"]
    assert copy["clips"][0]["id"] != "a" and "groupId" not in copy["clips"][0] and _spans(copy) == _spans(tracks[0])
    assert [t["id"] for t in moved["after"]["tracks"]] == ["t2", "t1"]
    # a hidden track still plays
    assert hidden["after"]["tracks"][1]["hidden"] is True
    assert np.array_equal(_mix(hidden["after"]), _mix(doc))
    assert tall["after"]["tracks"][0]["height"] == "jumbo" and noted["after"]["tracks"][0]["comments"] == "Lav, take 3"
    (medium,) = _edit((tall["after"], "apply", [{"type": "set-track-height", "trackId": "t1", "height": "medium"}]))
    assert "height" not in medium["after"]["tracks"][0]
