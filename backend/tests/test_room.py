import io
import wave

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.routers import remote, room

desk = TestClient(app, base_url="http://127.0.0.1:8060", headers={"x-formwav-local": "1"})


def _phone():
    return TestClient(remote.Marked(app), base_url="http://192.168.1.20:8978", headers={"x-formwav-local": "1"})


def _tone(seconds=1.0, rate=48000):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x10\x00" * int(seconds * rate))
    return buf.getvalue()


@pytest.fixture
def lan(tmp_path, monkeypatch):
    monkeypatch.setenv("FORMWAV_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(remote, "start", lambda app: None)
    monkeypatch.setattr(remote, "stop", lambda: None)
    room._room.update(take=None, guests={}, arrived=[])
    desk.put("/api/remote", json={"enabled": True})
    phone = _phone()
    code = desk.post("/api/remote/code").json()["code"]
    assert phone.post("/api/remote/pair", json={"code": code, "name": "Studio B"}).status_code == 200
    return phone


def test_an_unpaired_device_is_refused_the_room(tmp_path, monkeypatch):
    monkeypatch.setenv("FORMWAV_DATA_DIR", str(tmp_path))
    assert _phone().get("/api/room").status_code == 403


def test_a_guest_checks_in_and_only_the_desktop_starts_and_stops(lan):
    me = lan.get("/api/room", params={"status": "waiting"}).json()
    assert me["me"] == {"guest": True, "id": me["guests"][0]["id"], "name": "Studio B"} and me["guests"][0]["online"] is True
    assert desk.get("/api/room").json()["me"]["guest"] is False
    assert lan.post("/api/room/start").status_code == 403 and lan.post("/api/room/stop").status_code == 403
    take = desk.post("/api/room/start").json()["take"]
    assert take["stopped"] is None and lan.get("/api/room").json()["take"]["id"] == take["id"]
    assert desk.post("/api/room/stop").json()["take"]["stopped"] is not None


def test_a_take_arrives_as_media_with_its_offset_and_leaves_once_placed(lan):
    take = desk.post("/api/room/start").json()["take"]
    started = take["started"] + 0.25
    sent = lan.post("/api/room/take", params={"take": take["id"], "started": started}, content=_tone(1.0))
    assert sent.status_code == 200 and sent.json()["offset"] == 0.25 and sent.json()["media"]["frames"] == 48000
    arrived = desk.get("/api/room").json()
    assert [(a["name"], a["offset"]) for a in arrived["arrived"]] == [("Studio B", 0.25)] and arrived["guests"][0]["state"] == "sent"
    assert lan.post("/api/room/take", params={"take": "stale", "started": started}, content=_tone()).status_code == 409
    assert desk.post("/api/room/take", params={"take": take["id"], "started": started}, content=_tone()).status_code == 403
    assert desk.post("/api/room/placed", json={"media": [sent.json()["media"]["id"]]}).json()["arrived"] == []
