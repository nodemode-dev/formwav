import hashlib
import importlib.util
import json

from conftest import ROOT

DOCK = ROOT / "frontend" / "src" / "dock"


def _script():
    spec = importlib.util.spec_from_file_location("agents_sync", ROOT / "scripts" / "agents.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_every_file_of_the_shared_dock_matches_its_manifest():
    listed = json.loads((DOCK / "MANIFEST.json").read_text(encoding="utf-8"))
    assert listed["module"] == "dock" and listed["version"] == "2.1.0"
    for name, wanted in listed["files"].items():
        assert hashlib.sha256((DOCK / name).read_bytes()).hexdigest() == wanted, name
    assert sorted(p.name for p in DOCK.iterdir()) == sorted([*listed["files"], "MANIFEST.json"])
    assert _script().dock_problems() == []


def test_the_sync_names_a_dock_file_that_was_changed(tmp_path):
    script = _script()
    copy = tmp_path / "dock"
    copy.mkdir()
    for path in DOCK.iterdir():
        (copy / path.name).write_bytes(path.read_bytes())
    (copy / "keys.ts").write_text((copy / "keys.ts").read_text(encoding="utf-8") + "\n", encoding="utf-8")
    (copy / "extra.ts").write_text("import { x } from '../main';\n", encoding="utf-8")
    script.ROOT, script.DOCK_FOLDER = tmp_path, copy
    said = script.dock_problems()
    assert any("dock/keys.ts does not match MANIFEST.json" in line for line in said)
    assert any("dock/extra.ts is not a file of the shared dock" in line for line in said)
    assert any("dock/extra.ts imports from outside the dock folder" in line for line in said)


def test_the_contract_names_the_manifests_version():
    version = json.loads((DOCK / "MANIFEST.json").read_text(encoding="utf-8"))["version"]
    assert f"Module version {version}." in (DOCK / "CONTRACT.md").read_text(encoding="utf-8")


def test_formwavs_own_tabs_use_an_entry_of_their_own_name():
    from app.services import agent_programs, claude_code

    assert claude_code.TAB_ENTRY == "formwav_tab"
    token, path = claude_code.issue("http://127.0.0.1:1")
    try:
        assert list(json.loads(open(path, encoding="utf-8").read())["mcpServers"]) == ["formwav_tab"]
    finally:
        claude_code.revoke(token)
    source = (ROOT / "backend" / "app" / "services" / "agent_programs.py").read_text(encoding="utf-8")
    assert '"formwav_tab"' in source and "[mcp_servers.formwav_tab]" in source and agent_programs is not None
