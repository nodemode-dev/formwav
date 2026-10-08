"""PLAN_v13 S3, bounce and files: a range of the mix, AIFF, AIFF-C, 32-bit WAV and 16-bit FLAC beside the old formats, the
dither switch, peak normalisation, the true peak in the report, BWF's bext with the timecode, and RF64; each file read
back by ffprobe or ffmpeg, independent of the writer."""
import json
import shutil
import struct
import subprocess

import numpy as np
import pytest

from app.routers import render as route
from app.services import export, render

RATE = 48000
pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None, reason="needs ffmpeg and ffprobe on the PATH")


def _wav(x: np.ndarray) -> bytes:
    channels = 1 if x.ndim == 1 else x.shape[1]
    data = x.astype("<f4").tobytes()
    fmt = struct.pack("<IHHIIHH", 16, 3, channels, RATE, RATE * 4 * channels, 4 * channels, 32)
    return b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + fmt + b"data" + struct.pack("<I", len(data)) + data


def _tone(hz: float, seconds: float = 4.0, amp: float = 0.25) -> np.ndarray:
    return amp * np.sin(2 * np.pi * hz * np.arange(int(seconds * RATE)) / RATE)


@pytest.fixture(scope="module")
def store(client):
    return lambda x: client.post("/api/media", content=_wav(x), headers={"X-Filename": "bounce.wav"}).json()


def _doc(ref: dict, **more) -> dict:
    clip = {"id": "c1", "mediaId": ref["id"], "start": 0, "sourceIn": 0, "length": ref["frames"], "gainDb": 0}
    track = {"id": "t1", "name": "t", "gainDb": 0, "pan": 0, "mute": False, "solo": False, "clips": [clip], **more.pop("track", {})}
    return {"version": 1, "sampleRate": RATE, "media": {ref["id"]: ref}, "markers": [], "tracks": [track], **more}


def _decode(data: bytes, tmp_path, ext: str) -> np.ndarray:
    """What ffmpeg reads from a file, as float32 stereo frames."""
    src = tmp_path / f"probe.{ext}"
    src.write_bytes(data)
    done = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-i", str(src), "-f", "f32le", "-c:a", "pcm_f32le", "-"], capture_output=True, check=True)
    return np.frombuffer(done.stdout, "<f4").reshape(-1, 2)


def _probe(data: bytes, tmp_path, ext: str) -> dict:
    src = tmp_path / f"probe.{ext}"
    src.write_bytes(data)
    done = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,bits_per_sample,bits_per_raw_sample,sample_fmt:format=format_name,duration:format_tags", "-of", "json", str(src)], capture_output=True, text=True, check=True)
    return json.loads(done.stdout)


def _export(client, doc: dict, **params):
    reply = client.post("/api/render", params=params, json=doc)
    assert reply.status_code == 200, reply.text
    return reply


