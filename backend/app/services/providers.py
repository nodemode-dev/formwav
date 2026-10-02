"""The model-provider layer (owner decision, v1.20.0): local open weights and cloud models behind one registry.

- elevenlabs (ELEVENLABS_API_KEY): speech from text in a chosen voice, sound effects from text, and dubbing a media
  into another language (a job: submit, poll, collect), on the endpoints ElevenLabs documents (/v1/text-to-speech,
  /v1/voices, /v1/sound-generation, /v1/dubbing).
- fal (FAL_KEY): any fal model through fal's queue (submit to queue.fal.run, poll its status_url, read its
  response_url), with presets for the audio models checked against fal's model pages (ACE-Step 1.5 among them); the
  first audio URL in the output is downloaded.
- local: open-weight models on the owner's machine, each an entry in backend/models/local_models.json naming a command
  template; formwav fills {prompt}, {lyrics}, {duration} and {out}, runs it with a time limit, and imports the file it
  wrote. ACE-Step and any other model with a command line can be added there without a code change; weights stay
  wherever the owner keeps them, never in the repository.

Whatever a provider returns is imported through the media service, so it lands as media like any import (any format
ffmpeg reads). Keys come from the environment (backend/.env) and never leave the engine. ELEVENLABS_BASE_URL and
FAL_QUEUE_URL point the clients elsewhere (a proxy, or a recording stand-in in tests). Standard library only.
"""

from __future__ import annotations

import json
import os
import shlex
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

from . import media

LOCAL_FILE = Path(__file__).resolve().parents[2] / "models" / "local_models.json"
FAL_PRESETS = [
    {"model": "fal-ai/ace-step-1.5", "label": "ACE-Step 1.5: song from a prompt and lyrics", "fields": ["prompt", "lyrics", "duration"]},
    {"model": "fal-ai/ace-step/prompt-to-audio", "label": "ACE-Step: music from a prompt", "fields": ["prompt", "duration"]},
    {"model": "fal-ai/ace-step", "label": "ACE-Step: music from tags and lyrics", "fields": ["tags", "lyrics", "duration"]},
]


