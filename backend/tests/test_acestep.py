import json
import os

import pytest

from stand_ins import acestep

G = "/api/providers/acestep/generate"
RUNS = {
    "text2music with lyrics": {"task": "text2music", "prompt": "bright indie pop", "lyrics": "[Verse]\nHello", "seconds": 5, "bpm": 120, "key": "C Major"},
    "cover at 0.4": {"task": "cover", "prompt": "as a jazz trio", "strength": 0.4},
    "repaint with its end before its start": {"task": "repaint", "prompt": "a drum fill", "repaint_start": 1.0, "repaint_end": 0.5},
    "repaint 0.5 to 2.0": {"task": "repaint", "prompt": "a drum fill", "repaint_start": 0.5, "repaint_end": 2.0},
    "lego, a layer added": {"task": "lego", "prompt": "add a warm bass line"},
    "extract": {"task": "extract", "prompt": "the vocals"},
    "complete": {"task": "complete", "prompt": "carry it to an ending"},
}


@pytest.fixture(scope="module")
def server(client):
    srv = acestep.serve()
    saved = {k: os.environ.get(k) for k in ("ACESTEP_API_URL", "ACESTEP_API_KEY")}
    os.environ["ACESTEP_API_URL"] = f"http://127.0.0.1:{srv.server_address[1]}"
    os.environ["ACESTEP_API_KEY"] = acestep.KEY
    acestep.REPORT.clear()
    media = client.post("/api/media", content=acestep.wav(3.0), headers={"X-Filename": "song.wav"}).json()["id"]
    yield srv, media
    srv.shutdown()
    srv.server_close()
    for k, v in saved.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


def test_the_status_reads_the_servers_models(client, server):
    status = client.get("/api/providers/acestep").json()
    listed = next(p for p in client.get("/api/providers").json()["providers"] if p["id"] == "acestep")
    assert status["ready"] and listed["ready"] and status["default"] == "acestep-v15-turbo" and len(status["models"]) == 2


@pytest.mark.parametrize("name", list(RUNS))
def test_each_task_comes_back_as_media(client, server, name):
    body = dict(RUNS[name])
    if body["task"] != "text2music":
        body["media_id"] = server[1]
    reply = client.post(G, json=body)
    assert reply.status_code == 201, reply.text[:300]
    assert reply.json()["frames"] > 0


def test_no_request_broke_ace_steps_documented_api(server):
    released = [e for e in acestep.REPORT if e["path"] == "/release_task"]
    assert len(released) == len(RUNS)
    assert [e["problems"] for e in acestep.REPORT if e["problems"]] == []


def test_a_repaint_ending_before_it_starts_is_sent_as_to_the_end(server):
    repaints = [e["fields"] for e in acestep.REPORT if e["path"] == "/release_task" and e["task_type"] == "repaint"]
    assert float(repaints[0]["repainting_end"]) == -1, repaints[0]
    assert float(repaints[1]["repainting_end"]) == 2.0, repaints[1]


@pytest.mark.parametrize("body", [
    {"prompt": "x", "loudness": 3},
    {"prompt": "x", "task_type": "remix"},
    {"prompt": "x", "audio_duration": 700},
    {"prompt": "x", "batch_size": 9},
    {"prompt": "x", "task_type": "cover"},
])
def test_the_stand_in_itself_refuses_what_the_api_refuses(body):
    problems, _ = acestep.check_release({"content-type": "application/json", "authorization": f"Bearer {acestep.KEY}"}, json.dumps(body).encode())
    assert problems


def test_the_stand_in_itself_refuses_a_request_without_the_key():
    problems, _ = acestep.check_release({"content-type": "application/json"}, b'{"prompt": "x"}')
    assert problems


def test_with_the_server_gone_formwav_says_how_to_start_it(client, server):
    srv, _ = server
    srv.shutdown()
    srv.server_close()
    assert client.get("/api/providers/acestep").json()["ready"] is False
    reply = client.post(G, json={"task": "text2music", "prompt": "x"})
    assert reply.status_code >= 400 and "acestep-api" in reply.json().get("detail", "")
