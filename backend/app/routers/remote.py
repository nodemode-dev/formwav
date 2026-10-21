"""Phones and other computers on the local network, paired to this engine. Ported from formcut 2.6.3
(backend/app/remote.py, the same author, Apache-2.0); formwav's changes are its store, cookie, request marker, port
(8978 by default, beside formcut's 8977) and the pairing page's words.

Off by default. Turned on from the desktop, a second listener opens on every
network interface at a fixed port and serves the same app; the first listener
stays on 127.0.0.1 and nothing about it changes. Every request through the
second listener must come from a paired device, except the pairing page itself.

Pairing: the desktop shows a six-digit code that lasts five minutes and works
once; a phone or browser enters it at http://<address>:<port>/pair; the engine
answers with a device token in an HttpOnly, SameSite=Strict cookie, so page
scripts cannot read it and other sites cannot send it. After that the whole app
loads from the engine as it does on the desktop, so nothing in the interface
needs to know it is remote. Five wrong codes cancel every live code. Only the
desktop can turn the listener on, show codes, or remove devices, and only a
hash of each token is stored.
"""

from __future__ import annotations

import contextlib
import hashlib
import hmac
import os
import secrets
import socket
import threading
import time
import uuid
from http.cookies import SimpleCookie

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from ..core.paths import data_dir
from ..core.store import read_json, write_json

router = APIRouter(tags=["remote"])

COOKIE = "formwav_device"
CODE_FOR = 300.0  # seconds a pairing code lives
FAILURES = 5  # wrong codes that cancel every live code
_codes: dict[str, float] = {}
_failures = {"count": 0}
_lock = threading.Lock()
_server = {"server": None, "port": None}


class EnableInput(BaseModel):
    enabled: bool


class PairInput(BaseModel):
    code: str
    name: str = "Device"


class Marked:
    """The remote listener's app: the same app, with requests marked as having come from the network (and, for the
    guest listener, from a guest outside it)."""

    def __init__(self, app, guest: bool = False):
        self.app = app
        self.guest = guest

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            scope = {**scope, "formwav.remote": True, **({"formwav.guest": True} if self.guest else {})}
        await self.app(scope, receive, send)


def port() -> int:
    return int(os.environ.get("FORMWAV_REMOTE_PORT", "") or 8978)


# PLAN_v12 R12: guests from anywhere. A third listener, on 127.0.0.1 only, that a tunnel (services/tunnel.py) points at:
# it admits pairing and the recording room and nothing else, so a guest who comes in from the internet records and
# sends takes but never reaches the rest of the engine, paired or not.
GUEST_PATHS = {("GET", "/pair"), ("POST", "/api/remote/pair"), ("GET", "/room"), ("GET", "/api/room"), ("POST", "/api/room/take")}
_guest_server = {"server": None}


def guest_port() -> int:
    return int(os.environ.get("FORMWAV_GUEST_PORT", "") or 8979)


def start_guests(app) -> None:
    if _guest_server["server"] is not None:
        return
    import uvicorn

    server = uvicorn.Server(uvicorn.Config(Marked(app, guest=True), host="127.0.0.1", port=guest_port(), log_level="warning", lifespan="off"))
    _guest_server["server"] = server
    threading.Thread(target=server.run, name="formwav-guests", daemon=True).start()


def stop_guests() -> None:
    server = _guest_server["server"]
    if server is not None:
        server.should_exit = True
    _guest_server["server"] = None


def _store():
    return data_dir() / "remote.json"


def _read() -> dict:
    return read_json(_store(), {})  # durable.py: a damaged file set aside and its backup read


def _write(data: dict) -> None:
    write_json(_store(), data, private=True)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def device_for(token: str) -> dict | None:
    """The paired device a token belongs to, compared in constant time."""
    digest = _hash(token)
    found = None
    for device in _read().get("devices", []):
        if hmac.compare_digest(device["hash"], digest):
            found = device
    return found


def _token(headers: dict) -> str:
    cookie = SimpleCookie()
    try:
        cookie.load(headers.get("cookie", ""))
    except Exception:  # noqa: BLE001 - a malformed Cookie header simply carries no token
        return ""
    if COOKIE in cookie:
        return cookie[COOKIE].value
    kind, _, value = headers.get("authorization", "").partition(" ")
    return value.strip() if kind.lower() == "bearer" else ""


def admitted(scope: dict, headers: dict) -> bool:
    """Whether a request through the network listener may proceed."""
    path, method = scope.get("path", ""), scope.get("method", "GET")
    if scope.get("formwav.guest") and (method, path) not in GUEST_PATHS:
        return False
    if (method == "GET" and path == "/pair") or (method == "POST" and path == "/api/remote/pair"):
        return True
    token = _token(headers)
    return bool(token) and device_for(token) is not None


def addresses() -> list[str]:
    """This machine's IPv4 addresses a phone on the same network could reach."""
    found = set()
    with contextlib.suppress(OSError), socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        probe.connect(("192.0.2.1", 9))  # a documentation address: no packet is sent
        found.add(probe.getsockname()[0])
    with contextlib.suppress(OSError):
        found.update(socket.gethostbyname_ex(socket.gethostname())[2])
    return sorted(address for address in found if not address.startswith("127."))