class ProviderError(Exception):
    """Raised with a message meant for the user (the route turns it into an HTTP error)."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def _key(name: str, provider: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ProviderError(503, f"{provider} needs a key: put {name}=... in backend/.env and restart formwav.")
    return value


def _http(method: str, url: str, headers: dict[str, str], body: bytes | None = None, timeout: float = 300) -> tuple[int, bytes, str]:
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            return res.status, res.read(), res.headers.get("content-type", "")
    except urllib.error.HTTPError as err:
        return err.code, err.read(), err.headers.get("content-type", "") if err.headers else ""
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        raise ProviderError(502, f"Could not reach {url.split('/')[2]}: {err}") from err


def _ok(provider: str, status: int, raw: bytes) -> bytes:
    if status >= 400:
        raise ProviderError(502, f"{provider} answered {status}: {raw[:300].decode(errors='replace')}")
    return raw


def _multipart(fields: dict[str, str], files: dict[str, tuple[str, bytes, str]]) -> tuple[bytes, str]:
    boundary = f"formwav{uuid.uuid4().hex}"
    parts: list[bytes] = []
    for name, value in fields.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    for name, (filename, data, ctype) in files.items():
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\nContent-Type: {ctype}\r\n\r\n'.encode() + data + b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


# ── the registry ─────────────────────────────────────────────────────────────────────────────────────────────────

def local_models() -> list[dict]:
    if not LOCAL_FILE.is_file():
        return []
    try:
        entries = json.loads(LOCAL_FILE.read_text())
    except ValueError as err:
        raise ProviderError(500, f"backend/models/local_models.json is not valid JSON: {err}") from err
    return [e for e in entries if isinstance(e, dict) and e.get("id") and e.get("command")]


def providers() -> dict:
    """What can generate here: each provider, whether its key or models are set up, and what it offers."""
    return {
        "providers": [
            {"id": "elevenlabs", "label": "ElevenLabs", "ready": bool(os.environ.get("ELEVENLABS_API_KEY", "").strip()), "needs": "ELEVENLABS_API_KEY", "offers": ["speech", "sound-effects", "dubbing"]},
            {"id": "fal", "label": "fal", "ready": bool(os.environ.get("FAL_KEY", "").strip()), "needs": "FAL_KEY", "offers": ["music", "audio"], "presets": FAL_PRESETS},
            {"id": "local", "label": "On this machine", "ready": bool(local_models()), "needs": "backend/models/local_models.json", "offers": ["music", "audio", "speech"], "models": [{k: e.get(k) for k in ("id", "label", "kind", "fields")} for e in local_models()]},
        ]
    }


# ── ElevenLabs ───────────────────────────────────────────────────────────────────────────────────────────────────

def _el_base() -> str:
    return os.environ.get("ELEVENLABS_BASE_URL", "https://api.elevenlabs.io").rstrip("/")


def elevenlabs_voices() -> list[dict]:
    key = _key("ELEVENLABS_API_KEY", "ElevenLabs")
    status, raw, _ = _http("GET", f"{_el_base()}/v1/voices", {"xi-api-key": key})
    data = json.loads(_ok("ElevenLabs", status, raw))
    return [{"voice_id": v.get("voice_id"), "name": v.get("name"), "category": v.get("category")} for v in data.get("voices", [])]


def elevenlabs_speech(text: str, voice_id: str, model_id: str = "eleven_multilingual_v2") -> dict:
    if not text.strip() or not voice_id.strip():
        raise ProviderError(422, "speech needs text and a voice_id (from the voices list)")
    key = _key("ELEVENLABS_API_KEY", "ElevenLabs")
    body = json.dumps({"text": text, "model_id": model_id}).encode()
    status, raw, _ = _http("POST", f"{_el_base()}/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128", {"xi-api-key": key, "content-type": "application/json", "accept": "audio/mpeg"}, body)
    return media.import_audio(f"Speech - {text[:40].strip()}.mp3", _ok("ElevenLabs", status, raw))


def elevenlabs_sound(text: str, duration_s: float | None = None) -> dict:
    if not text.strip():
        raise ProviderError(422, "a sound effect needs a description")
    key = _key("ELEVENLABS_API_KEY", "ElevenLabs")
    payload: dict = {"text": text}
    if duration_s:
        payload["duration_seconds"] = max(0.5, min(30.0, float(duration_s)))
    status, raw, _ = _http("POST", f"{_el_base()}/v1/sound-generation", {"xi-api-key": key, "content-type": "application/json", "accept": "audio/mpeg"}, json.dumps(payload).encode())
    return media.import_audio(f"Sound - {text[:40].strip()}.mp3", _ok("ElevenLabs", status, raw))


def elevenlabs_dub_start(media_id: str, target_lang: str, source_lang: str = "auto") -> dict:
    key = _key("ELEVENLABS_API_KEY", "ElevenLabs")
    info = media.media_info(media_id)
    wav = (media.media_dir() / f"{media_id}.wav").read_bytes()
    fields = {"target_lang": target_lang, "source_lang": source_lang, "name": f"formwav {info.get('name', media_id)}"}
    body, ctype = _multipart(fields, {"file": (f"{media_id}.wav", wav, "audio/wav")})
    status, raw, _ = _http("POST", f"{_el_base()}/v1/dubbing", {"xi-api-key": key, "content-type": ctype}, body, timeout=600)
    data = json.loads(_ok("ElevenLabs", status, raw))
    return {"job": data.get("dubbing_id"), "expected_seconds": data.get("expected_duration_sec"), "target_lang": target_lang, "source": info.get("name")}


def elevenlabs_dub_status(job: str, target_lang: str, source_name: str = "") -> dict:
    """The dub's state; once ElevenLabs has finished, its audio is fetched and imported, and the media comes back."""
    key = _key("ELEVENLABS_API_KEY", "ElevenLabs")
    status, raw, _ = _http("GET", f"{_el_base()}/v1/dubbing/{job}", {"xi-api-key": key})
    meta = json.loads(_ok("ElevenLabs", status, raw))
    state = meta.get("status")
    if state == "failed":
        raise ProviderError(502, f"ElevenLabs could not dub it: {meta.get('error') or meta.get('error_message') or 'no reason given'}")
    if state != "dubbed":
        return {"job": job, "status": state or "dubbing"}
    status, raw, _ = _http("GET", f"{_el_base()}/v1/dubbing/{job}/audio/{target_lang}", {"xi-api-key": key}, timeout=600)
    ref = media.import_audio(f"{(source_name or 'Dub').rsplit('.', 1)[0]} ({target_lang} dub).mp3", _ok("ElevenLabs", status, raw))
    return {"job": job, "status": "dubbed", "media": ref}


# ── fal ──────────────────────────────────────────────────────────────────────────────────────────────────────────

