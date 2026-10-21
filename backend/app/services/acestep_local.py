"""ACE-Step 1.5 on this machine without a GPU server (PLAN_v12 R6, R7): acestep.cpp (MIT, a native C++ implementation
on ggml of ACE-Step 1.5 by ACE Studio and StepFun, github.com/ServeurpersoCom/acestep.cpp) runs community GGUF weights of
ACE-Step's own (MIT, huggingface.co/Serveurperso/ACE-Step-1.5-GGUF) on the CPU, Metal or a GPU, in the memory of a
laptop: one module at a time is resident (its default), so the 2B DiT at Q4_K_M peaks near 2 to 3 GB.

Installed on request: its source at a pinned commit (with its ggml at the commit the source pins), built here with
CMake and the machine's C++ compiler into ace-server alone (macOS turns on Metal and Accelerate by itself), and five GGUF
files at a pinned revision, each checked by SHA-256: the VAE, the Qwen3 text encoder, the 0.6B LM, the turbo DiT (songs,
covers, repaints) and the base DiT (a layer added, a part extracted, a clip completed; turbo cannot). formwav starts
ace-server on 127.0.0.1 at a free port when the first task needs it and stops it with the engine.

The tasks are services/acestep.py's (that module hands them here when this is installed and no ACE-Step server address
is set), through ace-server's job API: POST /lm (lyrics, metadata and audio codes from the caption) where the LM has a
part, then POST /synth (JSON, or multipart with the clip as `audio`), each polled at GET /job?id=N and fetched with
&result=1; a synth result is multipart/mixed, its first audio part the track.
"""

import atexit
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

from . import media, tiger_dnr
from .providers import ProviderError, _http, _multipart

REPO = "https://github.com/ServeurpersoCom/acestep.cpp.git"
COMMIT = "de858d8e1a94f0e1939cf9bdd8ff7d9631953077"
WEIGHTS_REPO = "Serveurperso/ACE-Step-1.5-GGUF"
REVISION = "666ac70204440867d8c01ba4b119cc79c95b370a"
WEIGHTS = {
    "vae-BF16.gguf": "0599862ac5d15cd308e1d2e368373aea6c02e25ebd1737ad4a4562a0901b0ef8",
    "Qwen3-Embedding-0.6B-Q8_0.gguf": "972f23255e46adfe744a0eb9a0039f3c63988f65753b0968d776e8b27168c321",
    "acestep-5Hz-lm-0.6B-Q8_0.gguf": "bdaf9e292d4470f31c19cafeaca1b74936a114667e3a85e5d33b65247e9908ec",
    "acestep-v15-turbo-Q4_K_M.gguf": "55b4d8514850f3d0f82536f37e99673aaf48df802b5ae5b153eea32a2e2daa5e",
    "acestep-v15-base-Q4_K_M.gguf": "942ec6a7bc11a40809af5f337063f2af2acc63e4fcd4a92b0cb42dc2bc7c41e8",
}
# named with their .gguf, as ace-server's registry knows them (a name without it is "not found", whatever the docs say)
LM, TURBO, BASE = "acestep-5Hz-lm-0.6B-Q8_0.gguf", "acestep-v15-turbo-Q4_K_M.gguf", "acestep-v15-base-Q4_K_M.gguf"
TRACKS = ("backing_vocals", "vocals", "drums", "bass", "guitar", "keyboard", "percussion", "strings", "synth", "fx", "brass", "woodwinds")
INFO = {"id": "acestep", "name": "Songs and music editing (ACE-Step)", "license": "MIT (ACE-Step 1.5's weights; acestep.cpp)", "clones": False,
        "size": "built here with CMake and a C++ compiler, and 4.7 GB of weights"}
_state = {"installing": ""}
_server: dict = {"process": None, "port": 0}
_lock = threading.Lock()
_known: dict[str, bool] = {}


def _folder() -> Path:
    return Path(__file__).resolve().parents[2] / "models" / "acestep-cpp"


def _binary() -> Path:
    build = _folder() / "src" / "build"
    found = [p for p in (build / "ace-server", build / "Release" / "ace-server.exe", build / "ace-server.exe") if p.exists()]
    return found[0] if found else build / "ace-server"


def installed() -> bool:
    if "acestep" not in _known:
        _known["acestep"] = _binary().exists() and all((_folder() / "models" / n).exists() for n in WEIGHTS)
    return _known["acestep"]


def status() -> dict:
    return {**INFO, "installed": installed(), "installing": _state["installing"]}


def _missing_tools() -> list[str]:
    need = {"git": "git", "cmake": "CMake"}
    out = [label for exe, label in need.items() if not shutil.which(exe)]
    if sys.platform != "win32" and not (shutil.which("c++") or shutil.which("g++") or shutil.which("clang++")):
        out.append("a C++ compiler (on a Mac: xcode-select --install)")
    return out


