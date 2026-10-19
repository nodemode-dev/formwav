"""Dubbing made on this machine (the v11 comparison's open-weight paths, PLAN_v11 2.M5): ElevenLabs dubs in its cloud; this
path keeps the words and the voice local. The clip's words come from formwav's transcript (Whisper); they are grouped into
sentences (at a full stop, question or exclamation mark, a break over 1.5 s, or past 15 s); Argos Translate's model for the language
pair translates them (a CTranslate2 model with its SentencePiece tokenizer, run in the speech runtime with ctranslate2 and
sentencepiece alone: the argostranslate package itself brings stanza and PyTorch); Kokoro speaks each sentence in a voice of
that language; each is placed where its sentence began, sped up with ffmpeg's pitch-keeping atempo by at most 1.35 times
when it would run into the next, and cut there only past that. The models' README names their training data (the OPUS
corpora); it states no licence for the model, and none is claimed here.
"""

import json
import shutil
import subprocess
import tempfile
import threading
import urllib.request
import zipfile
from pathlib import Path

import numpy as np

from ..core.version import VERSION
from . import local_speech, media, transcript
from .aup_project import _wav_bytes
from .providers import ProviderError

LANGS = {"es": ("Spanish", "es", "e", "https://argos-net.com/v1/translate-en_es-1_0.argosmodel"),
         "fr": ("French", "fr-fr", "f", "https://argos-net.com/v1/translate-en_fr-1_9.argosmodel"),
         "it": ("Italian", "it", "i", "https://argos-net.com/v1/translate-en_it-1_0.argosmodel"),
         "pt": ("Portuguese (Brazil)", "pt-br", "p", "https://argos-net.com/v1/translate-en_pt-1_9.argosmodel")}
MAX_SPEED = 1.35
_installing: dict[str, str] = {}

TRANSLATE = """
import json,sys
import ctranslate2,sentencepiece as spm
a=json.load(sys.stdin)
sp=spm.SentencePieceProcessor(model_file=a["base"]+"/sentencepiece.model")
tr=ctranslate2.Translator(a["base"]+"/model",device="cpu",compute_type="int8")
out=tr.translate_batch([sp.encode(t,out_type=str) for t in a["texts"]],beam_size=4)
print(json.dumps([sp.decode(o.hypotheses[0]) for o in out]))
"""
SPEAK_ALL = """
import json,sys,wave
import numpy as np
from kokoro_onnx import Kokoro
a=json.load(sys.stdin)
k=Kokoro(a["model"],a["voices"])
for i,t in enumerate(a["texts"]):
    audio,rate=k.create(t,voice=a["voice"],speed=1.0,lang=a["lang"])
    with wave.open(f"{a['folder']}/{i}.wav","wb") as w:
        w.setnchannels(1);w.setsampwidth(2);w.setframerate(rate)
        w.writeframes(np.round(np.clip(audio,-1,1)*32767).astype("<i2").tobytes())
"""


def _base(lang: str) -> Path:
    return Path(__file__).resolve().parents[2] / "models" / "translate" / f"en_{lang}"


def _runtime_ready() -> bool:
    py = local_speech._python()
    return py.exists() and subprocess.run([str(py), "-c", "import ctranslate2, sentencepiece"], capture_output=True, timeout=120).returncode == 0


def status() -> dict:
    return {"kokoro": local_speech.installed("kokoro"), "translator": _runtime_ready(),
            "languages": [{"code": c, "name": v[0], "installed": (_base(c) / "model" / "model.bin").exists(), "installing": _installing.get(c, "")} for c, v in LANGS.items()]}


def install(lang: str) -> dict:
    """The translation model for English to `lang` (about 90 MB), and ctranslate2 and sentencepiece in the speech runtime."""
    if lang not in LANGS:
        raise ProviderError(404, f"no dubbing language {lang}; there are {', '.join(LANGS)}")

    def work() -> None:
        try:
            if not _runtime_ready():
                if not local_speech._python().exists():
                    raise RuntimeError("install Kokoro first (Install a speech engine on this machine): dubbing speaks with it")
                _installing[lang] = "installing: ctranslate2 and sentencepiece"
                subprocess.run([str(local_speech._python()), "-m", "pip", "install", "-q", "ctranslate2", "sentencepiece"], check=True, capture_output=True, timeout=1800)
            base = _base(lang)
            if not (base / "model" / "model.bin").exists():
                _installing[lang] = f"installing: the English to {LANGS[lang][0]} model"
                base.parent.mkdir(parents=True, exist_ok=True)
                with tempfile.TemporaryDirectory() as tmp:
                    pkg = Path(tmp) / "pkg.argosmodel"
                    request = urllib.request.Request(LANGS[lang][3], headers={"User-Agent": f"formwav/{VERSION}"})
                    with urllib.request.urlopen(request, timeout=600) as res, open(pkg, "wb") as out:
                        shutil.copyfileobj(res, out)
                    with zipfile.ZipFile(pkg) as z:
                        for name in z.namelist():
                            rel = name.split("/", 1)[1] if "/" in name else ""
                            if rel.startswith("model/") or rel in ("sentencepiece.model", "README.md", "metadata.json"):
                                if not name.endswith("/"):
                                    (base / rel).parent.mkdir(parents=True, exist_ok=True)
                                    (base / rel).write_bytes(z.read(name))
            _installing[lang] = ""
        except Exception as err:  # noqa: BLE001 - the install's outcome, shown to the person
            _installing[lang] = f"failed: {err}"

    _installing[lang] = "installing"
    threading.Thread(target=work, name=f"formwav-dub-{lang}", daemon=True).start()
    return {"installing": _installing[lang]}


