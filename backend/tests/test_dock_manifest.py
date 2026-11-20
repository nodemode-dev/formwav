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
    assert listed["module"] == "dock" and listed["version"] == "2.2.1"
    for name, wanted in listed["files"].items():
        assert hashlib.sha256((DOCK / name).read_bytes()).hexdigest() == wanted, name
    assert sorted(p.name for p in DOCK.iterdir()) == sorted([*listed["files"], "MANIFEST.json"])
    assert _script().dock_problems() == []


def _finder_version(path):
    import re

    return re.search(r'^VERSION = "([^"]+)"$', path.read_text(encoding="utf-8"), re.M).group(1)


def test_the_shared_finder_is_the_recorded_file():
    script = _script()
    version = _finder_version(script.LOOKUP)
    assert script.LOOKUP_HASHES[version] == hashlib.sha256(script.LOOKUP.read_bytes()).hexdigest()
    assert script.lookup_problems() == []


def test_the_sync_names_the_shared_finder_edited_in_place_or_missing(tmp_path):
    script = _script()
    copy = tmp_path / "agent_lookup.py"
    copy.write_bytes(script.LOOKUP.read_bytes())
    version = _finder_version(copy)
    script.ROOT, script.LOOKUP = tmp_path, copy
    assert script.lookup_problems() == []
    with open(copy, "a", encoding="utf-8") as out:
        out.write("\n")
    assert script.lookup_problems() == [f"agent_lookup.py: does not match the hash recorded for version {version} (the shared finder changes only as a whole new version)"]
    copy.unlink()
    assert script.lookup_problems() == ["agent_lookup.py: missing (the shared finder for the agent programs)"]


def test_the_shared_finder_imports_nothing_from_the_app():
    import re

    imports = set(re.findall(r"^\s*(?:from|import)\s+([\w.]+)", _script().LOOKUP.read_text(encoding="utf-8"), re.M))
    assert imports == {"__future__", "dataclasses", "os", "pathlib", "re", "shutil", "signal", "subprocess", "sys", "threading", "time", "winreg"}


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