def install() -> dict:
    """acestep.cpp built here, then its weights, in the background."""
    if _state["installing"].startswith("installing"):
        return {"installing": _state["installing"]}
    missing = _missing_tools()
    if missing:
        raise ProviderError(409, f"building ACE-Step on this machine needs {', '.join(missing)}")

    def run(step: list[str], cwd: Path, timeout: float = 3600) -> None:
        done = subprocess.run(step, cwd=str(cwd), capture_output=True, timeout=timeout)
        if done.returncode != 0:
            tail = (done.stderr or done.stdout or b"").decode(errors="replace").strip().splitlines()
            raise RuntimeError(f"{' '.join(step[:3])}: {tail[-1][:300] if tail else done.returncode}")

    def work() -> None:
        try:
            src = _folder() / "src"
            if not _binary().exists():
                _state["installing"] = "installing: acestep.cpp's source"
                if src.exists():
                    shutil.rmtree(src)
                src.mkdir(parents=True)
                for step in (["git", "init", "-q"], ["git", "remote", "add", "origin", REPO], ["git", "fetch", "-q", "--depth", "1", "origin", COMMIT],
                             ["git", "checkout", "-q", "FETCH_HEAD"], ["git", "submodule", "update", "--init", "--depth", "1", "-q"]):
                    run(step, src, 1800)
                _state["installing"] = "installing: building acestep.cpp (several minutes)"
                run(["cmake", "-S", ".", "-B", "build", "-DCMAKE_BUILD_TYPE=Release"], src)
                run(["cmake", "--build", "build", "--config", "Release", "--target", "ace-server", "-j", str(max(1, os.cpu_count() or 1))], src, 7200)
            for name, sha in WEIGHTS.items():
                target = _folder() / "models" / name
                if not target.exists() or tiger_dnr._sha(target) != sha:
                    _state["installing"] = f"installing: {name}"
                    tiger_dnr._fetch(f"https://huggingface.co/{WEIGHTS_REPO}/resolve/{REVISION}/{name}", target, sha)
            _known.pop("acestep", None)
            _state["installing"] = ""
        except Exception as err:  # noqa: BLE001 - shown to the person as the install's outcome
            _state["installing"] = f"failed: {err}"

    _state["installing"] = "installing"
    threading.Thread(target=work, name="formwav-install-acestep", daemon=True).start()
    return {"installing": _state["installing"]}


def _url() -> str:
    """ace-server's address, started on first use and kept for the engine's life."""
    with _lock:
        proc = _server["process"]
        if proc is not None and proc.poll() is None:
            return f"http://127.0.0.1:{_server['port']}"
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        log = open(_folder() / "server.log", "ab")  # noqa: SIM115 - held open by the server process
        proc = subprocess.Popen([str(_binary()), "--models", str(_folder() / "models"), "--host", "127.0.0.1", "--port", str(port)], stdout=log, stderr=log, stdin=subprocess.DEVNULL)
        _server.update(process=proc, port=port)
    base = f"http://127.0.0.1:{port}"
    for _ in range(120):
        if proc.poll() is not None:
            raise ProviderError(502, f"ACE-Step's server stopped as it started (see {_folder() / 'server.log'})")
        try:
            with urllib.request.urlopen(base + "/health", timeout=2) as res:
                if res.status == 200:
                    return base
        except OSError:
            time.sleep(0.5)
    raise ProviderError(504, "ACE-Step's server did not answer within a minute")


def _stop() -> None:
    proc = _server.get("process")
    if proc is not None and proc.poll() is None:
        proc.terminate()


atexit.register(_stop)


def _job(base: str, kind: str, body: bytes, ctype: str, max_wait_s: float) -> tuple[bytes, str]:
    code, raw, _ = _http("POST", f"{base}/{kind}", {"Content-Type": ctype}, body, timeout=600)
    if code >= 400:
        raise ProviderError(502, f"ACE-Step refused the {kind} step ({code}): {raw[:300].decode(errors='replace')}")
    job = json.loads(raw).get("id")
    deadline = time.time() + max_wait_s
    while time.time() < deadline:
        code, raw, _ = _http("GET", f"{base}/job?id={job}", {}, None, timeout=60)
        state = json.loads(raw).get("status") if code < 400 else "failed"
        if state == "done":
            req = urllib.request.Request(f"{base}/job?id={job}&result=1")
            with urllib.request.urlopen(req, timeout=600) as res:
                return res.read(), res.headers.get("Content-Type", "")
        if state in ("failed", "cancelled"):
            raise ProviderError(502, f"ACE-Step's {kind} step {state} (see {_folder() / 'server.log'})")
        time.sleep(2)
    raise ProviderError(504, f"ACE-Step had not finished after {int(max_wait_s / 60)} minutes")


