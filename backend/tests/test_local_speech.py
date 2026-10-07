import re

import pytest

from app.services import local_speech
from conftest import whisper

SENTENCE = "Formwav can now make speech on this machine, with nothing sent anywhere."


@pytest.fixture(scope="module")
def kokoro():
    if not local_speech.installed("kokoro"):
        pytest.skip("needs Kokoro installed (Create tab: Install a speech engine on this machine)")


def _words(text: str) -> list[str]:
    return re.findall(r"[a-z]+", text.lower())


def test_kokoro_offers_its_voices(client, kokoro):
    voices = client.get("/api/providers/local-speech/kokoro/voices").json()["voices"]
    assert len(voices) == 54 and "af_heart" in voices


def test_a_spoken_sentence_is_heard_back_by_whisper(client, kokoro):
    whisper()
    from app.services import transcript

    spoken = client.post("/api/providers/local-speech/kokoro/speak", json={"text": SENTENCE, "voice": "af_heart"})
    assert spoken.status_code in (200, 201), spoken.text[:200]
    heard = _words(" ".join(w["text"] for w in transcript.transcript(spoken.json()["id"])["words"]))
    match = sum(1 for w in _words(SENTENCE) if w in heard) / len(_words(SENTENCE))
    assert match >= 0.8, f"Whisper heard {match:.0%} of the words: {heard}"


def test_regenerate_takes_its_reference_from_the_clip_and_splices_to_the_exact_length(client, kokoro, jfk_wav, monkeypatch):
    source = client.post("/api/media", content=jfk_wav, headers={"X-Filename": "jfk.wav"}).json()
    seen = {}
    real_speak = local_speech.speak

    def kokoro_in_place_of_a_cloning_engine(engine, text, voice="", reference_media="", language="en", rate=None, reference_from=0.0):
        seen.update(engine=engine, reference_media=reference_media, rate=rate)
        return real_speak("kokoro", text, rate=rate)

    monkeypatch.setitem(local_speech.ENGINES["pocket"], "clones", True)
    monkeypatch.setattr(local_speech, "speak", kokoro_in_place_of_a_cloning_engine)
    out = local_speech.regenerate("pocket", source["id"], 3.3, 4.38, "ask not")
    assert seen["reference_media"] == source["id"] and seen["rate"] == source["sampleRate"]
    assert out["media"]["frames"] == source["frames"] + out["delta_frames"]
