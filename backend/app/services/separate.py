"""Music source separation (local AI music separation and a stems view; no code taken): Demucs htdemucs splits a time range of a file into drums, bass, other and vocals.

The range is decoded by ffmpeg at the model's rate, separated on the CPU (or Apple's GPU through PyTorch on the Mac),
and each stem is written back at the file's own rate, so the stems line up with the clip they came from. The runtime
is optional: backend/requirements_separate.txt, whose notes keep PyTorch on builds this machine can run. The model
(about 80 MB) is cached in the git-ignored backend/models/torch.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
import threading
from pathlib import Path

from ..core.paths import media_dir
from . import media

os.environ.setdefault("TORCH_HOME", str(Path(__file__).resolve().parents[2] / "models" / "torch"))
MODEL = "htdemucs"
_model = None
_lock = threading.Lock()


class SeparationUnavailable(RuntimeError):
    """The separation runtime is not installed."""


def _load():
    global _model
    try:
        from demucs.pretrained import get_model
    except ImportError as err:
        raise SeparationUnavailable(f"separation needs Demucs ({err}); install backend/requirements_separate.txt") from err
    with _lock:
        if _model is None:
            _model = get_model(MODEL)
            _model.eval()
        return _model


def _median(s, k: int, dim: int):
    """Median filter of a (freq, time) magnitude along `dim` with a k-wide reflected window."""
    import torch.nn.functional as F

    x = s if dim == 1 else s.T
    padded = F.pad(x[None, None], (k // 2, k // 2, 0, 0), mode="reflect")[0, 0]
    out = padded.unfold(1, k, 1).median(dim=-1).values
    return out if dim == 1 else out.T


def deconstruct(media_id: str, start: float = 0.0, end: float | None = None, margin: float = 2.0, tonal_sens: float = 5.0,
                transient_sens: float = 5.0, gains_db: tuple[float, float, float] | None = None) -> list[dict]:
    """Deconstruct: harmonic-percussive separation of a time range into tonal (steady
    across time), transient (broad across frequency) and noisy (neither) parts. The three masks partition the
    spectrum, so the parts sum back to the range.

    RX-15: each split has a sensitivity from 0 to 10 (5 is the margin given, 2 by default; each step of 5 divides or
    multiplies it by 4), the higher the more of the spectrum goes to that part; transient bins are taken only from
    what is not tonal, so the masks still partition it at any setting. With gains_db (tonal, noisy, transient) the
    module renders one rebalanced result instead of three parts: the masks weighted by their gains, inverted once
    (the separation is linear, so this is the gains applied to the parts and summed)."""
    info = media.media_info(media_id)
    rate, channels = int(info["sampleRate"]), int(info["channels"])
    length = int(info["frames"]) / rate
    start = max(0.0, float(start))
    end = length if end is None else min(length, float(end))
    if end - start < 0.1:
        raise media.MediaError("the range to deconstruct is empty")
    try:
        import numpy as np
        import torch
    except ImportError as err:
        raise SeparationUnavailable(f"deconstruction needs PyTorch ({err}); install backend/requirements_separate.txt") from err
    ffmpeg = media._tool("ffmpeg")
    pcm = subprocess.run([ffmpeg, "-v", "error", "-nostdin", "-ss", f"{start:.6f}", "-t", f"{end - start:.6f}", "-i", str(media_dir() / f"{media_id}.wav"),
                          "-f", "f32le", "-"], capture_output=True, timeout=1800)
    if pcm.returncode != 0 or not pcm.stdout:
        raise media.MediaError(pcm.stderr.decode(errors="replace").strip()[-300:] or "could not decode the range")
    x = torch.from_numpy(np.frombuffer(pcm.stdout, dtype="<f4").copy().reshape(-1, channels).T.copy())
    n = x.shape[1]
    window = torch.hann_window(2048)
    spec = torch.stft(x, 2048, 512, window=window, return_complex=True)
    mag = spec.abs().mean(0)
    tonal_env, trans_env = _median(mag, 17, 1), _median(mag, 17, 0)
    to_margin = lambda s: margin * 4.0 ** ((5.0 - max(0.0, min(10.0, float(s)))) / 5.0)
    tonal = tonal_env > to_margin(tonal_sens) * trans_env
    trans = (trans_env > to_margin(transient_sens) * tonal_env) & ~tonal
    masks = {"tonal": tonal, "noisy": ~(tonal | trans), "transient": trans}
    stem_name = str(info["name"]).rsplit(".", 1)[0]
    out: list[dict] = []
    if gains_db is not None:
        # RX-15: the module's own rebalance, the parts' gains as one weighted mask
        weight = sum(10 ** (float(g) / 20) * m.to(torch.float32) for g, m in zip(gains_db, masks.values()))
        masks = {"rebalanced": weight}
    with tempfile.TemporaryDirectory() as tmp:
        for part, mask in masks.items():
            y = torch.istft(spec * mask[None].to(spec.dtype), 2048, 512, window=window, length=n)
            raw = Path(tmp) / f"{part}.f32"
            raw.write_bytes(y.T.contiguous().numpy().astype("<f4").tobytes())
            wav = Path(tmp) / f"{part}.wav"
            done = subprocess.run([ffmpeg, "-v", "error", "-nostdin", "-y", "-f", "f32le", "-ar", str(rate), "-ac", str(channels), "-i", str(raw), "-c:a", "pcm_f32le", str(wav)],
                                  capture_output=True, timeout=600)
            if done.returncode != 0:
                raise media.MediaError(done.stderr.decode(errors="replace").strip()[-300:])
            out.append({"source": part, "media": media.import_wav(f"{stem_name} ({part}).wav", wav.read_bytes())})
    return out


def separate(media_id: str, start: float = 0.0, end: float | None = None) -> list[dict]:
    """The stems of `media_id` between `start` and `end` (its own seconds), each as new media: [{source, media}]."""
    info = media.media_info(media_id)
    rate = int(info["sampleRate"])
    length = int(info["frames"]) / rate
    start = max(0.0, float(start))
    end = length if end is None else min(length, float(end))
    if end - start < 0.1:
        raise media.MediaError("the range to separate is empty")
    model = _load()
    import numpy as np
    import torch
    from demucs.apply import apply_model

    ffmpeg = media._tool("ffmpeg")
    pcm = subprocess.run([ffmpeg, "-v", "error", "-nostdin", "-ss", f"{start:.6f}", "-t", f"{end - start:.6f}", "-i", str(media_dir() / f"{media_id}.wav"),
                          "-ac", "2", "-ar", str(model.samplerate), "-f", "f32le", "-"], capture_output=True, timeout=1800)
    if pcm.returncode != 0 or not pcm.stdout:
        raise media.MediaError(pcm.stderr.decode(errors="replace").strip()[-300:] or "could not decode the range")
    mix = torch.from_numpy(np.frombuffer(pcm.stdout, dtype="<f4").copy().reshape(-1, 2).T.copy())
    with torch.no_grad():
        stems = apply_model(model, mix[None], device="cpu", split=True, overlap=0.25, progress=False)[0]
    stem_name = str(info["name"]).rsplit(".", 1)[0]
    out: list[dict] = []
    with tempfile.TemporaryDirectory() as tmp:
        for source, stem in zip(model.sources, stems):
            raw = Path(tmp) / f"{source}.f32"
            raw.write_bytes(stem.T.contiguous().numpy().astype("<f4").tobytes())
            wav = Path(tmp) / f"{source}.wav"
            done = subprocess.run([ffmpeg, "-v", "error", "-nostdin", "-y", "-f", "f32le", "-ar", str(model.samplerate), "-ac", "2", "-i", str(raw),
                                   "-af", f"aresample={rate}:resampler=soxr:precision=28", "-c:a", "pcm_f32le", str(wav)], capture_output=True, timeout=600)
            if done.returncode != 0:
                raise media.MediaError(done.stderr.decode(errors="replace").strip()[-300:])
            out.append({"source": source, "media": media.import_wav(f"{stem_name} ({source}).wav", wav.read_bytes())})
    order = {"vocals": 0, "drums": 1, "bass": 2, "other": 3}
    return sorted(out, key=lambda s: order.get(s["source"], 9))
