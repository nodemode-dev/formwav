"""Effect presets (Audacity's one preset system across built-in, destructive and realtime effects, as a reference):
named settings for an effect, rendered or realtime, kept in one JSON file in the data folder so they outlive a
browser and a session. The app reads the whole list and writes it back whole; entries are validated, and the file
is replaced atomically."""

from __future__ import annotations

import json
import math
import os
import tempfile

from fastapi import APIRouter, Body, HTTPException

from ..core.paths import data_dir

router = APIRouter()

MAX_PRESETS = 500
MAX_PARAMS = 16


def _path():
    return data_dir() / "presets.json"


def _clean(items: object) -> list[dict]:
    if not isinstance(items, list) or len(items) > MAX_PRESETS:
        raise HTTPException(422, f"presets must be a list of at most {MAX_PRESETS}")
    out: list[dict] = []
    for item in items:
        if not isinstance(item, dict):
            raise HTTPException(422, "each preset is an object")
        name, effect, params = item.get("name"), item.get("effect"), item.get("params")
        if not isinstance(name, str) or not name.strip() or len(name) > 60:
            raise HTTPException(422, "a preset's name is 1 to 60 characters")
        if not isinstance(effect, str) or not effect or len(effect) > 60:
            raise HTTPException(422, "a preset names its effect")
        if not isinstance(params, dict) or len(params) > MAX_PARAMS:
            raise HTTPException(422, f"a preset holds at most {MAX_PARAMS} settings")
        clean = {}
        for key, value in params.items():
            if not isinstance(key, str) or len(key) > 40 or isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise HTTPException(422, "a preset's settings are named numbers")
            clean[key] = float(value)
        entry = {"name": name.strip(), "effect": effect, "params": clean}
        # RX-55: a module chain saved as a preset (effect "chain"): its steps in order, each an effect with its settings
        steps = item.get("steps")
        if steps is not None:
            if effect != "chain" or not isinstance(steps, list) or not steps or len(steps) > 16:
                raise HTTPException(422, "a module chain preset holds 1 to 16 steps")
            entry["steps"] = []
            for step in steps:
                if not isinstance(step, dict) or not isinstance(step.get("name"), str) or not step["name"] or len(step["name"]) > 60:
                    raise HTTPException(422, "each chain step names its effect")
                step_params = step.get("params") or {}
                if not isinstance(step_params, dict) or len(step_params) > MAX_PARAMS:
                    raise HTTPException(422, f"a chain step holds at most {MAX_PARAMS} settings")
                for key, value in step_params.items():
                    if not isinstance(key, str) or len(key) > 40 or isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                        raise HTTPException(422, "a chain step's settings are named numbers")
                label = step.get("label") if isinstance(step.get("label"), str) else step["name"]
                entry["steps"].append({"name": step["name"], "label": label[:120], "params": {k: float(v) for k, v in step_params.items()}})
        out.append(entry)
    return out


@router.get("/presets")
def list_presets() -> list[dict]:
    try:
        return _clean(json.loads(_path().read_text()))
    except FileNotFoundError:
        return []
    except (ValueError, HTTPException):
        return []


@router.put("/presets")
def save_presets(items: list = Body(...)) -> list[dict]:
    presets = _clean(items)
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".presets-", suffix=".json")
    with os.fdopen(fd, "w") as f:
        json.dump(presets, f, indent=1)
    os.replace(tmp, path)
    return presets
