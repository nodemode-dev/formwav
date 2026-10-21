"""Fetches the models the tests judge with, through formwav's own installers, so CI runs those tests instead of
skipping them (PLAN_v12 C6). Not a test: run it from backend/ with the engine's Python before the suite:

    python tests/fetch_models.py

Each step uses the path a person's click takes (the same URLs, pinned hashes and runtimes) and waits for it: Silero
VAD, DeepFilterNet, Whisper base.en and tiny, Kokoro, the English to Spanish translation model and the trained
separator (TIGER-DnR). The speech runtime goes where the tests look for it (backend/data/speech-runtime). A step that
fails is reported and the rest still run; the exit status is the number of failures, so CI shows which model did not
arrive while the tests that need it say so by skipping.
"""

import os
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
os.environ.setdefault("FORMWAV_DATA_DIR", str(BACKEND / "data"))
sys.path.insert(0, str(BACKEND))

from app.services import deepfilter, local_dub, local_speech, tiger_dnr, transcript, vad  # noqa: E402


def wait(state, every: float = 2.0, limit: float = 3600.0) -> None:
    """Polls an installer's state (a callable giving its words) until it is done; raises with its words if it failed."""
    start = time.time()
    while time.time() - start < limit:
        words = state()
        if words.startswith("failed"):
            raise RuntimeError(words)
        if not words:
            return
        time.sleep(every)
    raise RuntimeError(f"still installing after {limit:.0f} s: {state()}")


def kokoro() -> None:
    if not local_speech.installed("kokoro"):
        local_speech.install("kokoro")
        wait(lambda: local_speech._installing.get("kokoro", ""))
        local_speech._known.pop("kokoro", None)
        if not local_speech.installed("kokoro"):
            raise RuntimeError("Kokoro's install ended but it is not usable")


def spanish() -> None:
    local_dub.install("es")
    wait(lambda: local_dub._installing.get("es", ""))


def tiger() -> None:
    if not tiger_dnr.installed():
        tiger_dnr.install()
        wait(lambda: tiger_dnr._state["installing"])


STEPS = [
    ("Silero VAD", vad.model_path),
    ("DeepFilterNet", deepfilter.binary),
    ("Whisper base.en", lambda: transcript._model("base.en")),
    ("Whisper tiny", lambda: transcript._model("tiny")),
    ("Kokoro", kokoro),
    ("English to Spanish", spanish),
    ("TIGER-DnR", tiger),
]

if __name__ == "__main__":
    failed = 0
    for name, step in STEPS:
        start = time.time()
        try:
            step()
            print(f"{name}: ready in {time.time() - start:.1f} s", flush=True)
        except Exception as err:  # noqa: BLE001 - reported per model, the rest still fetched
            failed += 1
            print(f"{name}: FAILED after {time.time() - start:.1f} s: {err}", flush=True)
    sys.exit(failed)
