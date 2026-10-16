import json
import math
import shutil
import subprocess

import pytest

from app.services import render
from conftest import BACKEND, ROOT

FRONTEND = ROOT / "frontend"
FULL = {
    "highpass": {"kind": "highpass", "freq": 120, "gainDb": 0, "q": 0.707},
    "lowpass": {"kind": "lowpass", "freq": 9000, "gainDb": 0, "q": 0.707},
    "peak": {"kind": "peak", "freq": 1000, "gainDb": 4, "q": 1.4},
    "lowshelf": {"kind": "lowshelf", "freq": 200, "gainDb": -3, "q": 0.707},
    "highshelf": {"kind": "highshelf", "freq": 6000, "gainDb": 2, "q": 0.707},
    "compressor": {"kind": "compressor", "thresholdDb": -18, "ratio": 3, "attackMs": 8, "releaseMs": 120, "makeupDb": 2},
    "denoise": {"kind": "denoise", "reductionDb": 10, "sensitivityDb": 2},
    "reverb": {"kind": "reverb", "room": 0.5, "damping": 0.4, "mix": 0.3, "width": 0.8},
    "echo": {"kind": "echo", "delayMs": 250, "feedback": 0.3, "mix": 0.35},
    "chorus": {"kind": "chorus", "rateHz": 0.7, "depthMs": 2.5, "mix": 0.45},
    "limiter": {"kind": "limiter", "ceilingDb": -1.5, "releaseMs": 60},
    "tremolo": {"kind": "tremolo", "rateHz": 5, "depth": 0.4, "spread": 0.2},
    "gate": {"kind": "gate", "thresholdDb": -45, "releaseMs": 90, "rangeDb": -50},
    "phaser": {"kind": "phaser", "rateHz": 0.4, "depth": 0.9, "feedback": 0.4},
    "flanger": {"kind": "flanger", "rateHz": 0.3, "depthMs": 2, "feedback": 0.3},
    "voice": {"kind": "voice", "strength": 0.8},
    "dehum": {"kind": "dehum", "baseHz": 50, "harmonics": 6, "q": 25},
    "declick": {"kind": "declick", "sensitivity": 9, "maxMs": 1.2},
    "dereverb": {"kind": "dereverb", "t60": 0.9, "reductionDb": 7},
    "processor": {"kind": "processor", "id": "compressor", "values": {"threshold": -18, "ratio": 3, "knee": 4, "lookahead": 2, "mix": 80, "sidechain_filter": 1}},
}
SWEPT = {"kind": "peak", "freq": 800, "gainDb": 3, "q": 1, "automation": {"freq": [{"time": 0, "value": 400}, {"time": 48000, "value": 4000}], "gain": [{"time": 24000, "value": -6}]}}


def _media(mid: str, rate: int = 48000, frames: int = 96000) -> dict:
    return {"id": mid, "name": f"{mid}.wav", "sampleRate": rate, "frames": frames, "channels": 2}


def _clip(cid: str, mid: str, start: int = 0, **more) -> dict:
    return {"id": cid, "mediaId": mid, "start": start, "sourceIn": 0, "length": 48000, "gainDb": 0, **more}


def _track(tid: str, clips: list, **more) -> dict:
    return {"id": tid, "name": tid, "channels": 2, "gainDb": 0, "pan": 0, "mute": False, "solo": False, "clips": clips, **more}


def _doc(tracks: list, **more) -> dict:
    return {"version": 1, "sampleRate": 48000, "media": {"a": _media("a"), "b": _media("b")}, "markers": [], "tracks": tracks, **more}


