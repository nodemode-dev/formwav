from __future__ import annotations

import base64
import ipaddress
import socket
import webbrowser
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import FileResponse, Response

from ..core.version import VERSION
from ..services import formext_host

router = APIRouter(prefix="/extensions", tags=["extensions"])

PRODUCT = "formwav"
APP = "formwav"
BASE = "/api/extensions/files"
MANAGE = f"formai://extensions?product={PRODUCT}"
FETCH_CAP = 50 * 1024 * 1024
_cache: dict = {"key": None, "list": []}


def _resolved() -> list[formext_host.Extension]:
    root = formext_host.portal_root()
    key = (str(root), formext_host.stamp(PRODUCT, root))
    if _cache["key"] != key:
        _cache["list"] = formext_host.resolve(PRODUCT, VERSION, APP, root)
        _cache["key"] = key
    return _cache["list"]


def _stamp() -> list[float]:
    return list(formext_host.stamp(PRODUCT))


@router.get("")
def list_extensions(reload: bool = False) -> dict:
    if reload:
        _cache["key"] = None
    exts = _resolved()
    return {
        "product": PRODUCT,
        "app": APP,
        "appVersion": VERSION,
        "api": formext_host.API,
        "root": str(formext_host.portal_root()),
        "stamp": _stamp(),
        "manage": MANAGE,
        "extensions": [e.public(BASE) for e in exts],
    }


@router.get("/stamp")
def extensions_stamp() -> dict:
    return {"stamp": _stamp()}


@router.api_route("/files/{ext_id}/{version}/{path:path}", methods=["GET", "HEAD"])
def extension_file(ext_id: str, version: str, path: str) -> Response:
    found = formext_host.file_for(_resolved(), ext_id, version, path)
    if found is None:
        return Response(status_code=404, headers=formext_host.headers_for("text/plain", ""))
    target, content_type = found
    return FileResponse(target, media_type=content_type, headers=formext_host.headers_for(content_type, ""))


@router.post("/manage")
def manage() -> dict:
    try:
        opened = bool(webbrowser.open(MANAGE))
    except Exception:
        opened = False
    return {"url": MANAGE, "opened": opened}


def _public_host(host: str) -> bool:
    if not host or host.lower() == "localhost" or host.lower().endswith((".localhost", ".local")):
        return False
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except OSError:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global:
            return False
    return bool(infos)


@router.post("/fetch")
def extension_fetch(body: dict = Body(...)) -> dict:
    url = str(body.get("url") or "")
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname:
        raise HTTPException(400, "only https:// addresses")
    if not _public_host(parts.hostname):
        raise HTTPException(403, "addresses on this computer or the local network are not reachable from an extension")
    method = str(body.get("method") or "GET").upper()
    if method not in ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"):
        raise HTTPException(400, f"{method} is not a method an extension can use")
    headers = {str(k): str(v) for k, v in (body.get("headers") or {}).items() if str(k).lower() not in ("cookie", "host", "authorization-proxy")}
    content = base64.b64decode(body["body"]) if body.get("body") else None
    try:
        with httpx.Client(timeout=60.0, follow_redirects=False) as client, client.stream(method, url, headers=headers, content=content) as res:
            chunks, size = [], 0
            for chunk in res.iter_bytes():
                size += len(chunk)
                if size > FETCH_CAP:
                    raise HTTPException(413, "the answer is larger than 50 MB")
                chunks.append(chunk)
            return {"status": res.status_code, "headers": {k: v for k, v in res.headers.items() if k.lower() != "set-cookie"}, "body": base64.b64encode(b"".join(chunks)).decode()}
    except httpx.HTTPError as err:
        raise HTTPException(502, f"could not reach {parts.hostname}: {err.__class__.__name__}") from err
