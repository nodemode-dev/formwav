import json
import re

import httpx
import pytest

from app.core import seal, window_key
from app.routers import claude

READS = {"GET", "HEAD", "OPTIONS"}
OPEN = {("POST", "/mcp"), ("POST", "/api/window/key")}
REFUSED = {"detail": "Only the formwav window can do this"}


def write_operations(app):
    return [(m.upper(), path) for path, item in app.openapi()["paths"].items() for m in item if m.upper() not in READS]


def test_the_open_list_is_short_and_named():
    assert set(window_key.OPEN) == {"/mcp", "/api/window/key"}


def test_every_write_route_needs_the_window_key(bare):
    ops = write_operations(bare.app)
    assert len(ops) > 100
    answered = []
    for method, path in ops:
        if (method, path) in OPEN:
            continue
        url = re.sub(r"\{[^}]+\}", "x", path)
        for headers in ({}, {window_key.HEADER: "x" * 43}):
            r = bare.request(method, url, json={}, headers=headers)
            if r.status_code != 403 or r.json() != REFUSED:
                answered.append(f"{method} {path} {r.status_code}")
    assert not answered, "write routes that answer without the window key (add the key, or name the route in window_key.OPEN with its caller): " + ", ".join(answered)


@pytest.mark.parametrize("path", ["/api/bridge/next", "/api/claude/state", "/api/claude/sessions", "/api/terminal/list", "/api/claude/events"])
def test_reads_that_hold_a_secret_need_the_key(bare, path):
    assert bare.get(path).json() == REFUSED


def test_the_open_routes_answer_without_the_key(bare):
    r = bare.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "ping", "params": {}})
    assert r.status_code == 200 and r.json()["result"] == {}


def test_an_agent_cannot_change_its_own_access(bare, client):
    client.post("/api/agents/outside", json={"outside": "ask"})
    for policy in ("allow", "block"):
        r = bare.post("/api/agents/outside", json={"outside": policy}, headers={window_key.AGENT_HEADER: "formwav's command line"})
        assert r.json() == REFUSED
    assert client.get("/api/agents/outside").json()["outside"] == "ask"


def test_an_agent_write_follows_the_stored_choice(bare, client):
    claude.BRIDGE.seen = 0.0
    agent = {window_key.AGENT_HEADER: "formwav's MCP server"}
    client.post("/api/agents/outside", json={"outside": "block"})
    assert "blocked outside agents" in bare.put("/api/presets", json=[], headers=agent).json()["detail"]
    client.post("/api/agents/outside", json={"outside": "ask"})
    assert "window is not open" in bare.put("/api/presets", json=[], headers=agent).json()["detail"]
    client.post("/api/agents/outside", json={"outside": "allow"})
    assert bare.put("/api/presets", json=[], headers=agent).status_code == 200
    client.post("/api/agents/outside", json={"outside": "ask"})


def test_the_ticket_opens_the_chat_stream_once():
    import asyncio

    async def ok(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    def status(query):
        got = []

        async def send(message):
            if message["type"] == "http.response.start":
                got.append(message["status"])

        scope = {"type": "http", "method": "GET", "path": "/api/claude/events", "query_string": query.encode(), "headers": []}
        asyncio.run(window_key.WindowKeyGuard(ok)(scope, None, send))
        return got[0]

    ticket = window_key.ticket()
    assert [status(f"ticket={ticket}"), status(f"ticket={ticket}"), status("")] == [200, 403, 403]


def test_the_bootstrap_answers_once_then_refuses(engine_url):
    headers = {"x-formwav-local": "1"}
    first = httpx.post(engine_url + "/api/window/key", headers=headers, timeout=30)
    second = httpx.post(engine_url + "/api/window/key", headers=headers, timeout=30)
    assert first.status_code == 200 and len(first.json()["key"]) >= 32
    assert second.status_code == 409
    assert httpx.get(engine_url + "/api/agents/outside", timeout=30).json()["secondWindowClaim"] is True
    key = {**headers, window_key.HEADER: first.json()["key"]}
    sid = httpx.post(engine_url + "/api/terminal/open", json={"cols": 80, "rows": 24}, headers=key, timeout=30)
    if sid.status_code != 200:
        pytest.skip(f"no terminal here: {sid.text}")
    from websockets.sync.client import connect

    ws_url = engine_url.replace("http://", "ws://") + f"/api/terminal/{sid.json()['id']}"
    with connect(ws_url, origin=engine_url, open_timeout=10) as sock:
        sock.send(json.dumps({"type": "input", "data": "echo nokey\n"}))
        with pytest.raises(Exception):
            sock.recv(timeout=5)
    with connect(ws_url, origin=engine_url, open_timeout=10) as sock:
        sock.send(json.dumps({"type": "key", "key": first.json()["key"]}))
        sock.send(json.dumps({"type": "input", "data": "echo key-$((40+2))\n"}))
        seen = ""
        for _ in range(50):
            seen += sock.recv(timeout=5)
            if "key-42" in seen:
                break
        assert "key-42" in seen
    httpx.post(engine_url + "/api/terminal/close", json={"id": sid.json()["id"]}, headers=key, timeout=30)


class _Store:
    def __init__(self):
        from keyring.backend import KeyringBackend

        class Memory(KeyringBackend):
            priority = 1
            values: dict = {}

            def get_password(self, service, username):
                return self.values.get((service, username))

            def set_password(self, service, username, password):
                self.values[(service, username)] = password

            def delete_password(self, service, username):
                self.values.pop((service, username), None)

        self.backend = Memory()


def test_a_hand_edit_of_the_stored_choice_is_caught(client):
    import keyring
    from keyring.backends import fail

    before = keyring.get_keyring()
    agents = claude.CONSENT._file()
    try:
        keyring.set_keyring(_Store().backend)
        seal.reset()
        client.post("/api/agents/outside", json={"outside": "allow"})
        assert client.get("/api/agents/outside").json()["seal"] == "ok"
        agents.write_text(json.dumps({"outside": "allow", "seal": "0" * 64}))
        state = client.get("/api/agents/outside").json()
        assert state["outside"] == "ask" and state["sealBroken"] is True
        agents.write_text(json.dumps({"outside": "block"}))
        assert client.get("/api/agents/outside").json()["outside"] == "block"
        keyring.set_keyring(fail.Keyring())
        seal.reset()
        agents.write_text(json.dumps({"outside": "allow"}))
        state = client.get("/api/agents/outside").json()
        assert state["outside"] == "allow" and state["seal"] == "unavailable"
    finally:
        keyring.set_keyring(before)
        seal.reset()
        agents.unlink(missing_ok=True)
