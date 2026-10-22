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
# one render at a time: the model is 2.82 GB, and two at once ran an 8 GB machine out of memory (the worker killed)
_render = threading.Lock()

WORKER = """
import json,os,sys
a=json.load(sys.stdin)
os.chdir(a["code"]);sys.path.insert(0,a["code"])
import numpy as np,torch
torch.set_num_threads(max(1,os.cpu_count() or 1))
from soulxsinger.utils.file_utils import load_config
from soulxsinger.utils.data_processor import DataProcessor
from soulxsinger.models.soulxsinger import SoulXSinger
config=load_config("soulxsinger/config/soulxsinger.yaml")
model=SoulXSinger(config)
model.load_state_dict(torch.load(a["model"],map_location="cpu",mmap=True,weights_only=False)["state_dict"],strict=True,assign=True)
model.eval()
dp=DataProcessor(hop_size=config.audio.hop_size,sample_rate=config.audio.sample_rate,phoneset_path="soulxsinger/utils/phoneme/phone_set.json",device="cpu")
prompt=dp.process(json.load(open(a["prompt_meta"]))[0],a["prompt_wav"])
for job in a["jobs"]:
    with torch.no_grad():
        y=model.infer({"prompt":prompt,"target":dp.process(job["meta"],None)},auto_shift=False,pitch_shift=0,n_steps=config.infer.n_steps,cfg=config.infer.cfg,control="score",use_fp16=False)
    np.save(job["out"],y.squeeze().cpu().numpy().astype(np.float32))
sys.stdout.flush();sys.stderr.flush();os._exit(0)
"""


PROMPT_WORKER = """
import json,sys
import numpy as np,librosa,soundfile as sf
a=json.load(sys.stdin)
SR,HOP,MAX_S,MIN_NOTE=24000,480,6.0,0.12
y,_=librosa.load(a["input"],sr=SR,mono=True,offset=a["offset"],duration=a["duration"])
f0,voiced,_=librosa.pyin(y,fmin=70,fmax=1100,sr=SR,frame_length=1920,hop_length=HOP,center=True)
n=len(f0)
if not voiced.any():
    print(json.dumps({"error":"no sung pitch was found in the recording"}));sys.exit(0)
midi=np.where(voiced,np.round(librosa.hz_to_midi(np.where(voiced,f0,1.0))),0).astype(int)
start=max(0,int(np.argmax(voiced))-10)
end=min(n,start+int(MAX_S*SR/HOP))
gaps=[i for i in range(start+int(2*SR/HOP),end) if not voiced[i]]
if gaps and end<n:
    end=gaps[-1]+1
runs=[];i=start
while i<end:
    j=i
    while j<end and midi[j]==midi[i]:
        j+=1
    runs.append([int(midi[i]),i,j]);i=j
merged=[]
for p,s,e in runs:
    if merged and ((e-s)*HOP/SR<MIN_NOTE or merged[-1][0]==p):
        merged[-1][2]=e
    else:
        merged.append([p,s,e])
dur,pitch,ph,kind,text=[],[],[],[],[];sung=False
for p,s,e in merged:
    sec=round((e-s)*HOP/SR,2)
    if p==0:
        dur.append(sec);pitch.append(0);ph.append("<SP>");kind.append(1);text.append("<SP>");sung=False
    else:
        dur.append(sec);pitch.append(p);ph.append("en_AA1");kind.append(3 if sung else 2);text.append("a");sung=True
sf.write(a["stem"]+".wav",y[start*HOP:end*HOP],SR,subtype="PCM_16")
meta=[{"index":a["id"],"language":"English","time":[0,int(round((end-start)*HOP/SR*1000))],"duration":" ".join(map(str,dur)),"text":" ".join(text),"phoneme":" ".join(ph),
       "note_pitch":" ".join(map(str,pitch)),"note_type":" ".join(map(str,kind)),"f0":" ".join(f"{v:.1f}" for v in np.where(voiced[start:end],f0[start:end],0.0))}]
json.dump(meta,open(a["stem"]+".json","w"))
sung_pitches=[p for p in pitch if p]
print(json.dumps({"seconds":round((end-start)*HOP/SR,2),"notes":len(sung_pitches),"low":min(sung_pitches),"high":max(sung_pitches)}))
"""


def _folder() -> Path:
    return Path(__file__).resolve().parents[2] / "models" / "soulx-singer"


def _voices() -> Path:
    return _folder() / "voices"


def _prompt(singer: str) -> tuple[Path, Path] | None:
    """A singer's prompt recording and metadata: a stock singer's beside this file, a person's own in the voices folder."""
    if singer in STOCK:
        return SINGERS / f"{singer}.wav", SINGERS / f"{singer}.json"
    if singer.startswith("own_") and singer[4:].isalnum() and (_voices() / f"{singer}.json").exists():
        return _voices() / f"{singer}.wav", _voices() / f"{singer}.json"
    return None


def _own() -> list[dict]:
    out = []
    for path in sorted(_voices().glob("own_*.permission.json")) if _voices().exists() else []:
        record = json.loads(path.read_text(encoding="utf-8"))
        out.append({"id": record["id"], "name": record["name"], "low": record["low"], "high": record["high"], "own": True, "permission": record["permission"]})
    return out


