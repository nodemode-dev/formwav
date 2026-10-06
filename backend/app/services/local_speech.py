"""Speech made on this machine, from formcut 2.6.3's local speech (backend/app/local_speech.py, the same author): Kokoro
(kokoro-onnx, Apache-2.0: voices, no cloning, no PyTorch), Pocket TTS (Kyutai; MIT code, CC-BY-4.0 weights: voices and
cloning) and Chatterbox (Resemble AI, MIT; cloning; every output carries an inaudible watermark). As in formcut, an engine
is installed on request into a speech runtime of its own (data/speech-runtime), never into formwav's engine, and speaks in
a worker process there; Kokoro's model files (about 340 MB) come from kokoro-onnx's releases into the models folder.
Pocket TTS and Chatterbox bring PyTorch, so they belong where there is room for it. Their cloning gives Regenerate an
open-weight path: the speaker cloned from the clip around the selection, the words spliced in as ElevenLabs' are.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import urllib.request
from pathlib import Path

from ..core.paths import data_dir
from . import media
from .providers import ProviderError, _splice

ENGINES = {
    "kokoro": {"name": "Kokoro", "module": "kokoro_onnx", "package": "kokoro-onnx==0.6.1", "license": "Apache-2.0", "clones": False, "size": "about 600 MB with its model (570 MB measured here)"},
    "pocket": {"name": "Pocket TTS", "module": "pocket_tts", "package": "pocket-tts", "license": "MIT code, CC-BY-4.0 weights (Kyutai)", "clones": True, "size": "PyTorch and its weights, not measured here (expect a GB or more)"},
    "chatterbox": {"name": "Chatterbox", "module": "chatterbox", "package": "chatterbox-tts", "license": "MIT (Resemble AI); every output carries an inaudible watermark", "clones": True, "size": "PyTorch and its weights, not measured here (expect several GB)"},
}
KOKORO_FILES = {
    "kokoro-v1.0.onnx": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.onnx",
    "voices-v1.0.bin": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin",
}
POCKET_VOICES = ["alba", "marius", "javert", "jean", "fantine", "cosette", "eponine", "azelma"]
REFERENCE_SECONDS = 20
_installing: dict[str, str] = {}
_known: dict[str, bool] = {}

KOKORO = """
import json,sys,wave
import numpy as np
from kokoro_onnx import Kokoro
args=json.load(sys.stdin)
engine=Kokoro(args["model"],args["voices"])
if args.get("list"):
    print(json.dumps(sorted(engine.get_voices())));sys.exit(0)
audio,rate=engine.create(args["text"],voice=args["voice"],speed=args.get("speed",1.0),lang=args.get("language","en-us"))
with wave.open(args["output"],"wb") as out:
    out.setnchannels(1);out.setsampwidth(2);out.setframerate(rate)
    out.writeframes(np.round(np.clip(audio,-1,1)*32767).astype("<i2").tobytes())
"""
POCKET = """
import json,sys,wave,os
import numpy as np
from pocket_tts import TTSModel
args=json.load(sys.stdin)
model=TTSModel.load_model()
state=model.get_state_for_audio_prompt(args["reference"] or args["voice"])
audio=model.generate_audio(state,args["text"]).detach().cpu().numpy().reshape(-1)
with wave.open(args["output"],"wb") as out:
    out.setnchannels(1);out.setsampwidth(2);out.setframerate(int(model.sample_rate))
    out.writeframes(np.round(np.clip(audio,-1,1)*32767).astype("<i2").tobytes())
sys.stdout.flush();sys.stderr.flush();os._exit(0)
"""
CHATTERBOX = """
import json,sys,wave,os
import numpy as np
import torch
args=json.load(sys.stdin)
mps=getattr(torch.backends,"mps",None)
device="cuda" if torch.cuda.is_available() else ("mps" if mps is not None and mps.is_available() else "cpu")
options={"audio_prompt_path":args["reference"] or None,"exaggeration":0.5,"cfg_weight":0.5}
if args.get("language","en")=="en":
    from chatterbox.tts import ChatterboxTTS
    model=ChatterboxTTS.from_pretrained(device=device);wav=model.generate(args["text"],**options)
else:
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    model=ChatterboxMultilingualTTS.from_pretrained(device=device);wav=model.generate(args["text"],language_id=args["language"],**options)
audio=wav.detach().cpu().numpy().reshape(-1)
with wave.open(args["output"],"wb") as out:
    out.setnchannels(1);out.setsampwidth(2);out.setframerate(int(model.sr))
    out.writeframes(np.round(np.clip(audio,-1,1)*32767).astype("<i2").tobytes())
