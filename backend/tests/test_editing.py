"""PLAN_v13 S4, editing commands: each command's session (frontend/src/engine/editing.ts and the reducer, run in Node as
the interface runs them) checked field by field, and where the sound is the point, the session rendered by the export
before and after and compared sample for sample."""
import json
import math
import shutil
import struct
import subprocess

import numpy as np
import pytest

from app.services import export, render
from conftest import BACKEND, ROOT

FRONTEND = ROOT / "frontend"
RATE = 48000


def _wav(x: np.ndarray, rate: int = RATE) -> bytes:
    data = x.astype("<f4").tobytes()
    fmt = struct.pack("<IHHIIHH", 16, 3, 1, rate, rate * 4, 4, 32)
    return b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + fmt + b"data" + struct.pack("<I", len(data)) + data


def _tone(hz: float, seconds: float, rate: int = RATE, amp: float = 0.25) -> np.ndarray:
    return amp * np.sin(2 * np.pi * hz * np.arange(round(seconds * rate)) / rate)


@pytest.fixture(scope="module")
def media(client) -> dict:
    def store(x: np.ndarray, rate: int = RATE) -> dict:
        return client.post("/api/media", content=_wav(x, rate), headers={"X-Filename": "editing.wav"}).json()

    gap = np.concatenate([_tone(440, 1.0), np.zeros(RATE), _tone(440, 1.0)])
    return {"tone": store(_tone(440, 4.0)), "gap": store(gap), "slow": store(_tone(330, 4.0, 44100), 44100), "short": store(_tone(550, 0.625))}


def _clip(cid: str, ref: dict, start: int, length: int, source_in: int = 0, **more) -> dict:
    return {"id": cid, "mediaId": ref["id"], "start": start, "length": length, "sourceIn": source_in, "gainDb": 0, **more}


def _track(tid: str, clips: list, **more) -> dict:
    return {"id": tid, "name": tid, "channels": 1, "gainDb": 0, "mute": False, "solo": False, "clips": clips, **more}


def _doc(refs: list, tracks: list, **more) -> dict:
    return {"sampleRate": RATE, "media": {r["id"]: r for r in refs}, "markers": [], "tracks": tracks, **more}


def _ramp(a_db: float = -12.0, b_db: float = 0.0, until: int = 2 * RATE) -> dict:
    return {"volume": [{"time": 0, "value": a_db}, {"time": until, "value": b_db}]}


def _edit(*cases: tuple) -> list:
    """Each (doc, fn, args) run by engine/editing.ts in Node, the command it returns applied as the engine dispatches it."""
    node = shutil.which("node")
    if node is None:
        pytest.skip("needs Node on the PATH")
    if not (FRONTEND / "node_modules" / "vite").is_dir():
        pytest.skip("needs the interface's packages: npm ci in frontend")
    done = subprocess.run([node, str(BACKEND / "tests" / "editing.mjs"), str(FRONTEND)], input=json.dumps([{"doc": d, "fn": f, "args": a} for d, f, a in cases]), capture_output=True, text=True, timeout=300)
    assert done.returncode == 0, done.stderr[-2000:]
    return json.loads(done.stdout)


def _mix(doc: dict) -> np.ndarray:
    return export.frames_of(render.render(doc)["wav"])[0][:, 0].astype(np.float64)


def _spans(track: dict) -> list:
    return [(c["start"], c["length"], c["sourceIn"]) for c in track["clips"]]


def _lane_db(points: list, t: float, gain: bool = True) -> float:
    """A lane's value at t as the core reads it (linear in gain for volume), the first and last values held."""
    if t <= points[0]["time"]:
        return points[0]["value"]
    for a, b in zip(points, points[1:]):
        if t <= b["time"]:
            x = (t - a["time"]) / (b["time"] - a["time"]) if b["time"] > a["time"] else 1.0
            if not gain:
                return a["value"] + (b["value"] - a["value"]) * x
            g = 10 ** (a["value"] / 20) + (10 ** (b["value"] / 20) - 10 ** (a["value"] / 20)) * x
            return 20 * math.log10(max(g, 1e-6))
    return points[-1]["value"]


