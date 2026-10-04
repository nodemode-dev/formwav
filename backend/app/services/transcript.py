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
    # letters of any language kept (an a-z filter turned "Äh" into "h" and "hã" into "h", so no filler outside English
    # could ever match)
    return re.sub(r"[^\w']", "", word.lower()).replace("_", "")


# DS-04: hesitation sounds and filler phrases for the other languages faster-whisper names, kept conservative (words
# that also carry meaning, such as "pues", "en fait" or "tipo", are left out); English's apply in every language
FILLERS_BY_LANGUAGE: dict[str, tuple[set[str], list[tuple[str, ...]]]] = {
    "es": ({"eh", "em", "ehm", "mmm"}, [("o", "sea")]),
    "fr": ({"euh", "heu", "hum", "bah", "ben"}, [("tu", "vois")]),
    "de": ({"äh", "ähm", "öh", "öhm", "hmm"}, []),
    "it": ({"ehm", "eh", "uhm", "mmm"}, []),
    "pt": ({"hã", "ahn", "hum", "éé"}, []),
}


def mark_fillers(words: list[dict], language: str = "en") -> list[dict]:
    """Flags filler words and filler phrases in place (English's and the transcript language's) and returns the list."""
    extra_words, extra_phrases = FILLERS_BY_LANGUAGE.get((language or "en")[:2].lower(), (set(), []))
    fillers = FILLERS | extra_words
    for w in words:
        w["filler"] = _norm(w["text"]) in fillers
    norms = [_norm(w["text"]) for w in words]
    for phrase in FILLER_PHRASES + extra_phrases:
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


def set_word(media_id: str, index: int, start: float, end: float, model: str = "", text: str | None = None) -> dict:
    """Moves one cached word's start and end (the media file's seconds), never past its neighbours, and returns the
    transcript; the clip must have been transcribed first. With `text` (DS-01, a typed correction) the word's text is
    corrected too, the audio untouched; it must be one word, not empty."""
    if text is not None:
        text = text.strip()
        if not text or len(text) > 64 or any(c.isspace() for c in text):
            raise media.MediaError("a corrected word is one word of 1 to 64 characters, without spaces")
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
    if text is not None:
        words[index]["text"] = text
    cache.write_text(json.dumps(data))
    data["words"] = mark_fillers(words, data.get("language", "en"))
    return data


def _mfcc(x, rate: int = 16000):
    """19 MFCCs a 10 ms frame (25 ms windows, 40 mel bands to 8 kHz), c0 left out (loudness is not a voice)."""
    import numpy as np

    n, hop, nfft = 400, 160, 512
    if len(x) < n:
        return np.zeros((0, 19))
    frames = np.lib.stride_tricks.sliding_window_view(x, n)[::hop] * np.hamming(n)
    power = np.abs(np.fft.rfft(frames, nfft)) ** 2
    mel = lambda f: 2595 * np.log10(1 + f / 700.0)
    edges = 700 * (10 ** (np.linspace(mel(60), mel(min(8000, rate / 2)), 42) / 2595) - 1)
    bins = np.fft.rfftfreq(nfft, 1 / rate)
    bank = np.zeros((40, len(bins)))
    for m in range(40):
        lo, mid, hi = edges[m : m + 3]
        bank[m] = np.clip(np.minimum((bins - lo) / (mid - lo), (hi - bins) / (hi - mid)), 0, None)
    logmel = np.log(power @ bank.T + 1e-10)
    k = np.arange(40)
    dct = np.cos(np.pi / 40 * (k[None, :] + 0.5) * np.arange(1, 20)[:, None])
    return logmel @ dct.T


