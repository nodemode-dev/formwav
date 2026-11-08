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
ffmpeg reads). Keys are the ones set in Preferences (services/secrets.py: the system's password store, or a file only
the user can read) and then the environment (backend/.env); they never leave the engine. ELEVENLABS_BASE_URL and
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

from . import media, provenance, secrets

LOCAL_FILE = Path(os.environ.get("FORMWAV_MODELS_ROOT", Path(__file__).resolve().parents[2] / "models")).expanduser() / "local_models.json"
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


def env_file() -> str:
    """The .env the running engine reads its keys from: in the desktop app, the one in its data folder (on a Mac
    ~/Library/Application Support/ai.nodemode.formwav/.env); run from the source tree, backend/.env."""
    import sys

    data = os.environ.get("FORMWAV_DATA_DIR", "")
    if getattr(sys, "frozen", False) and data:
        return os.path.join(data, ".env")
    return "backend/.env"


def _key(name: str, provider: str) -> str:
    value = secrets.get(name)
    if not value:
        raise ProviderError(503, f"{provider} needs a key: set it in Preferences, Keys and Models, or put {name}=... in {env_file()} and restart formwav.")
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


def _acestep_entry() -> dict:
    from . import acestep

    st = acestep.status()
    return {"id": "acestep", "label": "ACE-Step 1.5 (this machine)", "ready": st["ready"], "needs": f"ACE-Step installed on this machine (Install a model on this machine), or its server at {st['url']} (uv run acestep-api)", "offers": ["music", "cover", "repaint", "lego", "extract", "complete"], "models": st["models"]}


def providers() -> dict:
    """What can generate here: each provider, whether its key or models are set up, and what it offers."""
    return {
        "providers": [
            {"id": "elevenlabs", "label": "ElevenLabs", "ready": secrets.has("ELEVENLABS_API_KEY"), "needs": "ELEVENLABS_API_KEY", "offers": ["speech", "voice-changer", "music", "stems", "isolation", "sound-effects", "transcription", "voice-design", "dialogue", "alignment", "dubbing"]},
            {"id": "fal", "label": "fal", "ready": secrets.has("FAL_KEY"), "needs": "FAL_KEY", "offers": ["music", "audio"], "presets": FAL_PRESETS},
            _acestep_entry(),
            {"id": "local", "label": "On this machine", "ready": bool(local_models()), "needs": "backend/models/local_models.json", "offers": ["music", "audio", "speech"], "models": [{k: e.get(k) for k in ("id", "label", "kind", "fields", "license", "source")} for e in local_models()]},
        ],
        "provenance": provenance.table(),
    }


# ── ElevenLabs ───────────────────────────────────────────────────────────────────────────────────────────────────

def _el_base() -> str:
    return os.environ.get("ELEVENLABS_BASE_URL", "https://api.elevenlabs.io").rstrip("/")


def elevenlabs_voices() -> list[dict]:
    key = _key("ELEVENLABS_API_KEY", "ElevenLabs")
    status, raw, _ = _http("GET", f"{_el_base()}/v1/voices", {"xi-api-key": key})
    data = json.loads(_ok("ElevenLabs", status, raw))
    return [{"voice_id": v.get("voice_id"), "name": v.get("name"), "category": v.get("category")} for v in data.get("voices", [])]


def elevenlabs_speech(text: str, voice_id: str, model_id: str = "eleven_multilingual_v2", rate: int | None = None) -> dict:
    if not text.strip() or not voice_id.strip():
        raise ProviderError(422, "speech needs text and a voice_id (from the voices list)")
    key = _key("ELEVENLABS_API_KEY", "ElevenLabs")
    body = json.dumps({"text": text, "model_id": model_id}).encode()
    status, raw, _ = _http("POST", f"{_el_base()}/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128", {"xi-api-key": key, "content-type": "application/json", "accept": "audio/mpeg"}, body)
    return media.import_audio(f"Speech - {text[:40].strip()}.mp3", _ok("ElevenLabs", status, raw), rate)


