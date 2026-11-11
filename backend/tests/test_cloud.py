import io
import json
import os
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import cloud
from app.services import projects

client = TestClient(app, base_url="http://127.0.0.1:8123", headers={"x-formwav-local": "1"})


def _tone() -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(8000)
        out.writeframes(b"\1\0" * 4000)
    return buffer.getvalue()


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *args):
        return

    def _reply(self, payload=None, code=200, headers=None, raw=None):
        body = raw if raw is not None else json.dumps(payload or {}).encode()
        self.send_response(code)
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        return self.rfile.read(int(self.headers.get("Content-Length") or 0))

    def do_GET(self):
        state, url = self.server.state, urlsplit(self.path)
        state["gets"].append((url.path, parse_qs(url.query), self.headers.get("Authorization")))
        if url.path == "/google/api/drive/v3/files":
            files = [
                {"id": "f1", "name": "tone.wav", "mimeType": "audio/wav", "size": "8044"},
                {"id": "d1", "name": "Shoot", "mimeType": cloud.GOOGLE_FOLDER},
            ]
            self._reply({"files": files, "nextPageToken": "p2"})
        else:
            self._reply(raw=_tone())

    def do_PUT(self):
        state = self.server.state
        state["google_put"] = self._body()
        self._reply({"id": "up1", "name": "cut.mp4"})

    def do_POST(self):
        state, raw, path = self.server.state, self._body(), urlsplit(self.path).path
        if path in ("/google/token", "/dropbox/api/oauth2/token"):
            form = {key: values[0] for key, values in parse_qs(raw.decode()).items()}
            state["tokens"].append((path, form))
            fresh = form["grant_type"] == "refresh_token"
            self._reply({"access_token": "act.2" if fresh else "act.1", "refresh_token": "rft.1", "expires_in": 3600})
        elif path == "/google/api/drive/v3/files":
            state["folders"].append(json.loads(raw))
            self._reply({"id": "folder1"})
        elif path == "/google/api/upload/drive/v3/files":
            state["google_start"] = (json.loads(raw), dict(self.headers))
            self._reply(headers={"Location": f"{state['base']}/google/session/1"})
        elif path == "/dropbox/api/2/files/list_folder":
            state["listed"] = json.loads(raw)
            entries = [
                {".tag": "file", "name": "tone.wav", "path_display": "/Media/tone.wav", "size": 8044},
                {".tag": "folder", "name": "Clips", "path_display": "/Media/Clips"},
            ]
            self._reply({"entries": entries, "cursor": "c1", "has_more": False})
        elif path == "/dropbox/content/2/files/download":
            state["downloaded"] = json.loads(self.headers["Dropbox-API-Arg"])
            self._reply(raw=_tone())
        else:
            arg = json.loads(self.headers["Dropbox-API-Arg"])
            state["dropbox"].append((path.rsplit("/", 1)[1], arg, raw))
            if path.endswith("/start"):
                self._reply({"session_id": "s1"})
            else:
                self._reply({"name": "cut.mp4", "path_display": "/formcut/cut.mp4"})


@pytest.fixture
def fake(tmp_path, monkeypatch):
    server = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
    base = f"http://127.0.0.1:{server.server_address[1]}"
    server.state = {"base": base, "tokens": [], "gets": [], "folders": [], "dropbox": []}
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setenv("FORMWAV_DATA_DIR", str(tmp_path))
    for name, suffix in (("GOOGLE_AUTH", "/google/auth"), ("GOOGLE_TOKEN", "/google/token"), ("GOOGLE_API", "/google/api")):
        monkeypatch.setenv(f"CLOUD_{name}", base + suffix)
    for name, suffix in (("DROPBOX_AUTH", "/dropbox/auth"), ("DROPBOX_API", "/dropbox/api"), ("DROPBOX_CONTENT", "/dropbox/content")):
        monkeypatch.setenv(f"CLOUD_{name}", base + suffix)
    yield server.state
    server.shutdown()


