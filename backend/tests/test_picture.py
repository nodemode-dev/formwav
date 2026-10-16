"""PLAN_v13 S15: the session's picture. A ProRes or Motion JPEG movie gets an H.264 proxy the page can play (an H.264
one is played as it is), its sound comes in as media, its frames come back as a strip of thumbnails, and a session
keeps it by reference: moved beside the session it is found again on open, and gone it is named as missing."""
import io
import shutil
import subprocess

import numpy as np
import pytest

from app.core.paths import data_dir
from app.services import picture, projects

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg")


def _movie(tmp_path, name: str, codec: list[str], seconds: float = 2.0, sound: bool = False) -> bytes:
    out = tmp_path / name
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25"]
    if sound:
        cmd += ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-c:a", "pcm_s16le"]
    subprocess.run([*cmd, "-t", str(seconds), *codec, str(out)], check=True, timeout=120)
    return out.read_bytes()


def _probe(data: bytes, tmp_path) -> str:
    path = tmp_path / "served.bin"
    path.write_bytes(data)
    done = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name", "-of", "csv=p=0", str(path)], capture_output=True, text=True, timeout=60)
    return done.stdout.strip()


def test_prores_and_motion_jpeg_get_an_h264_proxy_and_the_movies_sound_comes_in(client, tmp_path):
    for name, codec, sound in (("prores.mov", ["-c:v", "prores_ks"], True), ("mjpeg.mov", ["-c:v", "mjpeg"], False)):
        data = _movie(tmp_path, name, codec, sound=sound)
        res = client.post("/api/pictures", content=data, headers={"X-Filename": name})
        assert res.status_code == 201, res.text
        out = res.json()
        pic = out["picture"]
        assert pic["proxy"] is True and pic["codec"] in ("prores", "mjpeg") and (pic["width"], pic["height"]) == (320, 180)
        assert abs(pic["duration"] - 2.0) < 0.05 and abs(pic["fps"] - 25) < 0.01 and pic["size"] == len(data)
        served = client.get(f"/api/pictures/{pic['id']}/movie")
        assert served.status_code == 200 and _probe(served.content, tmp_path) == "h264"
        part = client.get(f"/api/pictures/{pic['id']}/movie", headers={"Range": "bytes=0-99"})
        assert part.status_code == 206 and len(part.content) == 100
        assert (out["audio"] is not None) == sound
        if sound:
            assert out["audio"]["sampleRate"] == 48000 and abs(out["audio"]["frames"] - 96000) < 2000
    again = client.post("/api/pictures", content=data, headers={"X-Filename": "mjpeg.mov"}).json()["picture"]
    assert again["id"] == pic["id"]
    assert client.get("/api/pictures/" + "0" * 64).status_code == 404


def test_an_h264_movie_plays_as_it_is_and_its_frames_come_back_as_one_strip(client, tmp_path):
    data = _movie(tmp_path, "h264.mp4", ["-c:v", "libx264", "-pix_fmt", "yuv420p"], seconds=10)
    pic = client.post("/api/pictures", content=data, headers={"X-Filename": "h264.mp4"}).json()["picture"]
    assert pic["proxy"] is False and pic["codec"] == "h264"
    assert client.get(f"/api/pictures/{pic['id']}/movie").content == data
    res = client.get(f"/api/pictures/{pic['id']}/sprite", params={"times": ",".join(str(t) for t in range(10)), "height": 44})
    assert res.status_code == 200 and res.headers["content-type"] == "image/png"
    from PIL import Image

    img = np.asarray(Image.open(io.BytesIO(res.content)).convert("RGB"), dtype=np.float64)
    assert img.shape[0] == 44 and img.shape[1] == 10 * 78
    tiles = [img[:, k * 78 : (k + 1) * 78] for k in range(10)]
    diffs = [np.abs(a - b).mean() for a, b in zip(tiles, tiles[1:])]
    assert min(diffs) > 1.0, diffs
    past = client.get(f"/api/pictures/{pic['id']}/sprite", params={"times": "99", "height": 44})
    assert past.status_code == 200
    assert client.get(f"/api/pictures/{pic['id']}/sprite", params={"times": "a,b"}).status_code == 422


def test_a_session_finds_its_moved_picture_beside_it_and_names_a_lost_one(tmp_path):
    data = _movie(tmp_path, "scene.mp4", ["-c:v", "libx264", "-pix_fmt", "yuv420p"], seconds=1)
    pic = picture.import_picture("scene.mp4", data)
    doc = {"version": 1, "sampleRate": 48000, "media": {}, "markers": [], "tracks": [], "picture": {"id": pic["id"], "name": "scene.mp4", "size": len(data), "start": 48000}}
    projects.save("Picture relink", doc)
    gone = lambda: [p.unlink() for p in picture.folder().glob(f"{pic['id']}*")]
    gone()
    beside = data_dir() / "Video Files"
    beside.mkdir(exist_ok=True)
    (beside / "scene.mp4").write_bytes(data)
    opened = projects.open_project("Picture relink")
    assert opened["missing"] == [] and opened["document"]["picture"]["start"] == 48000
    assert picture.movie_path(pic["id"]).read_bytes() == data
    gone()
    (beside / "scene.mp4").write_bytes(data[:-1] + b"\x00")
    opened = projects.open_project("Picture relink")
    assert opened["missing"] == ["scene.mp4"]
    (beside / "scene.mp4").unlink()
    assert projects.open_project("Picture relink")["missing"] == ["scene.mp4"]
