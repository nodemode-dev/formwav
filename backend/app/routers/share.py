"""Shared editing (the comparison's Cloud projects and collaboration row): the desktop shares the session it has open,
and devices paired through routers/remote.py edit it with it at the same time.

formwav's edits are commands applied by one pure reducer, so editors who apply the same commands in the same order hold
the same session. The engine is the hub that fixes the order: it keeps the document as it was when sharing began and
every command since, numbered as they arrive; an editor joining late takes that document and replays the commands.
Each command carries an op id from its sender, which seeds the ids the command creates, so every editor creates the same
ones. Media needs no copying: every editor works through this engine and its media store. The state is in memory and
lasts while the engine runs; saving stays the desktop's, as before.
"""

import threading
import time

from fastapi import APIRouter, Body, HTTPException, Request

from . import remote

router = APIRouter(prefix="/share", tags=["share"])

ONLINE_FOR = 8.0
MAX_OPS = 200_000
_lock = threading.Lock()
_share: dict = {"active": False, "document": None, "ops": [], "people": {}, "started": None}


def _who(request: Request, name: str = "") -> dict:
    """The editor behind a request: the desktop, or a paired device through the network listener."""
    if not request.scope.get("formwav.remote"):
        return {"id": "desktop", "name": name or "Desktop", "desktop": True}
    device = remote.device_for(remote._token({k.lower(): v for k, v in request.headers.items()}))
    if device is None:
        raise HTTPException(403, "pair this device first")
    return {"id": device["id"], "name": device["name"], "desktop": False}


def _people(now: float) -> list[dict]:
    return [{"id": p["id"], "name": p["name"], "desktop": p["desktop"], "online": now - p["seen"] < ONLINE_FOR} for p in _share["people"].values()]


def _seen(who: dict, now: float) -> None:
    person = _share["people"].setdefault(who["id"], {**who, "seen": now})
    person.update(name=who["name"], seen=now)


@router.get("")
def state(request: Request, name: str = "") -> dict:
    who = _who(request, name)
    now = time.time()
    with _lock:
        if _share["active"]:
            _seen(who, now)
        return {"active": _share["active"], "seq": len(_share["ops"]), "people": _people(now), "me": who}


@router.post("/start")
def start(request: Request, body: dict = Body(...)) -> dict:
    """The desktop shares the session it has open ({"document": ...}): editing starts from it."""
    who = _who(request)
    if not who["desktop"]:
        raise HTTPException(403, "only the desktop shares its session")
    if not isinstance(body.get("document"), dict):
        raise HTTPException(422, "send the session's document")
    with _lock:
        _share.update(active=True, document=body["document"], ops=[], people={}, started=time.time())
        _seen(who, time.time())
        return {"active": True, "seq": 0}


@router.post("/stop")
def stop(request: Request) -> dict:
    if not _who(request)["desktop"]:
        raise HTTPException(403, "only the desktop stops sharing")
    with _lock:
        _share.update(active=False, document=None, ops=[], people={})
        return {"active": False}


@router.get("/join")
def join(request: Request, name: str = "") -> dict:
    """The document sharing began from and every command since, to replay in order."""
    who = _who(request, name)
    with _lock:
        if not _share["active"]:
            raise HTTPException(409, "no session is shared")
        _seen(who, time.time())
        return {"document": _share["document"], "ops": list(_share["ops"]), "seq": len(_share["ops"]), "me": who}


@router.post("/ops")
def send(request: Request, body: dict = Body(...)) -> dict:
    """A command from an editor ({"opId", "command"}), numbered in arrival order; every editor applies it at that number."""
    who = _who(request, str(body.get("name", "")))
    op_id, command = str(body.get("opId", "")), body.get("command")
    if not op_id or not isinstance(command, dict) or "type" not in command:
        raise HTTPException(422, "send an op id and a command")
    with _lock:
        if not _share["active"]:
            raise HTTPException(409, "no session is shared")
        if len(_share["ops"]) >= MAX_OPS:
            raise HTTPException(507, "the shared session holds too many changes; save it and share it again")
        _seen(who, time.time())
        seq = len(_share["ops"]) + 1
        _share["ops"].append({"seq": seq, "opId": op_id, "by": who["id"], "name": who["name"], "command": command})
        return {"seq": seq}


@router.get("/ops")
def since(request: Request, after: int = 0, name: str = "") -> dict:
    """Every command numbered after `after`, with who is here: an editor's poll, and its check-in."""
    who = _who(request, name)
    now = time.time()
    with _lock:
        if not _share["active"]:
            return {"active": False, "ops": [], "seq": 0, "people": []}
        _seen(who, now)
        return {"active": True, "ops": _share["ops"][max(0, after):], "seq": len(_share["ops"]), "people": _people(now)}