def elevenlabs_clone(media_id: str) -> str:
    """A voice cloned from a media's own speech (its first 90 s as 16-bit mono WAV, under ElevenLabs' 10 MB per file),
    made once per media and remembered in the media store's voices.json, so regenerating again costs no new clone."""
    import io
    import wave

    import numpy as np

    from .tools import _wav_view

    cache_path = media.media_dir() / "voices.json"
    try:
        cache = json.loads(cache_path.read_text()) if cache_path.is_file() else {}
    except ValueError:
        cache = {}
    if cache.get(media_id):
        return cache[media_id]
    key = _key("ELEVENLABS_API_KEY", "ElevenLabs")
    info = media.media_info(media_id)
    view, rate = _wav_view(media_id)
    x = np.asarray(view[: 90 * rate], dtype=np.float64)  # float in both cases: 16-bit sources read through _Scaled
    mono = np.clip(x.mean(axis=1), -1.0, 1.0)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes((mono * 32767.0).astype("<i2").tobytes())
    body, ctype = _multipart({"name": f"formwav - {info.get('name', media_id)}"[:100], "remove_background_noise": "false"}, {"files": ("voice-sample.wav", buf.getvalue(), "audio/wav")})
    status, raw, _ = _http("POST", f"{_el_base()}/v1/voices/add", {"xi-api-key": key, "content-type": ctype}, body, timeout=600)
    voice_id = json.loads(_ok("ElevenLabs", status, raw)).get("voice_id")
    if not voice_id:
        raise ProviderError(502, "ElevenLabs made the voice but sent back no voice_id")
    cache[media_id] = voice_id
    cache_path.write_text(json.dumps(cache))
    return voice_id


