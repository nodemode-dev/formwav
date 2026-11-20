import asyncio
import os

import pytest

from app.services import agent_programs, claude_code, terminals

pytestmark = pytest.mark.skipif(os.name == "nt", reason="the stand-ins are shell scripts")


@pytest.fixture
def stand_ins(tmp_path, monkeypatch):
    folder = tmp_path / "bin"
    folder.mkdir()
    for name in ("codex", "cursor-agent", "agy"):
        script = folder / name
        script.write_text(f'#!/bin/sh\nif [ "$1" = "--version" ]; then echo "{name} 1.2.3"; exit 0; fi\necho started\nread line\n')
        script.chmod(0o755)
    monkeypatch.setenv("PATH", f"{folder}{os.pathsep}{os.environ.get('PATH', '')}")
    monkeypatch.setenv("FORMWAV_AGENT_DIR", str(tmp_path / "agent"))
    monkeypatch.setitem(agent_programs._status, "value", None)
    return folder


@pytest.fixture
def none_found(tmp_path, monkeypatch):
    monkeypatch.setenv("PATH", str(tmp_path))
    monkeypatch.setenv("SHELL", "/bin/false")
    monkeypatch.setitem(agent_programs._status, "value", None)


def test_one_call_says_which_agent_programs_are_here(client, stand_ins):
    found = client.get("/api/agents/status").json()
    assert set(found) == {"claude", "codex", "cursor", "antigravity"}
    codex = found["codex"]
    assert (codex["installed"], codex["path"], codex["version"], codex["finding"], codex["how"]) == (True, str(stand_ins / "codex"), "1.2.3", "runs", "path")
    assert (codex["signedIn"], codex["install"], codex["title"], codex["error"]) == (None, "npm install -g @openai/codex", "Codex", "")
    assert found["cursor"]["path"] == str(stand_ins / "cursor-agent") and found["cursor"]["version"] == "1.2.3"
    assert found["antigravity"]["path"] == str(stand_ins / "agy") and found["antigravity"]["title"] == "Antigravity" and found["antigravity"]["signedIn"] is None
    assert found["claude"]["install"] and found["claude"]["signedIn"] in (True, False, None)


def test_a_missing_program_comes_with_the_line_that_installs_it(client, none_found):
    found = client.get("/api/agents/status").json()
    for kind in ("claude", "codex", "cursor", "antigravity"):
        assert found[kind]["installed"] is False and found[kind]["path"] is None and found[kind]["install"]
        assert found[kind]["finding"] == "missing" and found[kind]["said"].startswith(f"{found[kind]['title']} was not found. Looked in: PATH (")
    refused = client.post("/api/terminal/agent", json={"kind": "codex"})
    assert refused.status_code == 424 and "npm install -g @openai/codex" in refused.json()["detail"]
    refused = client.post("/api/terminal/agent", json={"kind": "antigravity"})
    assert refused.status_code == 424 and refused.json()["detail"].startswith("Antigravity was not found.")
    assert client.post("/api/terminal/agent", json={"kind": "vim"}).status_code == 422


@pytest.mark.parametrize("kind, file", [("codex", ".codex/config.toml"), ("cursor", ".cursor/mcp.json")])
def test_a_codex_or_cursor_tab_gets_its_own_token_in_its_environment_until_it_is_closed(stand_ins, tmp_path, kind, file):
    async def go():
        session = terminals.open_agent(kind, "http://127.0.0.1:8060", 80, 20)
        try:
            token = session.env["FORMWAV_INAPP_TOKEN"]
            return session.describe(), token, claude_code.is_inapp(token), session.env["FORMWAV_MCP_URL"], list(session.argv)
        finally:
            terminals.close(session.id)

    described, token, inapp, url, argv = asyncio.run(go())
    assert described["kind"] == kind and described["alive"] is True
    assert inapp and url == "http://127.0.0.1:8060/mcp" and all(token not in part for part in argv)
    config = tmp_path / "agent" / file
    assert config.stat().st_mode & 0o777 == 0o600 and token not in config.read_text() and "FORMWAV_INAPP_TOKEN" in config.read_text()
    assert not claude_code.is_inapp(token)


