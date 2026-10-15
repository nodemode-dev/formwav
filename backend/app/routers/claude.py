"""Claude Code in formwav, and formwav's session tools for any agent (PLAN_v14 W1, after formlit's dock chat and
formvis's window bridge).

- The window bridge. The open session lives in the page, so its tools run there: the page posts its tool list to
  /api/bridge/catalogue and asks /api/bridge/next (held up to 20 s) for work, runs it as one undoable step and posts
  /api/bridge/result. Nothing runs when no window is open; a call then says so.
- /mcp: formwav's MCP server on the engine itself, stateless JSON-RPC over HTTP (initialize, tools/list, tools/call,
  ping). Its tools are the window's. Claude Code in the Agent column and the terminal reach it with the engine's
  token; an outside agent added with `claude mcp add --transport http formwav http://127.0.0.1:<port>/mcp` reaches it
  too. The engine binds loopback and the lockdown holds the Host to loopback, so no web page can call it.
- The chat: /api/claude/chat runs `claude -p` with the user's own login for one message, streams its text, tool calls
  and results as server-sent events on /api/claude/events, and resumes the same Claude session on the next message.
"""

from __future__ import annotations

import asyncio
import itertools
import json
import subprocess
import threading
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import BaseModel

from ..services import claude_code

router = APIRouter()
PROTOCOLS = ("2025-11-25", "2025-06-18", "2025-03-26")


class Bridge:
    def __init__(self) -> None:
        self.tools: list[dict] = []
        self.pending: asyncio.Queue | None = None
        self.waiting: dict[str, asyncio.Future] = {}
        self.seen = 0.0
        self.ids = itertools.count(1)

    def queue(self) -> asyncio.Queue:
        if self.pending is None:
            self.pending = asyncio.Queue()
        return self.pending

    def live(self) -> bool:
        return time.monotonic() - self.seen < 45

    async def call(self, name: str, arguments: dict, who: str) -> Any:
        if not self.live():
            raise RuntimeError("formwav's window is not open: the session's tools run in it. Open formwav and try again.")
        cid = str(next(self.ids))
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self.waiting[cid] = fut
        await self.queue().put({"id": cid, "name": name, "arguments": arguments, "who": who})
        try:
            return await asyncio.wait_for(fut, timeout=600)
        finally:
            self.waiting.pop(cid, None)


BRIDGE = Bridge()


class Consent:
    """PLAN_v14 W2: an agent from outside formwav (one added with claude mcp add, the command line, another program)
    is asked about once: the window shows Allow, Always allow and Block; Always allow and Block are kept in the data
    folder's agents.json (outside: ask, allow or block), Allow lasts until the engine stops. The Agent column's own
    Claude Code carries the engine's token and is never asked."""

    def __init__(self) -> None:
        self.session: str | None = None
        self.lock: asyncio.Lock | None = None

    def _file(self):
        from ..core.paths import data_dir

        return data_dir() / "agents.json"

    def policy(self) -> str:
        try:
            value = json.loads(self._file().read_text()).get("outside", "ask")
        except (OSError, ValueError, AttributeError):
            value = "ask"
        return value if value in ("ask", "allow", "block") else "ask"

    def keep(self, value: str) -> None:
        try:
            self._file().write_text(json.dumps({"outside": value}))
        except OSError:
            pass

    async def check(self, name: str, client: str) -> str | None:
        policy = self.policy()
        if policy == "allow" or self.session == "allow":
            return None
        if policy == "block" or self.session == "block":
            return "The person using formwav has blocked outside agents (Settings > Agents, or the Agent column's prompt)."
        if self.lock is None:
            self.lock = asyncio.Lock()
        async with self.lock:
            if self.session in ("allow", "block"):
                return None if self.session == "allow" else "Blocked by the person using formwav."
            if not BRIDGE.live():
                return "formwav's window is not open: the session's tools run in it, and the person there is asked first."
            cid = str(next(BRIDGE.ids))
            fut: asyncio.Future = asyncio.get_running_loop().create_future()
            BRIDGE.waiting[cid] = fut
            await BRIDGE.queue().put({"id": cid, "consent": True, "name": name, "client": client})
            try:
                choice = await asyncio.wait_for(fut, timeout=120)
            except asyncio.TimeoutError:
                return "Nobody answered formwav's prompt within two minutes; ask again when someone is at formwav."
            finally:
                BRIDGE.waiting.pop(cid, None)
            if choice == "always":
                self.keep("allow")
            self.session = "block" if choice == "block" else "allow"
            return "Blocked by the person using formwav." if choice == "block" else None


