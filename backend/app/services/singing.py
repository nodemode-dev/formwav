"""Singing on this machine (DEV_PLAN_sung_lyrics L4): SoulX-Singer (Soul AI Lab; code and weights Apache-2.0) sings a
note clip's notes with their phonemes in a stock singer's voice.

Installed on request into the speech runtime (data/speech-runtime, PyTorch's CPU build, beside Chatterbox and EzAudio):
the packages its inference imports beyond what Chatterbox brings (accelerate, omegaconf, librosa, pinned), the 15 files of
its code that inference reaches (fetched at a pinned commit, each checked by SHA-256, listed in soulx_files.json beside
this file) and its 2.82 GB model (a pinned Hugging Face revision, checked). It ran here under PyTorch 2.6.0 and
transformers 4.46.3 (Chatterbox's), its result pitch for pitch the same as under its own pins (PyTorch 2.2.0).

The stock singers are VocalSet (Wilkins, Seetharaman, Wahl and Pardo, Northwestern University, 2018; CC BY 4.0,
doi:10.5281/zenodo.1442513): a soprano's (f1) and a baritone's (m1) scale sung on "a", trimmed to six seconds and
resampled to 24 kHz mono, with SoulX-Singer's prompt metadata made from them (pitch by pYIN, notes as runs of one
semitone, one AA1 vowel slurred across the notes), in singers/ beside this file.

A clip is sung phrase by phrase, a phrase ending where a rest of REST_S or more begins; each phrase is kept in a cache
keyed by its notes, phonemes, singer and the model, so singing a clip again after an edit renders only the phrases that
changed. The result is labelled as generated in its name.
"""

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

import numpy as np

from . import g2p, local_speech, media, tiger_dnr
from .providers import ProviderError

MANIFEST = json.loads((Path(__file__).with_name("soulx_files.json")).read_text(encoding="utf-8"))
REPO = "Soul-AILab/SoulX-Singer"
SINGERS = Path(__file__).with_name("singers")
STOCK = {
    "vocalset_f1": {"name": "Soprano (VocalSet f1)", "low": 60, "high": 79},
    "vocalset_m1": {"name": "Baritone (VocalSet m1)", "low": 43, "high": 64},
}
DEFAULT_SINGER = "vocalset_f1"
SR = 24000
REST_S = 0.3
LEAD_S = 0.2
TAIL_S = 0.4
INFO = {"id": "soulx-singer", "name": "Singing (SoulX-Singer)", "license": "Apache-2.0 code and weights (SoulX-Singer); stock singers from VocalSet, CC BY 4.0", "clones": False,
        "size": "PyTorch's CPU build and 2.82 GB of SoulX-Singer's model"}
_state = {"installing": ""}
_known: dict[str, bool] = {}

WORKER = """
import json,os,sys
a=json.load(sys.stdin)
os.chdir(a["code"]);sys.path.insert(0,a["code"])
import numpy as np,torch
torch.set_num_threads(max(1,os.cpu_count() or 1))
from soulxsinger.utils.file_utils import load_config
from soulxsinger.utils.data_processor import DataProcessor
from cli.inference import build_model
config=load_config("soulxsinger/config/soulxsinger.yaml")
model=build_model(a["model"],config,device="cpu")
dp=DataProcessor(hop_size=config.audio.hop_size,sample_rate=config.audio.sample_rate,phoneset_path="soulxsinger/utils/phoneme/phone_set.json",device="cpu")
prompt=dp.process(json.load(open(a["prompt_meta"]))[0],a["prompt_wav"])
for job in a["jobs"]:
    with torch.no_grad():
        y=model.infer({"prompt":prompt,"target":dp.process(job["meta"],None)},auto_shift=False,pitch_shift=0,n_steps=config.infer.n_steps,cfg=config.infer.cfg,control="score",use_fp16=False)
    np.save(job["out"],y.squeeze().cpu().numpy().astype(np.float32))
sys.stdout.flush();sys.stderr.flush();os._exit(0)
"""


def _folder() -> Path:
    return Path(__file__).resolve().parents[2] / "models" / "soulx-singer"


def _model() -> Path:
    return _folder() / "code" / next(iter(MANIFEST["weights"]))


def installed() -> bool:
    if "soulx" in _known:
        return _known["soulx"]
    files = [_folder() / "code" / p for p in (*MANIFEST["code"], *MANIFEST["weights"])]
    ok = all(f.exists() for f in files) and local_speech._python().exists()
    ok = ok and subprocess.run([str(local_speech._python()), "-c", "import torch, torchaudio, transformers, accelerate, omegaconf, librosa"], capture_output=True, timeout=300).returncode == 0
    _known["soulx"] = ok
    return ok


