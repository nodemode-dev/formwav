"""ACE-Step 1.5 on this machine (the v11 plan's 1.6): formwav drives ACE-Step's own REST server (acestep-api, MIT,
github.com/ace-step/ACE-Step-1.5), which the owner runs where a GPU or enough memory is (uv run acestep-api; it listens on
http://localhost:8001). Every request follows ACE-Step's API.md: a task released with POST /release_task (JSON for
text2music; multipart with the clip as src_audio for cover, repaint, lego, extract and complete), polled with POST
/query_result (status 0 running, 1 done, 2 failed; the result a JSON string listing files), the audio fetched from
/v1/audio. One result per task (batch_size 1, where the server's default is two) in lossless WAV. The weights never leave
the machine; set ACESTEP_API_URL for another address and ACESTEP_API_KEY when the server has a key.
"""

import json
import os
import time
import urllib.parse

from . import media
from .providers import ProviderError, _http, _multipart

TASKS = ("text2music", "cover", "repaint", "lego", "extract", "complete")


def _base() -> str:
    return os.environ.get("ACESTEP_API_URL", "http://127.0.0.1:8001").rstrip("/")


def _headers(extra: dict | None = None) -> dict:
    h = dict(extra or {})
    key = os.environ.get("ACESTEP_API_KEY", "").strip()
    if key:
        h["Authorization"] = f"Bearer {key}"
    return h


def _data(raw: bytes, what: str):
    try:
        out = json.loads(raw)
    except ValueError as err:
        raise ProviderError(502, f"ACE-Step answered {what} with something other than JSON") from err
    if out.get("code") not in (200, None) or out.get("error"):
        raise ProviderError(502, f"ACE-Step: {out.get('error') or out.get('code')}")
    return out.get("data")


def _local() -> bool:
    """PLAN_v12 R6: ACE-Step built on this machine (services/acestep_local.py) serves the tasks when no server address
    is set; an address set in ACESTEP_API_URL keeps them on that server."""
    from . import acestep_local

    return not os.environ.get("ACESTEP_API_URL") and acestep_local.installed()


def status() -> dict:
    """Whether ACE-Step's server answers here, and its loaded models."""
    if _local():
        from . import acestep_local

        return {"ready": True, "models": [acestep_local.TURBO, acestep_local.BASE], "default": acestep_local.TURBO, "url": "this machine (acestep.cpp)"}
    try:
        code, raw, _ = _http("GET", f"{_base()}/v1/models", _headers(), None, timeout=3)
    except ProviderError:
        return {"ready": False, "models": [], "url": _base()}
    if code >= 400:
        return {"ready": False, "models": [], "url": _base()}
    models = (_data(raw, "the model list") or {}).get("models", [])
    return {"ready": True, "models": [m.get("name") for m in models], "default": next((m.get("name") for m in models if m.get("is_default")), None), "url": _base()}


def generate(task: str = "text2music", prompt: str = "", lyrics: str = "", seconds: float | None = None, media_id: str = "", repaint_start: float | None = None,
             repaint_end: float | None = None, strength: float | None = None, bpm: int | None = None, key: str = "", model: str = "", instruction: str = "",
             max_wait_s: float = 1800) -> dict:
    """A task on the local server, its first result imported as media."""
    if task not in TASKS:
        raise ProviderError(422, f"task must be one of {', '.join(TASKS)}")
    if task == "text2music" and not (prompt.strip() or lyrics.strip()):
        raise ProviderError(422, "describe the music, or give lyrics")
    if task != "text2music" and not media_id:
        raise ProviderError(422, f"{task} works on a clip: choose one")
    if _local():
        from . import acestep_local

        return acestep_local.generate(task, prompt, lyrics, seconds, media_id, repaint_start, repaint_end, strength, bpm, key, max_wait_s=max(max_wait_s, 3600))
    fields: dict[str, str] = {"task_type": task, "batch_size": "1", "audio_format": "wav"}
    if prompt.strip():
        fields["prompt"] = prompt
    if lyrics.strip():
        fields["lyrics"] = lyrics
    if seconds:
        fields["audio_duration"] = f"{max(10.0, min(600.0, float(seconds))):g}"
    if bpm:
        fields["bpm"] = str(max(30, min(300, int(bpm))))
    if key.strip():
        fields["key_scale"] = key
    if model.strip():
        fields["model"] = model
    if instruction.strip():
        fields["instruction"] = instruction
    if task == "repaint":
        start = max(0.0, float(repaint_start or 0))
        fields["repainting_start"] = f"{start:g}"
        fields["repainting_end"] = f"{float(repaint_end):g}" if repaint_end is not None and float(repaint_end) > start else "-1"
    if task == "cover" and strength is not None:
        fields["audio_cover_strength"] = f"{max(0.0, min(1.0, float(strength))):g}"
    if task == "text2music":
        body, headers = json.dumps({k: (int(v) if k in ("batch_size", "bpm") else float(v) if k in ("audio_duration",) else v) for k, v in fields.items()}).encode(), _headers({"Content-Type": "application/json"})
    else:
        info = media.media_info(media_id)
        source = (str(info.get("name") or "clip").rsplit(".", 1)[0] + ".wav", (media.media_dir() / f"{media_id}.wav").read_bytes(), "audio/wav")
        body, ctype = _multipart(fields, {"src_audio": source})
        headers = _headers({"Content-Type": ctype})
    try:
        code, raw, _ = _http("POST", f"{_base()}/release_task", headers, body, timeout=600)
    except ProviderError as err:
        raise ProviderError(503, f"ACE-Step is not running at {_base()}: start its server on this machine (uv run acestep-api, in ACE-Step-1.5's folder), then try again") from err
    if code >= 400:
        raise ProviderError(502, f"ACE-Step refused the task ({code}): {raw[:300].decode(errors='replace')}")
    task_id = (_data(raw, "the task") or {}).get("task_id")
    if not task_id:
        raise ProviderError(502, "ACE-Step gave no task id")
    deadline = time.time() + max_wait_s
    while time.time() < deadline:
        code, raw, _ = _http("POST", f"{_base()}/query_result", _headers({"Content-Type": "application/json"}), json.dumps({"task_id_list": [task_id]}).encode(), timeout=60)
        rows = _data(raw, "the poll") or []
        row = next((r for r in rows if r.get("task_id") == task_id), None)
        if row and row.get("status") == 2:
            raise ProviderError(502, "ACE-Step could not make it (the task failed)")
        if row and row.get("status") == 1:
            results = json.loads(row.get("result") or "[]")
            done = next((r for r in results if r.get("file")), None)
            if not done:
                raise ProviderError(502, "ACE-Step finished without a file")
            path = done["file"] if done["file"].startswith("/") else "/" + done["file"]
            code, audio, _ = _http("GET", f"{_base()}{path}", _headers(), None, timeout=600)
            if code >= 400:
                raise ProviderError(502, f"ACE-Step's file could not be fetched ({code})")
            label = {"text2music": "Song", "cover": "Cover", "repaint": "Repainted", "lego": "With a layer", "extract": "Extracted", "complete": "Completed"}[task]
            return media.import_audio(f"{label} (ACE-Step) - {(prompt or task)[:40].strip()}.wav", audio)
        time.sleep(2)
    raise ProviderError(504, f"ACE-Step had not finished after {int(max_wait_s / 60)} minutes")