def test_two_antigravity_tabs_each_keep_their_own_entry_and_closing_one_leaves_the_other(stand_ins, tmp_path, monkeypatch):
    import json

    from app.core.paths import data_dir

    monkeypatch.setenv("FORMWAV_DATA_DIR", str(tmp_path / "data"))
    shared = tmp_path / "agent" / ".agents" / "mcp_config.json"
    root = data_dir() / "agent-tabs" / "antigravity"

    async def go():
        first = terminals.open_agent("antigravity", "http://127.0.0.1:8060", 80, 20)
        second = terminals.open_agent("antigravity", "http://127.0.0.1:8060", 80, 20)
        try:
            tabs = []
            for session in (first, second):
                token = session.env["FORMWAV_INAPP_TOKEN"]
                file = tmp_path / session.cwd / ".agents" / "mcp_config.json"
                tabs.append((session.describe(), token, file, json.loads(file.read_text()), file.stat().st_mode & 0o777, list(session.argv), session.cwd))
            terminals.close(first.id)
            after = json.loads(tabs[1][2].read_text())
            return tabs, after, claude_code.is_inapp(tabs[0][1]), claude_code.is_inapp(tabs[1][1])
        finally:
            for session in (first, second):
                if session.id in terminals.SESSIONS:
                    terminals.close(session.id)

    tabs, after, first_live, second_live = asyncio.run(go())
    assert tabs[0][6] != tabs[1][6] and all(os.path.dirname(tab[6]) == str(root) for tab in tabs)
    for described, token, file, during, mode, argv, cwd in tabs:
        assert described["kind"] == "antigravity" and described["title"] == "Antigravity" and described["alive"] is True
        assert mode == 0o600 and all(token not in part for part in argv)
        assert during == {"mcpServers": {"formwav_tab": {"serverUrl": "http://127.0.0.1:8060/mcp", "headers": {"x-formwav-inapp": token}}}}
    assert after == tabs[1][3] and not first_live and second_live
    assert not os.path.exists(tabs[0][6])
    assert not os.path.exists(tabs[1][6]) and not claude_code.is_inapp(tabs[1][1])
    assert not shared.exists()


def test_a_tab_entry_keeps_every_other_entry_and_a_damaged_file_is_left_alone(tmp_path):
    import json

    file = tmp_path / ".agents" / "mcp_config.json"
    file.parent.mkdir(parents=True)
    seed = {"mcpServers": {"other": {"command": "/bin/true", "args": []}}, "theme": "kept"}
    file.write_text(json.dumps(seed, indent=2) + "\n")
    agent_programs.write_tab_entry(tmp_path, "http://127.0.0.1:8060", "tok")
    during = json.loads(file.read_text())
    assert during["mcpServers"]["formwav_tab"] == {"serverUrl": "http://127.0.0.1:8060/mcp", "headers": {"x-formwav-inapp": "tok"}}
    assert during["mcpServers"]["other"] == seed["mcpServers"]["other"] and during["theme"] == "kept"
    agent_programs.remove_tab_entry(tmp_path, "tok")
    assert json.loads(file.read_text()) == seed
    file.write_text("not json at all")
    with pytest.raises(OSError, match="is not an MCP servers file formwav can read, so it was left alone"):
        agent_programs.write_tab_entry(tmp_path, "http://127.0.0.1:8060", "tok")
    assert file.read_text() == "not json at all"


def test_a_plain_shell_tab_gets_no_token():
    async def go():
        session = terminals.open_shell(80, 20)
        try:
            return dict(session.env)
        finally:
            terminals.close(session.id)

    env = asyncio.run(go())
    assert "FORMWAV_INAPP_TOKEN" not in env and "FORMWAV_MCP_URL" not in env


def test_starting_an_agent_tab_needs_the_window_key(bare, stand_ins):
    refused = bare.post("/api/terminal/agent", json={"kind": "codex"})
    assert refused.status_code == 403 and refused.json() == {"detail": "Only the formwav window can do this"}


@pytest.mark.parametrize("kind, file", [("codex", ".codex/config.toml"), ("cursor", ".cursor/mcp.json")])
def test_a_configuration_file_the_person_wrote_is_left_as_it_is(tmp_path, kind, file):
    theirs = tmp_path / file
    theirs.parent.mkdir()
    theirs.write_text("theirs\n")
    assert agent_programs.configure(kind, "http://127.0.0.1:8060", tmp_path) is False and theirs.read_text() == "theirs\n"