def _splice(media_id: str, a: int, b: int, spoken_id: str) -> dict:
    """New speech (media spoken_id, at the source's rate) put in place of frames a to b of media_id, with 10 ms equal-power
    crossfades: a new media, the source kept, and how many frames longer or shorter it is (so the caller can ripple)."""
    import numpy as np

    from .aup_project import _wav_bytes
    from .tools import _wav_view

    view, rate = _wav_view(media_id)
    frames, ch = int(view.shape[0]), int(view.shape[1])
    sview, srate = _wav_view(spoken_id)
    if srate != rate:
        raise ProviderError(500, f"the new speech came back at {srate} Hz, not the source's {rate} Hz")
    x = np.asarray(view[0:frames], dtype=np.float64)  # float in both cases: 16-bit sources read through _Scaled
    s = np.asarray(sview[0 : int(sview.shape[0])], dtype=np.float64)
    s = np.repeat(s.mean(axis=1, keepdims=True), ch, axis=1) if s.shape[1] != ch else s
    n = int(s.shape[0])
    # each end its own crossfade, none where there is nothing to fade from: at the very start (a = 0) or end (b = frames) a
    # shared fade forced to one frame made x[: a - 1] read as x[:-1], the whole recording, and doubled the new media
    fh = min(int(0.010 * rate), a, n // 2)
    ft = min(int(0.010 * rate), frames - b, n // 2)
    ramp_h = np.linspace(0.0, np.pi / 2, fh, endpoint=False)[:, None]
    ramp_t = np.linspace(0.0, np.pi / 2, ft, endpoint=False)[:, None]
    out = np.concatenate([x[: a - fh], x[a - fh : a] * np.cos(ramp_h) + s[:fh] * np.sin(ramp_h), s[fh : n - ft], s[n - ft :] * np.cos(ramp_t) + x[b : b + ft] * np.sin(ramp_t), x[b + ft :]])
    info = media.media_info(media_id)
    stem = str(info.get("name", "clip")).rsplit(".", 1)[0]
    new = media.import_wav(f"{stem} (regenerated).wav", _wav_bytes([out[:, c].astype(np.float32) for c in range(ch)], rate))
    return {"media": new, "replaced_s": [a / rate, b / rate], "inserted_s": n / rate, "delta_frames": int(out.shape[0]) - frames, "source_rate": rate}


def elevenlabs_regenerate(media_id: str, start_s: float, end_s: float, text: str) -> dict:
    """The words between start_s and end_s of a media (seconds in its own timeline), spoken again as `text` in the
    speaker's cloned voice and spliced in with 10 ms equal-power crossfades: a new media, the source kept. Returns it
    with the voice used and how many source frames longer (or shorter) it is, so the caller can ripple what follows."""
    import numpy as np

    from .aup_project import _wav_bytes
    from .tools import _wav_view

    if not text.strip():
        raise ProviderError(422, "type the words to say instead")
    view, rate = _wav_view(media_id)
    frames, ch = int(view.shape[0]), int(view.shape[1])
    a, b = max(0, int(round(float(start_s) * rate))), min(frames, int(round(float(end_s) * rate)))
    if b - a < int(0.05 * rate):
        raise ProviderError(422, "select at least 50 ms of the clip to regenerate")
    voice = elevenlabs_clone(media_id)
    spoken = elevenlabs_speech(text, voice, rate=rate)
    return {**_splice(media_id, a, b, spoken["id"]), "voice_id": voice}


def elevenlabs_sound(text: str, duration_s: float | None = None, loop: bool = False, prompt_influence: float | None = None) -> dict:
    """Sound effects (eleven_text_to_sound_v2): 0.5 to 30 s, looping on request, held to the prompt more or less."""
    if not text.strip():
        raise ProviderError(422, "a sound effect needs a description")
    key = _key("ELEVENLABS_API_KEY", "ElevenLabs")
    payload: dict = {"text": text, "model_id": "eleven_text_to_sound_v2"}
    if duration_s:
        payload["duration_seconds"] = max(0.5, min(30.0, float(duration_s)))
    if loop:
        payload["loop"] = True
    if prompt_influence is not None:
        payload["prompt_influence"] = max(0.0, min(1.0, float(prompt_influence)))
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


# ── ElevenLabs, the rest of the API (the v11 plan's 1.5; every request checked against ElevenLabs' OpenAPI document by
# sidecar verification/elevenlabs_contract.py: fields, enums and ranges as the document gives them) ──────────────────

def _el_file(media_id: str) -> tuple[str, bytes, str]:
    info = media.media_info(media_id)
    return (str(info.get("name") or f"{media_id}.wav").rsplit(".", 1)[0] + ".wav", (media.media_dir() / f"{media_id}.wav").read_bytes(), "audio/wav")


def _el_json(method: str, path: str, payload: dict | None = None, accept: str = "application/json") -> bytes:
    key = _key("ELEVENLABS_API_KEY", "ElevenLabs")
    headers = {"xi-api-key": key, "accept": accept}
    body = None
    if payload is not None:
        headers["content-type"] = "application/json"
        body = json.dumps(payload).encode()
    status, raw, _ = _http(method, f"{_el_base()}{path}", headers, body, timeout=900)
    return _ok("ElevenLabs", status, raw)


def _el_form(path: str, fields: dict[str, str], files: dict[str, tuple[str, bytes, str]], accept: str = "application/json") -> bytes:
    key = _key("ELEVENLABS_API_KEY", "ElevenLabs")
    body, ctype = _multipart(fields, files)
    status, raw, _ = _http("POST", f"{_el_base()}{path}", {"xi-api-key": key, "content-type": ctype, "accept": accept}, body, timeout=900)
    return _ok("ElevenLabs", status, raw)


def elevenlabs_models() -> list[dict]:
    """The account's models, with what each can do: speech, and voice conversion (the voice changer's models)."""
    rows = json.loads(_el_json("GET", "/v1/models"))
    return [{"model_id": r.get("model_id"), "name": r.get("name"), "speech": bool(r.get("can_do_text_to_speech")), "voice_changer": bool(r.get("can_do_voice_conversion"))} for r in rows]


def elevenlabs_change_voice(media_id: str, voice_id: str, model_id: str = "", remove_background_noise: bool = False, seed: int | None = None) -> dict:
    """The voice changer (speech to speech): the clip re-voiced, its delivery, pacing and timing kept."""
    if not voice_id:
        raise ProviderError(422, "choose the voice to change to")
    fields: dict[str, str] = {}
    if model_id:
        fields["model_id"] = model_id
    if remove_background_noise:
        fields["remove_background_noise"] = "true"
    if seed is not None:
        fields["seed"] = str(int(seed))
    raw = _el_form(f"/v1/speech-to-speech/{voice_id}?output_format=mp3_44100_192", fields, {"audio": _el_file(media_id)}, "audio/mpeg")
    return media.import_audio(f"{_el_file(media_id)[0].rsplit('.', 1)[0]} (new voice).mp3", raw)


MUSIC_MODELS = ("music_v1", "music_v2", "music_v2_5")


def elevenlabs_music(prompt: str, lyrics: str = "", seconds: float | None = None, model_id: str = "music_v1", instrumental: bool = False, seed: int | None = None) -> dict:
    """A song or a piece from a prompt, with lyrics when given (sung), 3 s to 10 min."""
    if not prompt.strip():
        raise ProviderError(422, "describe the music")
    if model_id not in MUSIC_MODELS:
        raise ProviderError(422, f"model must be one of {', '.join(MUSIC_MODELS)}")
    payload: dict = {"prompt": prompt, "model_id": model_id}
    if seconds:
        payload["music_length_ms"] = int(max(3000, min(600_000, float(seconds) * 1000)))
    if lyrics.strip():
        payload["lyrics_text"] = lyrics
    if instrumental:
        payload["force_instrumental"] = True
    if seed is not None:
        payload["seed"] = int(seed)
    raw = _el_json("POST", "/v1/music?output_format=mp3_44100_192", payload, "audio/mpeg")
    return media.import_audio(f"Music - {prompt[:40].strip()}.mp3", raw)


def elevenlabs_stems(media_id: str, six: bool = True) -> list[dict]:
    """The clip separated into stems (six, or vocals and the rest), each as media."""
    import io
    import zipfile

    raw = _el_form("/v1/music/stem-separation?output_format=mp3_44100_192", {"stem_variation_id": "six_stems_v1" if six else "two_stems_v1"}, {"file": _el_file(media_id)}, "application/zip")
    stem = _el_file(media_id)[0].rsplit(".", 1)[0]
    out = []
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        for name in sorted(n for n in z.namelist() if not n.endswith("/")):
            part = name.rsplit("/", 1)[-1]
            out.append(media.import_audio(f"{stem} - {part}", z.read(name)))
    return out


def elevenlabs_isolate(media_id: str) -> dict:
    """Voice isolation: the speech kept, the rest of the sound taken out."""
    raw = _el_form("/v1/audio-isolation", {}, {"audio": _el_file(media_id)}, "audio/mpeg")
    return media.import_audio(f"{_el_file(media_id)[0].rsplit('.', 1)[0]} (voice isolated).mp3", raw)


def elevenlabs_transcribe(media_id: str, model_id: str = "scribe_v2", diarize: bool = True, speakers: int | None = None, events: bool = True, keyterms: list[str] | None = None, entities: bool = False, language: str = "") -> dict:
    """Scribe: words with times, speakers told apart, sounds like laughter tagged, entities found; written where formwav
    keeps transcripts (model scribe_v2), so the Transcript tab, transcript editing and subtitles use it as their own."""
    from . import transcript as tr

    fields: dict[str, str] = {"model_id": model_id, "diarize": "true" if diarize else "false", "tag_audio_events": "true" if events else "false", "timestamps_granularity": "word"}
    if speakers:
        fields["num_speakers"] = str(int(speakers))
    if language:
        fields["language_code"] = language
    if entities:
        fields["entity_detection"] = "all"
    files = {"file": _el_file(media_id)}
    body, ctype = _multipart(fields, files)
    if keyterms:  # a list goes as the field repeated, as multipart carries arrays
        extra = b"".join(f'--{ctype.split("boundary=")[1]}\r\nContent-Disposition: form-data; name="keyterms"\r\n\r\n{k}\r\n'.encode() for k in keyterms[:100] if k.strip())
        body = extra + body
    key = _key("ELEVENLABS_API_KEY", "ElevenLabs")
    status, raw, _ = _http("POST", f"{_el_base()}/v1/speech-to-text", {"xi-api-key": key, "content-type": ctype, "accept": "application/json"}, body, timeout=1800)
    data = json.loads(_ok("ElevenLabs", status, raw))
    words = []
    for w in data.get("words", []):
        if w.get("type") not in ("word", "audio_event") or not str(w.get("text", "")).strip():
            continue
        item = {"text": str(w["text"]).strip(), "start": round(float(w.get("start") or 0), 3), "end": round(float(w.get("end") or 0), 3)}
        spk = str(w.get("speaker_id") or "")
        if spk.startswith("speaker_") and spk[8:].isdigit():
            item["speaker"] = int(spk[8:])
        if w.get("type") == "audio_event":
            item["event"] = True
        words.append(item)
    language_code = str(data.get("language_code") or "en")
    result = {"mediaId": media_id, "model": model_id, "language": language_code, "words": tr.mark_fillers(words, language_code), "source": "ElevenLabs Scribe"}
    if data.get("entities"):
        result["entities"] = data["entities"]
    cache = media.media_dir().parent / "transcripts" / f"{media_id}.{model_id}.json"
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(result))
    return result


def elevenlabs_design(description: str, text: str = "", model_id: str = "") -> dict:
    """Voice design: voices made from a description, as previews to hear; one is kept with elevenlabs_save_voice."""
    if not description.strip():
        raise ProviderError(422, "describe the voice")
    payload: dict = {"voice_description": description}
    if text.strip():
        payload["text"] = text
    else:
        payload["auto_generate_text"] = True
    if model_id:
        payload["model_id"] = model_id
    data = json.loads(_el_json("POST", "/v1/text-to-voice/design", payload))
    import base64

    previews = []
    for i, pv in enumerate(data.get("previews", [])):
        ref = media.import_audio(f"Voice preview {i + 1} - {description[:30].strip()}.mp3", base64.b64decode(pv.get("audio_base_64", "")))
        previews.append({"generated_voice_id": pv.get("generated_voice_id"), "media": ref})
    return {"previews": previews, "text": data.get("text", "")}


def elevenlabs_save_voice(name: str, description: str, generated_voice_id: str) -> dict:
    if not (name.strip() and generated_voice_id):
        raise ProviderError(422, "name the voice and choose a preview")
    data = json.loads(_el_json("POST", "/v1/text-to-voice", {"voice_name": name, "voice_description": description, "generated_voice_id": generated_voice_id}))
    return {"voice_id": data.get("voice_id"), "name": data.get("name", name)}


def elevenlabs_dialogue(lines: list[dict], model_id: str = "eleven_v3") -> dict:
    """Several voices in one conversation: each line its text and voice."""
    inputs = [{"text": str(l.get("text", "")), "voice_id": str(l.get("voice_id", ""))} for l in lines if str(l.get("text", "")).strip() and l.get("voice_id")]
    if not inputs:
        raise ProviderError(422, "give each line its text and voice")
    raw = _el_json("POST", "/v1/text-to-dialogue?output_format=mp3_44100_192", {"inputs": inputs, "model_id": model_id}, "audio/mpeg")
    return media.import_audio(f"Dialogue - {inputs[0]['text'][:30].strip()}.mp3", raw)


def elevenlabs_align(media_id: str, text: str) -> dict:
    """Forced alignment: a known script's words timed against the recording, kept as its transcript (model alignment)."""
    from . import transcript as tr

    if not text.strip():
        raise ProviderError(422, "give the script to align")
    data = json.loads(_el_form("/v1/forced-alignment", {"text": text}, {"file": _el_file(media_id)}))
    words = [{"text": str(w["text"]).strip(), "start": round(float(w["start"]), 3), "end": round(float(w["end"]), 3)} for w in data.get("words", []) if str(w.get("text", "")).strip()]
    result = {"mediaId": media_id, "model": "alignment", "language": "en", "words": tr.mark_fillers(words, "en"), "source": "ElevenLabs forced alignment"}
    cache = media.media_dir().parent / "transcripts" / f"{media_id}.alignment.json"
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(result))
    return result


def elevenlabs_dub_transcript(job: str, lang: str, fmt: str = "srt") -> str:
    """A dub's translated transcript, as subtitles (srt or webvtt)."""
    return _el_json("GET", f"/v1/dubbing/{job}/transcript/{lang}?format_type={'webvtt' if fmt == 'webvtt' else 'srt'}", None, "text/plain").decode(errors="replace")