def _connect(name, expires_in=3600.0):
    data = cloud._read()
    data[name] = {"app": {"clientId": f"{name}-id", "clientSecret": "g-secret" if name == "google" else ""}}
    data[name]["account"] = {"accessToken": "act.1", "refreshToken": "rft.1", "expiresAt": time.time() + expires_in}
    cloud._write(data)


def test_the_challenge_is_the_standard_s256_form():
    assert cloud.challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk") == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"


def test_google_signs_in_on_the_loopback_with_pkce_and_drive_file(fake):
    client.put("/api/cloud/google/app", json={"clientId": "g-id", "clientSecret": "g-secret"})
    query = parse_qs(urlsplit(client.post("/api/cloud/google/start").json()["url"]).query)
    assert query["redirect_uri"] == ["http://127.0.0.1:8123/api/cloud/google/callback"]
    assert query["scope"] == ["https://www.googleapis.com/auth/drive.file"]
    assert (query["access_type"], query["code_challenge_method"]) == (["offline"], ["S256"])
    page = client.get("/api/cloud/google/callback", params={"state": query["state"][0], "code": "g-code"})
    assert page.status_code == 200 and "Connected to Google Drive" in page.text
    path, form = fake["tokens"][0]
    assert path == "/google/token" and (form["client_secret"], form["code"]) == ("g-secret", "g-code")
    assert cloud.challenge(form["code_verifier"]) == query["code_challenge"][0]
    shown = client.get("/api/cloud").json()["google"]
    assert shown["connected"] is True and "g-secret" not in json.dumps(shown)
    assert os.name == "nt" or os.stat(cloud._store()).st_mode & 0o777 == 0o600
    assert client.get("/api/cloud/google/callback", params={"state": query["state"][0], "code": "g-code"}).status_code == 400


def test_full_drive_asks_for_read_access_as_well(fake):
    client.put("/api/cloud/google/app", json={"clientId": "g-id", "clientSecret": "g-secret", "fullDrive": True})
    scope = parse_qs(urlsplit(client.post("/api/cloud/google/start").json()["url"]).query)["scope"][0].split()
    assert sorted(scope) == ["https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/drive.readonly"]


def test_dropbox_signs_in_with_a_pasted_code_and_no_secret(fake):
    client.put("/api/cloud/dropbox/app", json={"clientId": "d-key", "clientSecret": "ignored"})
    started = client.post("/api/cloud/dropbox/start").json()
    query = parse_qs(urlsplit(started["url"]).query)
    assert started["paste"] is True and "redirect_uri" not in query and query["token_access_type"] == ["offline"]
    assert client.post("/api/cloud/dropbox/code", json={"code": " d-code "}).json()["connected"] is True
    path, form = fake["tokens"][0]
    assert path == "/dropbox/api/oauth2/token" and "client_secret" not in form and form["code"] == "d-code"
    assert cloud.challenge(form["code_verifier"]) == query["code_challenge"][0]
    assert client.post("/api/cloud/dropbox/code", json={"code": "d-code"}).status_code == 409


def test_both_services_list_in_one_shape(fake):
    _connect("google")
    _connect("dropbox")
    google = client.get("/api/cloud/google/files").json()
    assert google["cursor"] == "p2"
    assert [(e["name"], e["folder"], e["size"]) for e in google["entries"]] == [("tone.wav", False, 8044), ("Shoot", True, 0)]
    assert fake["gets"][0][1]["q"] == ["'root' in parents and trashed = false"] and fake["gets"][0][2] == "Bearer act.1"
    dropbox = client.get("/api/cloud/dropbox/files", params={"folder": "/Media"}).json()
    assert fake["listed"] == {"path": "/Media"} and dropbox["cursor"] == ""
    assert [(e["id"], e["folder"]) for e in dropbox["entries"]] == [("/Media/tone.wav", False), ("/Media/Clips", True)]