CONSENT = Consent()
CLIENTS: dict[str, str] = {}


@router.get("/api/agents/outside")
def outside_policy() -> dict:
    return {"outside": CONSENT.policy(), "now": CONSENT.session}


class Policy(BaseModel):
    outside: str


@router.post("/api/agents/outside")
def set_outside_policy(body: Policy) -> dict:
    if body.outside not in ("ask", "allow", "block"):
        raise HTTPException(status_code=400, detail="outside must be ask, allow or block")
    CONSENT.keep(body.outside)
    CONSENT.session = None
    return {"outside": body.outside}


async def _run_tool(name: str, arguments: dict, who: str, client: str) -> tuple[bool, Any]:
    if who == "outside":
        refused = await CONSENT.check(name, client)
        if refused:
            return False, refused
    try:
        return True, await BRIDGE.call(name, arguments, who)
    except (RuntimeError, asyncio.TimeoutError) as err:
        return False, str(err) or "the tool took too long"


@router.get("/api/commands")
async def list_commands(group: str | None = None, text: str | None = None) -> Any:
    ok, out = await _run_tool("list_commands", {k: v for k, v in (("group", group), ("text", text)) if v}, "outside", "formwav's command line")
    if not ok:
        raise HTTPException(status_code=409, detail=out)
    return out


@router.get("/api/commands/{cid}")
async def describe(cid: str) -> Any:
    ok, out = await _run_tool("describe_command", {"id": cid}, "outside", "formwav's command line")
    if not ok:
        raise HTTPException(status_code=404 if "no command" in str(out) else 409, detail=out)
    return out


class Params(BaseModel):
    params: dict = {}


@router.post("/api/commands/{cid}")
async def run(cid: str, body: Params) -> Any:
    ok, out = await _run_tool("run_command", {"id": cid, "params": body.params}, "outside", "formwav's command line")
    return {"ok": True, **out} if ok and isinstance(out, dict) else {"ok": ok, "result" if ok else "error": out}


class Catalogue(BaseModel):
    tools: list[dict]


@router.post("/api/bridge/catalogue")
def bridge_catalogue(body: Catalogue) -> dict:
    BRIDGE.tools = [t for t in body.tools if isinstance(t.get("name"), str)]
    BRIDGE.seen = time.monotonic()
    return {"tools": len(BRIDGE.tools)}


@router.get("/api/bridge/next")
async def bridge_next() -> Response:
    BRIDGE.seen = time.monotonic()
    try:
        item = await asyncio.wait_for(BRIDGE.queue().get(), timeout=20)
    except asyncio.TimeoutError:
        BRIDGE.seen = time.monotonic()
        return Response(status_code=204)
    BRIDGE.seen = time.monotonic()
    return JSONResponse(item)


class Result(BaseModel):
    id: str
    ok: bool = True
    result: Any = None
    error: str | None = None


@router.post("/api/bridge/result")
def bridge_result(body: Result) -> dict:
    fut = BRIDGE.waiting.get(body.id)
    if fut and not fut.done():
        if body.ok:
            fut.set_result(body.result)
        else:
            fut.set_exception(RuntimeError(body.error or "the tool failed"))
    return {"ok": True}


