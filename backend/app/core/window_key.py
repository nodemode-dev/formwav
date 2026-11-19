from __future__ import annotations

import asyncio
import hmac
import json
import os
import secrets
import time
from urllib.parse import parse_qs

from fastapi import HTTPException, Request

HEADER = "x-formwav-window-key"
STDOUT_ENV = "FORMWAV_WINDOW_KEY_STDOUT"
LINE = "formwav-window-key: "
REFUSED = "Only the formwav window can do this"
AGENT_HEADER = "x-formwav-agent"
TICKET_LIFE = 30.0
READS = ("GET", "HEAD", "OPTIONS")
OPEN = ("/mcp", "/api/window/key")
SECRET_READS = ("/api/bridge/next", "/api/claude/state", "/api/claude/sessions", "/api/claude/events", "/api/terminal/list")
TICKETED = ("/api/claude/events",)
WINDOW_ONLY = ("/api/agents", "/api/bridge", "/api/terminal", "/api/claudecode", "/api/claude","/api/remote", "/api/keys", "/api/settings", "/api/window", "/api/extensions")
DEVICE_OPEN = ("/api/remote/pair",)
KEY = secrets.token_urlsafe(32)
STATE = {"claimed": False, "secondClaim": False}
TICKETS: dict[str, float] = {}


def stdout_mode() -> bool:
    return os.environ.get(STDOUT_ENV) == "1"


def valid(value) -> bool:
    return isinstance(value, str) and bool(value) and hmac.compare_digest(value.encode("utf-8"), KEY.encode("utf-8"))


def require(request: Request) -> None:
    if not valid(request.headers.get(HEADER)):
        raise HTTPException(403, REFUSED)


def claim() -> str | None:
    if STATE["claimed"]:
        STATE["secondClaim"] = True
        return None
    STATE["claimed"] = True
    return KEY


def ticket() -> str:
    now = time.monotonic()
    for old in [t for t, at in TICKETS.items() if now - at > TICKET_LIFE]:
        TICKETS.pop(old, None)
    value = secrets.token_urlsafe(24)
    TICKETS[value] = now
    return value


def spend(value) -> bool:
    if not isinstance(value, str) or not value:
        return False
    at = TICKETS.pop(value, None)
    return at is not None and time.monotonic() - at <= TICKET_LIFE


async def socket_key(ws) -> bool:
    try:
        first = json.loads(await asyncio.wait_for(ws.receive_text(), 10))
    except Exception:
        return False
    return isinstance(first, dict) and first.get("type") == "key" and valid(first.get("key"))


def _window_only(path: str) -> bool:
    return any(path == p or path.startswith(p + "/") for p in WINDOW_ONLY)


async def _refuse(send, detail: str) -> None:
    body = json.dumps({"detail": detail}).encode("utf-8")
    await send({"type": "http.response.start", "status": 403, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()), (b"x-content-type-options", b"nosniff")]})
    await send({"type": "http.response.body", "body": body})


class WindowKeyGuard:
    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        method, path = scope.get("method", "GET"), str(scope.get("path", ""))
        secret_read = path.startswith(SECRET_READS)
        if path in OPEN or (method in READS and not secret_read):
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers") or []}
        if valid(headers.get(HEADER)):
            await self.app(scope, receive, send)
            return
        if method in READS and path.startswith(TICKETED) and spend((parse_qs(scope.get("query_string", b"").decode("latin-1")).get("ticket") or [""])[0]):
            await self.app(scope, receive, send)
            return
        if scope.get("formwav.remote") and (path in DEVICE_OPEN or not (secret_read or _window_only(path))):
            await self.app(scope, receive, send)
            return
        agent = headers.get(AGENT_HEADER, "").strip()
        if agent and method not in READS and path.startswith("/api/") and not _window_only(path):
            from ..routers.claude import CONSENT

            reason = await CONSENT.check(f"{method} {path}", agent[:60])
            if reason is None:
                await self.app(scope, receive, send)
                return
            await _refuse(send, reason)
            return
        await _refuse(send, REFUSED)