def _cases() -> dict:
    cases = {}
    for kind, f in FULL.items():
        cases[f"track/{kind}"] = _doc([_track("t1", [_clip("c1", "a")], fx=[f, SWEPT])])
        cases[f"clip/{kind}"] = _doc([_track("t1", [_clip("c1", "a", fx=[f, SWEPT])], fx=[SWEPT])])
        cases[f"track on a bus/{kind}"] = _doc([_track("t1", [_clip("c1", "a")], fx=[f, SWEPT], busId="b1")], buses=[{"id": "b1", "name": "b", "gainDb": -2, "pan": 0.3, "fx": []}])
        cases[f"bus/{kind}"] = _doc([_track("t1", [_clip("c1", "a")], busId="b1")], buses=[{"id": "b1", "name": "b", "gainDb": -2, "pan": 0.3, "fx": [f]}])
        cases[f"master/{kind}"] = _doc([_track("t1", [_clip("c1", "a")])], masterFx=[f])
    shapes = ["linear", "equal-power", "s-curve", "exponential"]
    cases["a fuller session"] = _doc(
        [
            _track("t1", [_clip(f"c{i}", "a", 60000 * i, fadeIn=4800, fadeOut=2400, fadeShape=s, gainDb=-1.5 * i) for i, s in enumerate(shapes)], gainDb=-3, pan=-0.4, vcaId="v1",
                   automation={"pan": [{"time": 0, "value": -1}, {"time": 96000, "value": 1}]}, sends=[{"busId": "b1", "gainDb": -9}]),
            _track("t2", [_clip("c9", "a", 1000, envelope=[{"at": 0, "db": 0}, {"at": 24000, "db": -12}, {"at": 48000, "db": 0}], pitchMediaId="b")], gainDb=2,
                   automation={"volume": [{"time": 0, "value": -6}, {"time": 30000, "value": 0}]}),
            _track("t3", [_clip("c10", "c")], gainDb=0),
            _track("t4", [_clip("c11", "a")], mute=True),
            _track("t5", [_clip("c12", "a")], busId="b2"),
            _track("t6", [_clip("c13", "a")], fx=[{**FULL["peak"], "bypass": True}, FULL["highpass"]], busId="b1"),
        ],
        media={"a": _media("a"), "b": _media("b"), "c": _media("c", 44100)},
        buses=[{"id": "b1", "name": "b", "gainDb": -2, "pan": 0.3, "fx": [FULL["compressor"]]}, {"id": "b2", "name": "muted", "gainDb": 0, "pan": 0, "mute": True}],
        vcas=[{"id": "v1", "name": "v", "gainDb": -4}],
    )
    # PLAN_v13 S2: solo safe, trim and polarity ahead of the track's inserts (after a clip's own compressor),
    # automation Off (the lanes kept, the static fader, pan and filters played), the pan law
    cases["the mixer's solo safe, trim, polarity, automation Off and pan law"] = _doc(
        [
            _track("t1", [_clip("c1", "a", fx=[FULL["compressor"]])], solo=True, trimDb=-4.5, invert=True),
            _track("t2", [_clip("c2", "a")], soloSafe=True, autoOff=True, fx=[SWEPT, FULL["echo"]],
                   automation={"volume": [{"time": 0, "value": -6}, {"time": 30000, "value": 0}]}),
            _track("t3", [_clip("c3", "a")], gainDb=-2),
            _track("t4", [_clip("c4", "a")], solo=True, fx=[SWEPT, FULL["gate"]]),
        ],
        panLaw="-4.5",
    )
    # a placed track keeps its time-based effects per clip, where its place reaches them; a compressor takes it to a bus
    cases["placed tracks' effects"] = _doc(
        [
            _track("t1", [_clip("c1", "a")], fx=[SWEPT, FULL["echo"], FULL["gate"]], surround={"x": 0, "y": 1}),
            _track("t2", [_clip("c2", "a")], fx=[FULL["chorus"], FULL["compressor"]], surround={"x": -1, "y": -1, "lfeDb": -10}),
            _track("t3", [_clip("c3", "a")], fx=[SWEPT, FULL["echo"]]),
        ],
        surroundFold=True,
    )
    # PLAN_v13 S5: a muted clip left out of both plans, a fade-out with a shape of its own, the logarithmic shape
    cases["clip mute and a shape for each fade"] = _doc(
        [
            _track("t1", [
                _clip("c1", "a", fadeIn=4800, fadeOut=9600, fadeShape="exponential", fadeOutShape="logarithmic"),
                _clip("c2", "a", 50000, mute=True),
                _clip("c3", "a", 100000, fadeIn=2400, fadeOut=2400, fadeShape="logarithmic"),
            ]),
        ],
    )
    # PLAN_v13 S6: an inactive track left out of both plans, and its solo silencing nothing
    cases["inactive tracks"] = _doc([_track("t1", [_clip("c1", "a")]), _track("t2", [_clip("c2", "b")], inactive=True), _track("t3", [_clip("c3", "b")], inactive=True, solo=True)])
    # PLAN_v13 S9: mute and trim lanes, a VCA lane, send lanes, a master lane, each folded into the one volume lane
    ramp = [{"time": 0, "value": 0}, {"time": 48000, "value": -12}]
    cases["automation depth"] = _doc(
        [
            _track("t1", [_clip("c1", "a", envelope=[{"at": 0, "db": 0}, {"at": 24000, "db": -6}])], gainDb=-3, vcaId="v1",
                   automation={"volume": [{"time": 0, "value": -6}, {"time": 30000, "value": 0}], "mute": [{"time": 0, "value": 0}, {"time": 12000, "value": 1}, {"time": 20000, "value": 0}], "trim": [{"time": 6000, "value": 3}]},
                   sends=[{"busId": "b1", "gainDb": -9, "automation": [{"time": 0, "value": -60}, {"time": 48000, "value": 0}]}]),
            _track("t2", [_clip("c2", "a")], gainDb=2, vcaId="v1", sends=[{"busId": "b1", "gainDb": -6}]),
            _track("t3", [_clip("c3", "a")], automation={"mute": [{"time": 24000, "value": 1}]}),
            _track("t4", [_clip("c4", "a")], autoOff=True, automation={"trim": ramp}, sends=[{"busId": "b1", "gainDb": -3, "automation": ramp}]),
        ],
        buses=[{"id": "b1", "name": "b", "gainDb": 0, "pan": 0, "fx": []}],
        vcas=[{"id": "v1", "name": "v", "gainDb": -4, "automation": [{"time": 0, "value": -4}, {"time": 96000, "value": 2}]}],
        masterGainDb=-2,
        masterAutomation=ramp,
    )
    return cases