def make_singer(media_id: str, name: str, permission: bool, offset: float = 0.0, duration: float | None = None) -> dict:
    """L4c: a singer from a person's own recording (best a few notes sung on "ah"), only with their permission confirmed:
    the first six seconds of singing kept as the prompt, its metadata made as for the stock singers, and the confirmation
    kept beside it (who, when, from which media)."""
    if not permission:
        raise ProviderError(403, "a singer is made from a voice only with the permission of the person it belongs to: confirm it first")
    name = " ".join(str(name).split())[:60]
    if not name:
        raise ProviderError(422, "name the singer")
    try:
        info = media.media_info(media_id)
    except KeyError as err:
        raise ProviderError(404, "no media with that id") from err
    if not installed():
        raise ProviderError(409, f"singing on this machine needs SoulX-Singer installed ({INFO['size']}): install it first (Install a model on this machine)")
    singer = "own_" + hashlib.sha256(f"{media_id}:{offset}:{duration}:{name}".encode()).hexdigest()[:16]
    _voices().mkdir(parents=True, exist_ok=True)
    args = {"input": str(media.media_dir() / f"{media_id}.wav"), "offset": max(0.0, float(offset)), "duration": float(duration) if duration else None, "stem": str(_voices() / singer), "id": singer}
    done = subprocess.run([str(local_speech._python()), "-c", PROMPT_WORKER], input=json.dumps(args).encode(), capture_output=True, timeout=600)
    found = json.loads((done.stdout.decode().strip().splitlines() or ["{}"])[-1]) if done.returncode == 0 else {"error": local_speech._last_line(done)}
    if "error" in found:
        raise ProviderError(422, f"no singer made: {found['error']}")
    record = {"id": singer, "name": name, "low": found["low"], "high": found["high"], "seconds": found["seconds"], "notes": found["notes"],
              "permission": {"confirmed": True, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "media": info.get("name", media_id), "media_id": media_id}}
    (_voices() / f"{singer}.permission.json").write_text(json.dumps(record, indent=1), encoding="utf-8")
    return record


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
    return [{"id": k, **v} for k, v in STOCK.items()] + _own()


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
    prompt = _prompt(singer)
    if prompt is None:
        raise ProviderError(422, f"no singer {singer}: one of {', '.join(s['id'] for s in singers())}")
    singer_name = STOCK[singer]["name"] if singer in STOCK else next(s["name"] for s in _own() if s["id"] == singer)
    if not notes:
        raise ProviderError(422, "no notes to sing")
    if not installed():
        raise ProviderError(409, f"singing on this machine needs SoulX-Singer installed ({INFO['size']}): install it first (Install a model on this machine)")
    began = time.monotonic()
    parts = [(p, phrase_meta(p)) for p in phrases(notes)]
    _cache().mkdir(parents=True, exist_ok=True)
    with _render:
        rendered = _render_missing(parts, singer, prompt)
    return _assemble(parts, singer, singer_name, rate, name, rendered, began)


def _render_missing(parts: list, singer: str, prompt: tuple[Path, Path]) -> int:
    """The phrases not in the cache, rendered by one worker (under _render, so a phrase another request just sang is
    found in the cache here)."""
    jobs = []
    for _, meta in parts:
        out = _cache() / f"{_key(meta, singer)}.npy"
        if not out.exists() and not any(j["out"] == str(out) for j in jobs):
            jobs.append({"meta": meta, "out": str(out)})
    if jobs:
        with tempfile.TemporaryDirectory(prefix="formwav-sing-") as tmp:
            staged = [{"meta": j["meta"], "out": str(Path(tmp) / f"{i}.npy"), "final": j["out"]} for i, j in enumerate(jobs)]
            args = {"code": str(_folder() / "code"), "model": str(_model()), "prompt_wav": str(prompt[0]), "prompt_meta": str(prompt[1]),
                    "jobs": [{"meta": s["meta"], "out": s["out"]} for s in staged]}
            done = subprocess.run([str(local_speech._python()), "-c", WORKER], input=json.dumps(args).encode(), capture_output=True, timeout=7200, env={**os.environ, "TOKENIZERS_PARALLELISM": "false"})
            if done.returncode != 0 or not all(Path(s["out"]).exists() for s in staged):
                raise ProviderError(502, f"SoulX-Singer failed: {local_speech._last_line(done)}")
            for s in staged:
                os.replace(s["out"], s["final"])
    return len(jobs)


def _assemble(parts: list, singer: str, singer_name: str, rate: int | None, name: str, rendered: int, began: float) -> dict:
    """The sung phrases, from the cache, placed in one mono buffer and imported as media."""
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
    voice = singer_name if singer in STOCK else f"{singer_name}'s own voice, generated"
    made = media.import_audio(f"{name} ({voice}, sung by SoulX-Singer).wav", _wav_bytes([mix], SR), rate)
    return {"media": made, "start": origin, "phrases": len(parts), "rendered": rendered, "cached": len(parts) - rendered, "seconds": round(time.monotonic() - began, 1)}
