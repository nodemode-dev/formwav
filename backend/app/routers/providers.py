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
    duration = body.get("duration_s")
    return _run(prov.elevenlabs_sound, str(body.get("text", "")), float(duration) if duration else None)


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
