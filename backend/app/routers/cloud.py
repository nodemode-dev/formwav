"""Google Drive and Dropbox: sign in, browse, open a session or import media from the cloud, and save sessions and media
to it (cloud projects). Ported from formcut 2.6.3 (backend/app/cloud.py, the same author, Apache-2.0); the sign-in, token,
listing and upload code is formcut's unchanged. formwav's changes: its data folder, the formwav folder name, a .fmw file
(a session with its media inside) opening as a project, and imports and uploads run within the request (formwav has no
job runner).

Google uses its desktop-app flow: PKCE (S256) with a redirect to this engine on
127.0.0.1, any port. The client ID and secret come from the owner's Google Cloud
project; Google's token endpoint wants the secret even from a desktop app and
treats it as not confidential. The default scope, drive.file, lets formwav create
files and see the ones it created, which covers saving sessions into a formwav
folder and importing them back. Browsing all of Drive needs drive.readonly, a
restricted scope that Google verifies before public use; it is an opt-in for the
owner's own use.

Dropbox uses PKCE with no secret. Dropbox wants redirect addresses registered
exactly, which an engine on a changing port cannot promise, so formwav uses the
flow without a redirect: Dropbox's page shows a code and the person pastes it
back. Only the app key needs registering.

Tokens stay in the engine, in a file only its owner can read, refresh
themselves, and never reach the browser.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import tempfile
import threading
import time
import webbrowser
from pathlib import Path
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from ..core.paths import data_dir
from ..services import media, projects

router = APIRouter(prefix="/cloud", tags=["cloud"])

PROVIDERS = ("google", "dropbox")
FOLDER = "formwav"
DROPBOX_SINGLE = 150 * 1024 * 1024  # Dropbox's limit for one upload call; larger files use an upload session
DROPBOX_CHUNK = 64 * 1024 * 1024  # a multiple of 4 MiB, as Dropbox asks of session chunks
GOOGLE_FOLDER = "application/vnd.google-apps.folder"
PENDING_FOR = 600.0
_pending: dict[str, dict] = {}
_lock = threading.Lock()


class AppInput(BaseModel):
    clientId: str
    clientSecret: str | None = None
    fullDrive: bool = False


class StartInput(BaseModel):
    open: bool = False


class CodeInput(BaseModel):
    code: str


class ImportInput(BaseModel):
    id: str
    name: str


class UploadInput(BaseModel):
    project: str | None = None
    mediaId: str | None = None


class CloudError(RuntimeError):
    """The storage service refused or failed; the message says which."""


def _base(name: str, default: str) -> str:
    return os.environ.get(name, "").rstrip("/") or default


def _google_auth() -> str:
    return _base("CLOUD_GOOGLE_AUTH", "https://accounts.google.com/o/oauth2/v2/auth")


def _google_token() -> str:
    return _base("CLOUD_GOOGLE_TOKEN", "https://oauth2.googleapis.com/token")


def _google_api() -> str:
    return _base("CLOUD_GOOGLE_API", "https://www.googleapis.com")


def _dropbox_auth() -> str:
    return _base("CLOUD_DROPBOX_AUTH", "https://www.dropbox.com/oauth2/authorize")


def _dropbox_api() -> str:
    return _base("CLOUD_DROPBOX_API", "https://api.dropboxapi.com")


def _dropbox_content() -> str:
    return _base("CLOUD_DROPBOX_CONTENT", "https://content.dropboxapi.com")


def _store() -> Path:
    return data_dir() / "cloud.json"


def _read() -> dict:
    try:
        return json.loads(_store().read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except ValueError:  # a damaged file is set aside rather than lost, and a fresh one begins
        _store().replace(_store().with_suffix(f".damaged-{int(time.time())}"))
        return {}


def _write(data: dict) -> None:
    # Written whole and then moved into place, readable by this user only: it holds the tokens
    path = _store()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".cloud-", dir=path.parent)
    with os.fdopen(fd, "w", encoding="utf-8") as out:
        json.dump(data, out)
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def _provider(name: str) -> str:
    if name not in PROVIDERS:
        raise HTTPException(404, f"no cloud provider {name}")
    return name


def challenge(verifier: str) -> str:
    """The standard PKCE S256 challenge: base64url of the SHA-256, unpadded."""
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()


def _scope(app: dict) -> str:
    access = "drive.readonly" if app.get("fullDrive") else "drive.file"
    # drive.file stays in both cases, so uploads keep working with the read-only scope.
    return " ".join(sorted({f"https://www.googleapis.com/auth/{access}", "https://www.googleapis.com/auth/drive.file"}))


def _checked(response: httpx.Response, what: str) -> httpx.Response:
    if response.status_code >= 400:
        try:
            body = response.json()
            detail = body.get("error_description") or body.get("error_summary") or body.get("error", {})
            if isinstance(detail, dict):
                detail = detail.get("message") or response.status_code
        except ValueError:
            detail = response.status_code
        raise CloudError(f"{what} failed: {detail}")
    return response


def _exchange(name: str, form: dict) -> dict:
    app = _read().get(name, {}).get("app", {})
    if name == "google":
        form = {**form, "client_id": app.get("clientId", ""), "client_secret": app.get("clientSecret", "")}
        url = _google_token()
    else:
        form = {**form, "client_id": app.get("clientId", "")}
        url = f"{_dropbox_api()}/oauth2/token"
    try:
        reply = _checked(httpx.post(url, data=form, timeout=30.0), "Signing in").json()
    except httpx.HTTPError as error:
        raise CloudError(f"Could not reach the sign-in service: {error.__class__.__name__}") from error
    tokens = {"accessToken": reply["access_token"], "expiresAt": time.time() + float(reply.get("expires_in", 3600))}
    if reply.get("refresh_token"):
        tokens["refreshToken"] = reply["refresh_token"]
    return tokens


def _token(name: str) -> str:
    data = _read()
    account = data.get(name, {}).get("account")
    if not account:
        raise CloudError(f"Connect {name.title()} first")
    if account["expiresAt"] - time.time() < 60:
        if not account.get("refreshToken"):
            raise CloudError(f"The {name.title()} sign-in has expired; connect again")
        account = {**account, **_exchange(name, {"grant_type": "refresh_token", "refresh_token": account["refreshToken"]})}
        data[name]["account"] = account
        _write(data)
    return account["accessToken"]


def _auth(name: str) -> dict:
    return {"Authorization": f"Bearer {_token(name)}"}


# Listing, fetching and uploading ------------------------------------------------------


def _entry(item: str, name: str, folder: bool, size, modified) -> dict:
    return {"id": item, "name": name, "folder": folder, "size": int(size or 0), "modified": modified}


def listing(name: str, folder: str, cursor: str = "") -> dict:
    """One page of a folder, in one shape for both services."""
    try:
        if name == "google":
            query = {"q": f"'{folder or 'root'}' in parents and trashed = false", "pageSize": 100}
            query["fields"] = "files(id,name,mimeType,size,modifiedTime),nextPageToken"
            if cursor:
                query["pageToken"] = cursor
            sent = httpx.get(f"{_google_api()}/drive/v3/files", params=query, headers=_auth(name), timeout=30.0)
            reply = _checked(sent, "Listing").json()
            files = reply.get("files", [])
            entries = [_entry(f["id"], f["name"], f.get("mimeType") == GOOGLE_FOLDER, f.get("size"), f.get("modifiedTime")) for f in files]
            return {"entries": entries, "cursor": reply.get("nextPageToken", "")}
        if cursor:
            reply = httpx.post(f"{_dropbox_api()}/2/files/list_folder/continue", json={"cursor": cursor}, headers=_auth(name), timeout=30.0)
        else:
            reply = httpx.post(f"{_dropbox_api()}/2/files/list_folder", json={"path": folder}, headers=_auth(name), timeout=30.0)
        body = _checked(reply, "Listing").json()
        found = body.get("entries", [])
        entries = [_entry(e["path_display"], e["name"], e[".tag"] == "folder", e.get("size"), e.get("client_modified")) for e in found]
        return {"entries": entries, "cursor": body.get("cursor", "") if body.get("has_more") else ""}
    except httpx.HTTPError as error:
        raise CloudError(f"Could not reach {name.title()}: {error.__class__.__name__}") from error


def _download(name: str, item: str, into: Path) -> None:
    if name == "google":
        request = ("GET", f"{_google_api()}/drive/v3/files/{item}", {"params": {"alt": "media"}, "headers": _auth(name)})
    else:
        headers = {**_auth(name), "Dropbox-API-Arg": json.dumps({"path": item})}
        request = ("POST", f"{_dropbox_content()}/2/files/download", {"headers": headers})
    method, url, options = request
    try:
        with httpx.stream(method, url, timeout=600.0, **options) as response:
            if response.status_code >= 400:
                response.read()
                _checked(response, "Downloading")
            with into.open("wb") as handle:
                for chunk in response.iter_bytes(1 << 20):
                    handle.write(chunk)
    except httpx.HTTPError as error:
        raise CloudError(f"Could not download from {name.title()}: {error.__class__.__name__}") from error


def _google_folder() -> str:
    data = _read()
    known = data.get("google", {}).get("folder")
    if known:
        return known
    body = {"name": FOLDER, "mimeType": GOOGLE_FOLDER}
    sent = httpx.post(f"{_google_api()}/drive/v3/files", json=body, headers=_auth("google"), timeout=30.0)
    made = _checked(sent, "Making the formwav folder").json()
    data = _read()
    data.setdefault("google", {})["folder"] = made["id"]
    _write(data)
    return made["id"]


def _upload(name: str, path: Path, filename: str, report) -> dict:
    size = path.stat().st_size
    try:
        if name == "google":
            headers = {**_auth(name), "X-Upload-Content-Type": "application/octet-stream", "X-Upload-Content-Length": str(size)}
            body = {"name": filename, "parents": [_google_folder()]}
            url = f"{_google_api()}/upload/drive/v3/files?uploadType=resumable"
            session = _checked(httpx.post(url, json=body, headers=headers, timeout=30.0), "Starting the upload").headers["Location"]
            with path.open("rb") as handle:
                sent = httpx.put(session, content=handle, headers={"Content-Length": str(size)}, timeout=1800.0)
            made = _checked(sent, "Uploading").json()
            return {"id": made["id"], "name": made.get("name", filename)}
        target = {"path": f"/{FOLDER}/{filename}", "mode": "add", "autorename": True}
        octet = {"Content-Type": "application/octet-stream"}
        if size <= DROPBOX_SINGLE:
            headers = {**_auth(name), **octet, "Dropbox-API-Arg": json.dumps(target)}
            with path.open("rb") as handle:
                sent = httpx.post(f"{_dropbox_content()}/2/files/upload", content=handle.read(), headers=headers, timeout=1800.0)
            made = _checked(sent, "Uploading").json()
            return {"id": made["path_display"], "name": made["name"]}
        session = f"{_dropbox_content()}/2/files/upload_session"
        with path.open("rb") as handle:
            first = handle.read(DROPBOX_CHUNK)
            headers = {**_auth(name), **octet, "Dropbox-API-Arg": json.dumps({"close": False})}
            started = _checked(httpx.post(f"{session}/start", content=first, headers=headers, timeout=600.0), "Uploading")
            cursor = {"session_id": started.json()["session_id"], "offset": len(first)}
            while True:
                piece = handle.read(DROPBOX_CHUNK)
                if not piece:
                    break
                report(0.1 + 0.8 * cursor["offset"] / size)
                arg = {"cursor": cursor, "close": False}
                headers = {**_auth(name), **octet, "Dropbox-API-Arg": json.dumps(arg)}
                _checked(httpx.post(f"{session}/append_v2", content=piece, headers=headers, timeout=600.0), "Uploading")
                cursor = {**cursor, "offset": cursor["offset"] + len(piece)}
        headers = {**_auth(name), **octet, "Dropbox-API-Arg": json.dumps({"cursor": cursor, "commit": target})}
        made = _checked(httpx.post(f"{session}/finish", content=b"", headers=headers, timeout=600.0), "Uploading").json()
        return {"id": made["path_display"], "name": made["name"]}
    except httpx.HTTPError as error:
        raise CloudError(f"Could not upload to {name.title()}: {error.__class__.__name__}") from error


def _export(body: UploadInput) -> tuple[Path, str]:
    """A saved session (its .fmw holds the document and its media, so it reopens anywhere) or one media file."""
    if body.project:
        path = projects._path(body.project)
        if not path.is_file():
            raise HTTPException(404, f"no saved session named {body.project}")
        return path, f"{body.project}.fmw"
    if body.mediaId:
        info = media.media_info(body.mediaId)
        path = next(media.media_dir().glob(f"{body.mediaId}.*"), None)
        if path is None:
            raise HTTPException(404, "file missing")
        return path, str(info.get("name") or path.name)
    raise HTTPException(422, "name a saved session (project) or a media item (mediaId)")


# Routes -------------------------------------------------------------------------------


def _public(name: str) -> dict:
    entry = _read().get(name, {})
    app, account = entry.get("app", {}), entry.get("account")
    configured = bool(app.get("clientId") and (name == "dropbox" or app.get("clientSecret")))
    return {
        "configured": configured,
        "connected": bool(account),
        "clientId": app.get("clientId", ""),
        "fullDrive": bool(app.get("fullDrive")),
    }


@router.get("")
def states() -> dict:
    return {name: _public(name) for name in PROVIDERS}


@router.put("/{name}/app")
def set_app(name: str, body: AppInput) -> dict:
    """Store the app's client ID (and Google's desktop secret); an omitted secret keeps the stored one."""
    _provider(name)
    data = _read()
    entry = data.setdefault(name, {})
    kept = entry.get("app", {}).get("clientSecret", "")
    secret = kept if body.clientSecret is None else body.clientSecret.strip()
    entry["app"] = {"clientId": body.clientId.strip(), "clientSecret": secret if name == "google" else "", "fullDrive": body.fullDrive}
    _write(data)
    return _public(name)


@router.post("/{name}/start")
def start(name: str, request: Request, body: StartInput | None = None) -> dict:
    """The sign-in address, opened in the system browser when asked."""
    _provider(name)
    app = _read().get(name, {}).get("app", {})
    if not _public(name)["configured"]:
        raise HTTPException(409, f"Set up {name.title()} first")
    verifier, key = secrets.token_urlsafe(48), secrets.token_urlsafe(24)
    query = {"client_id": app["clientId"], "response_type": "code", "code_challenge": challenge(verifier), "code_challenge_method": "S256"}
    pending = {"verifier": verifier, "at": time.time(), "provider": name}
    if name == "google":
        redirect = f"http://127.0.0.1:{request.url.port}/api/cloud/google/callback"
        query.update(redirect_uri=redirect, scope=_scope(app), state=key, access_type="offline", prompt="consent")
        pending["redirect"] = redirect
        url = f"{_google_auth()}?{urlencode(query)}"
    else:
        query.update(token_access_type="offline")  # noqa: S106  # Dropbox's parameter name, not a password
        url = f"{_dropbox_auth()}?{urlencode(query)}"
        key = "dropbox"  # the pasted code carries no state, so one Dropbox sign-in is pending at a time
    with _lock:
        _pending[key] = pending
    return {"url": url, "opened": bool(body and body.open and webbrowser.open(url)), "paste": name == "dropbox"}


@router.get("/google/callback", response_class=HTMLResponse)
def google_callback(state: str = "", code: str = "", error: str = "") -> HTMLResponse:
    with _lock:
        pending = _pending.pop(state, None)
    if pending is None or pending["provider"] != "google" or time.time() - pending["at"] > PENDING_FOR:
        return HTMLResponse("<p>This Google sign-in is unknown or expired. Start again from formwav.</p>", status_code=400)
    if error or not code:
        return HTMLResponse(f"<p>Google sign-in did not finish: {error or 'no code'}.</p>", status_code=400)
    form = {"code": code, "grant_type": "authorization_code", "redirect_uri": pending["redirect"], "code_verifier": pending["verifier"]}
    try:
        account = _exchange("google", form)
    except CloudError as failure:
        return HTMLResponse(f"<p>{failure}</p>", status_code=502)
    data = _read()
    data.setdefault("google", {})["account"] = account
    _write(data)
    return HTMLResponse("<p>Connected to Google Drive. You can close this tab and return to formwav.</p>")


@router.post("/dropbox/code")
def dropbox_code(body: CodeInput) -> dict:
    """Finish a Dropbox sign-in with the code Dropbox's page showed."""
    with _lock:
        pending = _pending.pop("dropbox", None)
    if pending is None or time.time() - pending["at"] > PENDING_FOR:
        raise HTTPException(409, "Start the Dropbox sign-in again")
    form = {"code": body.code.strip(), "grant_type": "authorization_code", "code_verifier": pending["verifier"]}
    try:
        account = _exchange("dropbox", form)
    except CloudError as failure:
        raise HTTPException(502, str(failure)) from failure
    data = _read()
    data.setdefault("dropbox", {})["account"] = account
    _write(data)
    return _public("dropbox")