def test_a_range_is_exactly_those_frames_of_the_mix_and_one_past_the_end_keeps_the_tails(client, store, tmp_path):
    ref = store(_tone(440))
    doc = _doc(ref)
    whole = export.frames_of(render.render(doc)["wav"])[0]
    part = _export(client, doc, format="wav", start=48000, end=144000)
    assert part.headers["X-Frames"] == "96000" and part.headers["X-Range-Start"] == "48000"
    assert np.array_equal(_decode(part.content, tmp_path, "wav"), whole[48000:144000])
    # a 1 s clip through an echo on its track's own bus: a range to 2 s renders the repeats after the clip
    short = store(_tone(440, seconds=1.0))
    echo = _doc(short, track={"fx": [{"kind": "echo", "delayMs": 250, "feedback": 0.3, "mix": 0.35}]})
    assert render.render(echo)["frames"] == RATE
    tail = _decode(_export(client, echo, format="wav", start=RATE // 2, end=2 * RATE).content, tmp_path, "wav")
    assert len(tail) == int(1.5 * RATE)
    after = tail[RATE // 2 : RATE // 2 + RATE // 4, 0]
    assert 10 * np.log10(np.mean(after.astype(np.float64) ** 2)) > -30


@pytest.mark.parametrize(("fmt", "codec", "bits"), [
    ("wav32", "pcm_s32le", 32), ("wav24", "pcm_s24le", 24), ("wav16", "pcm_s16le", 16), ("aiff", "pcm_s24be", 24), ("aiff16", "pcm_s16be", 16),
    ("aifc", "pcm_f32be", 32), ("flac", "flac", 24), ("flac16", "flac", 16),
])
def test_each_new_file_reads_back_as_its_format_and_depth(client, store, tmp_path, fmt, codec, bits):
    reply = _export(client, _doc(store(_tone(440))), format=fmt)
    ext = reply.headers["Content-Disposition"].rsplit(".", 1)[1].strip('"')
    stream = _probe(reply.content, tmp_path, ext)["streams"][0]
    assert stream["codec_name"] == codec
    assert int(stream.get("bits_per_raw_sample") or stream["bits_per_sample"]) == bits
    if fmt == "aifc":
        assert reply.content[8:12] == b"AIFC" and b"fl32" in reply.content[:200]


def test_aiff_and_flac_hold_the_same_samples_as_the_wav_of_their_depth_and_aiff_c_the_float_mix(client, store, tmp_path):
    doc = _doc(store(_tone(440)))
    decoded = {fmt: _decode(_export(client, doc, format=fmt).content, tmp_path, ext) for fmt, ext in [
        ("wav", "wav"), ("wav24", "wav"), ("aiff", "aiff"), ("flac", "flac"), ("wav16", "wav"), ("aiff16", "aiff"), ("flac16", "flac"), ("aifc", "aifc"), ("wav32", "wav")]}
    assert np.array_equal(decoded["aiff"], decoded["wav24"]) and np.array_equal(decoded["flac"], decoded["wav24"])
    assert np.array_equal(decoded["aiff16"], decoded["wav16"]) and np.array_equal(decoded["flac16"], decoded["wav16"])
    assert np.array_equal(decoded["aifc"], decoded["wav"])
    assert np.max(np.abs(decoded["wav32"] - decoded["wav"])) < 2.0**-30
    # the 24-bit file within a step and a half of the float mix (TPDF of two steps, then rounding)
    assert np.max(np.abs(decoded["wav24"] - decoded["wav"])) <= 1.5 * 2.0**-23


def test_dither_keeps_a_tone_below_one_step_that_rounding_loses_and_leaves_silence_silent(client, store, tmp_path):
    quiet = np.concatenate([_tone(1000, seconds=1.0, amp=0.3 / 32768), np.zeros(RATE // 2)])
    doc = _doc(store(quiet))
    rounded = _decode(_export(client, doc, format="wav16", dither="false").content, tmp_path, "wav")
    dithered = _decode(_export(client, doc, format="wav16").content, tmp_path, "wav")
    assert not rounded.any()
    steps = np.round(dithered[:RATE, 0] * 32768)
    assert np.array_equal(steps, dithered[:RATE, 0] * 32768) and np.abs(steps).max() <= 2
    spectrum = np.abs(np.fft.rfft(steps * np.hanning(RATE)))
    assert np.argmax(spectrum[20:]) + 20 == 1000
    assert not dithered[RATE:].any()


def test_normalising_puts_the_mix_peak_at_the_target_in_float_and_16_bit(client, store, tmp_path):
    doc = _doc(store(_tone(440, amp=0.2)))
    for fmt in ("wav", "wav16"):
        reply = _export(client, doc, format=fmt, normalize=-0.1)
        peak = 20 * np.log10(np.abs(_decode(reply.content, tmp_path, "wav")).max())
        assert peak == pytest.approx(-0.1, abs=0.01)
        assert float(reply.headers["X-Normalize-dB"]) == pytest.approx(-0.1 - 20 * np.log10(0.2), abs=0.01)
        assert float(reply.headers["X-Peak-Left-dBFS"]) == pytest.approx(-0.1, abs=0.01)


def test_the_report_gives_the_true_peak_above_the_sample_peak_of_a_quarter_rate_sine(client, store):
    # a sine at a quarter of the rate, phased 45 degrees, has its samples at 0.707 of its height
    x = np.sin(2 * np.pi * 0.25 * (np.arange(2 * RATE) % 4) + np.pi / 4)
    reply = _export(client, _doc(store(x)), format="wav")
    assert float(reply.headers["X-Peak-Left-dBFS"]) == pytest.approx(-3.01, abs=0.01)
    assert abs(float(reply.headers["X-True-Peak-dBTP"])) < 0.5


def test_a_wav_carries_the_session_timecode_plus_the_range_start_in_its_bext_chunk(client, store, tmp_path):
    doc = _doc(store(_tone(440)), timecodeStart=3600.5)
    for fmt in ("wav", "wav24", "wav16"):
        tags = _probe(_export(client, doc, format=fmt, start=48000, end=96000).content, tmp_path, "wav")["format"]["tags"]
        assert tags["time_reference"] == str(int(3600.5 * RATE) + 48000)
        assert tags["encoded_by"] == "formwav" and tags["comment"] == "formwav mix"
    assert "time_reference" not in _probe(_export(client, doc, format="aiff").content, tmp_path, "aiff")["format"].get("tags", {})


def test_markers_inside_a_range_land_as_cue_points_counted_from_its_start(client, store):
    doc = _doc(store(_tone(440)), markers=[{"at": 72000, "label": "in"}, {"at": 10, "label": "before"}, {"at": 150000, "label": "after"}])
    data = _export(client, doc, format="wav24", start=48000, end=144000).content
    i = data.index(b"cue ")
    count = struct.unpack("<I", data[i + 8 : i + 12])[0]
    assert count == 1 and struct.unpack("<I", data[i + 12 + 20 : i + 12 + 24])[0] == 24000
    assert b"in\0" in data and b"before" not in data and b"after" not in data


def test_past_4_gib_the_render_is_written_as_rf64_and_still_reads_whole(client, store, tmp_path, monkeypatch):
    doc = _doc(store(_tone(440)))
    plain = render.render(doc)["wav"]
    monkeypatch.setattr(render, "RF64_ABOVE", 0)
    wide = render.render(doc)["wav"]
    assert wide[:4] == b"RF64" and struct.unpack("<I", wide[4:8])[0] == 0xFFFFFFFF and wide[12:16] == b"ds64"
    riff, data, frames, table = struct.unpack("<QQQI", wide[20:48])
    assert (riff, data, frames, table) == (len(wide) - 8, 4 * RATE * 8, 4 * RATE, 0)
    assert np.array_equal(export.frames_of(wide)[0], export.frames_of(plain)[0])
    assert _probe(wide, tmp_path, "wav")["format"]["duration"] == "4.000000"
    # cue points appended to an RF64 file move its ds64 size, not the 32-bit one
    cued = route._with_cues(wide, {"markers": [{"at": 100, "label": "m"}]})
    assert struct.unpack("<Q", cued[20:28])[0] == len(cued) - 8 and struct.unpack("<I", cued[4:8])[0] == 0xFFFFFFFF
    assert np.array_equal(_decode(cued, tmp_path, "wav"), export.frames_of(plain)[0])


def test_the_engine_refuses_a_range_or_a_normalisation_where_it_does_not_apply(client, store):
    doc = _doc(store(_tone(440, seconds=1.0)))
    assert client.post("/api/render", params={"what": "adm", "start": 0, "end": 100}, json=doc).status_code == 422
    assert client.post("/api/render", params={"what": "stems", "normalize": -1}, json=doc).status_code == 422
    assert client.post("/api/render", params={"normalize": 3}, json=doc).status_code == 422
    assert client.post("/api/render", params={"start": 2000, "end": 1000}, json=doc).status_code == 400
    assert client.post("/api/render", params={"start": 10 * RATE}, json=doc).status_code == 400
