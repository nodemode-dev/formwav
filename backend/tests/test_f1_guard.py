import pytest
from starlette.websockets import WebSocketDisconnect

PORT = 8060
HEALTH = "/api/health"
WINDOW_ORIGINS = ["http://localhost:3060", "http://127.0.0.1:3060", "http://localhost:3061", "http://127.0.0.1:3061", "tauri://localhost", "http://tauri.localhost"]
OWN = f"http://127.0.0.1:{PORT}"
LOOPBACK = {"host": f"127.0.0.1:{PORT}"}

FOREIGN_ORIGINS = [
    "http://evil.example",
    "https://evil.example",
    f"http://localhost.evil.com:{PORT}",
    f"http://127.0.0.1.evil.com:{PORT}",
    "http://localhost:3099",
    "http://127.0.0.1:3099",
    "null",
    "file://",
]
FOREIGN_HOSTS = ["evil.example", f"evil.example:{PORT}", f"localhost.evil.com:{PORT}", f"192.168.1.10:{PORT}"]


@pytest.fixture(autouse=True)
def default_origins(monkeypatch):
    monkeypatch.delenv("FORMWAV_CORS_ORIGINS", raising=False)


def test_foreign_origins_are_not_in_the_apps_own_list():
    from app.core.config import cors_origins

    assert not set(FOREIGN_ORIGINS) & set(WINDOW_ORIGINS)
    assert [o for o in WINDOW_ORIGINS if o.startswith("http://") and "tauri" not in o] == cors_origins()


@pytest.mark.parametrize("host", FOREIGN_HOSTS)
def test_foreign_host_is_refused(client, host):
    assert client.get(HEALTH, headers={"host": host}).status_code == 403


@pytest.mark.parametrize("origin", FOREIGN_ORIGINS)
def test_foreign_origin_is_refused(client, origin):
    assert client.get(HEALTH, headers={"origin": origin}).status_code == 403


@pytest.mark.parametrize("origin", FOREIGN_ORIGINS)
def test_foreign_origin_cannot_post(client, origin):
    assert client.post(HEALTH, headers={"origin": origin}).status_code == 403


def test_cross_site_request_without_origin_is_refused(client):
    assert client.get(HEALTH, headers={"sec-fetch-site": "cross-site"}).status_code == 403


@pytest.mark.parametrize("value", ["CROSS-SITE", " cross-site "])
def test_cross_site_marker_is_read_loosely(client, value):
    assert client.get(HEALTH, headers={"sec-fetch-site": value}).status_code == 403


@pytest.mark.parametrize("origin", [OWN, *WINDOW_ORIGINS])
def test_allowed_origin_passes(client, origin):
    assert client.get(HEALTH, headers={"origin": origin}).status_code == 200


@pytest.mark.parametrize("host", [f"localhost:{PORT}", f"[::1]:{PORT}"])
def test_own_origin_under_another_loopback_name_passes(client, host):
    assert client.get(HEALTH, headers={"host": host, "origin": f"http://{host}"}).status_code == 200


def test_own_origin_must_match_the_host_it_was_sent_to(client):
    assert client.get(HEALTH, headers={**LOOPBACK, "origin": f"http://127.0.0.1:{PORT + 1}"}).status_code == 403


@pytest.mark.parametrize("site", ["same-origin", "same-site", "none"])
def test_browser_request_without_origin_passes_unless_cross_site(client, site):
    assert client.get(HEALTH, headers={"sec-fetch-site": site}).status_code == 200


def test_plain_client_without_origin_passes(client):
    assert client.get(HEALTH).status_code == 200


@pytest.mark.parametrize("host", [f"127.0.0.1:{PORT}", f"localhost:{PORT}", f"[::1]:{PORT}"])
def test_loopback_hosts_pass(client, host):
    assert client.get(HEALTH, headers={"host": host}).status_code == 200


def test_another_machine_is_refused():
    from fastapi.testclient import TestClient

    from app.main import app

    elsewhere = TestClient(app, base_url=OWN, client=("203.0.113.7", 50000))
    assert elsewhere.get(HEALTH).status_code == 403


def close_code(client, path, headers):
    try:
        with client.websocket_connect(path, headers=headers):
            return None
    except WebSocketDisconnect as e:
        return e.code


WS_PATHS = ["/api/audio/native", "/api/terminal"]


@pytest.mark.parametrize("path", WS_PATHS)
@pytest.mark.parametrize("headers", [
    {"host": "evil.example"},
    {**LOOPBACK, "origin": "http://evil.example"},
    {**LOOPBACK, "origin": f"http://127.0.0.1:{PORT + 1}"},
    {**LOOPBACK, "origin": "null"},
])
def test_foreign_websocket_is_refused_by_the_guard(client, path, headers):
    assert close_code(client, path, headers) == 4403


@pytest.mark.parametrize("path", WS_PATHS)
def test_websocket_without_origin_is_refused(client, path):
    assert close_code(client, path, LOOPBACK) in (1008, 4403)


@pytest.mark.parametrize("origin", [OWN, "http://localhost:3060", "http://127.0.0.1:3061"])
def test_window_websocket_is_accepted(client, origin):
    assert close_code(client, "/api/audio/native", {**LOOPBACK, "origin": origin}) is None
