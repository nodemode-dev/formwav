"""Sound effects made on this machine (PLAN_v12 R5): EzAudio (Hai, Chen and others, 2024; code and weights MIT), a
text-to-audio diffusion transformer, its large model (s3_l), at 24 kHz for up to 10 s, with Google's FLAN-T5 large
(Apache-2.0) reading the prompt. ElevenLabs makes effects in its cloud; this path keeps the prompt on the machine.

Installed on request into the speech runtime (data/speech-runtime, where PyTorch's CPU build lives for formwav's open
models), never into the engine: the packages its generation imports (pinned where Chatterbox or Kokoro do not already
bring them), the 67 files of EzAudio's code that generation reaches (fetched from its repository at a pinned commit,
each checked by SHA-256, listed in ezaudio_files.json beside this file) and its two checkpoints (a pinned Hugging Face
revision, checked: the model 2.39 GB, the autoencoder 183 MB). FLAN-T5 large comes from Hugging Face on the first
effect. Each effect runs in a worker process of its own, with a seed, so the same prompt and seed make the same sound.
"""

import json
import os
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

from . import local_speech, media, tiger_dnr
from .providers import ProviderError

MANIFEST = json.loads((Path(__file__).with_name("ezaudio_files.json")).read_text(encoding="utf-8"))
REPO = "haidog-yaqub/EzAudio"
MAX_SECONDS = 10
INFO = {"id": "ezaudio", "name": "Sound effects (EzAudio)", "license": "MIT code and weights (EzAudio); FLAN-T5 Apache-2.0", "clones": False,
        "size": "PyTorch's CPU build, 2.6 GB of EzAudio's weights and 3.1 GB of FLAN-T5 large on the first effect"}
_state = {"installing": ""}
_known: dict[str, bool] = {}

WORKER = """
import json,os,sys
a=json.load(sys.stdin)
os.chdir(a["code"]);sys.path.insert(0,a["code"])
import torch,soundfile as sf
torch.set_num_threads(max(1,os.cpu_count() or 1))
from api.ezaudio import EzAudio
ez=EzAudio(model_name="s3_l",ckpt_path=a["ckpt"],vae_path=a["vae"],device="cpu")
sr,audio=ez.generate_audio(a["prompt"],length=a["seconds"],guidance_scale=a["guidance"],ddim_steps=a["steps"],random_seed=a["seed"])
sf.write(a["output"],audio,sr,subtype="FLOAT")
sys.stdout.flush();sys.stderr.flush();os._exit(0)
"""


def _folder() -> Path:
    return Path(os.environ.get("FORMWAV_MODELS_ROOT", Path(__file__).resolve().parents[2] / "models")).expanduser() / "ezaudio"


def installed() -> bool:
    if "ezaudio" in _known:
        return _known["ezaudio"]
    files = [_folder() / "code" / p for p in (*MANIFEST["code"], *MANIFEST["weights"])]
    ok = all(f.exists() for f in files) and local_speech._python().exists()
    ok = ok and subprocess.run([str(local_speech._python()), "-c", "import torch, diffusers, transformers, alias_free_torch, vector_quantize_pytorch, flatten_dict"], capture_output=True, timeout=300).returncode == 0
    _known["ezaudio"] = ok
    return ok


def status() -> dict:
    return {**INFO, "installed": installed(), "installing": _state["installing"]}


def install() -> dict:
    """PyTorch's CPU build and EzAudio's packages into the speech runtime, then its code and weights, in the background."""
    if _state["installing"].startswith("installing"):
        return {"installing": _state["installing"]}

    def work() -> None:
        try:
            python = local_speech._python()
            if not python.exists():
                _state["installing"] = "installing: making the speech runtime"
                subprocess.run([sys.executable, "-m", "venv", str(local_speech._runtime())], check=True, capture_output=True, timeout=600)
            index = [] if sys.platform == "darwin" else ["--index-url", "https://download.pytorch.org/whl/cpu"]
            for label, step in (("PyTorch (CPU build)", [*local_speech.TORCH, *index]), ("EzAudio's packages", MANIFEST["packages"])):
                _state["installing"] = f"installing: {label}"
                done = subprocess.run([str(python), "-m", "pip", "install", "-q", *step], capture_output=True, timeout=3600)
                if done.returncode != 0:
                    raise RuntimeError(local_speech._last_line(done))
            for path, sha in MANIFEST["code"].items():
                target = _folder() / "code" / path
                if not target.exists() or tiger_dnr._sha(target) != sha:
                    _state["installing"] = f"installing: EzAudio's {path.rsplit('/', 1)[-1]}"
                    tiger_dnr._fetch(f"https://raw.githubusercontent.com/{REPO}/{MANIFEST['commit']}/{path}", target, sha)
            for path, sha in MANIFEST["weights"].items():
                target = _folder() / "code" / path
                if not target.exists() or tiger_dnr._sha(target) != sha:
                    _state["installing"] = f"installing: EzAudio's {path.rsplit('/', 1)[-1]}"
                    tiger_dnr._fetch(f"https://huggingface.co/OpenSound/EzAudio/resolve/{MANIFEST['revision']}/{path}", target, sha)
            _known.pop("ezaudio", None)
            _state["installing"] = ""
        except Exception as err:  # noqa: BLE001 - shown to the person as the install's outcome
            _state["installing"] = f"failed: {err}"

    _state["installing"] = "installing"
    threading.Thread(target=work, name="formwav-install-ezaudio", daemon=True).start()
    return {"installing": _state["installing"]}


def generate(prompt: str, seconds: float = 5, seed: int = 0, steps: int = 50, guidance: float = 5.0, rate: int | None = None) -> dict:
    """An effect from a description, 1 to 10 whole seconds, as new media (at the session's rate when given)."""
    prompt = " ".join(str(prompt).split())
    if not prompt:
        raise ProviderError(422, "describe the sound to make")
    if not installed():
        raise ProviderError(409, f"sound effects on this machine need EzAudio installed ({INFO['size']}): install it first (Install a model on this machine)")
    length = max(1, min(MAX_SECONDS, int(round(float(seconds)))))
    with tempfile.TemporaryDirectory(prefix="formwav-ezaudio-") as tmp:
        out = Path(tmp) / "effect.wav"
        args = {"code": str(_folder() / "code"), "ckpt": str(_folder() / "code" / "ckpts/s3/ezaudio_s3_l.pt"), "vae": str(_folder() / "code" / "ckpts/vae/1m.pt"),
                "prompt": prompt, "seconds": length, "seed": int(seed), "steps": max(10, min(200, int(steps))), "guidance": float(guidance), "output": str(out)}
        env = {**os.environ, "TOKENIZERS_PARALLELISM": "false"}
        done = subprocess.run([str(local_speech._python()), "-c", WORKER], input=json.dumps(args).encode(), capture_output=True, timeout=3600, env=env)
        if done.returncode != 0 or not out.exists():
            raise ProviderError(502, f"EzAudio failed: {local_speech._last_line(done)}")
        return media.import_audio(f"{prompt[:40].strip()} (EzAudio).wav", out.read_bytes(), rate)