def start(app) -> None:
    """Open the network listener, once."""
    if _server["server"] is not None:
        return
    import uvicorn

    server = uvicorn.Server(uvicorn.Config(Marked(app), host="0.0.0.0", port=port(), log_level="warning", lifespan="off"))  # noqa: S104
    _server.update(server=server, port=port())
    threading.Thread(target=server.run, name="formwav-remote", daemon=True).start()


def stop() -> None:
    server = _server["server"]
    if server is not None:
        server.should_exit = True
    _server.update(server=None, port=None)


def resume(app) -> None:
    """At engine start, reopen the listener if it was left on."""
    if _read().get("enabled"):
        start(app)


def _desktop(request: Request) -> None:
    if request.scope.get("formwav.remote"):
        raise HTTPException(403, "only the desktop can manage paired devices")


def _public() -> dict:
    data = _read()
    devices = [{key: device.get(key) for key in ("id", "name", "created", "lastSeen")} for device in data.get("devices", [])]
    return {"enabled": bool(data.get("enabled")), "port": port(), "addresses": addresses(), "devices": devices}


@router.get("/api/remote")
def state(request: Request) -> dict:
    _desktop(request)
    return _public()


@router.put("/api/remote")
def enable(body: EnableInput, request: Request) -> dict:
    _desktop(request)
    data = _read()
    data["enabled"] = body.enabled
    _write(data)
    if body.enabled:
        start(request.app)
    else:
        stop()
        with _lock:
            _codes.clear()
    return _public()


@router.post("/api/remote/code")
def new_code(request: Request) -> dict:
    """A six-digit code that pairs one device within five minutes."""
    _desktop(request)
    from ..services import tunnel

    if not _read().get("enabled") and not tunnel.status()["url"]:
        raise HTTPException(409, "turn on access from the network, or the link for guests from anywhere, first")
    code = f"{secrets.randbelow(1_000_000):06d}"
    with _lock:
        _codes[code] = time.time() + CODE_FOR
    return {"code": code, "expiresIn": int(CODE_FOR)}


@router.delete("/api/remote/devices/{device_id}")
def remove(device_id: str, request: Request) -> dict:
    _desktop(request)
    data = _read()
    kept = [device for device in data.get("devices", []) if device["id"] != device_id]
    if len(kept) == len(data.get("devices", [])):
        raise HTTPException(404, "no such device")
    data["devices"] = kept
    _write(data)
    return _public()


@router.get("/api/remote/tunnel")
def tunnel_state(request: Request) -> dict:
    _desktop(request)
    from ..services import tunnel

    return tunnel.status()


@router.put("/api/remote/tunnel")
def tunnel_switch(body: EnableInput, request: Request) -> dict:
    """PLAN_v12 R12: the link for guests from anywhere, on or off."""
    _desktop(request)
    from ..services import tunnel

    if body.enabled:
        return tunnel.start(lambda: start_guests(request.app), guest_port())
    tunnel.stop()
    stop_guests()
    return tunnel.status()


@router.post("/api/remote/pair")
def pair(body: PairInput, response: Response) -> dict:
    now = time.time()
    with _lock:
        expires = _codes.pop(body.code.strip(), None)
        if expires is None or expires < now:
            _failures["count"] += 1
            if _failures["count"] >= FAILURES:
                _codes.clear()
                _failures["count"] = 0
            raise HTTPException(403, "that code is wrong or has expired; ask the desktop for a new one")
        _failures["count"] = 0
    token = secrets.token_urlsafe(32)
    device = {
        "id": uuid.uuid4().hex[:12],
        "name": body.name.strip()[:60] or "Device",
        "hash": _hash(token),
        "created": now,
        "lastSeen": now,
    }
    data = _read()
    data.setdefault("devices", []).append(device)
    _write(data)
    response.set_cookie(COOKIE, token, max_age=365 * 24 * 3600, httponly=True, samesite="strict", path="/")
    return {"device": {"id": device["id"], "name": device["name"]}}


PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pair with formwav</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#16181a;color:#e9e9e7;font:16px/1.4 system-ui,sans-serif}
form{display:grid;gap:12px;width:min(320px,90vw)}input,button{padding:12px;border-radius:8px;border:1px solid #3a3d40;background:#222528;color:inherit;font:inherit}
button{background:#ffae2b;border-color:#ffae2b;color:#16181a;font-weight:600}#note{min-height:1.4em;color:#b9b9b4}
</style></head><body><form id="pair"><h1>Pair with formwav</h1><label for="code">The six-digit code on the desktop</label>
<input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required><label for="name">This device's name</label>
<input id="name" maxlength="60" value="Phone"><button>Pair</button><p id="note"></p></form><script>
document.getElementById("pair").addEventListener("submit", async (event) => {
  event.preventDefault();
  const note = document.getElementById("note");
  const body = JSON.stringify({ code: document.getElementById("code").value, name: document.getElementById("name").value });
  const reply = await fetch("/api/remote/pair", { method: "POST", headers: { "content-type": "application/json", "x-formwav-local": "1" }, body });
  if (reply.ok) location.href = "/room";
  else note.textContent = (await reply.json()).detail || "Pairing failed";
});
</script></body></html>"""


@router.get("/pair", response_class=HTMLResponse, include_in_schema=False)
def pairing_page() -> HTMLResponse:
    return HTMLResponse(PAGE)
