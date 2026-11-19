import asyncio
import os

import pytest

from app.services import agent_programs, claude_code, terminals

pytestmark = pytest.mark.skipif(os.name == "nt", reason="the stand-ins are shell scripts")


@pytest.fixture
def stand_ins(tmp_path, monkeypatch):
    folder = tmp_path / "bin"
    folder.mkdir()
    for name in ("codex", "cursor-agent"):
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
    assert set(found) == {"claude", "codex", "cursor"}
    assert found["codex"] == {"installed": True, "path": str(stand_ins / "codex"), "version": "codex 1.2.3", "signedIn": None, "install": "npm install -g @openai/codex", "title": "Codex"}
    assert found["cursor"]["path"] == str(stand_ins / "cursor-agent") and found["cursor"]["version"] == "cursor-agent 1.2.3"
    assert found["claude"]["install"] and found["claude"]["signedIn"] in (True, False, None)


def test_a_missing_program_comes_with_the_line_that_installs_it(client, none_found):
    found = client.get("/api/agents/status").json()
    for kind in ("codex", "cursor"):
        assert found[kind]["installed"] is False and found[kind]["path"] is None and found[kind]["install"]
    refused = client.post("/api/terminal/agent", json={"kind": "codex"})
    assert refused.status_code == 424 and "npm install -g @openai/codex" in refused.json()["detail"]
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
