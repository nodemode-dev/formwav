import json
import os

import pytest

from stand_ins import elevenlabs

P = "/api/providers/elevenlabs"


@pytest.fixture(scope="module")
def media(client):
    server = elevenlabs.serve()
    saved = {k: os.environ.get(k) for k in ("ELEVENLABS_BASE_URL", "ELEVENLABS_API_KEY")}
    os.environ["ELEVENLABS_BASE_URL"] = f"http://127.0.0.1:{server.server_address[1]}"
    os.environ["ELEVENLABS_API_KEY"] = "test-key"
    elevenlabs.REPORT.clear()
    yield client.post("/api/media", content=elevenlabs.wav(2.0), headers={"X-Filename": "speech.wav"}).json()["id"]
    server.shutdown()
    for k, v in saved.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


EXACT = 88200 - 22050 + 44100 - 441
CHECKS = {
    "models": (lambda c, m: c.get(f"{P}/models"), lambda d: [x["model_id"] for x in d["models"] if x["voice_changer"]] == ["eleven_english_sts_v2", "eleven_multilingual_sts_v2"]),
    "voices": (lambda c, m: c.get(f"{P}/voices"), lambda d: len(d["voices"]) == 2),
    "speech": (lambda c, m: c.post(f"{P}/speech", json={"text": "Hello", "voice_id": "v_rachel"}), lambda d: d["frames"] > 0),
    "voice changer": (lambda c, m: c.post(f"{P}/voice-changer", json={"media_id": m, "voice_id": "v_adam", "model_id": "eleven_multilingual_sts_v2", "remove_background_noise": True, "seed": 7}), lambda d: "(new voice)" in d["name"]),
    "voice changer, default model": (lambda c, m: c.post(f"{P}/voice-changer", json={"media_id": m, "voice_id": "v_adam"}), lambda d: d["frames"] > 0),
    "music with lyrics": (lambda c, m: c.post(f"{P}/music", json={"prompt": "warm acoustic folk", "lyrics": "[Verse]\nOn the road again", "seconds": 30, "model_id": "music_v2_5"}), lambda d: d["frames"] > 0),
    "music, length clamped": (lambda c, m: c.post(f"{P}/music", json={"prompt": "drone", "seconds": 1, "instrumental": True, "seed": 3}), lambda d: d["frames"] > 0),
    "stems, six": (lambda c, m: c.post(f"{P}/stems", json={"media_id": m}), lambda d: len(d["stems"]) == 6),
    "stems, two": (lambda c, m: c.post(f"{P}/stems", json={"media_id": m, "six": False}), lambda d: len(d["stems"]) == 2),
    "isolate": (lambda c, m: c.post(f"{P}/isolate", json={"media_id": m}), lambda d: "(voice isolated)" in d["name"]),
    "sound, loop": (lambda c, m: c.post(f"{P}/sound", json={"text": "rain on a tin roof", "duration_s": 12, "loop": True, "prompt_influence": 0.6}), lambda d: d["frames"] > 0),
    "transcribe, Scribe v2": (
        lambda c, m: c.post(f"{P}/transcribe", json={"media_id": m, "speakers": 2, "keyterms": ["formwav", "ElevenLabs"], "entities": True}),
        lambda d: [w["text"] for w in d["words"]] == ["Hello", "(laughter)", "there"] and [w.get("speaker") for w in d["words"]] == [0, 1, 1] and d["words"][1].get("event") is True,
    ),
    "design": (lambda c, m: c.post(f"{P}/design", json={"description": "a calm older narrator"}), lambda d: len(d["previews"]) == 3 and all(p["media"]["frames"] > 0 for p in d["previews"])),
    "save voice": (lambda c, m: c.post(f"{P}/voices", json={"name": "Narrator", "description": "a calm older narrator", "generated_voice_id": "gen1"}), lambda d: d["voice_id"] == "v_designed"),
    "dialogue": (lambda c, m: c.post(f"{P}/dialogue", json={"lines": [{"text": "Hi.", "voice_id": "v_rachel"}, {"text": "Hello!", "voice_id": "v_adam"}]}), lambda d: d["frames"] > 0),
    "align": (lambda c, m: c.post(f"{P}/align", json={"media_id": m, "text": "Hello there"}), lambda d: [w["text"] for w in d["words"]] == ["Hello", "there"]),
    "regenerate": (lambda c, m: c.post(f"{P}/regenerate", json={"media_id": m, "start_s": 0.5, "end_s": 1.0, "text": "Hi there"}), lambda d: d["voice_id"] == "v_clone" and d["media"]["frames"] > 0 and abs(d["replaced_s"][0] - 0.5) < 1e-3),
    "regenerate at the very start, exact length": (lambda c, m: c.post(f"{P}/regenerate", json={"media_id": m, "start_s": 0.0, "end_s": 0.5, "text": "Hi"}), lambda d: d["media"]["frames"] == EXACT),
    "regenerate to the very end, exact length": (lambda c, m: c.post(f"{P}/regenerate", json={"media_id": m, "start_s": 1.5, "end_s": 2.0, "text": "Hi"}), lambda d: d["media"]["frames"] == EXACT),
    "dub start": (lambda c, m: c.post(f"{P}/dub", json={"media_id": m, "target_lang": "es"}), lambda d: d["job"] == "dub1"),
    "dub transcript": (lambda c, m: c.get(f"{P}/dub/dub1/transcript", params={"lang": "es"}), lambda d: "Hola" in d["subtitles"]),
}


@pytest.mark.parametrize("name", list(CHECKS))
def test_each_elevenlabs_route_is_answered_and_handled(client, media, name):
    call, ok = CHECKS[name]
    reply = call(client, media)
    assert reply.status_code < 300, reply.text[:300]
    assert ok(reply.json()), json.dumps(reply.json())[:300]


def test_no_request_broke_elevenlabs_contract(media):
    assert len(elevenlabs.REPORT) >= len(CHECKS)
    broken = [(e["method"], e["template"] or e["path"], e["problems"]) for e in elevenlabs.REPORT if e["problems"]]
    assert broken == []


def test_scribes_transcript_is_kept_where_formwav_keeps_transcripts(media):
    from app.services import media as media_service

    kept = json.loads((media_service.media_dir().parent / "transcripts" / f"{media}.scribe_v2.json").read_text())
    assert kept["source"] and [w["text"] for w in kept["words"]][:1] == ["Hello"]