def test_duplicate_puts_a_copy_after_the_clips_over_what_lies_there_with_their_automation(media):
    tone = media["tone"]
    doc = _doc([tone], [_track("t1", [_clip("a", tone, 0, RATE), _clip("b", tone, RATE, RATE, RATE)], automation=_ramp())])
    (dup,) = _edit((doc, "repeatSpan", [{"range": None, "clipIds": ["a"]}, 1, False]))
    assert dup["value"]["label"] == "Duplicated clips"
    after = dup["after"]["tracks"][0]
    assert _spans(after) == [(0, RATE, 0), (RATE, RATE, 0)]
    before_lane, after_lane = doc["tracks"][0]["automation"]["volume"], after["automation"]["volume"]
    # the copy's automation is the source's (set-automation keeps 0.01 dB), and outside the copy it plays as it did
    assert max(abs(_lane_db(after_lane, t + RATE) - _lane_db(before_lane, t)) for t in range(0, RATE, 997)) < 0.006
    assert max(abs(_lane_db(after_lane, t) - _lane_db(before_lane, t)) for t in [*range(0, RATE, 997), *range(2 * RATE, 3 * RATE, 997)]) < 0.006
    # without automation the copy plays the same samples as the source, one second later
    flat = _doc([tone], [_track("t1", [_clip("a", tone, 0, RATE), _clip("b", tone, RATE, RATE, RATE)])])
    (plain,) = _edit((flat, "repeatSpan", [{"range": None, "clipIds": ["a"]}, 1, False]))
    mixed = _mix(plain["after"])
    assert np.array_equal(mixed[RATE : 2 * RATE], mixed[:RATE])


