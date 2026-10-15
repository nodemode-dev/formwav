import json
import os
import subprocess
import tomllib

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.routers import agents
from conftest import BACKEND

MCP_PYTHON = BACKEND / "formwav_mcp" / "venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


@pytest.fixture
def home(tmp_path, monkeypatch):
    for name in ("HOME", "USERPROFILE"):
        monkeypatch.setenv(name, str(tmp_path))
    monkeypatch.setenv("APPDATA", str(tmp_path / "AppData" / "Roaming"))
    return tmp_path


def _files(home):
    return {"codex": home / ".codex" / "config.toml", "cursor": home / ".cursor" / "mcp.json", "desktop": agents._desktop_file()}


def test_six_clients_are_shown_and_the_servers_command_exists(client, home):
    shown = client.get("/api/agents/connect").json()
    assert [c["id"] for c in shown["clients"]] == ["claude-code", "codex", "cursor", "claude-desktop", "vscode", "any"]
    assert shown["ready"] is True
    assert all(c["present"] in (False, None) for c in shown["clients"])


def test_codex_keeps_its_settings_and_other_servers_and_a_second_add_does_not_duplicate(client, home):
    path = _files(home)["codex"]
    path.parent.mkdir(parents=True)
    path.write_text('model = "o4-mini"\n\n[mcp_servers.other]\ncommand = "other-server"\n')
    assert client.post("/api/agents/install", json={"client": "codex"}).status_code == 200
    first = tomllib.loads(path.read_text())
    assert first["model"] == "o4-mini" and first["mcp_servers"]["other"]["command"] == "other-server"
    assert first["mcp_servers"]["formwav"]["command"] == agents.server_command()[0]
    assert path.with_name("config.toml.bak").read_text().startswith('model = "o4-mini"')
    client.post("/api/agents/install", json={"client": "codex"})
    again = path.read_text()
    assert again.count("[mcp_servers.formwav]") == 1 and tomllib.loads(again)["mcp_servers"]["other"]["command"] == "other-server"


def test_cursor_and_claude_desktop_merge_beside_other_servers(client, home):
    cursor = _files(home)["cursor"]
    cursor.parent.mkdir(parents=True)
    cursor.write_text(json.dumps({"mcpServers": {"github": {"command": "gh-mcp"}}}))
    assert client.post("/api/agents/install", json={"client": "cursor"}).status_code == 200
    assert set(json.loads(cursor.read_text())["mcpServers"]) == {"github", "formwav"}
    assert cursor.with_name("mcp.json.bak").exists()
    assert client.post("/api/agents/install", json={"client": "claude-desktop"}).status_code == 200
    assert "formwav" in json.loads(_files(home)["desktop"].read_text())["mcpServers"]
    shown = {c["id"]: c["present"] for c in client.get("/api/agents/connect").json()["clients"]}
    assert shown["cursor"] is True and shown["claude-desktop"] is True and shown["codex"] is False


def test_a_broken_file_is_refused_and_left_byte_for_byte(client, home):
    cursor = _files(home)["cursor"]
    cursor.parent.mkdir(parents=True)
    cursor.write_text('{"mcpServers": {"github": ')
    reply = client.post("/api/agents/install", json={"client": "cursor"})
    assert reply.status_code == 409 and "not valid JSON" in reply.json()["detail"]
    assert cursor.read_text() == '{"mcpServers": {"github": '


def test_claude_code_without_its_command_says_so(client, home, monkeypatch):
    from app.services import claude_code

    monkeypatch.setattr(claude_code, "cli", lambda: None)
    reply = client.post("/api/agents/install", json={"client": "claude-code"})
    assert reply.status_code == 409 and "Claude Code" in reply.json()["detail"]


def test_a_paired_device_is_refused(home):
    request = Request({"type": "http", "method": "POST", "headers": [], "formwav.remote": True})
    with pytest.raises(HTTPException) as refused:
        agents.install(request, {"client": "cursor"})
    assert refused.value.status_code == 403


def test_the_command_cursors_written_file_names_starts_the_server(client, home, engine_url):
    if not MCP_PYTHON.exists():
        pytest.skip("needs the MCP server's venv (backend/oc_install makes it)")
    client.post("/api/agents/install", json={"client": "cursor"})
    conf = json.loads(_files(home)["cursor"].read_text())["mcpServers"]["formwav"]
    probe = (
        "import asyncio, json, os, sys\n"
        "from mcp import ClientSession\n"
        "from mcp.client.stdio import StdioServerParameters, stdio_client\n"
        "conf = json.loads(sys.argv[1])\n"
        "async def go():\n"
        "    params = StdioServerParameters(command=conf['command'], args=conf['args'], env={**os.environ, **conf.get('env', {})})\n"
        "    async with stdio_client(params) as (r, w), ClientSession(r, w) as s:\n"
        "        await s.initialize()\n"
        "        res = await s.call_tool('formwav_status', {})\n"
        "        print(json.dumps([not res.is_error, ' '.join(getattr(x, 'text', '') for x in res.content)]))\n"
        "asyncio.run(go())\n"
    )
    done = subprocess.run([str(MCP_PYTHON), "-c", probe, json.dumps(conf)], capture_output=True, text=True, timeout=120, env={**os.environ, "FORMWAV_ENGINE": engine_url})
    assert done.stdout.strip(), done.stderr[-500:]
    ok, text = json.loads(done.stdout.strip().splitlines()[-1])
    assert ok and '"version"' in text, text[:300]
