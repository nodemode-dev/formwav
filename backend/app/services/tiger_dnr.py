"""Dialogue, music and effects by a trained model (PLAN_v12 R1): TIGER-DnR (Xu, Li and others, ICASSP 2025; code MIT,
weights Apache-2.0), trained on the Divide and Remaster set to split a film or video mix into dialogue, sound effects and
music. Installed on request into the speech runtime (data/speech-runtime, where PyTorch lives for formwav's open models),
never into the engine: PyTorch's CPU build, the four files of TIGER's code the model needs (fetched from its repository at a
pinned commit and checked by SHA-256, under package files of formwav's own that leave the rest of its layers and their
dependencies out) and its 17 MB of weights (a pinned Hugging Face revision, checked). It runs in a worker process at
44.1 kHz, each channel on its own, in the model's own overlapped 12 s windows.
"""

import hashlib
import json
import os
import subprocess
import sys
import tempfile
import threading
import urllib.request
from pathlib import Path

import numpy as np

from . import local_speech, media
from .providers import ProviderError

RATE = 44100
COMMIT = "9f18d4a10a7137e1ce8052cfb62215179f1287b6"
CODE = {
    "look2hear/models/tiger_dnr.py": "89605593bdfc05669e70f2b8647514077197f9870d32b5dd745913f6e03b50e0",
    "look2hear/models/base_model.py": "bbdcdb2ba7c398f9bbbd17caffd7b9f5c3b5f2c6443ddb350b3e3162722a9945",
    "look2hear/layers/activations.py": "bc3707fd81e8783007b1dfe7fd23f9cdde5fc5c087028a62e7c1415e70d3cfc1",
    "look2hear/layers/normalizations.py": "5d8305d3b45afde0ff635fd7ebd3fa31a92ff6047ed610a19b9090896cba73b9",
}
PACKAGES = {
    "look2hear/__init__.py": "",
    "look2hear/models/__init__.py": "from .tiger_dnr import TIGERDNR\n",
    "look2hear/layers/__init__.py": "from . import activations, normalizations\n",
}
REVISION = "b7a59560bbca10febbcd46fb01600f868e587f57"
WEIGHTS = {
    "config.json": "ba9d2f833bf2f3a5855a35d0ccd11c786f6b92f1a482d84404bc4673edb29b54",
    "model.safetensors": "dd1c696e72f6adea0085ef1af640882a8260519ad666422835e387a5b4abdd2a",
}
TORCH = "torch==2.6.0"
INFO = {"id": "tiger", "name": "Speech, music and effects (TIGER)", "license": "MIT code, Apache-2.0 weights", "clones": False, "size": "PyTorch's CPU build (900 MB installed here) and 17 MB of weights"}
_state = {"installing": ""}
_known: dict[str, bool] = {}

WORKER = """
import json,sys,os
import numpy as np
args=json.load(sys.stdin)
sys.path.insert(0,args["code"])
import torch
from safetensors.torch import load_file
from look2hear.models.tiger_dnr import TIGERDNR
torch.set_num_threads(max(1,os.cpu_count() or 1))
model=TIGERDNR(**json.load(open(args["config"])))
model.load_state_dict(load_file(args["weights"]))
model.eval()
chans=args["channels"]
x=np.fromfile(args["input"],dtype="<f4").reshape(-1,chans)
source={"dialog":2,"effect":1,"music":0}
with torch.no_grad():
    for k in args["parts"]:
        out=np.zeros_like(x)
        for c in range(chans):
            y=model.wav_chunk_inference(getattr(model,k),torch.from_numpy(np.ascontiguousarray(x[:,c]))[None,None,:],hop_length=args["hop"])
            out[:,c]=y[source[k]].reshape(-1)[:len(x)].numpy()
        out.astype("<f4").tofile(args[k])
sys.stdout.flush();sys.stderr.flush();os._exit(0)
"""


def _folder() -> Path:
    return Path(__file__).resolve().parents[2] / "models" / "tiger-dnr"


def _sha(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def installed() -> bool:
    if "tiger" in _known:
        return _known["tiger"]
    files = [_folder() / "code" / p for p in (*CODE, *PACKAGES)] + [_folder() / name for name in WEIGHTS]
    ok = all(f.exists() for f in files) and local_speech._python().exists()
    ok = ok and subprocess.run([str(local_speech._python()), "-c", "import torch, safetensors"], capture_output=True, timeout=300).returncode == 0
    _known["tiger"] = ok
    return ok


def status() -> dict:
    return {**INFO, "installed": installed(), "installing": _state["installing"]}


def _fetch(url: str, target: Path, sha: str) -> None:
    part = target.with_name(f".{target.name}.part")
    target.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=600) as res, open(part, "wb") as out:
        while block := res.read(1 << 20):
            out.write(block)
    if _sha(part) != sha:
        part.unlink()
        raise RuntimeError(f"{target.name} did not match its pinned checksum")
    part.replace(target)


