import json
import subprocess
import sys

from conftest import ROOT

SCRIPT = ROOT / "scripts" / "agents.py"


def _run(*args):
    return subprocess.run([sys.executable, "-I", str(SCRIPT), "sync", *args], capture_output=True, text=True, timeout=60)


def test_the_committed_manifest_is_what_the_sync_writes():
    done = _run("--check")
    assert done.returncode == 0, done.stderr


def test_the_manifest_holds_the_servers_own_tools_and_the_subsets_stay_inside_them():
    data = json.loads((ROOT / "agents" / "manifest.json").read_text(encoding="utf-8"))
    mcp = data["mcp"]
    assert data["format"] == "form-agent-manifest" and data["version"] == 1 and data["app"] == "formwav"
    assert len(mcp["tools"]) == len(set(mcp["tools"])) and all(n.startswith("formwav_") for n in mcp["tools"])
    assert set(mcp["read_only"]) <= set(mcp["tools"]) and set(mcp["approval_gated"]) <= set(mcp["tools"])
    assert mcp["transports"] == ["stdio", "http"]
    assert "formwav_open_session_call" in mcp["approval_gated"] and "formwav_status" not in mcp["approval_gated"]
    assert [s["name"] for s in data["skills"]] == ["formwav-harness"] and "session" in data["skills"][0]["sub_skills"]


def test_agents_and_claude_say_how_many_tools_the_server_lists():
    count = len(json.loads((ROOT / "agents" / "manifest.json").read_text(encoding="utf-8"))["mcp"]["tools"])
    for name in ("AGENTS.md", "CLAUDE.md"):
        assert f"gives {count} tools over the engine's HTTP API" in (ROOT / name).read_text(encoding="utf-8"), name
