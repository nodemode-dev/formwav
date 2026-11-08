"""Routes for what Preferences keeps in the engine (2.25.0): the models on this computer (remove one, open their folder,
what they take on disk) and the cloud providers' keys and the agent's model (services/secrets.py). A key goes in and
never comes out: the status answers whether it is kept, from where, and its last four characters."""

from __future__ import annotations

from fastapi import APIRouter, Body, HTTPException

from ..services import models_disk, secrets
from ..services.providers import ProviderError

router = APIRouter()


def _run(fn, *args):
    try:
        return fn(*args)
    except ProviderError as err:
        raise HTTPException(err.status, str(err)) from err


@router.get("/models/disk")
def models_disk_usage() -> dict:
    return models_disk.disk()


@router.post("/models/open-folder")
def models_open_folder() -> dict:
    return _run(models_disk.open_folder)


@router.delete("/providers/local-speech/{engine}")
def local_speech_remove(engine: str) -> dict:
    return _run(models_disk.remove_engine, engine)


@router.delete("/providers/local-dub/{lang}")
def local_dub_remove(lang: str) -> dict:
    return _run(models_disk.remove_dub, lang)


@router.get("/keys")
def keys_status() -> dict:
    return {**secrets.where(), "keys": [{"name": name, "label": label, **secrets.summary(name)} for name, label in secrets.KEYS.items()], "agentModel": secrets.agent_model(), "defaultAgentModel": secrets.DEFAULT_AGENT_MODEL}


@router.put("/keys/{name}")
def keys_save(name: str, body: dict = Body(...)) -> dict:
    if name not in secrets.KEYS:
        raise HTTPException(404, f"no key named {name}")
    value = body.get("value")
    if not isinstance(value, str) or not value.strip():
        raise HTTPException(422, "send the key as value")
    try:
        kept = secrets.put(name, value)
    except OSError as err:
        raise HTTPException(500, f"the key could not be kept: {err}") from err
    return {"kept": kept, **secrets.summary(name)}


@router.delete("/keys/{name}")
def keys_forget(name: str) -> dict:
    if name not in secrets.KEYS:
        raise HTTPException(404, f"no key named {name}")
    secrets.delete(name)
    return secrets.summary(name)


@router.put("/settings/agent-model")
def agent_model_save(body: dict = Body(...)) -> dict:
    try:
        return {"agentModel": secrets.set_agent_model(str(body.get("model", "")))}
    except ValueError as err:
        raise HTTPException(422, str(err)) from err
