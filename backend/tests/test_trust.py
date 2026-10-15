import asyncio
import json
import subprocess
import sys
import types

import pytest

from app.routers import agents
from app.services import local_speech, mcp_stdio, provenance, winpty_relay
from conftest import BACKEND, _free_port


def test_every_generator_and_model_names_its_source_licences_and_where_it_runs(client):
    rows = client.get("/api/providers").json()["provenance"]
    ids = {r["id"] for r in rows}
    assert {"elevenlabs", "fal", "acestep", "dubbing", "whisper", "demucs", "tiger", "deepfilter", "silero", "dnsmos", "samaudio"} <= ids
    assert set(local_speech.ENGINES) <= ids
    for r in rows:
        assert r["source"].startswith("https://") and r["code"] and r["weights"] and r["runs"] and r["sends"]
    cloud = {r["id"] for r in rows if r["sends"] != "nothing"}
    assert cloud == {"elevenlabs", "fal", "acestep"}
    assert all("upload" in r["sends"] for r in rows if r["id"] in {"elevenlabs", "fal"})
    assert "watermark" in provenance.find("chatterbox")["note"]
    assert provenance.find("kokoro")["weights"] == local_speech.ENGINES["kokoro"]["license"]


def test_the_models_status_tool_carries_the_provenance():
    src = (BACKEND / "formwav_mcp" / "server.py").read_text()
    assert '"provenance": listing.get("provenance", [])' in src


class FakePty:
    spawned: list = []

    def __init__(self, argv, cwd, env, dims):
        self.argv, self.cwd, self.env, self.size = argv, cwd, env, dims
        self.written: list[str] = []
        self.chunks = ["PS> ", "hello\r\n"]
        self.alive = True
        self.killed = False

    @classmethod
    def spawn(cls, argv, cwd=None, env=None, dimensions=(24, 80)):
        p = cls(argv, cwd, env, dimensions)
        cls.spawned.append(p)
        return p

    def read(self, size=1024):
        if self.chunks:
            return self.chunks.pop(0)
        if not self.alive:
            raise EOFError("Pty is closed")
        import time

        time.sleep(0.01)
        return ""

    def write(self, s):
        self.written.append(s)
        if s == "exit\r":
            self.alive = False

    def setwinsize(self, rows, cols):
        self.size = (rows, cols)

    def isalive(self):
        return self.alive

    def terminate(self, force=False):
        self.killed = force
        self.alive = False


class FakeSocket:
    def __init__(self, incoming):
        self.incoming = list(incoming)
        self.sent: list[bytes] = []
        self.closed = False

    async def receive(self):
        await asyncio.sleep(0.05)
        if self.incoming:
            return self.incoming.pop(0)
        await asyncio.sleep(10)
        return {"type": "websocket.disconnect"}

    async def send_bytes(self, data):
        self.sent.append(data)

    async def close(self, code=1000):
        self.closed = True


def test_the_windows_terminal_relays_through_a_conpty_both_ways_resizes_and_ends_with_its_shell(monkeypatch):
    monkeypatch.setitem(sys.modules, "winpty", types.SimpleNamespace(PtyProcess=FakePty))
    FakePty.spawned.clear()
    ws = FakeSocket([{"type": "websocket.receive", "text": json.dumps({"type": "resize", "rows": 40, "cols": 120})}, {"type": "websocket.receive", "bytes": "dir\r".encode()}, {"type": "websocket.receive", "bytes": b"exit\r"}])
    asyncio.run(asyncio.wait_for(winpty_relay.relay(ws, ["C:/Users/a/AppData/Roaming/npm/claude.cmd", "--mcp-config", "{}"], "C:/Users/a", {"PATH": "x"}), 10))
    p = FakePty.spawned[0]
    assert p.argv[1:] == ["/c", "C:/Users/a/AppData/Roaming/npm/claude.cmd", "--mcp-config", "{}"]
    assert p.cwd == "C:/Users/a" and p.env == {"PATH": "x"}
    assert b"".join(ws.sent) == b"PS> hello\r\n"
    assert p.size == (40, 120) and p.written == ["dir\r", "exit\r"]
    assert p.killed and ws.closed


def test_the_windows_terminal_says_what_is_missing_without_pywinpty(monkeypatch):
    monkeypatch.setitem(sys.modules, "winpty", None)
    ws = FakeSocket([])
    asyncio.run(winpty_relay.relay(ws, ["cmd.exe"], ".", {}))
    assert b"pywinpty" in b"".join(ws.sent) and ws.closed
    assert winpty_relay.runnable(["C:/x/claude.exe", "-p"]) == ["C:/x/claude.exe", "-p"]


def _shim(lines, env):
    import os

    done = subprocess.run([sys.executable, str(BACKEND / "desktop_entry.py"), "--mcp-stdio"], input="\n".join(lines) + "\n", capture_output=True, text=True, cwd=BACKEND, env={**os.environ, **env}, timeout=60)
    return [json.loads(x) for x in done.stdout.splitlines() if x.strip()]


def test_the_desktop_engine_speaks_stdio_mcp_by_relaying_to_the_running_app(engine_url, tmp_path):
    lines = [
        json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "clientInfo": {"name": "Claude Desktop"}, "capabilities": {}}}),
        json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}),
        json.dumps({"jsonrpc": "2.0", "id": 2, "method": "ping"}),
        json.dumps({"jsonrpc": "2.0", "id": 3, "method": "tools/list"}),
    ]
    port = engine_url.rsplit(":", 1)[1]
    (tmp_path / mcp_stdio.PORT_FILE).write_text(port)
    out = _shim(lines, {"FORMWAV_DATA_DIR": str(tmp_path)})
    assert [m["id"] for m in out] == [1, 2, 3]
    assert out[0]["result"]["serverInfo"]["name"] == "formwav" and out[1]["result"] == {} and isinstance(out[2]["result"]["tools"], list)
    dead = _shim([lines[0], lines[1]], {"FORMWAV_MCP_URL": f"http://127.0.0.1:{_free_port()}/mcp"})
    assert len(dead) == 1 and dead[0]["id"] == 1 and "open the formwav app" in dead[0]["error"]["message"]


def test_settings_agents_points_stdio_clients_at_the_desktop_engine_when_frozen(monkeypatch):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", "/Applications/formwav.app/Contents/MacOS/formwav-engine")
    assert agents.server_command() == ("/Applications/formwav.app/Contents/MacOS/formwav-engine", ["--mcp-stdio"], {})
    desktop = next(c for c in agents.clients() if c["id"] == "claude-desktop")
    assert json.loads(desktop["text"])["mcpServers"]["formwav"] == {"command": "/Applications/formwav.app/Contents/MacOS/formwav-engine", "args": ["--mcp-stdio"]}