def _first_audio(body: bytes, ctype: str) -> bytes:
    """The first audio part of a multipart/mixed synth result."""
    found = re.search(r'boundary="?([^";]+)"?', ctype)
    if not found:
        raise ProviderError(502, "ACE-Step's result had no parts")
    for part in body.split(b"--" + found.group(1).encode()):
        head, sep, data = part.partition(b"\r\n\r\n")
        if sep and b"audio/" in head.lower():
            return data[:-2] if data.endswith(b"\r\n") else data
    raise ProviderError(502, "ACE-Step's result had no audio")


def track_from(prompt: str) -> str:
    """The part named in a prompt (bass, drums, strings...): what lego, extract and complete need."""
    words = prompt.lower().replace("-", " ").replace("backing vocals", "backing_vocals")
    aliases = {"keys": "keyboard", "piano": "keyboard", "vocal": "vocals", "voice": "vocals", "drum": "drums", "string": "strings", "horns": "brass", "sax": "woodwinds", "flute": "woodwinds"}
    for word in re.findall(r"[a-z_]+", words):
        if word in TRACKS:
            return word
        if word in aliases:
            return aliases[word]
    return ""


def generate(task: str, prompt: str = "", lyrics: str = "", seconds: float | None = None, media_id: str = "", repaint_start: float | None = None,
             repaint_end: float | None = None, strength: float | None = None, bpm: int | None = None, key: str = "", seed: int = -1, max_wait_s: float = 3600) -> dict:
    if not installed():
        raise ProviderError(409, f"ACE-Step is not installed on this machine yet ({INFO['size']}): install it first (Install a model on this machine)")
    track = track_from(prompt) if task in ("lego", "extract", "complete") else ""
    if task in ("lego", "extract", "complete") and not track:
        raise ProviderError(422, f"name the part in the prompt: one of {', '.join(t.replace('_', ' ') for t in TRACKS)}")
    # The description is kept as the person wrote it (the LM otherwise rewrites it: asked for female vocals, its rewrite
    # added a male one); lyrics in plain English are said to be, as the LM guessed Tamil for them once
    req: dict = {"caption": prompt.strip() or task, "task_type": task, "seed": int(seed), "output_format": "wav16", "use_cot_caption": False,
                 "synth_model": BASE if task in ("lego", "extract", "complete") else TURBO, "lm_model": LM}
    if lyrics.strip() and lyrics.isascii() and re.search(r"[A-Za-z]", lyrics):
        req["vocal_language"] = "en"
    req["lyrics"] = lyrics.strip() or ("" if task == "text2music" and not prompt.strip() else "[Instrumental]")
    if task == "text2music" and not lyrics.strip():
        req["lyrics"] = "[Instrumental]"
    if seconds and task == "text2music":
        req["duration"] = max(10.0, min(600.0, float(seconds)))
    if bpm:
        req["bpm"] = max(30, min(300, int(bpm)))
    if key.strip():
        req["keyscale"] = key.strip()
    if track:
        req["track"] = track
    if task == "repaint":
        start = max(0.0, float(repaint_start or 0))
        req["repainting_start"] = start
        req["repainting_end"] = float(repaint_end) if repaint_end is not None and float(repaint_end) > start else -1
    if task == "cover" and strength is not None:
        req["audio_cover_strength"] = max(0.0, min(1.0, float(strength)))
    base = _url()
    if task in ("text2music", "lego", "complete"):
        raw, _ = _job(base, "lm", json.dumps(req).encode(), "application/json", max_wait_s)
        filled = json.loads(raw)
        req = {**req, **(filled[0] if isinstance(filled, list) and filled else {})}
    if task == "text2music":
        audio_body, ctype = json.dumps(req).encode(), "application/json"
    else:
        info = media.media_info(media_id)
        src = (str(info.get("name") or "clip").rsplit(".", 1)[0] + ".wav", (media.media_dir() / f"{media_id}.wav").read_bytes(), "audio/wav")
        audio_body, ctype = _multipart({}, {"request": ("request.json", json.dumps(req).encode(), "application/json"), "audio": src})
    raw, rtype = _job(base, "synth", audio_body, ctype, max_wait_s)
    label = {"text2music": "Song", "cover": "Cover", "repaint": "Repainted", "lego": f"With {track.replace('_', ' ')}", "extract": f"{track.replace('_', ' ').capitalize()} extracted", "complete": "Completed"}[task]
    return media.import_audio(f"{label} (ACE-Step, this machine) - {(prompt or task)[:40].strip()}.wav", _first_audio(raw, rtype))