def install() -> dict:
    """PyTorch's CPU build into the speech runtime, then TIGER's code and weights, in the background."""
    if _state["installing"].startswith("installing"):
        return {"installing": _state["installing"]}

    def work() -> None:
        try:
            python = local_speech._python()
            if not python.exists():
                _state["installing"] = "installing: making the speech runtime"
                subprocess.run([sys.executable, "-m", "venv", str(local_speech._runtime())], check=True, capture_output=True, timeout=600)
            _state["installing"] = "installing: PyTorch (CPU build)"
            index = [] if sys.platform == "darwin" else ["--index-url", "https://download.pytorch.org/whl/cpu"]
            for step in ([TORCH, *index], ["numpy", "safetensors", "huggingface_hub"]):
                done = subprocess.run([str(python), "-m", "pip", "install", "-q", *step], capture_output=True, timeout=3600)
                if done.returncode != 0:
                    raise RuntimeError(done.stderr.decode(errors="replace").strip().splitlines()[-1][:300])
            for path, sha in CODE.items():
                target = _folder() / "code" / path
                if not target.exists() or _sha(target) != sha:
                    _state["installing"] = f"installing: TIGER's {path.rsplit('/', 1)[-1]}"
                    _fetch(f"https://raw.githubusercontent.com/JusperLee/TIGER/{COMMIT}/{path}", target, sha)
            for path, text in PACKAGES.items():
                (_folder() / "code" / path).write_text(text, encoding="utf-8")
            for name, sha in WEIGHTS.items():
                target = _folder() / name
                if not target.exists() or _sha(target) != sha:
                    _state["installing"] = f"installing: TIGER's {name}"
                    _fetch(f"https://huggingface.co/JusperLee/TIGER-DnR/resolve/{REVISION}/{name}", target, sha)
            _known.pop("tiger", None)
            _state["installing"] = ""
        except Exception as err:  # noqa: BLE001 - shown to the person as the install's outcome
            _state["installing"] = f"failed: {err}"

    _state["installing"] = "installing"
    threading.Thread(target=work, name="formwav-install-tiger", daemon=True).start()
    return {"installing": _state["installing"]}


def separate(x: np.ndarray, rate: int, parts: tuple[str, ...] = ("dialog", "effect", "music"), hop: float = 4.0) -> dict[str, np.ndarray]:
    """Frames by channels in; the chosen parts (dialog, effect, music) out at the same rate and length, through the model
    at 44.1 kHz in 12 s windows every `hop` seconds (4, the model's own, overlaps each sample three times)."""
    if not installed():
        raise ProviderError(409, f"the trained separation model is not installed on this machine yet ({INFO['size']}): install it first")
    x = np.asarray(x, dtype=np.float32)
    frames, chans = x.shape
    ff = [media._tool("ffmpeg"), "-hide_banner", "-nostdin", "-loglevel", "error", "-y"]
    with tempfile.TemporaryDirectory(prefix="formwav-tiger-") as tmp:
        folder = Path(tmp)
        raw = folder / "in.f32"
        resampled = subprocess.run([*ff, "-f", "f32le", "-ar", str(rate), "-ac", str(chans), "-i", "-", "-ar", str(RATE), "-f", "f32le", "-"], input=x.astype("<f4").tobytes(), capture_output=True, timeout=1800)
        if resampled.returncode != 0:
            raise ProviderError(500, "the clip could not be resampled for the model")
        raw.write_bytes(resampled.stdout)
        args = {"code": str(_folder() / "code"), "config": str(_folder() / "config.json"), "weights": str(_folder() / "model.safetensors"), "channels": chans, "input": str(raw),
                "parts": list(parts), "hop": float(hop), **{k: str(folder / f"{k}.f32") for k in parts}}
        done = subprocess.run([str(local_speech._python()), "-c", WORKER], input=json.dumps(args).encode(), capture_output=True, timeout=7200)
        if done.returncode != 0:
            tail = done.stderr.decode(errors="replace").strip().splitlines()
            raise ProviderError(502, f"the separation model failed: {tail[-1][:300] if tail else done.returncode}")
        out = {}
        for k in parts:
            back = subprocess.run([*ff, "-f", "f32le", "-ar", str(RATE), "-ac", str(chans), "-i", str(folder / f"{k}.f32"), "-ar", str(rate), "-f", "f32le", "-"], capture_output=True, timeout=1800)
            y = np.frombuffer(back.stdout, dtype="<f4").reshape(-1, chans)
            out[k] = np.pad(y, ((0, max(0, frames - len(y))), (0, 0)))[:frames].astype(np.float32)
    return out
