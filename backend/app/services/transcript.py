"""Word-level transcripts for Descript-style editing (Descript is a behavioural reference only; no code taken).

A media file is decoded with ffmpeg to 16 kHz mono float samples (no PyAV) and transcribed by faster-whisper with word
timestamps; a verbatim prompt keeps disfluencies, which Whisper otherwise drops. Words carry their times in the media
file's own seconds and a filler flag. Transcripts are cached per media file and model. The runtime is optional:
backend/requirements_transcript.txt.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import threading
from pathlib import Path

from ..core.paths import media_dir
from . import media

MODELS_ROOT = Path(os.environ.get("FORMWAV_MODELS_ROOT", Path(__file__).resolve().parents[2] / "models")).expanduser() / "whisper"
DEFAULT_MODEL = os.environ.get("FORMWAV_WHISPER_MODEL", "base.en")
VERBATIM_PROMPT = "Umm, let me think like, hmm... Okay, here is what I am, like, thinking."
#: Single-word fillers; "like" is left out because it is usually a real word.
FILLERS = {"um", "umm", "uh", "uhh", "uhm", "er", "erm", "ah", "hmm", "hm", "mm", "mhm"}
FILLER_PHRASES = [("you", "know"), ("i", "mean")]

_models: dict[str, object] = {}
_lock = threading.Lock()


class TranscriptUnavailable(RuntimeError):
    """The transcription runtime is not installed."""


def _norm(word: str) -> str:
    return re.sub(r"[^a-z']", "", word.lower())


def mark_fillers(words: list[dict]) -> list[dict]:
    """Flags filler words and filler phrases in place and returns the list."""
    for w in words:
        w["filler"] = _norm(w["text"]) in FILLERS
    norms = [_norm(w["text"]) for w in words]
    for phrase in FILLER_PHRASES:
        for i in range(len(words) - len(phrase) + 1):
            if tuple(norms[i : i + len(phrase)]) == phrase:
                for w in words[i : i + len(phrase)]:
                    w["filler"] = True
    return words


def _model(name: str):
    try:
        from faster_whisper import WhisperModel
    except ImportError as err:
        raise TranscriptUnavailable(f"transcription needs faster-whisper ({err}); install backend/requirements_transcript.txt") from err
    with _lock:
        if name not in _models:
            MODELS_ROOT.mkdir(parents=True, exist_ok=True)
            _models[name] = WhisperModel(name, device="cpu", compute_type="int8", download_root=str(MODELS_ROOT))
        return _models[name]


def set_word(media_id: str, index: int, start: float, end: float, model: str = "") -> dict:
    """Moves one cached word's start and end (the media file's seconds), never past its neighbours, and returns the
    transcript; the clip must have been transcribed first."""
    name = model or DEFAULT_MODEL
    info = media.media_info(media_id)
    cache = media_dir().parent / "transcripts" / f"{media_id}.{name}.json"
    if not cache.exists():
        raise media.MediaError("transcribe this clip before adjusting its words")
    data = json.loads(cache.read_text())
    words = data.get("words", [])
    if not 0 <= index < len(words):
        raise media.MediaError(f"there is no word {index} in this transcript")
    lo = float(words[index - 1]["end"]) if index > 0 else 0.0
    hi = float(words[index + 1]["start"]) if index + 1 < len(words) else int(info["frames"]) / int(info["sampleRate"])
    if not (lo - 1e-6 <= start < end <= hi + 1e-6):
        raise media.MediaError(f"the word must start before it ends and stay between {lo:.3f} and {hi:.3f} s")
    words[index]["start"], words[index]["end"] = round(max(start, lo), 3), round(min(end, hi), 3)
    cache.write_text(json.dumps(data))
    return data


def transcript(media_id: str, model: str = "") -> dict:
    """The media file's words with start and end in its own seconds, cached."""
    name = model or DEFAULT_MODEL
    media.media_info(media_id)
    cache = media_dir().parent / "transcripts" / f"{media_id}.{name}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    import numpy as np

    pcm = subprocess.run([media._tool("ffmpeg"), "-v", "error", "-nostdin", "-i", str(media_dir() / f"{media_id}.wav"), "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                         capture_output=True, timeout=1800)
    if pcm.returncode != 0:
        raise media.MediaError(pcm.stderr.decode(errors="replace").strip()[-300:] or "could not decode the file")
    audio = np.frombuffer(pcm.stdout, dtype="<f4").copy()
    segments, info = _model(name).transcribe(audio, word_timestamps=True, initial_prompt=VERBATIM_PROMPT)
    words = [{"text": w.word.strip(), "start": round(float(w.start), 3), "end": round(float(w.end), 3)} for s in segments for w in (s.words or []) if w.word.strip()]
    result = {"mediaId": media_id, "model": name, "language": info.language, "words": mark_fillers(words)}
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(result))
    return result