def _audio_url(output: object) -> str | None:
    """The first audio file in a fal output: an {"audio": {"url": ...}} field, or any url that looks like audio."""
    if isinstance(output, dict):
        for name in ("audio", "audio_file", "audio_url", "output"):
            value = output.get(name)
            if isinstance(value, dict) and isinstance(value.get("url"), str):
                return value["url"]
            if isinstance(value, str) and value.startswith("http"):
                return value
        url = output.get("url")
        if isinstance(url, str) and (str(output.get("content_type", "")).startswith("audio") or url.rsplit(".", 1)[-1].lower() in ("wav", "mp3", "flac", "ogg", "m4a", "aac")):
            return url
        for value in output.values():
            found = _audio_url(value)
            if found:
                return found
    if isinstance(output, list):
        for value in output:
            found = _audio_url(value)
            if found:
                return found
    return None


def fal_generate(model: str, inputs: dict, max_wait_s: float = 900) -> dict:
    model = model.strip().strip("/")
    if not model or ".." in model or not all(part.replace("-", "").replace("_", "").replace(".", "").isalnum() for part in model.split("/")):
        raise ProviderError(422, "model must be a fal model id such as fal-ai/ace-step-1.5")
    key = _key("FAL_KEY", "fal")
    auth = {"authorization": f"Key {key}", "content-type": "application/json"}
    base = os.environ.get("FAL_QUEUE_URL", "https://queue.fal.run").rstrip("/")
    status, raw, _ = _http("POST", f"{base}/{model}", auth, json.dumps(inputs).encode())
    job = json.loads(_ok("fal", status, raw))
    status_url, response_url = job.get("status_url"), job.get("response_url")
    if not status_url or not response_url:
        raise ProviderError(502, "fal accepted the request but gave no status_url or response_url")
    waited, delay = 0.0, 0.5
    while True:
        status, raw, _ = _http("GET", status_url, {"authorization": f"Key {key}"})
        state = json.loads(_ok("fal", status, raw))
        if state.get("status") == "COMPLETED":
            if state.get("error"):
                raise ProviderError(502, f"fal could not run {model}: {state.get('error')}")
            break
        if waited >= max_wait_s:
            raise ProviderError(504, f"fal had not finished {model} after {int(max_wait_s)} s (request {job.get('request_id')})")
        time.sleep(delay)
        waited += delay
        delay = min(delay * 1.5, 5.0)
    status, raw, _ = _http("GET", response_url, {"authorization": f"Key {key}"})
    output = json.loads(_ok("fal", status, raw))
    url = _audio_url(output)
    if not url:
        raise ProviderError(502, f"{model} finished but its output has no audio file")
    status, data, _ = _http("GET", url, {}, timeout=600)
    label = str(inputs.get("prompt") or inputs.get("tags") or model)[:40].strip()
    return media.import_audio(f"{model.split('/')[-1]} - {label}.{url.rsplit('.', 1)[-1].split('?')[0][:4] or 'wav'}", _ok("fal", status, data))


# ── local open weights ───────────────────────────────────────────────────────────────────────────────────────────

def local_generate(model_id: str, prompt: str = "", lyrics: str = "", duration_s: float = 30) -> dict:
    entry = next((e for e in local_models() if e["id"] == model_id), None)
    if not entry:
        raise ProviderError(404, f"No local model {model_id!r}: add it to backend/models/local_models.json (README, Generate with models; backend/local_models.example.json)")
    with tempfile.TemporaryDirectory(prefix="formwav-local-") as tmp:
        out = Path(tmp) / f"out.{entry.get('ext', 'wav')}"
        values = {"prompt": prompt, "lyrics": lyrics, "duration": f"{float(duration_s):g}", "out": str(out)}
        command = entry["command"]
        argv = [part.format(**values) for part in (command if isinstance(command, list) else shlex.split(command))]
        try:
            done = subprocess.run(argv, cwd=entry.get("cwd") or None, capture_output=True, timeout=float(entry.get("timeout_s", 1800)))
        except FileNotFoundError as err:
            raise ProviderError(502, f"{entry.get('label', model_id)} could not start: {err}") from err
        except subprocess.TimeoutExpired as err:
            raise ProviderError(504, f"{entry.get('label', model_id)} did not finish within {entry.get('timeout_s', 1800)} s") from err
        if done.returncode != 0 or not out.is_file() or out.stat().st_size == 0:
            tail = (done.stderr or done.stdout or b"").decode(errors="replace").strip().splitlines()[-3:]
            raise ProviderError(502, f"{entry.get('label', model_id)} exited {done.returncode} without writing audio: {' | '.join(tail)[:300]}")
        return media.import_audio(f"{entry.get('label', model_id)} - {(prompt or model_id)[:40].strip()}.{out.suffix.lstrip('.')}", out.read_bytes())
