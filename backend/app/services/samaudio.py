"""Isolate any sound by description with Meta's SAM-Audio (github.com/facebookresearch/sam-audio, SAM License, which
the owner accepts for using the model). An optional component, like Demucs: installed from requirements_sam_audio.txt
on the owner's machine, never in the build container, whose one CPU core and 4 GB of free disk cannot hold even the
smallest checkpoint (5.10 GB). The checkpoints are manually gated on Hugging Face, so a download needs the owner's
approved account (`hf auth login`); FORMWAV_SAM_AUDIO_MODEL picks the checkpoint (default facebook/sam-audio-small;
base 7.73 GB, large 14.86 GB). Meta recommends a CUDA GPU; Apple's MPS or the CPU work, slowly.

Written against the source at commit bb4c6999 (2026-05-26), not only its README: the processor downmixes to mono and
resamples paths to 48 kHz but takes a tensor as given, so the region is decoded to 48 kHz mono here; anchors are
("+", start, end) in seconds; separate() returns SeparationResult whose target and residual are lists with one mono
tensor per input (the README's `result.target.cpu()` would fail on a list); descriptions are lowercased noun or verb
phrases, as Meta advises. The outputs come back at the clip's rate and exact frame count so they align with it."""

from __future__ import annotations

import importlib.util
import os
import subprocess

import numpy as np

from ..core.paths import media_dir
from . import media

MODEL = os.environ.get("FORMWAV_SAM_AUDIO_MODEL", "facebook/sam-audio-small")
_loaded: dict[str, tuple] = {}


class Unavailable(media.MediaError):
    """A precondition is missing (not installed, not logged in, access not approved): the route answers 503."""


def _device() -> str | None:
    try:
        import torch
    except ImportError:
        return None
    if torch.cuda.is_available():
        return "cuda"
    mps = getattr(torch.backends, "mps", None)
    return "mps" if mps is not None and mps.is_available() else "cpu"


def status() -> dict:
    out = {"model": MODEL, "installed": importlib.util.find_spec("sam_audio") is not None, "loggedIn": False, "cached": False, "device": _device()}
    try:
        from huggingface_hub import get_token, try_to_load_from_cache

        out["loggedIn"] = bool(get_token())
        out["cached"] = isinstance(try_to_load_from_cache(MODEL, "checkpoint.pt"), str)
    except ImportError:
        pass
    if not out["installed"]:
        out["message"] = "SAM-Audio is not installed: pip install -r backend/requirements_sam_audio.txt (Python 3.11 or later)"
    elif not (out["loggedIn"] or out["cached"]):
        out["message"] = f"SAM-Audio needs access: request it for {MODEL} on Hugging Face, then run: hf auth login"
    elif out["device"] == "cpu":
        out["message"] = f"SAM-Audio is ready with {MODEL} on the CPU, which is slow; a GPU is recommended"
    else:
        out["message"] = f"SAM-Audio is ready with {MODEL} on {out['device']}"
    out["ready"] = out["installed"] and (out["loggedIn"] or out["cached"])
    return out


def _load() -> tuple:
    if MODEL in _loaded:
        return _loaded[MODEL]
    if importlib.util.find_spec("sam_audio") is None:
        raise Unavailable(status()["message"])
    from sam_audio import SAMAudio, SAMAudioProcessor

    try:
        model = SAMAudio.from_pretrained(MODEL)
        processor = SAMAudioProcessor.from_pretrained(MODEL)
    except Exception as err:  # the hub's gated, missing-token and HTTP errors, named for the owner
        name = type(err).__name__
        if "Gated" in name or "Token" in name or "401" in str(err) or "403" in str(err):
            raise Unavailable(f"Hugging Face refused {MODEL} ({name}): request access on its page, then run: hf auth login") from err
        raise media.MediaError(f"could not load {MODEL}: {name}: {str(err)[:200]}") from err
    device = _device() or "cpu"
    model = model.eval().to(device)
    _loaded[MODEL] = (model, processor, device)
    return _loaded[MODEL]


def _decode(media_id: str, rate: int, start: float | None, end: float | None) -> np.ndarray:
    cmd = [media._tool("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin"]
    if start is not None and start > 0:
        cmd += ["-ss", f"{start:.6f}"]
    if end is not None and end > (start or 0):
        cmd += ["-t", f"{end - (start or 0):.6f}"]
    cmd += ["-i", str(media_dir() / f"{media_id}.wav"), "-ac", "1", "-ar", str(rate), "-f", "f32le", "-"]
    done = subprocess.run(cmd, capture_output=True, timeout=600)
    if done.returncode != 0:
        raise media.MediaError(f"could not read the audio: {done.stderr.decode(errors='replace').strip()[-200:]}")
    return np.frombuffer(done.stdout, dtype="<f4")


def _to_media(signal: np.ndarray, model_rate: int, rate: int, frames: int, name: str) -> dict:
    """Mono output at the model's rate, resampled to the clip's rate and cut or padded to its exact frame count."""
    cmd = [media._tool("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin", "-f", "f32le", "-ar", str(model_rate), "-ac", "1", "-i", "-",
           "-af", f"aresample={rate},apad,atrim=end_sample={frames}", "-c:a", "pcm_f32le", "-f", "wav", "-"]
    done = subprocess.run(cmd, input=np.ascontiguousarray(signal, dtype="<f4").tobytes(), capture_output=True, timeout=600)
    if done.returncode != 0:
        raise media.MediaError(f"could not write the result: {done.stderr.decode(errors='replace').strip()[-200:]}")
    return media.import_wav(name, done.stdout)


def isolate(media_id: str, description: str, start: float | None = None, end: float | None = None,
            spans: list[list[float]] | None = None, predict_spans: bool = False, candidates: int = 1) -> list[dict]:
    """The described sound and everything else, as two media aligned with the region. Spans are seconds from the
    region's start where the sound occurs (SAM-Audio's positive anchors)."""
    text = " ".join(description.split()).lower()
    if not text:
        raise media.MediaError("describe the sound to isolate, for example: man speaking")
    info = media.media_info(media_id)
    rate = int(info["sampleRate"])
    model, processor, device = _load()
    import torch

    model_rate = int(getattr(processor, "audio_sampling_rate", 48_000))
    x = _decode(media_id, model_rate, start, end)
    if len(x) < model_rate // 10:
        raise media.MediaError("the region is too short to separate")
    anchors = [[("+", float(a), float(b)) for a, b in spans if b > a]] if spans else None
    batch = processor(descriptions=[text], audios=[torch.from_numpy(x.copy()).unsqueeze(0)], anchors=anchors or None).to(device)
    with torch.inference_mode():
        result = model.separate(batch, reranking_candidates=max(1, min(8, int(candidates))), predict_spans=bool(predict_spans and not anchors))
    frames = round(len(x) * rate / model_rate)
    stem = str(info["name"]).rsplit(".", 1)[0]
    target = result.target[0].detach().float().cpu().numpy().reshape(-1)
    residual = result.residual[0].detach().float().cpu().numpy().reshape(-1)
    return [
        {"source": text, "media": _to_media(target, model_rate, rate, frames, f"{stem} ({text}).wav")},
        {"source": "everything else", "media": _to_media(residual, model_rate, rate, frames, f"{stem} (without {text}).wav")},
    ]
