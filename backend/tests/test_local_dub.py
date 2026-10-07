import importlib.util
import os
import re
import subprocess

import numpy as np
import pytest

from app.services import local_speech, media
from conftest import BACKEND

HUMAN = "Y así, mis compatriotas estadounidenses, no pregunten qué puede hacer su país por ustedes, pregunten qué pueden hacer ustedes por su país."


def _words(text: str) -> list[str]:
    return re.findall(r"[a-záéíóúñü]+", text.lower())


def _f1(a: str, b: str) -> float:
    x, y = _words(a), _words(b)
    common = sum(min(x.count(w), y.count(w)) for w in set(x))
    return 2 * common / (len(x) + len(y)) if x and y else 0.0


@pytest.fixture(scope="module")
def dubbed(client, jfk_wav):
    if not local_speech.installed("kokoro") or not (BACKEND / "models" / "translate" / "en_es" / "model" / "model.bin").exists():
        pytest.skip("needs Kokoro and the Spanish dubbing model (Create tab: Install dubbing language)")
    if importlib.util.find_spec("faster_whisper") is None:
        pytest.skip("needs backend/requirements_transcript.txt for Whisper")
    source = client.post("/api/media", content=jfk_wav, headers={"X-Filename": "jfk.wav"}).json()
    reply = client.post("/api/providers/local-dub/es", json={"media_id": source["id"]})
    assert reply.status_code in (200, 201), reply.text[:300]
    return source, reply.json()


def test_the_translation_matches_the_standard_human_rendering(dubbed):
    _, out = dubbed
    said = " ".join(p["translated"] for p in out["sentences"])
    assert _f1(said, HUMAN) > 0.7, said


def test_each_sentence_is_placed_where_it_was_said_and_sped_up_no_more_than_a_third(dubbed):
    _, out = dubbed
    for p in out["sentences"]:
        assert abs(p["placed_s"] - p["start"]) < 0.002 and p["speed"] <= 1.35, p


def test_the_dub_is_as_long_as_the_source(dubbed):
    source, out = dubbed
    assert abs(out["media"]["frames"] / out["media"]["sampleRate"] - source["frames"] / source["sampleRate"]) < 0.01


def test_a_multilingual_whisper_hears_the_spanish_that_was_to_be_said(dubbed):
    _, out = dubbed
    from faster_whisper import WhisperModel

    judge = WhisperModel("tiny", device="cpu", compute_type="int8", download_root=os.environ.get("FORMWAV_MODELS_ROOT", str(BACKEND / "models")) + "/whisper")
    pcm = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-i", str(media.media_dir() / f"{out['media']['id']}.wav"), "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], capture_output=True, check=True).stdout
    segments, _ = judge.transcribe(np.frombuffer(pcm, "<f4").copy(), language="es")
    heard = " ".join(s.text.strip() for s in segments)
    said = " ".join(p["translated"] for p in out["sentences"])
    assert _f1(heard, said) > 0.6, f"heard {heard!r} for {said!r}"