sys.stdout.flush();sys.stderr.flush();os._exit(0)
"""
WORKERS = {"kokoro": KOKORO, "pocket": POCKET, "chatterbox": CHATTERBOX}


def _runtime() -> Path:
    return data_dir() / "speech-runtime"


def _python() -> Path:
    return _runtime() / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def _models() -> Path:
    return Path(__file__).resolve().parents[2] / "models" / "kokoro"


def installed(engine: str) -> bool:
    if engine in _known:
        return _known[engine]
    ok = _python().exists() and subprocess.run([str(_python()), "-c", f"import {ENGINES[engine]['module']}"], capture_output=True, timeout=120).returncode == 0
    if engine == "kokoro":
        ok = ok and all((_models() / f).exists() for f in KOKORO_FILES)
    _known[engine] = ok
    return ok


def status() -> list[dict]:
    return [{"id": k, "name": e["name"], "license": e["license"], "clones": e["clones"], "size": e["size"], "installed": installed(k), "installing": _installing.get(k, "")} for k, e in ENGINES.items()]


def install(engine: str) -> dict:
    """The engine's package into the speech runtime (and Kokoro's model files), in the background."""
    if engine not in ENGINES:
        raise ProviderError(404, f"no local speech engine named {engine}")
    if _installing.get(engine, "").startswith("installing"):
        return {"installing": _installing[engine]}

    def work() -> None:
        try:
            if not _python().exists():
                _installing[engine] = "installing: making the speech runtime"
                subprocess.run([sys.executable, "-m", "venv", str(_runtime())], check=True, capture_output=True, timeout=600)
            _installing[engine] = f"installing: {ENGINES[engine]['package']}"
            done = subprocess.run([str(_python()), "-m", "pip", "install", "-q", ENGINES[engine]["package"], "numpy"], capture_output=True, timeout=3600)
            if done.returncode != 0:
                raise RuntimeError(done.stderr.decode(errors="replace").strip().splitlines()[-1][:300])
            if engine == "kokoro":
                _models().mkdir(parents=True, exist_ok=True)
                for name, url in KOKORO_FILES.items():
                    if not (_models() / name).exists():
                        _installing[engine] = f"installing: downloading {name}"
                        tmp = _models() / f".{name}.part"
                        with urllib.request.urlopen(url, timeout=600) as res, open(tmp, "wb") as out:
                            shutil.copyfileobj(res, out)
                        tmp.replace(_models() / name)
            _known.pop(engine, None)
            _installing[engine] = ""
        except Exception as err:  # noqa: BLE001 - shown to the person as the install's outcome
            _installing[engine] = f"failed: {err}"

    _installing[engine] = "installing"
    threading.Thread(target=work, name=f"formwav-install-{engine}", daemon=True).start()
    return {"installing": _installing[engine]}


def _run(engine: str, args: dict, timeout: float = 1800) -> subprocess.CompletedProcess:
    if not installed(engine):
        raise ProviderError(409, f"{ENGINES[engine]['name']} is not installed on this machine yet ({ENGINES[engine]['size']}): install it first")
    if engine == "kokoro":
        args = {**args, "model": str(_models() / "kokoro-v1.0.onnx"), "voices": str(_models() / "voices-v1.0.bin")}
    done = subprocess.run([str(_python()), "-c", WORKERS[engine]], input=json.dumps(args).encode(), capture_output=True, timeout=timeout)
    if done.returncode != 0:
        raise ProviderError(502, f"{ENGINES[engine]['name']} failed: {done.stderr.decode(errors='replace').strip().splitlines()[-1][:300] if done.stderr else done.returncode}")
    return done


def voices(engine: str) -> list[str]:
    if engine == "kokoro":
        return json.loads(_run("kokoro", {"list": True}, timeout=300).stdout or b"[]")
    if engine == "pocket":
        return POCKET_VOICES
    return []


def _reference(media_id: str, folder: Path, start_s: float = 0.0) -> str:
    """Up to 20 s of a clip's sound from start_s, mono at 24 kHz, as both cloning engines read it."""
    target = folder / f"reference-{media_id}.wav"
    done = subprocess.run([media._tool("ffmpeg"), "-v", "error", "-nostdin", "-y", "-ss", f"{max(0.0, start_s):.3f}", "-i", str(media.media_dir() / f"{media_id}.wav"),
                           "-ac", "1", "-ar", "24000", "-t", str(REFERENCE_SECONDS), str(target)], capture_output=True, timeout=300)
    if done.returncode != 0:
        raise ProviderError(404, "the voice reference could not be read")
    return str(target)


def speak(engine: str, text: str, voice: str = "", reference_media: str = "", language: str = "en", rate: int | None = None, reference_from: float = 0.0) -> dict:
    """Text spoken by a local engine, imported as media (at `rate` when given); a cloning engine clones from reference_media."""
    if engine not in ENGINES:
        raise ProviderError(404, f"no local speech engine named {engine}")
    if not text.strip():
        raise ProviderError(422, "type what to say")
    if engine == "chatterbox" and not reference_media:
        raise ProviderError(422, "Chatterbox speaks in a cloned voice: choose a clip to clone")
    with tempfile.TemporaryDirectory(prefix="formwav-speech-") as tmp:
        folder = Path(tmp)
        args = {"text": text, "voice": voice or ("af_heart" if engine == "kokoro" else "alba"), "language": language, "output": str(folder / "out.wav"),
                "reference": _reference(reference_media, folder, reference_from) if reference_media and ENGINES[engine]["clones"] else ""}
        if engine == "kokoro":
            args["language"] = {"en": "en-us"}.get(language, language)
        _run(engine, args)
        return media.import_audio(f"Speech ({ENGINES[engine]['name']}) - {text[:30].strip()}.wav", (folder / "out.wav").read_bytes(), rate)


def regenerate(engine: str, media_id: str, start_s: float, end_s: float, text: str) -> dict:
    """The words between start_s and end_s spoken again as `text` by a local cloning engine, in the speaker's voice cloned
    from the clip around them, and spliced in as ElevenLabs' regeneration is: the open-weight path."""
    from .tools import _wav_view

    if not ENGINES.get(engine, {}).get("clones"):
        raise ProviderError(422, "regenerating in the speaker's voice takes a cloning engine: Pocket TTS or Chatterbox")
    view, rate = _wav_view(media_id)
    frames = int(view.shape[0])
    a, b = max(0, int(round(float(start_s) * rate))), min(frames, int(round(float(end_s) * rate)))
    if b - a < int(0.05 * rate):
        raise ProviderError(422, "select at least 50 ms of the clip to regenerate")
    spoken = speak(engine, text, reference_media=media_id, rate=rate, reference_from=max(0.0, float(start_s) - REFERENCE_SECONDS / 2))
    return {**_splice(media_id, a, b, spoken["id"]), "engine": engine}