def test_repeat_with_shuffle_opens_time_for_its_copies_and_moves_what_follows(media):
    tone = media["tone"]
    doc = _doc([tone], [_track("t1", [_clip("a", tone, 0, RATE // 2), _clip("b", tone, RATE, RATE, RATE)])])
    (rep,) = _edit((doc, "repeatSpan", [{"range": None, "clipIds": ["a"]}, 3, True]))
    assert rep["value"]["label"] == "Repeated clips 3 times"
    assert _spans(rep["after"]["tracks"][0]) == [(0, 24000, 0), (24000, 24000, 0), (48000, 24000, 0), (72000, 24000, 0), (RATE + 72000, RATE, RATE)]
    # a range repeats the audio inside it, cut at its edges as a split cuts
    (rng,) = _edit((doc, "repeatSpan", [{"range": {"trackId": "t1", "start": 12000, "end": 36000}, "clipIds": []}, 2, False]))
    assert rng["value"]["label"] == "Repeated a range 2 times"
    assert _spans(rng["after"]["tracks"][0]) == [(0, 24000, 0), (36000, 12000, 12000), (60000, 12000, 12000), (84000, 12000, 84000)]


def test_shift_moves_the_selected_clips_and_stops_them_at_the_session_start(media):
    tone = media["tone"]
    doc = _doc([tone], [_track("t1", [_clip("a", tone, RATE, RATE), _clip("b", tone, 3 * RATE, RATE)])])
    later, earlier, alone = _edit((doc, "shiftClips", [["a", "b"], 24000]), (doc, "shiftClips", [["a", "b"], -10 * RATE]), (doc, "shiftClips", [["b"], -10 * RATE]))
    assert [c["start"] for c in later["after"]["tracks"][0]["clips"]] == [RATE + 24000, 3 * RATE + 24000]
    assert [c["start"] for c in earlier["after"]["tracks"][0]["clips"]] == [0, 2 * RATE]
    assert earlier["value"]["label"] == "Shifted clips earlier"
    assert [c["start"] for c in alone["after"]["tracks"][0]["clips"]] == [RATE, 0]


def test_insert_silence_opens_the_ranges_length_on_its_track_and_its_automation_moves_with_it(media):
    tone = media["tone"]
    doc = _doc([tone], [_track("t1", [_clip("a", tone, 0, 2 * RATE)], automation=_ramp()), _track("t2", [_clip("b", tone, 0, 2 * RATE)], mute=True)])
    (ins,) = _edit((doc, "insertSilence", [{"range": {"trackId": "t1", "start": RATE // 2, "end": RATE}, "clipIds": []}]))
    t1, t2 = ins["after"]["tracks"]
    assert ins["value"]["label"] == "Inserted silence"
    assert _spans(t1) == [(0, 24000, 0), (RATE, 72000, 24000)] and _spans(t2) == [(0, 2 * RATE, 0)]
    assert t2.get("automation") is None
    # the automation ramp crossing the insert keeps its value either side of the opening: what follows plays as it did
    before, after = _mix(doc), _mix(ins["after"])
    assert np.max(np.abs(after[:24000] - before[:24000])) < 1e-6
    assert np.max(np.abs(after[24000:RATE])) == 0
    assert np.max(np.abs(after[RATE : RATE + 72000] - before[24000:96000])) < 1e-5


def test_insert_and_cut_time_move_markers_regions_the_loop_and_automation_on_every_track(media):
    tone = media["tone"]
    doc = _doc(
        [tone],
        [_track("t1", [_clip("a", tone, 0, 2 * RATE)], automation=_ramp()), _track("t2", [_clip("b", tone, 3 * RATE // 2, RATE // 2)], mute=True)],
        markers=[{"id": "m1", "at": 72000, "label": "free"}, {"id": "m2", "at": 84000, "label": "on b", "clipId": "b"}, {"id": "m3", "at": 30000, "label": "inside"}],
        regions=[{"id": "r1", "start": RATE, "end": 2 * RATE, "label": "R"}],
        loop={"start": 24000, "end": 72000, "enabled": True},
    )
    ins, cut = _edit((doc, "timeOperation", ["insert", RATE, RATE + 12000]), (doc, "timeOperation", ["cut", 12000, 36000]))
    a = ins["after"]
    assert ins["value"]["label"] == "Inserted time across the session"
    assert {m["id"]: m["at"] for m in a["markers"]} == {"m1": 84000, "m2": 96000, "m3": 30000}
    assert a["regions"] == [{"id": "r1", "start": RATE + 12000, "end": 2 * RATE + 12000, "label": "R"}]
    assert a["loop"] == {"start": 24000, "end": 84000, "enabled": True}
    assert [c["start"] for c in a["tracks"][1]["clips"]] == [3 * RATE // 2 + 12000]
    c = cut["after"]
    assert cut["value"]["label"] == "Cut time across the session"
    assert {m["id"]: m["at"] for m in c["markers"]} == {"m1": 48000, "m2": 60000}
    assert c["regions"] == [{"id": "r1", "start": RATE - 24000, "end": 2 * RATE - 24000, "label": "R"}]
    assert c["loop"] == {"start": 12000, "end": 48000, "enabled": True}
    # the cut session is the old one with the cut taken out, sample for sample, the automation ramp included
    before, after = _mix(doc), _mix(c)
    assert np.max(np.abs(after[:12000] - before[:12000])) < 1e-6
    assert np.max(np.abs(after[12000:72000] - before[36000:96000])) < 1e-5


def test_delete_with_shuffle_closes_the_automation_with_the_audio(media):
    tone = media["tone"]
    doc = _doc([tone], [_track("t1", [_clip("a", tone, 0, 2 * RATE)], automation=_ramp())])
    cut = {"type": "clear-range", "trackId": "t1", "start": 24000, "end": 48000, "ripple": True, "follow": "tracks"}
    loose = {**cut, "follow": None}
    (follows, stays) = _edit((doc, "apply", [cut]), (doc, "apply", [{k: v for k, v in loose.items() if v is not None}]))
    assert np.max(np.abs(_mix(follows["after"])[24000:72000] - _mix(doc)[48000:96000])) < 1e-5
    assert stays["after"]["tracks"][0]["automation"] == doc["tracks"][0]["automation"]


def test_the_trims_keep_a_range_reach_the_playhead_open_to_the_file_and_fill_the_selection(media):
    tone, slow = media["tone"], media["slow"]
    doc = _doc([tone, slow], [_track("t1", [_clip("a", tone, 0, 2 * RATE), _clip("b", tone, 3 * RATE, RATE, RATE)]), _track("t2", [_clip("s", slow, RATE, RATE, 44100)])])
    to_range, start, end, to_file, file_edge, fill, slow_file = _edit(
        (doc, "trimToRange", [{"trackId": "t1", "start": 24000, "end": 72000}]),
        (doc, "trimToPlayhead", [{"range": None, "clipIds": ["a"]}, 24000, "start"]),
        (doc, "trimToPlayhead", [{"range": None, "clipIds": ["a"]}, 72000, "end"]),
        (doc, "trimToFile", [["b"]]),
        (_doc([tone], [_track("t1", [_clip("e", tone, 0, RATE, RATE)])]), "trimToFile", [["e"]]),
        (doc, "trimToFill", [{"trackId": "t1", "start": 2 * RATE + 24000, "end": 7 * RATE}]),
        (doc, "trimToFile", [["s"]]),
    )
    assert _spans(to_range["after"]["tracks"][0]) == [(24000, 48000, 24000), (3 * RATE, RATE, RATE)]
    assert _spans(start["after"]["tracks"][0])[0] == (24000, 72000, 24000) and start["value"]["label"] == "Trimmed a start to the playhead"
    assert _spans(end["after"]["tracks"][0])[0] == (0, 72000, 0)
    assert _spans(to_file["after"]["tracks"][0])[1] == (2 * RATE, 4 * RATE, 0)
    assert _spans(file_edge["after"]["tracks"][0]) == [(0, 3 * RATE, RATE)]
    assert _spans(fill["after"]["tracks"][0])[1] == (2 * RATE + 24000, 4 * RATE - 24000, 24000)
    # a 44.1 kHz file in a 48 kHz session: its whole length, counted as set-clip-bounds counts it, so the trim lands
    assert _spans(slow_file["after"]["tracks"][1]) == [(0, 4 * RATE, 0)]


def test_heal_joins_what_a_split_made_and_leaves_a_join_with_a_fade(media):
    tone, slow = media["tone"], media["slow"]
    doc = _doc([tone, slow], [_track("t1", [_clip("a", tone, 0, 2 * RATE)]), _track("t2", [_clip("s", slow, 0, 2 * RATE, 4410)])])
    split = {"type": "batch", "commands": [{"type": "split-clip", "trackId": "t1", "clipId": "a", "at": 30000}, {"type": "split-clip", "trackId": "t2", "clipId": "s", "at": 70001}, {"type": "split-clip", "trackId": "t2", "clipId": "s", "at": 33333}]}
    (cut,) = _edit((doc, "apply", [split]))
    pieces = cut["after"]
    assert [len(t["clips"]) for t in pieces["tracks"]] == [2, 3]
    ids = [c["id"] for t in pieces["tracks"] for c in t["clips"]]
    faded = json.loads(json.dumps(pieces))
    faded["tracks"][0]["clips"][0]["fadeOut"] = 2400
    healed, by_range, refused = _edit(
        (pieces, "healSeparations", [{"range": None, "clipIds": ids}, 0]),
        (pieces, "healSeparations", [{"range": {"trackId": "t2", "start": 0, "end": 2 * RATE}, "clipIds": []}, 0]),
        (faded, "healSeparations", [{"range": None, "clipIds": ids[:2]}, 0]),
    )
    assert healed["value"]["label"] == "Healed a separation"
    assert _spans(healed["after"]["tracks"][0]) == [(0, 2 * RATE, 0)] and _spans(healed["after"]["tracks"][1]) == [(0, 2 * RATE, 4410)]
    assert _spans(by_range["after"]["tracks"][1]) == [(0, 2 * RATE, 4410)] and len(by_range["after"]["tracks"][0]["clips"]) == 2
    assert refused["value"] is None
    assert np.array_equal(_mix(healed["after"]), _mix(doc))


def test_separate_on_the_grid_cuts_at_each_line_inside_the_range(media):
    tone = media["tone"]
    doc = _doc([tone], [_track("t1", [_clip("a", tone, 0, 2 * RATE)])])
    lines, fine, many, clips = _edit(
        (doc, "separateOnGrid", [{"range": {"trackId": "t1", "start": 24000, "end": 72000}, "clipIds": []}, 24000]),
        (doc, "separateOnGrid", [{"range": None, "clipIds": ["a"]}, 0.5]),
        (doc, "separateOnGrid", [{"range": None, "clipIds": ["a"]}, 40]),
        (doc, "separateOnGrid", [{"range": None, "clipIds": ["a"]}, RATE * 0.75]),
    )
    assert [c["start"] for c in lines["after"]["tracks"][0]["clips"]] == [0, 24000, 48000, 72000]
    assert fine["value"] is None and many["value"] is None
    assert [c["start"] for c in clips["after"]["tracks"][0]["clips"]] == [0, 36000, 72000]


def test_strip_silence_removes_what_lies_below_the_threshold_and_keeps_the_pads(client, media):
    gap = media["gap"]
    doc = _doc([gap], [_track("t1", [_clip("g", gap, 0, 3 * RATE)])])
    reply = client.post("/api/render/activity", params={"trackId": "t1", "threshold": -48, "gap": 0.3}, json=doc)
    assert reply.status_code == 200, reply.text
    (gaps,) = _edit((None, "stripGaps", [reply.json()["regions"], RATE, 0, 3 * RATE, 0.005, 0.02]))
    assert gaps["value"] == [{"start": 48960, "end": 95760}]
    (stripped,) = _edit((doc, "apply", [{"type": "batch", "label": "Stripped silence", "commands": [{"type": "clear-ranges", "trackIds": ["t1"], "ranges": gaps["value"], "ripple": False}]}]))
    assert _spans(stripped["after"]["tracks"][0]) == [(0, 48960, 0), (95760, 48240, 95760)]
    before, after = _mix(doc), _mix(stripped["after"])
    assert np.max(np.abs(after[48960:95760])) == 0
    assert np.array_equal(after[:48960], before[:48960]) and np.array_equal(after[95760:], before[95760:])
    (merged,) = _edit((None, "stripGaps", [[[0.5, 1.0], [1.01, 1.5]], RATE, 0, 2 * RATE, 0.005, 0.02]))
    assert merged["value"] == [{"start": 0, "end": 23760}, {"start": 72960, "end": 2 * RATE}]


def test_identify_beat_tab_stops_and_transients_in_session_samples(media):
    tone, slow = media["tone"], media["slow"]
    doc = _doc([tone, slow], [_track("t1", [_clip("a", tone, RATE, RATE)]), _track("t2", [_clip("s", slow, 2 * RATE, RATE, 22050)])])
    beat, slower, triple, nxt, prev, mine, extra, marks = _edit(
        (None, "identifyBeat", [2 * RATE, RATE, 1, 4]),
        (None, "identifyBeat", [4 * RATE, RATE, 1, 4]),
        (None, "identifyBeat", [2 * RATE, RATE, 2, 3]),
        (doc, "nextStop", [None, RATE + 10, 1]),
        (doc, "nextStop", [None, 2 * RATE + 10, -1]),
        (doc, "nextStop", [["t1"], 2 * RATE, 1]),
        (doc, "nextStop", [["t2"], 2 * RATE, 1, [2 * RATE + 4800]]),
        (doc, "clipTransients", [doc["tracks"][1]["clips"][0], [0.5, 1.0, 1.25], 44100]),
    )
    assert (beat["value"], slower["value"], triple["value"]) == (120, 60, 180)
    assert (nxt["value"], prev["value"], mine["value"], extra["value"]) == (2 * RATE, 2 * RATE, None, 2 * RATE + 4800)
    assert marks["value"] == [2 * RATE + 24000, 2 * RATE + 36000]


def test_fit_to_range_swaps_in_the_render_and_sets_the_clip_on_the_range(media):
    tone, short = media["tone"], media["short"]
    doc = _doc([tone], [_track("t1", [_clip("a", tone, 0, RATE // 2)])])
    (fit,) = _edit((doc, "fitToRange", ["t1", "a", short, RATE, 30000]))
    assert fit["value"]["label"] == "Fitted a clip to the selection"
    clip = fit["after"]["tracks"][0]["clips"][0]
    assert (clip["mediaId"], clip["start"], clip["length"], clip["sourceIn"]) == (short["id"], RATE, 30000, 0)
    assert short["id"] in fit["after"]["media"]