def test_importing_brings_media_in_and_opens_a_session_as_a_project(fake):
    _connect("google")
    _connect("dropbox")
    google = client.post("/api/cloud/google/import", json={"id": "f1", "name": "tone.wav"}).json()
    assert google["media"]["name"] == "tone.wav" and google["media"]["frames"] > 0
    assert fake["gets"][-1][:2] == ("/google/api/drive/v3/files/f1", {"alt": ["media"]})
    dropbox = client.post("/api/cloud/dropbox/import", json={"id": "/Media/tone.wav", "name": "tone.wav"}).json()
    assert dropbox["media"]["name"] == "tone.wav" and fake["downloaded"] == {"path": "/Media/tone.wav"}
    first = client.post("/api/cloud/google/import", json={"id": "f1", "name": "Interview.fmw"}).json()
    second = client.post("/api/cloud/google/import", json={"id": "f1", "name": "Interview.fmw"}).json()
    assert first == {"project": "Interview"} and second == {"project": "Interview (2)"}
    assert projects._path("Interview").is_file() and projects._path("Interview (2)").is_file()


def _session(content):
    projects.projects_dir().mkdir(parents=True, exist_ok=True)
    projects._path("cut").write_bytes(content)


def test_google_saves_a_session_into_one_formwav_folder_through_a_resumable_session(fake):
    _connect("google")
    content = bytes(range(200))
    _session(content)
    first = client.post("/api/cloud/google/upload", json={"project": "cut"})
    assert first.status_code == 200 and first.json()["id"] == "up1"
    metadata, headers = fake["google_start"]
    assert metadata == {"name": "cut.fmw", "parents": ["folder1"]} and headers["X-Upload-Content-Length"] == "200"
    assert fake["google_put"] == content and fake["folders"] == [{"name": "formwav", "mimeType": cloud.GOOGLE_FOLDER}]
    client.post("/api/cloud/google/upload", json={"project": "cut"})
    assert len(fake["folders"]) == 1
    assert client.post("/api/cloud/google/upload", json={"project": "missing"}).status_code == 404


def test_dropbox_saves_small_sessions_whole_and_large_ones_in_a_session(fake, monkeypatch):
    _connect("dropbox")
    _session(b"s" * 30)
    client.post("/api/cloud/dropbox/upload", json={"project": "cut"})
    call, arg, body = fake["dropbox"][0]
    assert call == "upload" and body == b"s" * 30 and arg == {"path": "/formwav/cut.fmw", "mode": "add", "autorename": True}
    monkeypatch.setattr(cloud, "DROPBOX_SINGLE", 10)
    monkeypatch.setattr(cloud, "DROPBOX_CHUNK", 8)
    content = bytes(range(20))
    _session(content)
    client.post("/api/cloud/dropbox/upload", json={"project": "cut"})
    session = fake["dropbox"][1:]
    assert [call for call, _, _ in session] == ["start", "append_v2", "append_v2", "finish"]
    assert [arg.get("cursor", {}).get("offset") for _, arg, _ in session[1:]] == [8, 16, 20]
    assert b"".join(body for _, _, body in session) == content and session[-1][1]["commit"]["path"] == "/formwav/cut.fmw"


def test_an_expiring_token_is_refreshed_first_and_unknown_services_are_refused(fake):
    _connect("google", expires_in=10)
    client.get("/api/cloud/google/files")
    path, form = fake["tokens"][0]
    assert (path, form["grant_type"], form["client_secret"]) == ("/google/token", "refresh_token", "g-secret")
    assert fake["gets"][-1][2] == "Bearer act.2"
    assert client.get("/api/cloud/onedrive/files").status_code == 404
    assert client.get("/api/cloud/dropbox/files").status_code == 502


def test_a_media_item_imported_from_another_format_is_saved_under_a_wav_name(fake):
    from app.services import media

    _connect("dropbox")
    made = media.import_wav("Song.final.mp3", _tone())
    assert client.post("/api/cloud/dropbox/upload", json={"mediaId": made["id"]}).status_code == 200
    call, arg, body = fake["dropbox"][0]
    assert call == "upload" and arg["path"] == "/formwav/Song.final.wav" and body[:4] == b"RIFF" and body[8:12] == b"WAVE"
    kept = media.import_wav("tone.wav", _tone())
    client.post("/api/cloud/dropbox/upload", json={"mediaId": kept["id"]})
    assert fake["dropbox"][1][1]["path"] == "/formwav/tone.wav"
