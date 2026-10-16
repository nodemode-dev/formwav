"""PLAN_v13 S9, automation depth, heard in the export: a mute lane, a trim lane over the volume, a VCA lane and its
coalescing into the members, a send lane, a master lane after the master effects, and Off leaving the lanes unplayed."""
import json
import shutil
import struct
import subprocess

import numpy as np
import pytest

from app.services import render
from conftest import BACKEND, ROOT

RATE = 48000
RAMP = [{"time": 0, "value": 0}, {"time": RATE, "value": -12}]


def _wav(x: np.ndarray) -> bytes:
    data = x.astype("<f4").tobytes()
    fmt = struct.pack("<IHHIIHH", 16, 3, 1, RATE, RATE * 4, 4, 32)
    return b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + fmt + b"data" + struct.pack("<I", len(data)) + data


@pytest.fixture(scope="module")
def ref(client):
    return client.post("/api/media", content=_wav(np.full(3 * RATE, 0.5)), headers={"X-Filename": "level.wav"}).json()


def _track(tid: str, ref: dict, **more) -> dict:
    return {"id": tid, "name": tid, "gainDb": 0, "pan": 0, "mute": False, "solo": False, "clips": [{"id": f"c{tid}", "mediaId": ref["id"], "start": 0, "sourceIn": 0, "length": ref["frames"], "gainDb": 0}], **more}


def _doc(ref: dict, tracks: list, **more) -> dict:
    return {"version": 1, "sampleRate": RATE, "media": {ref["id"]: ref}, "markers": [], "tracks": tracks, **more}


def _mix(doc: dict) -> np.ndarray:
    return np.frombuffer(render.render(doc)["wav"][44:], "<f4").reshape(-1, 2)[:, 0].astype(np.float64)


def _db(x: float) -> float:
    return 20 * np.log10(abs(x))


def test_a_mute_lane_silences_its_span_and_leaves_the_rest_as_it_was(ref):
    plain = _mix(_doc(ref, [_track("t1", ref)]))
    muted = _mix(_doc(ref, [_track("t1", ref, automation={"mute": [{"time": 0, "value": 0}, {"time": RATE, "value": 1}, {"time": 2 * RATE, "value": 0}]})]))
    assert np.max(np.abs(muted[RATE : 2 * RATE])) < 1e-7
    assert np.array_equal(muted[: RATE - 1], plain[: RATE - 1]) and np.array_equal(muted[2 * RATE :], plain[2 * RATE :])


def test_a_trim_lane_adds_to_the_volume_and_off_plays_neither(ref):
    base = _mix(_doc(ref, [_track("t1", ref)]))[RATE]
    trimmed = _mix(_doc(ref, [_track("t1", ref, automation={"volume": [{"time": 0, "value": -6}], "trim": [{"time": 0, "value": 3}]})]))[RATE]
    assert abs(_db(trimmed / base) + 3) < 1e-3
    off = _mix(_doc(ref, [_track("t1", ref, gainDb=-1, autoOff=True, automation={"volume": [{"time": 0, "value": -6}], "trim": [{"time": 0, "value": 3}]})]))[RATE]
    assert abs(_db(off / base) + 1) < 1e-3


def test_a_vca_lane_moves_its_members_and_a_master_lane_comes_after_the_master_effects(ref):
    base = _mix(_doc(ref, [_track("t1", ref)]))
    vca = _mix(_doc(ref, [_track("t1", ref, vcaId="v1", gainDb=-2)], vcas=[{"id": "v1", "name": "v", "gainDb": 5, "automation": RAMP}]))
    assert abs(_db(vca[0] / base[0]) + 2) < 1e-3 and abs(_db(vca[RATE] / base[RATE]) + 14) < 1e-3 and abs(_db(vca[2 * RATE] / base[2 * RATE]) + 14) < 1e-3
    master = _mix(_doc(ref, [_track("t1", ref)], masterGainDb=-30, masterAutomation=RAMP, masterFx=[{"kind": "processor", "id": "gain", "values": {"gain": 6}}]))
    assert abs(_db(master[RATE] / base[RATE]) - (6 - 12)) < 0.01 and abs(_db(master[0] / base[0]) - 6) < 0.01
    assert abs(master[RATE // 2] / base[RATE // 2] - 2 * (1 + 10 ** (-12 / 20)) / 2 * 10 ** (6 / 20) / 2) < 1e-3


def test_a_send_lane_brings_the_bus_in_from_minus_sixty_to_its_level(ref):
    bus = [{"id": "b1", "name": "b", "gainDb": 0, "pan": 0, "fx": []}]
    dry = _mix(_doc(ref, [_track("t1", ref)], buses=bus))
    wet = _mix(_doc(ref, [_track("t1", ref, sends=[{"busId": "b1", "gainDb": -6, "automation": [{"time": 0, "value": -60}, {"time": RATE, "value": 0}]}])], buses=bus))
    send = wet - dry
    assert abs(_db(send[0] / dry[0]) + 60) < 0.05 and abs(_db(send[RATE] / dry[RATE])) < 0.01 and abs(_db(send[2 * RATE] / dry[2 * RATE])) < 0.01


def _apply(cases: list) -> list:
    node = shutil.which("node")
    if node is None or not (ROOT / "frontend" / "node_modules" / "vite").is_dir():
        pytest.skip("needs Node and the interface's packages")
    done = subprocess.run([node, str(BACKEND / "tests" / "apply_commands.mjs"), str(ROOT / "frontend")], input=json.dumps(cases), capture_output=True, text=True, timeout=120)
    assert done.returncode == 0, done.stderr[-2000:]
    return json.loads(done.stdout)


def test_coalescing_a_vca_writes_its_level_into_every_member_and_the_mix_does_not_move(ref):
    vcas = [{"id": "v1", "name": "v", "gainDb": -4, "automation": [{"time": 0, "value": -4}, {"time": 2 * RATE, "value": 2}]}]
    doc = _doc(ref, [_track("t1", ref, vcaId="v1", gainDb=-3, automation={"volume": [{"time": 0, "value": -6}, {"time": RATE, "value": 0}]}), _track("t2", ref, vcaId="v1", gainDb=1)], vcas=vcas)
    after, static = _apply([{"doc": doc, "commands": [{"type": "coalesce-vca", "vcaId": "v1"}]}, {"doc": {**doc, "vcas": [{"id": "v1", "name": "v", "gainDb": -4}]}, "commands": [{"type": "coalesce-vca", "vcaId": "v1"}]}])
    assert after["vcas"] == [{"id": "v1", "name": "v", "gainDb": 0}] and static["vcas"][0]["gainDb"] == 0
    lane = after["tracks"][0]["automation"]["volume"]
    mid = 20 * np.log10((10 ** (-4 / 20) + 10 ** (2 / 20)) / 2)
    assert (lane[0]["value"], lane[8]["time"], lane[-1]["value"]) == (-10, RATE, 2) and abs(lane[8]["value"] - round(mid, 2)) < 1e-9 and len(lane) == 17
    assert static["tracks"][1]["gainDb"] == -3 and "automation" not in static["tracks"][1]
    before, coalesced = _mix(doc), _mix(after)
    assert np.max(np.abs(20 * np.log10(coalesced / before))) < 0.01
    assert [p["value"] for p in after["tracks"][1]["automation"]["volume"]] == [-3, 3]
    s0, s1 = _mix({**doc, "vcas": [{"id": "v1", "name": "v", "gainDb": -4}]}), _mix(static)
    assert np.max(np.abs(s1 - s0)) < 1e-7