def sentences(words: list[dict], start: float, end: float) -> list[dict]:
    """Words between start and end grouped into whole sentences, which translation needs: at end punctuation, a break over
    1.5 s, or past 15 s. A speaker's pause stays inside its sentence: split at JFK's 1.4 s pause after "my fellow Americans",
    the second half lost who it addressed and came back in the informal singular (word F1 0.65 against the human rendering)."""
    out, cur = [], []
    for w in words:
        if w.get("event") or w["end"] <= start or w["start"] >= end:
            continue
        if cur and (w["start"] - cur[-1]["end"] > 1.5 or w["end"] - cur[0]["start"] > 15.0):
            out.append(cur); cur = []
        cur.append(w)
        if w["text"].rstrip().endswith((".", "?", "!")):
            out.append(cur); cur = []
    if cur:
        out.append(cur)
    return [{"start": s[0]["start"], "end": s[-1]["end"], "text": " ".join(x["text"].strip() for x in s)} for s in out]


def _worker(script: str, args: dict, timeout: float = 1800) -> str:
    done = subprocess.run([str(local_speech._python()), "-c", script], input=json.dumps(args).encode(), capture_output=True, timeout=timeout)
    if done.returncode != 0:
        raise ProviderError(502, (done.stderr.decode(errors="replace").strip().splitlines() or ["the worker failed"])[-1][:300])
    return done.stdout.decode()


def dub(media_id: str, lang: str, start: float = 0.0, end: float | None = None, voice: str = "") -> dict:
    if lang not in LANGS:
        raise ProviderError(404, f"no dubbing language {lang}; there are {', '.join(LANGS)}")
    if not local_speech.installed("kokoro"):
        raise ProviderError(409, "dubbing on this machine speaks with Kokoro: install it first (Install a speech engine on this machine)")
    if not (_base(lang) / "model" / "model.bin").exists() or not _runtime_ready():
        raise ProviderError(409, f"install the English to {LANGS[lang][0]} translation first")
    info = media.media_info(media_id)
    rate = int(info["sampleRate"])
    length = int(info["frames"]) / rate
    start, end = max(0.0, float(start)), length if end is None else min(length, float(end))
    parts = sentences(transcript.transcript(media_id)["words"], start, end)
    if not parts:
        raise ProviderError(422, "no words to dub in that range")
    translated = json.loads(_worker(TRANSLATE, {"base": str(_base(lang)), "texts": [p["text"] for p in parts]}))
    name, klang, prefix, _ = LANGS[lang]
    if not voice:
        names = local_speech.voices("kokoro")
        voice = next((v for v in names if v.startswith(prefix + "f_")), next((v for v in names if v.startswith(prefix)), "af_heart"))
    total = int(round((end - start) * rate))
    out = np.zeros(total, np.float32)
    with tempfile.TemporaryDirectory(prefix="formwav-dub-") as tmp:
        _worker(SPEAK_ALL, {"model": str(local_speech._models() / "kokoro-v1.0.onnx"), "voices": str(local_speech._models() / "voices-v1.0.bin"), "texts": translated, "voice": voice, "lang": klang, "folder": tmp})
        for i, p in enumerate(parts):
            at = int(round((p["start"] - start) * rate))
            room = (int(round((parts[i + 1]["start"] - start) * rate)) if i + 1 < len(parts) else total) - at
            spoken = Path(tmp) / f"{i}.wav"
            dec = lambda tempo: np.frombuffer(subprocess.run([media._tool("ffmpeg"), "-v", "error", "-nostdin", "-i", str(spoken), "-af", f"atempo={tempo:.4f}", "-ar", str(rate), "-ac", "1", "-f", "f32le", "-"], capture_output=True, check=True, timeout=300).stdout, "<f4")
            y = dec(1.0)
            speed = 1.0
            if len(y) > room > 0:
                speed = min(MAX_SPEED, len(y) / room)
                y = dec(speed)
            n = min(len(y), max(0, room), total - at)
            out[at : at + n] += y[:n]
            p.update(translated=translated[i], speed=round(speed, 3), placed_s=round(at / rate + start, 3), spoken_s=round(len(y) / rate, 3), cut_s=round(max(0, len(y) - n) / rate, 3))
    stem = str(info.get("name", "clip")).rsplit(".", 1)[0]
    ref = media.import_wav(f"{stem} (dubbed {lang}, this machine).wav", _wav_bytes([out], rate))
    return {"media": ref, "lang": lang, "voice": voice, "sentences": parts}