def _rpc(id_: Any, result: Any = None, error: tuple[int, str] | None = None) -> JSONResponse:
    body: dict = {"jsonrpc": "2.0", "id": id_}
    if error:
        body["error"] = {"code": error[0], "message": error[1]}
    else:
        body["result"] = result
    return JSONResponse(body)


@router.post("/mcp")
async def mcp(request: Request) -> Response:
    origin = request.headers.get("origin")
    if origin and not origin.startswith(("http://127.0.0.1", "http://localhost", "http://[::1]", "tauri://", "http://tauri.localhost")):
        raise HTTPException(status_code=403, detail="formwav's MCP server answers local agents only")
    try:
        msg = await request.json()
    except ValueError:
        return _rpc(None, error=(-32700, "not JSON"))
    if isinstance(msg, list):
        return _rpc(None, error=(-32600, "batches are not taken; send one request at a time"))
    method, id_, params = msg.get("method"), msg.get("id"), msg.get("params") or {}
    if id_ is None:
        return Response(status_code=202)
    who = "inapp" if request.headers.get("x-formwav-inapp") == claude_code.INAPP_TOKEN else "outside"
    if method == "initialize":
        info = params.get("clientInfo") or {}
        if info.get("name"):
            CLIENTS[request.client.host if request.client else "?"] = str(info.get("name"))[:60]
        asked = params.get("protocolVersion")
        from ..core.version import VERSION

        return _rpc(id_, {"protocolVersion": asked if asked in PROTOCOLS else PROTOCOLS[0], "capabilities": {"tools": {"listChanged": False}}, "serverInfo": {"name": "formwav", "version": VERSION}, "instructions": claude_code.NOTE})
    if method == "ping":
        return _rpc(id_, {})
    if method == "tools/list":
        tools = [{"name": t["name"], "description": t.get("description", ""), "inputSchema": t.get("input_schema") or {"type": "object", "properties": {}}} for t in BRIDGE.tools]
        return _rpc(id_, {"tools": tools})
    if method == "tools/call":
        name = params.get("name")
        if not any(t["name"] == name for t in BRIDGE.tools):
            return _rpc(id_, {"content": [{"type": "text", "text": f"There is no formwav tool named {name}; call tools/list." if BRIDGE.live() else "formwav's window is not open: the session's tools run in it."}], "isError": True})
        client = request.headers.get("x-formwav-agent") or CLIENTS.get(request.client.host if request.client else "?", "An agent outside formwav")
        ok, out = await _run_tool(name, params.get("arguments") or {}, who, client)
        text = out if isinstance(out, str) else json.dumps(out)
        return _rpc(id_, {"content": [{"type": "text", "text": text}], "isError": not ok})
    return _rpc(id_, error=(-32601, f"no method {method}"))


@router.get("/api/claude/status")
def claude_status() -> dict:
    return {**claude_code.info(), "window": BRIDGE.live(), "tools": len(BRIDGE.tools)}


class Chat:
    def __init__(self) -> None:
        self.session: str | None = None
        self.proc: subprocess.Popen | None = None
        self.busy = False
        self.listeners: set[asyncio.Queue] = set()
        self.loop: asyncio.AbstractEventLoop | None = None

    def publish(self, kind: str, **payload: Any) -> None:
        if not self.loop:
            return
        event = {"type": kind, **payload}
        for q in list(self.listeners):
            self.loop.call_soon_threadsafe(q.put_nowait, event)


CHAT = Chat()


def _brief(value: Any) -> str:
    text = json.dumps(value) if not isinstance(value, str) else value
    return text if len(text) <= 160 else text[:157] + "..."


