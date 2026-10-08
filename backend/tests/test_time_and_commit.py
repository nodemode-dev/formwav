"""PLAN_v13 S6, time formats and counters: the fifteen frame rates and SMPTE timecode (drop-frame judged against labels
counted one at a time from the rule itself), Feet+Frames, Bars|Beats, Min:Secs and Samples written and read back, the
session's frame rate; Make Inactive, Consolidate and Commit, rendered by the export where the sound is the point."""
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


def _run(*cases: tuple) -> list:
    """Each (doc, fn, args) run by engine/editing.ts, engine/grid.ts or engine/timebase.ts in Node, a command it returns
    applied as the engine dispatches it (fn "apply" applies args[0]; a null doc calls fn(...args))."""
    node = shutil.which("node")
    if node is None:
        pytest.skip("needs Node on the PATH")
    if not (FRONTEND / "node_modules" / "vite").is_dir():
        pytest.skip("needs the interface's packages: npm ci in frontend")
    done = subprocess.run([node, str(BACKEND / "tests" / "editing.mjs"), str(FRONTEND)], input=json.dumps([{"doc": d, "fn": f, "args": a} for d, f, a in cases]), capture_output=True, text=True, timeout=300)
    assert done.returncode == 0, done.stderr[-2000:]
    return json.loads(done.stdout)


def _values(*calls: tuple) -> list:
    return [r["value"] for r in _run(*[(None, fn, list(args)) for fn, *args in calls])]


def _rates(*ids: str) -> dict:
    return dict(zip(ids, _values(*[("frameRate", i) for i in ids])))


def _drop_labels(fps: int, count: int) -> list[str]:
    """The first `count` drop-frame labels, walked one at a time: a minute that is not a multiple of ten starts without
    its first two labels at 29.97 (four at 59.94)."""
    drop = 2 if fps == 30 else 4
    labels: list[str] = []
    h = m = s = f = 0
    while len(labels) < count:
        if not (m % 10 and s == 0 and f < drop):
            labels.append(f"{h:02d}:{m:02d}:{s:02d};{f:02d}")
        f += 1
        if f == fps:
            f, s = 0, s + 1
        if s == 60:
            s, m = 0, m + 1
        if m == 60:
            m, h = 0, h + 1
    return labels


