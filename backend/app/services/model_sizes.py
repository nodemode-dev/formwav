"""What each installable model downloads, and how long its install should take, in one table (2.25.x): Preferences >
Models on this computer shows it on each row before Install, and the agents read the same numbers from the model status
(GET /api/providers/local-speech and /api/providers/local-dub carry it as `download`).

The sizes are the repository's own: Kokoro's 570 MB was measured here (services/local_speech.py), Chatterbox's 7.8 GB
was measured with PyTorch's CPU build, ACE-Step's 4.7 GB of weights (services/acestep_local.py), SoulX-Singer's 2.82 GB
model (services/singing.py), EzAudio's 2.6 GB and FLAN-T5 large's 3.1 GB (services/local_sfx.py), TIGER's 17 MB of
weights and the 900 MB PyTorch's CPU build takes installed here (services/tiger_dnr.py), and about 90 MB for each dubbing
language's translation model (services/local_dub.py). Pocket TTS was not measured here: its weights are an estimate
and say so. PyTorch is shared by the engines that run on it, so it counts only while the speech runtime lacks it.

The time is the download at a measured speed, once a model file has come down in this session (the first 4 MB and
second of any download through `copy` measure it), otherwise at 50 and 200 Mbit/s, plus the setup the install runs
(making the speech runtime, pip, or building acestep.cpp), an estimate. `copy` also keeps each install's bytes done and
total, so a running install shows its progress and the time left."""

from __future__ import annotations

import threading
import time
from pathlib import Path

MB = 1_000_000
GB = 1_000_000_000
TORCH = ("PyTorch (CPU build)", 900 * MB, True)

#: id to (parts: (what, bytes, measured here), uses PyTorch, setup seconds the install spends besides downloading).
TABLE: dict[str, tuple[list[tuple[str, int, bool]], bool, int]] = {
    "kokoro": ([("Kokoro and its model", 570 * MB, True)], False, 30),
    "pocket": ([("Pocket TTS weights", 400 * MB, False)], True, 60),
    "chatterbox": ([("Chatterbox with PyTorch (CPU build)", 7800 * MB, True)], False, 120),
    "acestep": ([("ACE-Step weights", 4700 * MB, True)], False, 300),
    "soulx-singer": ([("SoulX-Singer model", 2820 * MB, True)], True, 60),
    "ezaudio": ([("EzAudio weights", 2600 * MB, True), ("FLAN-T5 large", 3100 * MB, True)], True, 60),
    "tiger": ([("TIGER weights", 17 * MB, True)], True, 30),
    "dub": ([("Translation model", 90 * MB, True)], False, 20),
}
SPEEDS_MBIT = (50, 200)

_lock = threading.Lock()
#: The download speed measured this session, in bytes a second, or 0 before any download measured it.
_bps = 0.0
#: Owner (an engine id, or "dub:<lang>") to its running download: bytes done, bytes expected in all, when it began.
_progress: dict[str, dict] = {}


def _torch_present() -> bool:
    from . import local_speech

    runtime = local_speech._runtime()
    return any(runtime.glob("lib/python*/site-packages/torch")) or (runtime / "Lib" / "site-packages" / "torch").is_dir()


def facts(model: str, torch_present: bool | None = None) -> dict:
    """The download and the time estimate for `model` (an engine id, or "dub" for a dubbing language)."""
    parts, uses_torch, setup = TABLE[model]
    if uses_torch and not (_torch_present() if torch_present is None else torch_present):
        parts = [*parts, TORCH]
    total = sum(p[1] for p in parts)
    estimates = {str(mbit): round(total * 8 / (mbit * MB)) + setup for mbit in SPEEDS_MBIT}
    with _lock:
        bps = _bps
    out = {
        "bytes": total,
        "parts": [{"what": what, "bytes": size, "measured": measured} for what, size, measured in parts],
        "measured": all(p[2] for p in parts),
        "setupSeconds": setup,
        "estimates": estimates,
        "measuredBps": round(bps),
        "measuredSeconds": round(total / bps) + setup if bps else 0,
    }
    return out


def progress(owner: str) -> dict | None:
    """The running download of `owner`: bytes done, bytes in all (0 when the server did not say), seconds left (0 when
    unknown)."""
    with _lock:
        found = _progress.get(owner)
        if not found:
            return None
        done, total, began = found["done"], found["total"], found["began"]
    spent = max(time.monotonic() - began, 1e-3)
    rate = done / spent if done else 0
    left = round((total - done) / rate) if rate and total > done else 0
    return {"done": done, "total": total, "secondsLeft": left}


def copy(res, out, owner: str = "") -> None:
    """Copies a download to `out` a megabyte at a time, keeping `owner`'s progress and measuring the speed. The total
    is the model's own files from the table (what the engine fetches itself; pip's downloads are not counted)."""
    global _bps
    began = time.monotonic()
    done = 0
    if owner:
        key = "dub" if owner.startswith("dub:") else owner
        with _lock:
            if owner not in _progress:
                _progress[owner] = {"done": 0, "total": sum(p[1] for p in TABLE[key][0]) if key in TABLE else 0, "began": began}
    while block := res.read(1 << 20):
        out.write(block)
        done += len(block)
        spent = time.monotonic() - began
        with _lock:
            if owner in _progress:
                _progress[owner]["done"] += len(block)
            if done >= 4 * MB and spent >= 1:
                _bps = done / spent


def finished(owner: str) -> None:
    with _lock:
        _progress.pop(owner, None)


def target_owner(target: Path) -> str:
    """The owner a model file belongs to, from where it is kept under the models folder."""
    head = target.parts
    for name, owner in (("tiger-dnr", "tiger"), ("ezaudio", "ezaudio"), ("acestep-cpp", "acestep"), ("soulx-singer", "soulx-singer")):
        if name in head:
            return owner
    return ""
