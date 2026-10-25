"""The engine's loopback lockdown (tauri-compiler-skill, local API security), for the web build and the desktop app alike.

A localhost server is reachable by every process on the machine and, through the browser, by any page the user opens:
CORS keeps a foreign page from reading answers, not from sending simple requests, and DNS rebinding can point a hostile
name at 127.0.0.1. Four cheap layers, one ASGI middleware over HTTP and WebSocket:

1. the client must be loopback;
2. the Host header must name loopback (a rebinding page arrives with its own name and is refused);
3. every mutating /api request (POST, PUT, PATCH, DELETE) must carry `x-formwav-local: 1`, a custom header a foreign
   page cannot add without a preflight the engine never grants (the app's fetch, the MCP server and the tests send it);
4. every answer carries `X-Content-Type-Options: nosniff`.

Refusals are 403 with a JSON reason; a refused WebSocket is closed before it is accepted.
"""

from __future__ import annotations

import re

_HOST = re.compile(r"^(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[::1\])(:\d+)?$", re.IGNORECASE)
_MUTATING = {"POST", "PUT", "PATCH", "DELETE"}
LOCAL_HEADER = "x-formwav-local"


def _loopback(client: str) -> bool:
    return client.startswith("127.") or client in ("::1", "localhost", "testclient")


def ws_allowed(origin: str | None, host: str | None) -> bool:
    """A WebSocket is accepted only from the app's own origins, since browsers let any page open one to 127.0.0.1: the
    dev origins, or the engine's own (the desktop app serves the page from the engine; the lockdown has already held
    the Host to loopback, so no other site can present it). Every WebSocket router uses this one check."""
    from .config import cors_origins

    return bool(origin) and (origin in cors_origins() or origin == f"http://{host}")


class LocalOnly:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers") or []}
        client = (scope.get("client") or ("", 0))[0] or ""
        reason = None
        through_network = bool(scope.get("formwav.remote"))
        if through_network:
            # The network listener (routers/remote.py, off by default), marked by its own server: only paired devices,
            # and the pairing page itself, get through. The loopback listener's checks below are unchanged.
            from ..routers import remote

            if not remote.admitted(scope, headers):
                reason = "pair this device first"
        elif client and not _loopback(client):
            reason = "the engine answers this machine only"
        elif not _HOST.match(headers.get("host", "")):
            reason = "unexpected Host header"
        elif headers.get("origin") is None and headers.get("sec-fetch-site", "").strip().lower() == "cross-site":
            reason = "a request from another site"
        if reason is None and scope["type"] == "http" and scope["method"] in _MUTATING and scope["path"].startswith("/api/") and headers.get(LOCAL_HEADER) != "1":
            reason = f"a change needs the {LOCAL_HEADER} header"
        if reason and through_network and scope["type"] == "http" and scope["method"] == "GET" and not scope["path"].startswith("/api/"):
            await send({"type": "http.response.start", "status": 303, "headers": [(b"location", b"/pair"), (b"content-length", b"0")]})
            await send({"type": "http.response.body", "body": b""})
            return
        if reason:
            if scope["type"] == "websocket":
                await receive()  # the connect event, then a close before accept refuses the handshake (403)
                await send({"type": "websocket.close", "code": 4403})
                return
            body = ('{"detail": "refused: %s"}' % reason).encode()
            await send({"type": "http.response.start", "status": 403, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()), (b"x-content-type-options", b"nosniff")]})
            await send({"type": "http.response.body", "body": body})
            return

        async def send_nosniff(message):
            if message["type"] == "http.response.start":
                message["headers"] = list(message.get("headers") or []) + [(b"x-content-type-options", b"nosniff")]
            await send(message)

        await self.app(scope, receive, send_nosniff)
