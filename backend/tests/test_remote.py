import json
import socket
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import remote

desk = TestClient(app, base_url="http://127.0.0.1:8060", headers={"x-formwav-local": "1"})


def _phone():
    return TestClient(remote.Marked(app), base_url="http://192.168.1.20:8978", headers={"x-formwav-local": "1"})


@pytest.fixture
def lan(tmp_path, monkeypatch):
    monkeypatch.setenv("FORMWAV_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(remote, "start", lambda app: None)
    monkeypatch.setattr(remote, "stop", lambda: None)
    remote._codes.clear()
    remote._failures["count"] = 0
    desk.put("/api/remote", json={"enabled": True})
    return _phone()


def _pair(phone, name="Pixel"):
    code = desk.post("/api/remote/code").json()["code"]
    return phone.post("/api/remote/pair", json={"code": code, "name": name})


def test_the_network_side_refuses_everything_until_paired(lan):
    assert lan.get("/api/cloud").status_code == 403
    first = lan.get("/", follow_redirects=False)
    assert first.status_code == 303 and first.headers["location"] == "/pair"
    page = lan.get("/pair")
    assert page.status_code == 200 and "Pair with formwav" in page.text


def test_a_fresh_code_pairs_one_device_with_a_strict_cookie(lan):
    code = desk.post("/api/remote/code").json()["code"]
    assert len(code) == 6 and code.isdigit()
    reply = lan.post("/api/remote/pair", json={"code": code, "name": "Pixel"})
    cookie = reply.headers["set-cookie"].lower()
    assert reply.status_code == 200 and "formwav_device=" in cookie and "httponly" in cookie and "samesite=strict" in cookie
    assert lan.get("/api/cloud").status_code == 200
    devices = desk.get("/api/remote").json()["devices"]
    assert [device["name"] for device in devices] == ["Pixel"] and "hash" not in devices[0]
    assert lan.cookies[remote.COOKIE] not in remote._store().read_text()


def test_a_code_works_once_and_not_after_it_expires(lan, monkeypatch):
    code = desk.post("/api/remote/code").json()["code"]
    assert lan.post("/api/remote/pair", json={"code": code}).status_code == 200
    assert _phone().post("/api/remote/pair", json={"code": code}).status_code == 403
    monkeypatch.setattr(remote, "CODE_FOR", -1.0)
    assert _pair(_phone()).status_code == 403


def test_five_wrong_codes_cancel_every_live_code(lan):
    code = desk.post("/api/remote/code").json()["code"]
    wrong = [f"{(int(code) + step) % 1_000_000:06d}" for step in range(1, 6)]
    assert [lan.post("/api/remote/pair", json={"code": guess}).status_code for guess in wrong] == [403] * 5
    assert lan.post("/api/remote/pair", json={"code": code}).status_code == 403


def test_only_the_desktop_manages_pairing(lan):
    _pair(lan)
    device = desk.get("/api/remote").json()["devices"][0]["id"]
    assert lan.get("/api/remote").status_code == 403
    assert lan.post("/api/remote/code").status_code == 403
    assert lan.put("/api/remote", json={"enabled": False}).status_code == 403
    assert lan.delete(f"/api/remote/devices/{device}").status_code == 403


def test_removing_a_device_ends_its_access(lan):
    _pair(lan)
    device = desk.get("/api/remote").json()["devices"][0]["id"]
    assert desk.delete(f"/api/remote/devices/{device}").json()["devices"] == []
    assert lan.get("/api/cloud").status_code == 403


def test_a_bearer_token_works_for_clients_without_cookies(lan):
    _pair(lan)
    token = lan.cookies[remote.COOKIE]
    bare = TestClient(remote.Marked(app), base_url="http://192.168.1.20:8978")
    assert bare.get("/api/cloud", headers={"Authorization": f"Bearer {token}"}).status_code == 200
    assert bare.get("/api/cloud", headers={"Authorization": "Bearer guessed"}).status_code == 403


def test_codes_need_the_listener_on_and_loopback_is_unchanged(lan):
    desk.put("/api/remote", json={"enabled": False})
    assert desk.post("/api/remote/code").status_code == 409
    assert desk.get("/api/cloud").status_code == 200


def test_the_real_listener_marks_its_requests_even_from_this_machine(tmp_path, monkeypatch):
    monkeypatch.setenv("FORMWAV_DATA_DIR", str(tmp_path))
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        free = probe.getsockname()[1]
    monkeypatch.setenv("FORMWAV_REMOTE_PORT", str(free))
    desk.put("/api/remote", json={"enabled": True})
    try:
        deadline = time.time() + 10
        while time.time() < deadline:
            try:
                page = httpx.get(f"http://127.0.0.1:{free}/pair", timeout=1)
                break
            except httpx.HTTPError:
                time.sleep(0.1)
        assert page.status_code == 200
        assert httpx.get(f"http://127.0.0.1:{free}/api/cloud", timeout=2).status_code == 403
        assert json.loads(remote._store().read_text())["enabled"] is True
    finally:
        desk.put("/api/remote", json={"enabled": False})