@router.delete("/{name}")
def disconnect(name: str) -> dict:
    _provider(name)
    data = _read()
    data.get(name, {}).pop("account", None)
    _write(data)
    return _public(name)


@router.get("/{name}/files")
def files(name: str, folder: str = "", cursor: str = "") -> dict:
    _provider(name)
    try:
        return listing(name, folder, cursor)
    except CloudError as failure:
        raise HTTPException(502, str(failure)) from failure


@router.post("/{name}/import")
def import_file(name: str, body: ImportInput) -> dict:
    """Open a session (.fmw) from the cloud as a project, or bring any other file into the session's media."""
    _provider(name)
    with tempfile.TemporaryDirectory(prefix="formwav-cloud-") as scratch:
        into = Path(scratch) / Path(body.name).name
        try:
            _download(name, body.id, into)
        except CloudError as failure:
            raise HTTPException(502, str(failure)) from failure
        if into.suffix.lower() == ".fmw":
            stem, n = into.stem, 1
            while projects._path(stem).exists():  # never over a session already here
                n += 1
                stem = f"{into.stem} ({n})"
            projects.projects_dir().mkdir(parents=True, exist_ok=True)
            projects._path(stem).write_bytes(into.read_bytes())
            return {"project": stem}
        try:
            return {"media": media.import_audio(body.name, into.read_bytes())}
        except media.MediaError as failure:
            raise HTTPException(415, str(failure)) from failure


@router.post("/{name}/upload")
def upload(name: str, body: UploadInput) -> dict:
    """Put a saved session or a media item in the service's formwav folder."""
    _provider(name)
    path, filename = _export(body)
    try:
        return _upload(name, path, filename, lambda *a, **k: None)
    except CloudError as failure:
        raise HTTPException(502, str(failure)) from failure