CASES = _cases()


@pytest.fixture(scope="module")
def browser_plans() -> dict:
    node = shutil.which("node")
    if node is None:
        pytest.skip("needs Node on the PATH")
    if not (FRONTEND / "node_modules" / "vite").is_dir():
        pytest.skip("needs the interface's packages: npm ci in frontend")
    done = subprocess.run([node, str(BACKEND / "tests" / "player_plan.mjs"), str(FRONTEND)], input=json.dumps(list(CASES.values())), capture_output=True, text=True, timeout=300)
    assert done.returncode == 0, done.stderr[-2000:]
    return dict(zip(CASES, json.loads(done.stdout)))


def _export_plan(doc: dict) -> dict:
    _, sources, clips, end, skipped, buses, envelopes, fx, chains, fx_auto, comps, _, bus_auto = render.plan(doc)
    media_of = {v: k for k, v in sources.items()}

    def env(i: int) -> list | None:
        return [[t, v] for t, v in envelopes[i - 1][0]] if i else None

    return {
        "end": end,
        "skipped": skipped,
        "clips": [
            {
                "media": media_of[c[0]], "start": c[1], "sourceIn": c[2], "length": c[3], "gain": c[4], "pan": c[5], "fadeIn": c[6], "fadeOut": c[7], "fadeShape": c[8], "bus": c[9],
                "gainPoints": env(c[10]), "panPoints": env(c[11]),
                "fx": [list(s[1:]) for s in fx if s[0] == i],
                "fxAuto": [[s, p, env(e)] for ci, s, p, e in fx_auto if ci == i],
                "comp": next((list(x[1:]) for x in comps if x[0] == i), None),
            }
            for i, c in enumerate(clips)
        ],
        "buses": [
            {"gain": g, "pan": p, "stages": [list(ch[2:]) for ch in chains if ch[0] == 1 and ch[1] == k], "fxAuto": [[s, prm, env(e)] for bi, s, prm, e in bus_auto if bi == k]}
            for k, (_, g, p) in enumerate(buses)
        ],
        "master": [list(s) for s in (render._stage(f) for f in (doc.get("masterFx") or [])) if s],
        "panLaw": render.PAN_LAWS.get(doc.get("panLaw"), 0),
        "masterDb": render.master_lane(doc)[0],
        "masterPoints": [[t, v] for t, v in render.master_lane(doc)[1] or []] or None,
    }


def _differences(export, browser, path: str = "") -> list[str]:
    if isinstance(export, dict) and isinstance(browser, dict):
        return [d for k in sorted(set(export) | set(browser)) for d in _differences(export.get(k), browser.get(k), f"{path}.{k}")]
    if isinstance(export, (list, tuple)) and isinstance(browser, (list, tuple)):
        if len(export) != len(browser):
            return [f"{path}: the export has {len(export)} ({export}), the browser {len(browser)} ({browser})"]
        return [d for i, (a, b) in enumerate(zip(export, browser)) for d in _differences(a, b, f"{path}[{i}]")]
    if isinstance(export, (int, float)) and isinstance(browser, (int, float)) and not isinstance(export, bool):
        return [] if math.isclose(export, browser, rel_tol=1e-9, abs_tol=1e-9) else [f"{path}: the export {export}, the browser {browser}"]
    return [] if export == browser else [f"{path}: the export {export!r}, the browser {browser!r}"]


@pytest.mark.parametrize("case", CASES)
def test_the_browser_plans_what_the_export_renders(browser_plans, case):
    got = browser_plans[case]
    assert not _differences(_export_plan(got["doc"]), got["plan"])


def test_every_live_kind_is_planned_somewhere_by_both(browser_plans):
    for kind in FULL:
        plan = browser_plans[f"track/{kind}"]["plan"]
        stages = [s[0] for c in plan["clips"] for s in c["fx"]] + [s[0] for b in plan["buses"] for s in b["stages"]]
        assert render.FX_KINDS[kind] in stages, kind
