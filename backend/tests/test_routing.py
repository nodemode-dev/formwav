"""PLAN_v13 S10, routing and groups, heard in the export and held by the interface's reducer: a pre-fader send that the
fader does not move, a muted send, a panned send, a bus played into another bus (and silenced by a muted destination),
a routing loop refused, and mix groups moving their tracks together."""
import struct

import numpy as np
import pytest

from app.services import render
from test_automation_depth import _apply

RATE = 48000


def _wav(x: np.ndarray) -> bytes:
    data = x.astype("<f4").tobytes()
    fmt = struct.pack("<IHHIIHH", 16, 3, 1, RATE, RATE * 4, 4, 32)
    return b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + fmt + b"data" + struct.pack("<I", len(data)) + data


@pytest.fixture(scope="module")
def ref(client):
    return client.post("/api/media", content=_wav(np.full(RATE, 0.25)), headers={"X-Filename": "flat.wav"}).json()


def _track(tid: str, ref: dict, **more) -> dict:
    return {"id": tid, "name": tid, "gainDb": 0, "pan": 0, "mute": False, "solo": False, "clips": [{"id": f"c{tid}", "mediaId": ref["id"], "start": 0, "sourceIn": 0, "length": ref["frames"], "gainDb": 0}], **more}


def _doc(ref: dict, tracks: list, **more) -> dict:
    return {"version": 1, "sampleRate": RATE, "media": {ref["id"]: ref}, "markers": [], "tracks": tracks, **more}


def _mix(doc: dict) -> np.ndarray:
    return np.frombuffer(render.render(doc)["wav"][44:], "<f4").reshape(-1, 2).astype(np.float64)


def _bus(bid: str, **more) -> dict:
    return {"id": bid, "name": bid, "gainDb": 0, "pan": 0, **more}


def test_a_pre_fader_send_keeps_its_level_when_the_fader_moves_and_a_post_fader_one_follows(ref):
    buses = [_bus("b1")]
    sent = {}
    for pre in (False, True):
        for fader in (0, -12):
            dry = _mix(_doc(ref, [_track("t1", ref, gainDb=fader)], buses=buses))
            wet = _mix(_doc(ref, [_track("t1", ref, gainDb=fader, sends=[{"busId": "b1", "gainDb": 0, **({"pre": True} if pre else {})}])], buses=buses))
            sent[pre, fader] = (wet - dry)[RATE // 2, 0]
    assert abs(sent[True, -12] - sent[True, 0]) < 1e-6
    assert abs(20 * np.log10(sent[False, -12] / sent[False, 0]) + 12) < 1e-3


def test_a_muted_send_adds_nothing_and_a_panned_send_lands_on_its_side(ref):
    buses = [_bus("b1")]
    dry = _mix(_doc(ref, [_track("t1", ref)], buses=buses))
    muted = _mix(_doc(ref, [_track("t1", ref, sends=[{"busId": "b1", "gainDb": 0, "mute": True}])], buses=buses))
    assert np.max(np.abs(muted - dry)) < 1e-7
    left = _mix(_doc(ref, [_track("t1", ref, sends=[{"busId": "b1", "gainDb": 0, "pan": -1}])], buses=buses)) - dry
    assert left[RATE // 2, 0] > 0.05 and abs(left[RATE // 2, 1]) < 1e-6


def test_a_bus_played_into_another_takes_its_level_and_a_muted_destination_silences_it(ref):
    def wet(dest: dict) -> np.ndarray:
        return _mix(_doc(ref, [_track("t1", ref, busId="b1")], buses=[_bus("b1", out="b2"), dest]))

    level, lower, muted = wet(_bus("b2")), wet(_bus("b2", gainDb=-6)), wet(_bus("b2", mute=True))
    assert level[RATE // 2, 0] > 0.05
    assert abs(20 * np.log10(lower[RATE // 2, 0] / level[RATE // 2, 0]) + 6) < 1e-3
    assert np.max(np.abs(muted)) < 1e-7
    # listed in either order, the bus that feeds another runs first
    reversed_ = _mix(_doc(ref, [_track("t1", ref, busId="b1")], buses=[_bus("b2", gainDb=-6), _bus("b1", out="b2")]))
    assert np.max(np.abs(reversed_ - lower)) < 1e-7


def test_routing_refuses_a_loop_and_removing_a_bus_frees_what_played_into_it(ref):
    doc = _doc(ref, [_track("t1", ref)], buses=[_bus("b1"), _bus("b2"), _bus("b3")])
    looped, removed = _apply([
        {"doc": doc, "commands": [{"type": "route-bus", "busId": "b1", "to": "b2"}, {"type": "route-bus", "busId": "b2", "to": "b3"}, {"type": "route-bus", "busId": "b3", "to": "b1"}, {"type": "route-bus", "busId": "b2", "to": "b2"}]},
        {"doc": doc, "commands": [{"type": "route-bus", "busId": "b1", "to": "b2"}, {"type": "remove-bus", "busId": "b2"}]},
    ])
    assert [b.get("out") for b in looped["buses"]] == ["b2", "b3", None]
    assert removed["buses"] == [_bus("b1"), _bus("b3")]


def test_a_mix_group_moves_volume_mute_and_solo_together_and_an_inactive_one_does_not(ref):
    tracks = [_track("t1", ref), _track("t2", ref, gainDb=-3), _track("t3", ref)]
    group = {"id": "g1", "name": "Drums", "trackIds": ["t1", "t2"], "volume": True, "mute": True, "solo": False, "edit": False, "active": True}
    moved, off, removed = _apply([
        {"doc": _doc(ref, tracks), "commands": [{"type": "set-group", "group": group}, {"type": "set-track-gain", "trackId": "t1", "gainDb": -4}, {"type": "set-track-mute", "trackId": "t2", "mute": True}, {"type": "set-track-solo", "trackId": "t1", "solo": True}]},
        {"doc": _doc(ref, tracks), "commands": [{"type": "set-group", "group": {**group, "active": False}}, {"type": "set-track-gain", "trackId": "t1", "gainDb": -4}]},
        {"doc": _doc(ref, tracks), "commands": [{"type": "set-group", "group": group}, {"type": "remove-track", "trackId": "t2"}]},
    ])
    assert [(t["gainDb"], t["mute"], t["solo"]) for t in moved["tracks"]] == [(-4, True, True), (-7, True, False), (0, False, False)]
    assert [t["gainDb"] for t in off["tracks"]] == [-4, -3, 0]
    assert "groups" not in removed
