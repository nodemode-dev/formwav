"""PLAN_v13 S12: the demo session made in code, the headless command line (engine commands on a saved session, bounced
by the engine's own export) and the engine command catalogue."""
import json
import shutil
import subprocess
import sys

import numpy as np
import pytest

from app.services import render
from conftest import BACKEND, ROOT
from test_automation_depth import _apply
from test_tempo_map import _calls


def _needs_node():
    if shutil.which("node") is None or not (ROOT / "frontend" / "node_modules" / "vite").is_dir():
        pytest.skip("needs Node and the interface's packages")


def _mix(doc: dict) -> np.ndarray:
    return np.frombuffer(render.render(doc)["wav"][44:], "<f4").reshape(-1, 2)


def test_the_demo_is_a_known_session_that_plays_and_comes_out_the_same_every_time(client):
    first = client.post("/api/projects/demo").json()
    again = client.post("/api/projects/demo").json()["document"]
    doc = first["document"]
    assert first["name"] == "Demo" and doc == again
    assert [t["name"] for t in doc["tracks"]] == ["Kick", "Snare", "Hats", "Bass", "Pad", "Keys"]
    assert doc["tempo"] == {"bpm": 104, "beatsPerBar": 4} and [m["label"] for m in doc["markers"]] == ["Intro", "Verse", "Chorus", "Outro"]
    assert doc["buses"][0]["name"] == "Verb" and doc["buses"][0]["fx"][0]["kind"] == "reverb"
    assert [t["name"] for t in doc["tracks"] if t.get("sends")] == ["Snare", "Pad", "Keys"]
    keys = doc["tracks"][5]["clips"][0]
    bar = round(48000 * 60 / 104) * 4
    assert keys["start"] == 8 * bar and len(keys["notes"]) == 8 * 4 * 3 and {n["pitch"] for n in keys["notes"][:3]} == {69, 72, 76}
    mix = _mix(doc)
    assert len(mix) == 16 * bar and 0.3 < np.max(np.abs(mix)) < 1.0
    for t in doc["tracks"]:
        alone = _mix({**doc, "tracks": [t], "buses": []})
        assert np.sqrt(np.mean(alone**2)) > 1e-3, t["name"]
    assert client.post("/api/projects/demo?rate=12345").status_code == 400


def _cli(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, "-m", "app.headless", *args], cwd=BACKEND, capture_output=True, text=True, timeout=600)


def test_the_headless_command_line_applies_commands_to_a_saved_session_and_bounces_what_the_app_would(client, tmp_path):
    _needs_node()
    commands = [{"type": "set-track-gain", "trackId": "demo1", "gainDb": -30}, {"type": "set-track-mute", "trackId": "demo5", "mute": True}, {"type": "set-tempo-change", "tick": 7680, "bpm": 90}]
    made = _cli("run", "--demo", *sum((["--cmd", json.dumps(c)] for c in commands), []), "--bounce", str(tmp_path / "a.wav"), "--save", str(tmp_path / "a.fmw"))
    assert made.returncode == 0, made.stderr[-1500:]
    assert "set-track-gain: Changed the volume of Kick" in made.stderr and "set-track-mute: Muted Pad" in made.stderr
    expected = _apply([{"doc": client.post("/api/projects/demo").json()["document"], "commands": commands}])[0]
    assert (tmp_path / "a.wav").read_bytes() == render.render(expected)["wav"]
    (tmp_path / "more.jsonl").write_text(json.dumps({"type": "rename-track", "trackId": "demo6", "name": "Piano"}) + "\n" + json.dumps({"type": "set-track-gain", "trackId": "nobody", "gainDb": 1}) + "\n")
    again = _cli("run", "--in", str(tmp_path / "a.fmw"), "--cmds", str(tmp_path / "more.jsonl"), "--inspect")
    assert again.returncode == 0, again.stderr[-1500:]
    summary = json.loads(again.stdout)
    assert [t["name"] for t in summary["tracks"]][5] == "Piano" and summary["tracks"][0]["gain_db"] == -30 and summary["tracks"][4]["mute"] is True
    assert summary["tempo"]["changes"] == [{"tick": 7680, "bpm": 90}] and "set-track-gain: no change" in again.stderr
    bad = _cli("run", "--demo", "--cmd", json.dumps({"type": "explode"}))
    assert bad.returncode != 0 and 'no engine command "explode"' in bad.stderr
    listed = _cli("commands", "tempo")
    assert listed.returncode == 0 and "set-tempo-map" in listed.stdout and "changes: readonly TempoChange[]" in listed.stdout


def test_the_catalogue_lists_every_engine_command_with_its_parameters_and_words():
    _needs_node()
    doc = {"version": 1, "sampleRate": 48000, "media": {}, "markers": [], "tracks": [{"id": "t1", "name": "Voice", "gainDb": 0, "mute": False, "solo": False, "clips": []}]}
    catalogue, known, unknown = _calls([
        {"module": "engine/catalogue.ts", "fn": "commandCatalogue", "args": [doc]},
        {"module": "engine/catalogue.ts", "fn": "isCommandType", "args": ["route-bus"]},
        {"module": "engine/catalogue.ts", "fn": "isCommandType", "args": ["toString"]},
    ])
    by = {c["type"]: c for c in catalogue}
    src = (ROOT / "frontend" / "src" / "engine" / "document.ts").read_text()
    union = src[src.index("export type Command ="): src.index(";\n\n", src.index("export type Command ="))]
    assert len(by) == union.count('| { type: "') and known is True and unknown is False
    assert by["set-track-gain"]["params"] == "trackId: string; gainDb: number" and by["route-bus"]["label"] == "Routed a bus"