def _run_chat(argv: list[str], cwd: str) -> None:
    started = time.monotonic()
    error = None
    meta: dict = {}
    try:
        proc = subprocess.Popen(claude_code.shell_wrapped(argv), cwd=cwd, env=claude_code.child_env(), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
        CHAT.proc = proc
        assert proc.stdout is not None
        for line in proc.stdout:
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                ev = json.loads(line)
            except ValueError:
                continue
            if ev.get("parent_tool_use_id"):
                continue
            kind = ev.get("type")
            if kind == "system" and ev.get("subtype") == "init":
                CHAT.session = ev.get("session_id") or CHAT.session
                CHAT.publish("start", model=ev.get("model"))
            elif kind == "stream_event":
                inner = ev.get("event") or {}
                delta = inner.get("delta") or {}
                if inner.get("type") == "content_block_delta" and delta.get("type") == "text_delta":
                    CHAT.publish("delta", text=delta.get("text", ""))
            elif kind == "assistant":
                for block in (ev.get("message") or {}).get("content") or []:
                    if block.get("type") == "tool_use" and block.get("name") != "ToolSearch":
                        name = str(block.get("name", "")).replace("mcp__formwav__", "")
                        CHAT.publish("tool", id=block.get("id"), name=name, input=_brief(block.get("input") or {}))
            elif kind == "user":
                for block in (ev.get("message") or {}).get("content") or []:
                    if isinstance(block, dict) and block.get("type") == "tool_result":
                        CHAT.publish("toolDone", id=block.get("tool_use_id"), error=bool(block.get("is_error")))
            elif kind == "result":
                CHAT.session = ev.get("session_id") or CHAT.session
                meta = {"seconds": round(time.monotonic() - started, 1), "turns": ev.get("num_turns"), "cost": ev.get("total_cost_usd")}
                if ev.get("is_error"):
                    error = str(ev.get("result") or "Claude Code stopped with an error")
        proc.wait(timeout=30)
        if proc.returncode and not error and not meta:
            err = (proc.stderr.read() if proc.stderr else "").strip()
            error = err.splitlines()[-1] if err else f"Claude Code exited with {proc.returncode}"
    except FileNotFoundError:
        error = claude_code.INSTALL
    except (OSError, subprocess.SubprocessError) as err:
        error = f"Claude Code could not run: {err}"
    finally:
        CHAT.proc = None
        CHAT.busy = False
        CHAT.publish("done", error=error, meta=meta)


class Message(BaseModel):
    text: str
    context: str | None = None


@router.post("/api/claude/chat")
async def claude_chat(body: Message, request: Request) -> dict:
    if CHAT.busy:
        raise HTTPException(status_code=409, detail="Claude Code is still answering the last message; Stop it first")
    if not claude_code.cli():
        raise HTTPException(status_code=424, detail=claude_code.INSTALL)
    CHAT.loop = asyncio.get_running_loop()
    base = f"http://{request.url.netloc}"
    text = body.text.strip() + (f"\n\n({body.context})" if body.context else "")
    argv = claude_code.argv(base, text, CHAT.session, print_mode=True)
    CHAT.busy = True
    threading.Thread(target=_run_chat, args=(argv, str(claude_code.workdir())), daemon=True).start()
    return {"started": True, "session": CHAT.session}


@router.post("/api/claude/cancel")
def claude_cancel() -> dict:
    if CHAT.proc:
        CHAT.proc.terminate()
    return {"ok": True}


@router.post("/api/claude/reset")
def claude_reset() -> dict:
    if CHAT.busy:
        raise HTTPException(status_code=409, detail="Stop Claude Code first")
    CHAT.session = None
    return {"ok": True}


@router.get("/api/claude/events")
async def claude_events(request: Request) -> StreamingResponse:
    CHAT.loop = asyncio.get_running_loop()
    q: asyncio.Queue = asyncio.Queue()
    CHAT.listeners.add(q)

    async def stream():
        try:
            yield "retry: 1500\n\n"
            yield f"data: {json.dumps({'type': 'hello', 'busy': CHAT.busy, 'session': CHAT.session})}\n\n"
            while not await request.is_disconnected():
                try:
                    event = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            CHAT.listeners.discard(q)

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
