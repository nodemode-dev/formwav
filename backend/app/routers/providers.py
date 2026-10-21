"""Routes for the model-provider layer (services/providers.py): what can generate here, and each provider's actions.
Every generation answers with the new media; dubbing is a job (start, then poll until it brings the media back)."""

from __future__ import annotations

from fastapi import APIRouter, Body, HTTPException

from ..services import providers as prov

router = APIRouter()


def _run(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except prov.ProviderError as err:
        raise HTTPException(err.status, str(err)) from err


@router.get("/providers")
def list_providers() -> dict:
    return _run(prov.providers)


@router.get("/providers/elevenlabs/voices")
def elevenlabs_voices() -> dict:
    return {"voices": _run(prov.elevenlabs_voices)}


@router.post("/providers/elevenlabs/speech", status_code=201)
def elevenlabs_speech(body: dict = Body(...)) -> dict:
    return _run(prov.elevenlabs_speech, str(body.get("text", "")), str(body.get("voice_id", "")), str(body.get("model_id") or "eleven_multilingual_v2"))


@router.post("/providers/elevenlabs/sound", status_code=201)
def elevenlabs_sound(body: dict = Body(...)) -> dict:
    duration, influence = body.get("duration_s"), body.get("prompt_influence")
    return _run(prov.elevenlabs_sound, str(body.get("text", "")), float(duration) if duration else None, bool(body.get("loop")), float(influence) if influence is not None else None)


@router.post("/providers/elevenlabs/regenerate", status_code=201)
def elevenlabs_regenerate(body: dict = Body(...)) -> dict:
    try:
        start, end = float(body.get("start_s", 0)), float(body.get("end_s", 0))
    except (TypeError, ValueError) as err:
        raise HTTPException(422, "start_s and end_s are seconds in the media") from err
    return _run(prov.elevenlabs_regenerate, str(body.get("media_id", "")), start, end, str(body.get("text", "")))


@router.post("/providers/elevenlabs/dub", status_code=202)
def elevenlabs_dub(body: dict = Body(...)) -> dict:
    return _run(prov.elevenlabs_dub_start, str(body.get("media_id", "")), str(body.get("target_lang", "")).strip() or "es", str(body.get("source_lang") or "auto"))


@router.get("/providers/elevenlabs/dub/{job}")
def elevenlabs_dub_status(job: str, lang: str, source: str = "") -> dict:
    return _run(prov.elevenlabs_dub_status, job, lang, source)


@router.post("/providers/fal/generate", status_code=201)
def fal_generate(body: dict = Body(...)) -> dict:
    inputs = body.get("input") if isinstance(body.get("input"), dict) else {}
    return _run(prov.fal_generate, str(body.get("model", "")), inputs)


@router.post("/providers/local/generate", status_code=201)
def local_generate(body: dict = Body(...)) -> dict:
    return _run(prov.local_generate, str(body.get("model", "")), str(body.get("prompt", "")), str(body.get("lyrics", "")), float(body.get("duration_s") or 30))



# The rest of ElevenLabs (the v11 plan's 1.5), each checked against ElevenLabs' OpenAPI document
@router.get("/providers/elevenlabs/models")
def elevenlabs_models() -> dict:
    return {"models": _run(prov.elevenlabs_models)}


@router.post("/providers/elevenlabs/voice-changer", status_code=201)
def elevenlabs_change_voice(body: dict = Body(...)) -> dict:
    seed = body.get("seed")
    return _run(prov.elevenlabs_change_voice, str(body.get("media_id", "")), str(body.get("voice_id", "")), str(body.get("model_id") or ""), bool(body.get("remove_background_noise")), int(seed) if seed is not None else None)


@router.post("/providers/elevenlabs/music", status_code=201)
def elevenlabs_music(body: dict = Body(...)) -> dict:
    seconds, seed = body.get("seconds"), body.get("seed")
    return _run(prov.elevenlabs_music, str(body.get("prompt", "")), str(body.get("lyrics") or ""), float(seconds) if seconds else None, str(body.get("model_id") or "music_v1"), bool(body.get("instrumental")), int(seed) if seed is not None else None)


@router.post("/providers/elevenlabs/stems", status_code=201)
def elevenlabs_stems(body: dict = Body(...)) -> dict:
    return {"stems": _run(prov.elevenlabs_stems, str(body.get("media_id", "")), body.get("six", True) is not False)}


@router.post("/providers/elevenlabs/isolate", status_code=201)
def elevenlabs_isolate(body: dict = Body(...)) -> dict:
    return _run(prov.elevenlabs_isolate, str(body.get("media_id", "")))


@router.post("/providers/elevenlabs/transcribe")
def elevenlabs_transcribe(body: dict = Body(...)) -> dict:
    speakers = body.get("speakers")
    keyterms = [str(k) for k in body.get("keyterms", [])] if isinstance(body.get("keyterms"), list) else None
    return _run(prov.elevenlabs_transcribe, str(body.get("media_id", "")), str(body.get("model_id") or "scribe_v2"), body.get("diarize", True) is not False, int(speakers) if speakers else None, body.get("events", True) is not False, keyterms, bool(body.get("entities")), str(body.get("language") or ""))


@router.post("/providers/elevenlabs/design", status_code=201)
def elevenlabs_design(body: dict = Body(...)) -> dict:
    return _run(prov.elevenlabs_design, str(body.get("description", "")), str(body.get("text") or ""), str(body.get("model_id") or ""))


@router.post("/providers/elevenlabs/voices", status_code=201)
def elevenlabs_save_voice(body: dict = Body(...)) -> dict:
    return _run(prov.elevenlabs_save_voice, str(body.get("name", "")), str(body.get("description", "")), str(body.get("generated_voice_id", "")))


@router.post("/providers/elevenlabs/dialogue", status_code=201)
def elevenlabs_dialogue(body: dict = Body(...)) -> dict:
    lines = body.get("lines") if isinstance(body.get("lines"), list) else []
    return _run(prov.elevenlabs_dialogue, lines, str(body.get("model_id") or "eleven_v3"))


@router.post("/providers/elevenlabs/align")
def elevenlabs_align(body: dict = Body(...)) -> dict:
    return _run(prov.elevenlabs_align, str(body.get("media_id", "")), str(body.get("text", "")))


@router.get("/providers/elevenlabs/dub/{job}/transcript")
def elevenlabs_dub_transcript(job: str, lang: str, format: str = "srt") -> dict:
    return {"subtitles": _run(prov.elevenlabs_dub_transcript, job, lang, format)}



# ACE-Step 1.5 on this machine (the v11 plan's 1.6), through its own REST server
@router.get("/providers/acestep")
def acestep_status() -> dict:
    from ..services import acestep

    return acestep.status()


@router.post("/providers/acestep/generate", status_code=201)
def acestep_generate(body: dict = Body(...)) -> dict:
    from ..services import acestep

    num = lambda k: float(body[k]) if body.get(k) not in (None, "") else None
    return _run(acestep.generate, str(body.get("task") or "text2music"), str(body.get("prompt") or ""), str(body.get("lyrics") or ""), num("seconds"), str(body.get("media_id") or ""),
                num("repaint_start"), num("repaint_end"), num("strength"), int(body["bpm"]) if body.get("bpm") else None, str(body.get("key") or ""), str(body.get("model") or ""), str(body.get("instruction") or ""))



# Models on this machine, installed on request into their own runtime: Kokoro, Pocket TTS and Chatterbox (from formcut), and the trained speech, music and effects separator (TIGER)
@router.get("/providers/local-speech")
def local_speech_status() -> dict:
    from ..services import local_sfx, local_speech, tiger_dnr

    return {"engines": [*local_speech.status(), tiger_dnr.status(), local_sfx.status()]}


@router.post("/providers/local-speech/{engine}/install", status_code=202)
def local_speech_install(engine: str) -> dict:
    from ..services import local_sfx, local_speech, tiger_dnr

    if engine == "ezaudio":
        return _run(local_sfx.install)
    return _run(tiger_dnr.install) if engine == "tiger" else _run(local_speech.install, engine)


@router.post("/providers/local-sfx/generate", status_code=201)
def local_sfx_generate(body: dict = Body(...)) -> dict:
    """PLAN_v12 R5: a sound effect from a description, made on this machine (EzAudio)."""
    from ..services import local_sfx

    rate = body.get("rate")
    return _run(local_sfx.generate, str(body.get("text", "")), float(body.get("duration_s") or 5), int(body.get("seed") or 0), int(body.get("steps") or 50), float(body.get("guidance") or 5.0), int(rate) if rate else None)


@router.get("/providers/local-speech/{engine}/voices")
def local_speech_voices(engine: str) -> dict:
    from ..services import local_speech

    return {"voices": _run(local_speech.voices, engine)}


@router.post("/providers/local-speech/{engine}/speak", status_code=201)
def local_speech_speak(engine: str, body: dict = Body(...)) -> dict:
    from ..services import local_speech

    return _run(local_speech.speak, engine, str(body.get("text", "")), str(body.get("voice") or ""), str(body.get("reference_media") or ""), str(body.get("language") or "en"))


@router.post("/providers/local-speech/{engine}/regenerate", status_code=201)
def local_speech_regenerate(engine: str, body: dict = Body(...)) -> dict:
    from ..services import local_speech

    return _run(local_speech.regenerate, engine, str(body.get("media_id", "")), float(body.get("start_s", 0)), float(body.get("end_s", 0)), str(body.get("text", "")))


@router.post("/providers/local-speech/chatterbox/voice-changer", status_code=201)
def local_voice_changer(body: dict = Body(...)) -> dict:
    """PLAN_v12 R3: a clip re-voiced on this machine (ChatterboxVC) in the voice of another clip."""
    from ..services import local_speech

    return _run(local_speech.change_voice, str(body.get("media_id", "")), str(body.get("target_media", "")), float(body.get("target_from") or 0))



# Dubbing on this machine (PLAN_v11 2.M5): Whisper, Argos Translate's models through CTranslate2, Kokoro
@router.get("/providers/local-dub")
def local_dub_status() -> dict:
    from ..services import local_dub

    return local_dub.status()


@router.post("/providers/local-dub/{lang}/install", status_code=202)
def local_dub_install(lang: str) -> dict:
    from ..services import local_dub

    return _run(local_dub.install, lang)


@router.post("/providers/local-dub/{lang}", status_code=201)
def local_dub_run(lang: str, body: dict = Body(...)) -> dict:
    from ..services import local_dub

    end = body.get("end")
    return _run(local_dub.dub, str(body.get("media_id", "")), lang, float(body.get("start") or 0), float(end) if end is not None else None, str(body.get("voice") or ""))