def test_drop_frame_labels_match_the_rule_counted_label_by_label_and_read_back():
    r = _rates("29.97df", "59.94df", "25", "24")
    df, df60 = r["29.97df"], r["59.94df"]
    labels = _values(*[("timecodeFromFrames", f, df) for f in (1800, 1799, 17982)])
    assert [_values(("formatTimecode", tc, df))[0] for tc in labels] == ["00:01:00;02", "00:00:59;29", "00:10:00;00"]
    frames = [0, 1, 1799, 1800, 1801, 3597, 3598, 17981, 17982, 17983, 35964, 107891, 107892, 500000]
    back = _values(*[("timecodeToFrames", tc, df) for tc in _values(*[("timecodeFromFrames", f, df) for f in frames])])
    assert back == frames
    # every 7th frame across 40 minutes, at both drop rates, against the labels walked one at a time
    for rate, fps, step in ((df, 30, 7), (df60, 60, 13)):
        sample = list(range(0, 40 * 60 * fps, step)) + [107892, 500000, 1_000_003]
        walked = _drop_labels(fps, max(sample) + 1)
        texts = _values(*[("formatTimecode", tc, rate) for tc in _values(*[("timecodeFromFrames", f, rate) for f in sample])])
        assert texts == [walked[f] for f in sample]
        assert _values(*[("timecodeToFrames", tc, rate) for tc in _values(*[("timecodeFromFrames", f, rate) for f in sample])]) == sample
    # non-drop: 2 h 3 min 4 s and 7 frames at 25 fps reads 02:03:04:07 and goes back to the same sample
    at = RATE * 7384 + 7 * RATE // 25
    (tc,) = _values(("timecodeFromFrames", _values(("framesAt", at, r["25"], RATE))[0], r["25"]))
    assert _values(("formatTimecode", tc, r["25"]), ("samplesAtFrame", _values(("timecodeToFrames", tc, r["25"]))[0], r["25"], RATE)) == ["02:03:04:07", at]
    # 35 mm, sixteen frames to the foot: two and a half seconds at 24 fps are three feet and twelve frames
    assert _values(("feetFrames", RATE * 5 // 2, r["24"], RATE)) == [[3, 12]]
    parsed = _values(("parseTimecode", "01:02:03:04"), ("parseTimecode", "3:04"), ("parseTimecode", "a:b"), ("parseTimecode", "1:2:3:4:5"))
    assert [(p["hours"], p["minutes"], p["seconds"], p["frames"]) for p in parsed[:2]] == [(1, 2, 3, 4), (0, 0, 3, 4)] and parsed[2:] == [None, None]


def test_the_fifteen_rates_count_real_frames():
    ids = ["23.976", "24", "25", "29.97", "29.97df", "30", "47.952", "48", "50", "59.94", "59.94df", "60", "100", "119.88", "120"]
    r = _rates(*ids)
    assert [r[i]["id"] for i in ids] == ids
    # the frames in ten minutes of samples: 23.976 counts 14385 (24000/1001 a second), 29.97 drop-frame 17982
    counts = _values(*[("framesAt", RATE * 600, r[i], RATE) for i in ids])
    assert counts == [14385, 14400, 15000, 17982, 17982, 18000, 28771, 28800, 30000, 35964, 35964, 36000, 60000, 71928, 72000]


def _ctx(rate: dict, bpm: float = 120, beats: int = 4, start: float = 0) -> dict:
    return {"sampleRate": RATE, "bpm": bpm, "beatsPerBar": beats, "rate": rate, "startSeconds": start}


def test_positions_read_as_pro_tools_counters_and_back_in_every_timebase():
    r = _rates("30", "29.97df", "24")
    ctx = _ctx(r["30"])
    assert _values(
        ("formatPosition", 0, "min_secs", ctx),
        ("formatPosition", RATE * 75 + 24000, "min_secs", ctx),
        ("formatPosition", 0, "bars_beats", ctx),
        ("formatPosition", RATE, "timecode", ctx),
        ("formatPosition", 12345, "samples", ctx),
        ("formatLength", 0, 96000 + 24000, "bars_beats", ctx),
        ("formatPosition", 3 * RATE, "bars_beats", ctx),
        ("formatPosition", 3 * RATE, "feet_frames", _ctx(r["24"])),
    ) == ["0:00.000", "1:15.500", "1| 1| 000", "00:00:01:00", "12345", "1| 1| 000", "2| 3| 000", "4+08"]
    formats = ["bars_beats", "min_secs", "timecode", "feet_frames", "samples"]
    positions = [0, 48000, 96000 * 3, 1_440_000]
    texts = _values(*[("formatPosition", s, f, ctx) for f in formats for s in positions])
    back = _values(*[("parsePosition", t, f, ctx) for t, (f, _) in zip(texts, [(f, s) for f in formats for s in positions])])
    assert all(abs(b - s) <= 48 for b, s in zip(back, [s for _ in formats for s in positions])), list(zip(texts, back))
    assert _values(("parsePosition", "abc", "samples", ctx), ("parsePosition", "1:x", "min_secs", ctx), ("parsePosition", "", "bars_beats", ctx), ("parsePosition", "00:01:15.500", "min_secs", ctx)) == [None, None, None, RATE * 75 + 24000]
    # a session starting at 01:00:00;00 at 29.97 drop-frame reads its first sample so and types back to it
    start = 107892 * 1001 / 30000
    dctx = _ctx(r["29.97df"], start=start)
    assert _values(("formatPosition", 0, "timecode", dctx), ("parsePosition", "01:00:00;00", "timecode", dctx), ("formatPosition", 1800 * 1001 * RATE // 30000 + 1, "timecode", dctx)) == ["01:00:00;00", 0, "01:01:00;02"]


def _doc(tracks: list, media: list, **more) -> dict:
    return {"sampleRate": RATE, "media": {m["id"]: m for m in media}, "markers": [], "tracks": tracks, **more}


def _clip(cid: str, mid: str, start: int, length: int, source_in: int = 0, **more) -> dict:
    return {"id": cid, "mediaId": mid, "start": start, "length": length, "sourceIn": source_in, "gainDb": 0, **more}


def _track(tid: str, clips: list, channels: int = 1, **more) -> dict:
    return {"id": tid, "name": tid, "channels": channels, "gainDb": 0, "mute": False, "solo": False, "clips": clips, **more}


def test_the_session_keeps_its_frame_rate_and_a_frame_of_grid_follows_it():
    doc = _doc([], [])
    set25, cleared, wrong = _run((doc, "apply", [{"type": "set-frame-rate", "rate": "25"}]), (doc, "apply", [{"type": "set-frame-rate", "rate": None}]), (doc, "apply", [{"type": "set-frame-rate", "rate": "26"}]))
    assert set25["after"]["frameRate"] == "25" and "frameRate" not in cleared["after"] and "frameRate" not in wrong["after"]
    (back,) = _run((set25["after"], "apply", [{"type": "set-frame-rate", "rate": None}]))
    assert "frameRate" not in back["after"]
    ctx, step = _values(("timeContext", set25["after"]), ("gridStepOf", set25["after"], {"kind": "frames", "frames": 1}, 25))
    assert (ctx["rate"]["num"], ctx["rate"]["den"], step) == (25, 1, 1920)


def _wav(x: np.ndarray) -> bytes:
    x = np.atleast_2d(x.T).T if x.ndim == 1 else x
    data = x.astype("<f4").tobytes()
    channels = x.shape[1]
    fmt = struct.pack("<IHHIIHH", 16, 3, channels, RATE, RATE * 4 * channels, 4 * channels, 32)
    return b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVE" + b"fmt " + fmt + b"data" + struct.pack("<I", len(data)) + data


@pytest.fixture(scope="module")
def tones(client) -> dict:
    def store(x: np.ndarray, name: str) -> dict:
        res = client.post("/api/media", content=_wav(x), headers={"X-Filename": name})
        assert res.status_code == 201, res.text
        return res.json()

    t = np.arange(8 * RATE) / RATE
    a = 0.3 * np.sin(2 * np.pi * 220 * t) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.9 * t))
    b = 0.25 * np.sin(2 * np.pi * 660 * t + 0.4)
    stereo = np.stack([0.3 * np.sin(2 * np.pi * 330 * t), 0.2 * np.sin(2 * np.pi * 440 * t)], axis=1)
    return {"a": store(a, "a.wav"), "b": store(b, "b.wav"), "st": store(stereo, "st.wav")}


def _mix(doc: dict, start: int = 0, stop: int | None = None) -> np.ndarray:
    return export.frames_of(render.render(doc, start, stop)["wav"])[0].astype(np.float64)


def test_an_inactive_track_neither_plays_nor_exports_and_its_solo_silences_nothing(tones):
    a, b = tones["a"], tones["b"]
    alone = _doc([_track("A", [_clip("x", a["id"], 0, 2 * RATE)])], [a, b])
    both = _doc([_track("A", [_clip("x", a["id"], 0, 2 * RATE)]), _track("B", [_clip("y", b["id"], 0, 2 * RATE)], inactive=True, solo=True)], [a, b])
    assert np.array_equal(_mix(both, 0, 2 * RATE), _mix(alone, 0, 2 * RATE))
    assert len(render.plan(both)[2]) == 1
    (on,) = _run((both, "apply", [{"type": "set-tracks-inactive", "trackIds": ["B"], "inactive": False}]))
    assert "inactive" not in on["after"]["tracks"][1]
    assert np.max(np.abs(_mix(on["after"], 0, 2 * RATE)[:, 0])) > 0.2 and np.max(np.abs(_mix(on["after"], 0, 2 * RATE) - _mix(alone, 0, 2 * RATE))) > 0.05


def test_consolidate_renders_the_clips_in_a_range_into_one_that_plays_as_they_did(client, tones):
    a, st = tones["a"], tones["st"]
    clips = [
        _clip("c1", a["id"], 0, RATE, fadeIn=2400, fadeShape="logarithmic"),
        _clip("c2", a["id"], RATE + 12000, RATE, 2 * RATE, gainDb=-6, fadeOut=4800, fadeOutShape="s-curve", fx=[{"kind": "highpass", "freq": 400, "gainDb": 0, "q": 0.707}]),
        _clip("c3", a["id"], 3 * RATE, RATE, 4 * RATE, envelope=[{"at": 4 * RATE, "db": 0}, {"at": 5 * RATE, "db": -12}]),
    ]
    track_fx = [{"kind": "lowpass", "freq": 3000, "gainDb": 0, "q": 0.707}, {"kind": "compressor", "thresholdDb": -24, "ratio": 4, "attackMs": 5, "releaseMs": 80, "makeupDb": 3}]
    doc = _doc([_track("A", clips, gainDb=-3, pan=0.3, fx=track_fx), _track("S", [_clip("s1", st["id"], RATE // 2, 2 * RATE)], channels=2)], [a, st])
    start, end = RATE // 2, 3 * RATE + RATE // 2
    res = client.post(f"/api/render/bounce?trackId=A&mode=clips&start={start}&end={end}", json=doc)
    assert res.status_code == 201, res.text
    media = res.json()
    assert (media["channels"], media["frames"], media["sampleRate"]) == (1, end - start, RATE)
    (done,) = _run((doc, "consolidate", ["A", start, end, media]))
    assert done["value"]["label"] == "Consolidated clips" and done["value"]["whole"] is True
    track = done["after"]["tracks"][0]
    assert [(c["start"], c["length"], c["mediaId"] == media["id"]) for c in track["clips"]] == [(0, start, False), (start, end - start, True), (end, 4 * RATE - end, False)]
    before, after = _mix(doc), _mix(done["after"])
    assert before.shape == after.shape and np.max(np.abs(before - after)) < 1e-6
    # a stereo track consolidates to stereo
    res = client.post(f"/api/render/bounce?trackId=S&mode=clips&start=0&end={3 * RATE}", json=doc)
    assert res.status_code == 201 and res.json()["channels"] == 2
    assert client.post("/api/render/bounce?trackId=A&mode=clips&start=10&end=5", json=doc).status_code == 422


def test_commit_renders_the_track_onto_a_new_one_and_the_mix_nulls(client, tones):
    a, b = tones["a"], tones["b"]
    automation = {"volume": [{"time": 0, "value": -12}, {"time": 3 * RATE, "value": 0}], "pan": [{"time": 0, "value": -0.5}, {"time": 3 * RATE, "value": 0.5}]}
    fx = [{"kind": "highpass", "freq": 150, "gainDb": 0, "q": 0.707}, {"kind": "compressor", "thresholdDb": -20, "ratio": 3, "attackMs": 8, "releaseMs": 120, "makeupDb": 2}, {"kind": "echo", "delayMs": 180, "feedback": 0.3, "mix": 0.3}]
    lane = _track("A", [_clip("x", a["id"], 0, 3 * RATE, fadeIn=4800, fadeOut=9600)], gainDb=-4, pan=-0.4, trimDb=2, invert=True, fx=fx, automation=automation, color="amber")
    routed = _track("C", [_clip("z", b["id"], RATE, 2 * RATE)], fx=[{"kind": "peak", "freq": 1200, "gainDb": 5, "q": 1}], busId="X", sends=[{"busId": "Y", "gainDb": -6}])
    buses = [{"id": "X", "name": "X", "gainDb": -3, "pan": 0.2, "fx": [{"kind": "lowpass", "freq": 5000, "gainDb": 0, "q": 0.707}]}, {"id": "Y", "name": "Y", "gainDb": 0, "pan": 0, "fx": [{"kind": "reverb", "room": 0.5, "damping": 0.4, "mix": 1, "width": 1}]}]
    doc = _doc([lane, _track("B", [_clip("y", b["id"], 0, 2 * RATE)]), routed], [a, b], buses=buses, masterGainDb=-2, masterFx=[{"kind": "lowshelf", "freq": 200, "gainDb": -3, "q": 0.707}])
    after = doc
    for tid, end in (("A", 3 * RATE), ("C", 3 * RATE)):
        res = client.post(f"/api/render/bounce?trackId={tid}&mode=track", json=after)
        assert res.status_code == 201, res.text
        media = res.json()
        assert media["channels"] == 2 and end <= media["frames"] <= end + 10 * RATE
        (done,) = _run((after, "apply", [{"type": "commit-track", "trackId": tid, "media": media, "length": media["frames"]}]))
        after = done["after"]
    names = [(t["name"], bool(t.get("inactive")), bool(t.get("hidden"))) for t in after["tracks"]]
    assert names == [("A", True, True), ("A.cm", False, False), ("B", False, False), ("C", True, True), ("C.cm", False, False)]
    committed = after["tracks"][1]
    assert (committed["channels"], committed["gainDb"], committed.get("color"), committed.get("fx"), committed.get("automation")) == (2, 0, "amber", None, None)
    assert (after["tracks"][4]["busId"], after["tracks"][4]["sends"]) == ("X", [{"busId": "Y", "gainDb": -6}])
    span = 6 * RATE
    plain = lambda d: {**d, "masterFx": []}
    before_mix, after_mix = _mix(plain(doc), 0, span), _mix(plain(after), 0, span)
    # the committed tracks play what the originals did, to the rounding of the order the mix sums them in; a low shelf
    # on the master, in 32-bit float, makes that rounding about a hundred times larger, still near -99 dBFS
    assert np.max(np.abs(before_mix)) > 0.05 and np.max(np.abs(before_mix - after_mix)) < 1e-6
    assert np.max(np.abs(_mix(doc, 0, span) - _mix(after, 0, span))) < 3e-5
    placed = _doc([_track("P", [_clip("p", a["id"], 0, RATE)], surround={"x": 0.5, "y": 0.5})], [a])
    assert client.post("/api/render/bounce?trackId=P&mode=track", json=placed).status_code == 422
