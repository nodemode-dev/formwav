import json
import threading
import time

import httpx
import pytest

from app.core.paths import data_dir
from app.routers import claude as bridge
from app.services import claude_code

HEADERS = {"host": "127.0.0.1:8060"}
TOOLS = [{"name": "get_session", "description": "reads"}, {"name": "set_tempo", "description": "changes"}]
NO_WINDOW = "and the person there is asked first"
BLOCKED = "has blocked outside agents"
DECLINED = "Blocked by the person using formwav"
NOT_OPEN = "Open formwav and try again"
AGENTS = data_dir() / "agents.json"


def reset(policy=None, window=False):
    bridge.BRIDGE.tools = list(TOOLS)
    bridge.BRIDGE.seen = time.monotonic() if window else 0.0
    bridge.BRIDGE.pending = None
    bridge.BRIDGE.waiting.clear()
    bridge.CONSENT.session = None
    bridge.CONSENT.lock = None
    if policy is None:
        AGENTS.unlink(missing_ok=True)
    else:
        AGENTS.write_text(json.dumps({"outside": policy}))


@pytest.fixture(autouse=True)
def clean():
    reset()
    yield
    reset()
    bridge.BRIDGE.tools = []


def rpc_text(reply):
    result = reply["result"]
    return result["isError"], " ".join(c["text"] for c in result["content"])


def call(client, tool, headers=None):
    body = {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": tool, "arguments": {}}}
    r = client.post("/mcp", json=body, headers={**HEADERS, **(headers or {})})
    assert r.status_code == 200, r.text
    return rpc_text(r.json())


@pytest.mark.parametrize("tool", ["get_session", "set_tempo"])
def test_with_no_window_an_outside_tool_is_refused_and_not_run(client, tool):
    error, text = call(client, tool)
    assert error and NO_WINDOW in text


def test_block_refuses_an_outside_tool(client):
    reset("block", window=True)
    error, text = call(client, "set_tempo")
    assert error and BLOCKED in text


def test_block_refuses_even_with_no_window(client):
    reset("block")
    assert BLOCKED in call(client, "get_session")[1]


def test_allow_passes_the_ask_and_reaches_the_window_bridge(client):
    reset("allow")
    error, text = call(client, "set_tempo")
    assert error and NOT_OPEN in text and NO_WINDOW not in text


def test_the_inapp_token_skips_the_ask(client):
    error, text = call(client, "set_tempo", {"x-formwav-inapp": claude_code.INAPP_TOKEN})
    assert error and NOT_OPEN in text and NO_WINDOW not in text


def test_the_inapp_token_is_not_stopped_by_block(client):
    reset("block")
    assert BLOCKED not in call(client, "set_tempo", {"x-formwav-inapp": claude_code.INAPP_TOKEN})[1]


@pytest.mark.parametrize("token", ["", "wrong-token", "x" * 64])
def test_a_wrong_inapp_token_does_not_skip_the_ask(client, token):
    error, text = call(client, "set_tempo", {"x-formwav-inapp": token})
    assert error and NO_WINDOW in text


def test_an_unknown_tool_is_not_run(client):
    reset(window=True)
    error, text = call(client, "no_such_tool")
    assert error and "no formwav tool" in text


def test_the_policy_is_kept_only_as_ask_allow_or_block(client):
    assert client.post("/api/agents/outside", json={"outside": "sometimes"}).status_code == 400
    assert client.post("/api/agents/outside", json={"outside": "block"}).json() == {"outside": "block"}
    assert client.get("/api/agents/outside").json()["outside"] == "block"
    AGENTS.write_text("not json")
    assert client.get("/api/agents/outside").json()["outside"] == "ask"


class Window:
    def __init__(self, base):
        self.base = base
        self.http = httpx.Client(base_url=base, headers={"x-formwav-local": "1"}, timeout=30)
        self.http.post("/api/agents/outside", json={"outside": "ask"})
        self.http.post("/api/bridge/catalogue", json={"tools": TOOLS})

    def next(self, within=10.0):
        deadline = time.monotonic() + within
        while time.monotonic() < deadline:
            r = self.http.get("/api/bridge/next")
            if r.status_code == 200:
                return r.json()
        raise AssertionError("the engine asked the window for nothing")

    def answer(self, item, result):
        assert self.http.post("/api/bridge/result", json={"id": item["id"], "result": result}).status_code == 200

    def outside_call(self, tool):
        out = {}

        def run():
            body = {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": tool, "arguments": {}}}
            r = httpx.post(self.base + "/mcp", json=body, headers={"x-formwav-local": "1"}, timeout=30)
            out["error"], out["text"] = rpc_text(r.json())

        thread = threading.Thread(target=run)
        thread.start()
        return thread, out


@pytest.fixture
def window(engine_url):
    w = Window(engine_url)
    yield w
    w.http.post("/api/agents/outside", json={"outside": "ask"})
    AGENTS.unlink(missing_ok=True)


def test_the_window_is_asked_and_a_decline_blocks_every_later_call(window):
    thread, out = window.outside_call("set_tempo")
    item = window.next()
    assert item["consent"] is True and item["name"] == "set_tempo"
    window.answer(item, "block")
    thread.join(10)
    assert out["error"] and DECLINED in out["text"]
    thread, again = window.outside_call("get_session")
    thread.join(10)
    assert again["error"] and BLOCKED in again["text"]
    assert window.http.get("/api/agents/outside").json()["now"] == "block"


def test_allow_once_runs_the_tool_in_the_window_and_is_not_kept(window):
    thread, out = window.outside_call("set_tempo")
    window.answer(window.next(), "allow")
    run = window.next()
    assert run["name"] == "set_tempo" and "consent" not in run
    window.answer(run, {"done": True})
    thread.join(10)
    assert out["error"] is False and json.loads(out["text"]) == {"done": True}
    assert window.http.get("/api/agents/outside").json() == {"outside": "ask", "now": "allow"}


def test_always_allow_is_kept_in_the_data_folder(window):
    thread, out = window.outside_call("set_tempo")
    window.answer(window.next(), "always")
    window.answer(window.next(), "ok")
    thread.join(10)
    assert json.loads(AGENTS.read_text()) == {"outside": "allow"}
    assert window.http.get("/api/agents/outside").json()["outside"] == "allow"