def status() -> dict:
    return {**INFO, "installed": installed(), "installing": _state["installing"]}


def singers() -> list[dict]:
    return [{"id": k, **v} for k, v in STOCK.items()]


def install() -> dict:
    """PyTorch's CPU build and SoulX-Singer's packages into the speech runtime, then its code and model, in the background."""
    if _state["installing"].startswith("installing"):
        return {"installing": _state["installing"]}

    def work() -> None:
        try:
            python = local_speech._python()
            if not python.exists():
                _state["installing"] = "installing: making the speech runtime"
                subprocess.run([sys.executable, "-m", "venv", str(local_speech._runtime())], check=True, capture_output=True, timeout=600)
            index = [] if sys.platform == "darwin" else ["--index-url", "https://download.pytorch.org/whl/cpu"]
            for label, step in (("PyTorch (CPU build)", [*local_speech.TORCH, *index]), ("SoulX-Singer's packages", MANIFEST["packages"])):
                _state["installing"] = f"installing: {label}"
                done = subprocess.run([str(python), "-m", "pip", "install", "-q", *step], capture_output=True, timeout=3600)
                if done.returncode != 0:
                    raise RuntimeError(local_speech._last_line(done))
            for path, sha in MANIFEST["code"].items():
                target = _folder() / "code" / path
                if not target.exists() or tiger_dnr._sha(target) != sha:
                    _state["installing"] = f"installing: SoulX-Singer's {path.rsplit('/', 1)[-1]}"
                    tiger_dnr._fetch(f"https://raw.githubusercontent.com/{REPO}/{MANIFEST['commit']}/{path}", target, sha)
            for path, sha in MANIFEST["weights"].items():
                target = _folder() / "code" / path
                if not target.exists() or tiger_dnr._sha(target) != sha:
                    _state["installing"] = "installing: SoulX-Singer's model (2.82 GB)"
                    tiger_dnr._fetch(f"https://huggingface.co/{REPO}/resolve/{MANIFEST['revision']}/{path.rsplit('/', 1)[-1]}", target, sha)
            _known.pop("soulx", None)
            _state["installing"] = ""
        except Exception as err:  # noqa: BLE001 - shown to the person as the install's outcome
            _state["installing"] = f"failed: {err}"

    _state["installing"] = "installing"
    threading.Thread(target=work, name="formwav-install-soulx", daemon=True).start()
    return {"installing": _state["installing"]}


def _phonemes(note: dict, previous: list[str]) -> tuple[list[str], bool]:
    """A note's ARPAbet phonemes and whether it is a slur (sung on the vowel before it)."""
    given = note.get("phonemes")
    if isinstance(given, list):
        phones = [str(p).upper() for p in given if str(p).strip()]
        return (previous, True) if not phones and previous else (phones, False)
    lyric = str(note.get("lyric") or "da").strip()
    if lyric == "-":
        return previous, True
    phones: list[str] = []
    for word in lyric.replace("-", " ").split():
        phones += g2p.pronounce(word)[0]
    return phones or ["D", "AA1"], False


def phrases(notes: list[dict]) -> list[list[dict]]:
    """Notes in time order, the higher of a chord only, cut into phrases at rests of REST_S or more."""
    by_start: dict[int, dict] = {}
    for n in notes:
        start = int(round(float(n["start"]) * 1000))
        if start not in by_start or int(n["pitch"]) > int(by_start[start]["pitch"]):
            by_start[start] = n
    ordered = [by_start[k] for k in sorted(by_start)]
    out: list[list[dict]] = []
    for n in ordered:
        if out and float(n["start"]) - max(float(x["start"]) + float(x["length"]) for x in out[-1]) < REST_S:
            out[-1].append(n)
        else:
            out.append([n])
    return out