def diarize(media_id: str, speakers: int | None = None, model: str = "") -> dict:
    """DS-12, RX-59: the speakers told apart inside one recording. The transcript's words are grouped into chunks (a
    pause of 0.3 s, or 3 s, ends one); each chunk is described by its voice, the mean and spread of 19 MFCCs, standardised
    across chunks; the chunks are clustered (agglomerative, average linkage on cosine distance) into `speakers`, or into
    the one to four that separate best (silhouette; one when nothing separates); each word is labelled Speaker 1, 2 and
    so on in order of first appearance, kept in the cached transcript."""
    import numpy as np

    name = model or DEFAULT_MODEL
    cache = media_dir().parent / "transcripts" / f"{media_id}.{name}.json"
    if not cache.exists():
        raise media.MediaError("transcribe this clip before telling its speakers apart")
    data = json.loads(cache.read_text())
    words = data.get("words", [])
    if len(words) < 2:
        return data
    pcm = subprocess.run([media._tool("ffmpeg"), "-v", "error", "-nostdin", "-i", str(media_dir() / f"{media_id}.wav"), "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                         capture_output=True, timeout=1800)
    audio = np.frombuffer(pcm.stdout, dtype="<f4").astype(np.float64)
    chunks: list[list[int]] = [[0]]
    for i in range(1, len(words)):
        if float(words[i]["start"]) - float(words[i - 1]["end"]) >= 0.3 or float(words[i]["end"]) - float(words[chunks[-1][0]]["start"]) > 3.0:
            chunks.append([i])
        else:
            chunks[-1].append(i)
    feats = []
    for c in chunks:
        a, b = int(float(words[c[0]]["start"]) * 16000), int(float(words[c[-1]]["end"]) * 16000)
        m = _mfcc(audio[a:b])
        feats.append(np.concatenate([m.mean(axis=0), m.std(axis=0)]) if len(m) > 4 else None)
    good = [i for i, f in enumerate(feats) if f is not None]
    if len(good) < 2:
        return data
    f = np.array([feats[i] for i in good])
    f = (f - f.mean(axis=0)) / (f.std(axis=0) + 1e-9)
    f /= np.linalg.norm(f, axis=1, keepdims=True) + 1e-12
    dist = 1 - f @ f.T

    def cluster(k: int) -> np.ndarray:
        groups = [[i] for i in range(len(f))]
        while len(groups) > k:
            best = None
            for x in range(len(groups)):
                for y in range(x + 1, len(groups)):
                    d = dist[np.ix_(groups[x], groups[y])].mean()
                    if best is None or d < best[0]:
                        best = (d, x, y)
            _, x, y = best
            groups[x] += groups.pop(y)
        labels = np.empty(len(f), dtype=int)
        for g, members in enumerate(groups):
            labels[members] = g
        return labels

    def silhouette(labels: np.ndarray) -> float:
        scores = []
        for i in range(len(f)):
            own = labels == labels[i]
            if own.sum() < 2:
                scores.append(0.0)
                continue
            a = dist[i, own].sum() / (own.sum() - 1)
            b = min(dist[i, labels == g].mean() for g in set(labels) if g != labels[i])
            scores.append((b - a) / max(a, b, 1e-12))
        return float(np.mean(scores))

    # the speakers are found among chunks of a second or more, whose voices are measured reliably; shorter chunks then
    # join the nearest speaker's centroid (clustered with the rest, a short "Ask, not, what" after a pause took the
    # other speaker's label)
    span = lambda i: float(words[chunks[good[i]][-1]]["end"]) - float(words[chunks[good[i]][0]]["start"])
    long = [i for i in range(len(f)) if span(i) >= 1.0]
    base = long if len(long) >= 2 else list(range(len(f)))
    full_f, full_dist = f, dist
    f, dist = full_f[base], full_dist[np.ix_(base, base)]
    if speakers:
        found = cluster(max(1, min(int(speakers), len(f))))
    else:
        found, best = np.zeros(len(f), dtype=int), 0.15
        for k in range(2, min(4, len(f) - 1) + 1):
            trial = cluster(k)
            score = silhouette(trial)
            if score > best:
                found, best = trial, score
    centroids = {g: full_f[[base[j] for j in range(len(base)) if found[j] == g]].mean(axis=0) for g in set(found.tolist())}
    labels = np.empty(len(full_f), dtype=int)
    for j, i in enumerate(base):
        labels[i] = found[j]
    for i in range(len(full_f)):
        if i not in base:
            labels[i] = max(centroids, key=lambda g: float(full_f[i] @ centroids[g]) / (np.linalg.norm(centroids[g]) + 1e-12))
    order: dict[int, int] = {}
    for g in labels:
        order.setdefault(int(g), len(order) + 1)
    chunk_label = {good[j]: f"Speaker {order[int(labels[j])]}" for j in range(len(good))}
    last = "Speaker 1"
    for ci, c in enumerate(chunks):
        last = chunk_label.get(ci, last)
        for wi in c:
            words[wi]["speaker"] = last
    cache.write_text(json.dumps(data))
    data["words"] = mark_fillers(words, data.get("language", "en"))
    return data


def transcript(media_id: str, model: str = "") -> dict:
    """The media file's words with start and end in its own seconds, cached."""
    name = model or DEFAULT_MODEL
    media.media_info(media_id)
    cache = media_dir().parent / "transcripts" / f"{media_id}.{name}.json"
    if cache.exists():
        # marked again on every read, so a cached transcript follows the current filler lists for its language
        cached = json.loads(cache.read_text())
        cached["words"] = mark_fillers(cached.get("words", []), cached.get("language", "en"))
        return cached
    import numpy as np

    pcm = subprocess.run([media._tool("ffmpeg"), "-v", "error", "-nostdin", "-i", str(media_dir() / f"{media_id}.wav"), "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                         capture_output=True, timeout=1800)
    if pcm.returncode != 0:
        raise media.MediaError(pcm.stderr.decode(errors="replace").strip()[-300:] or "could not decode the file")
    audio = np.frombuffer(pcm.stdout, dtype="<f4").copy()
    segments, info = _model(name).transcribe(audio, word_timestamps=True, initial_prompt=VERBATIM_PROMPT)
    words = [{"text": w.word.strip(), "start": round(float(w.start), 3), "end": round(float(w.end), 3)} for s in segments for w in (s.words or []) if w.word.strip()]
    result = {"mediaId": media_id, "model": name, "language": info.language, "words": mark_fillers(words, info.language)}
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(result))
    return result
