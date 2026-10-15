"""PLAN_v14 W4, sessions that do not lose work: the timeline as OpenTimelineIO, read back by the Academy Software
Foundation's own opentimelineio package as the judge, and the autosave the window keeps and offers back."""
import io
import json
import struct
import zipfile

import numpy as np
import pytest

RATE = 48000


def _wav(x: np.ndarray, rate: int = RATE) -> bytes:
    data = x.astype("<f4").tobytes()
    fmt = struct.pack("<IHHIIHH", 16, 3, 1, rate, rate * 4, 4, 32)
    return b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + fmt + b"data" + struct.pack("<I", len(data)) + data


@pytest.fixture(scope="module")
def session(client):
    a = client.post("/api/media", content=_wav(0.1 * np.ones(4 * RATE, dtype=np.float32)), headers={"X-Filename": "voice.wav"}).json()
    b = client.post("/api/media", content=_wav(0.1 * np.ones(3 * 44100, dtype=np.float32), 44100), headers={"X-Filename": "music.wav"}).json()
    return {
        "sampleRate": RATE,
        "media": {a["id"]: a, b["id"]: b},
        "markers": [{"id": "m1", "at": RATE, "label": "Intro"}, {"id": "r1", "at": 2 * RATE, "end": 3 * RATE, "label": "Chorus"}],
        "tracks": [
            {"id": "t1", "name": "Vox", "channels": 1, "gainDb": -3, "mute": False, "solo": False, "clips": [
                {"id": "c1", "mediaId": a["id"], "start": RATE // 2, "length": RATE, "sourceIn": RATE, "gainDb": 0},
                {"id": "c2", "mediaId": a["id"], "start": RATE, "length": RATE, "sourceIn": 0, "gainDb": 0, "mute": True},
                {"id": "c3", "mediaId": a["id"], "start": 3 * RATE, "length": RATE // 2, "sourceIn": 0, "gainDb": 0},
            ]},
            {"id": "t2", "name": "Music", "channels": 1, "gainDb": 0, "mute": False, "solo": False, "inactive": True, "clips": [
                {"id": "c4", "mediaId": b["id"], "start": 0, "length": 2 * RATE, "sourceIn": 22050, "gainDb": 0},
            ]},
        ],
    }


def test_the_otioz_opens_in_opentimelineio_with_every_clip_where_formwav_has_it(client, session, tmp_path):
    otio = pytest.importorskip("opentimelineio", reason="pip install -r backend/tests/requirements.txt")
    res = client.post("/api/projects/export-otio", json=session)
    assert res.status_code == 200, res.text
    names = zipfile.ZipFile(io.BytesIO(res.content)).namelist()
    assert {"version.txt", "content.otio"} <= set(names) and sum(n.startswith("media/") for n in names) == 2
    path = tmp_path / "s.otioz"
    path.write_bytes(res.content)
    (tmp_path / "x").mkdir()
    tl = otio.adapters.read_from_file(str(path), extract_to_directory=str(tmp_path / "x"))
    tracks = {t.name: t for t in tl.tracks}
    # the overlapping clip on Vox goes to a second track; times are the session's samples
    assert sorted(tracks) == ["Music", "Vox", "Vox 2"]
    vox = list(tracks["Vox"].find_clips())
    assert [round(tracks["Vox"].range_of_child(c).start_time.to_seconds(), 6) for c in vox] == [0.5, 3.0]
    assert round(vox[0].source_range.start_time.to_seconds(), 6) == 1.0
    second = list(tracks["Vox 2"].find_clips())[0]
    assert not second.enabled and round(tracks["Vox 2"].range_of_child(second).start_time.to_seconds(), 6) == 1.0
    # a 44.1 kHz clip's source range is in its own samples: 0.5 s in, 2 s long
    music = list(tracks["Music"].find_clips())[0]
    assert not tracks["Music"].enabled
    assert music.source_range.start_time.rate == 44100 and round(music.source_range.start_time.to_seconds(), 6) == 0.5 and round(music.source_range.duration.to_seconds(), 6) == 2.0
    assert [(m.name, round(m.marked_range.duration.to_seconds(), 3)) for m in tl.tracks.markers] == [("Intro", 0.0), ("Chorus", 1.0)]
    assert tracks["Vox"].metadata["formwav"]["gainDb"] == -3
    # every clip's audio is in the bundle where its reference points
    from urllib.parse import urlparse

    target = vox[0].media_reference.target_url
    local = urlparse(target).path if target.startswith("file:") else str(tmp_path / "x" / target)
    assert __import__("pathlib").Path(local).is_file(), target


def test_a_clip_whose_audio_is_gone_is_refused(client, session):
    broken = json.loads(json.dumps(session))
    broken["tracks"][0]["clips"][0]["mediaId"] = "0" * 32
    assert client.post("/api/projects/export-otio", json=broken).status_code == 422


def test_the_autosave_is_kept_whole_read_back_and_cleared(client, session):
    client.delete("/api/autosave")
    assert client.get("/api/autosave").json() == {"exists": False}
    assert client.put("/api/autosave", json={"name": "Interview", "document": {"tracks": "no"}}).status_code == 400
    assert client.put("/api/autosave", json={"name": "Interview", "document": session}).status_code == 200
    summary = client.get("/api/autosave").json()
    assert summary["exists"] and summary["name"] == "Interview" and summary["tracks"] == 2 and summary["clips"] == 4 and "document" not in summary
    assert client.get("/api/autosave", params={"full": True}).json()["document"] == session
    client.delete("/api/autosave")
    assert client.get("/api/autosave").json() == {"exists": False}