def phrase_meta(phrase: list[dict]) -> dict:
    """One phrase in SoulX-Singer's score form: a lead rest, each note (a rest inserted where it starts after the last
    one ended), a tail rest; times in seconds from LEAD_S before its first note."""
    dur, pitch, phone, kind = [LEAD_S], [0], ["<SP>"], [1]
    previous: list[str] = []
    for k, n in enumerate(phrase):
        start, length = float(n["start"]), max(0.05, float(n["length"]))
        if k:
            end = float(phrase[k - 1]["start"]) + float(phrase[k - 1]["length"])
            if start - end > 0.02:
                dur.append(round(start - end, 3)); pitch.append(0); phone.append("<SP>"); kind.append(1)
        if k + 1 < len(phrase):
            length = min(length, float(phrase[k + 1]["start"]) - start)
        phones, slur = _phonemes(n, previous)
        phones = [p for p in phones if p.rstrip("012") in g2p.VOWELS | g2p.CONSONANTS] or ["AA1"]
        dur.append(round(max(0.03, length), 3)); pitch.append(max(0, min(127, int(n["pitch"])))); phone.append("en_" + "-".join(phones)); kind.append(3 if slur else 2)
        previous = phones
    dur.append(TAIL_S); pitch.append(0); phone.append("<SP>"); kind.append(1)
    total = int(round(sum(dur) * 1000))
    return {"index": "phrase", "language": "English", "time": [0, total], "duration": " ".join(map(str, dur)), "text": " ".join("<SP>" if p == "<SP>" else "x" for p in phone),
            "phoneme": " ".join(phone), "note_pitch": " ".join(map(str, pitch)), "note_type": " ".join(map(str, kind))}


def _cache() -> Path:
    return _folder() / "cache"


def _key(meta: dict, singer: str) -> str:
    return hashlib.sha256(json.dumps([meta, singer, MANIFEST["commit"], MANIFEST["revision"]], sort_keys=True).encode()).hexdigest()[:32]


def sing(notes: list[dict], singer: str = DEFAULT_SINGER, rate: int | None = None, name: str = "Singing") -> dict:
    """Notes ({start, length in seconds, pitch, phonemes or lyric}) sung by a stock singer as new media; start is where
    the media's first sample belongs, in the notes' seconds. Only phrases not in the cache are rendered."""
    if singer not in STOCK:
        raise ProviderError(422, f"no singer {singer}: one of {', '.join(STOCK)}")
    if not notes:
        raise ProviderError(422, "no notes to sing")
    if not installed():
        raise ProviderError(409, f"singing on this machine needs SoulX-Singer installed ({INFO['size']}): install it first (Install a model on this machine)")
    began = time.monotonic()
    parts = [(p, phrase_meta(p)) for p in phrases(notes)]
    _cache().mkdir(parents=True, exist_ok=True)
    jobs = []
    for _, meta in parts:
        out = _cache() / f"{_key(meta, singer)}.npy"
        if not out.exists() and not any(j["out"] == str(out) for j in jobs):
            jobs.append({"meta": meta, "out": str(out)})
    if jobs:
        with tempfile.TemporaryDirectory(prefix="formwav-sing-") as tmp:
            staged = [{"meta": j["meta"], "out": str(Path(tmp) / f"{i}.npy"), "final": j["out"]} for i, j in enumerate(jobs)]
            args = {"code": str(_folder() / "code"), "model": str(_model()), "prompt_wav": str(SINGERS / f"{singer}.wav"), "prompt_meta": str(SINGERS / f"{singer}.json"),
                    "jobs": [{"meta": s["meta"], "out": s["out"]} for s in staged]}
            done = subprocess.run([str(local_speech._python()), "-c", WORKER], input=json.dumps(args).encode(), capture_output=True, timeout=7200, env={**os.environ, "TOKENIZERS_PARALLELISM": "false"})
            if done.returncode != 0 or not all(Path(s["out"]).exists() for s in staged):
                raise ProviderError(502, f"SoulX-Singer failed: {local_speech._last_line(done)}")
            for s in staged:
                os.replace(s["out"], s["final"])
    from .aup_project import _wav_bytes

    origin = float(parts[0][0][0]["start"]) - LEAD_S
    end = max(float(p[-1]["start"]) + float(p[-1]["length"]) for p, _ in parts) + TAIL_S
    mix = np.zeros(int(round((end - origin) * SR)) + SR, dtype=np.float32)
    for p, meta in parts:
        y = np.load(_cache() / f"{_key(meta, singer)}.npy").astype(np.float32)
        at = int(round((float(p[0]["start"]) - LEAD_S - origin) * SR))
        n = min(len(y), len(mix) - at)
        mix[at:at + n] += y[:n]
    mix = mix[: int(round((end - origin) * SR))]
    if origin < 0:
        mix = mix[int(round(-origin * SR)):]
        origin = 0.0
    made = media.import_audio(f"{name} ({STOCK[singer]['name']}, sung by SoulX-Singer).wav", _wav_bytes([mix], SR), rate)
    return {"media": made, "start": origin, "phrases": len(parts), "rendered": len(jobs), "cached": len(parts) - len(jobs), "seconds": round(time.monotonic() - began, 1)}
