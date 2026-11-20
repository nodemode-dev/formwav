import contextlib
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import numpy as np
import pytest

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
FIXTURES = Path(__file__).resolve().parent / "fixtures"
sys.path.insert(0, str(BACKEND))

for _paid in ("ELEVENLABS_API_KEY", "ELEVENLABS_BASE_URL", "FAL_KEY", "FAL_QUEUE_URL", "ANTHROPIC_API_KEY", "ACESTEP_API_URL", "ACESTEP_API_KEY"):
    os.environ.pop(_paid, None)

os.environ["PYTHON_KEYRING_BACKEND"] = "keyring.backends.fail.Keyring"

_OWN_DATA =None if "FORMWAV_DATA_DIR" in os.environ else tempfile.mkdtemp(prefix="formwav-tests-")
if _OWN_DATA:
    os.environ["FORMWAV_DATA_DIR"] = _OWN_DATA
    _runtime = BACKEND / "data" / "speech-runtime"
    if _runtime.is_dir():
        os.symlink(_runtime, Path(_OWN_DATA) / "speech-runtime", target_is_directory=True)

AGENT_STAND_INS = ("claude", "codex", "cursor-agent", "agy")
AGENT_SHELL = """#!/bin/sh
login=0; inter=0; script=""
while [ $# -gt 0 ]; do
  case "$1" in -l) login=1 ;; -i) inter=1 ;; -c) shift; script="$1" ;; esac
  shift
done
if [ "$login" = 1 ] && [ -f "$HOME/.zprofile-path" ]; then PATH="$(cat "$HOME/.zprofile-path"):$PATH"; fi
if [ "$inter" = 1 ] && [ -f "$HOME/.zshrc-path" ]; then PATH="$(cat "$HOME/.zshrc-path"):$PATH"; fi
export PATH
if [ -n "$script" ]; then exec /bin/sh -c "$script"; fi
exec /bin/sh
"""
_AGENTS = Path(tempfile.mkdtemp(prefix="formwav-agents-"))
AGENT_CALLS = _AGENTS / "agent-calls.log"
_agent_calls: list[str] = []
if os.name != "nt":
    for _name in ("bin", "shell", "home"):
        (_AGENTS / _name).mkdir()
    for _name in AGENT_STAND_INS:
        (_AGENTS / "bin" / _name).write_text(f'#!/bin/sh\necho "{_name} $*" >> "{AGENT_CALLS}"\nif [ "$1" = "--version" ]; then echo "0.0.0 (stand-in)"; exit 0; fi\nexit 1\n')
        (_AGENTS / "bin" / _name).chmod(0o755)
    (_AGENTS / "shell" / "zsh").write_text(AGENT_SHELL)
    (_AGENTS / "shell" / "zsh").chmod(0o755)
    os.environ["SHELL"] = str(_AGENTS / "shell" / "zsh")
    os.environ["PATH"] = os.pathsep.join([str(_AGENTS / "bin"), os.environ.get("PATH", "")])
    for _key in ("NPM_CONFIG_PREFIX", "npm_config_prefix", "PNPM_HOME", "VOLTA_HOME", "BUN_INSTALL", "NVM_SYMLINK"):
        os.environ.pop(_key, None)


@pytest.fixture(autouse=True)
def only_stand_in_agent_programs(monkeypatch):
    from app.services import agent_lookup, agent_programs, claude_code

    known = agent_lookup.folders
    monkeypatch.setattr(agent_lookup, "system_folders", lambda platform=None: [])
    monkeypatch.setattr(agent_lookup, "folders", lambda program, home=None, env=None, platform=None: known(program, _AGENTS / "home" if home is None or Path(home) == Path.home() else home, env, platform))
    monkeypatch.setitem(claude_code._info, "value", None)
    monkeypatch.setitem(agent_programs._status, "value", None)
    agent_lookup.forget()


def pytest_sessionfinish(session, exitstatus):
    try:
        _agent_calls.extend(AGENT_CALLS.read_text(encoding="utf-8").splitlines())
    except OSError:
        pass
    shutil.rmtree(_AGENTS, ignore_errors=True)
    if _OWN_DATA:
        shutil.rmtree(_OWN_DATA, ignore_errors=True)


def pytest_terminal_summary(terminalreporter):
    terminalreporter.write_line(f"agent program stand-ins started {len(_agent_calls)} time(s): " + (", ".join(sorted(set(_agent_calls))) or "none"))


needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg on the PATH")


def model(path: Path, install: str) -> Path:
    if not path.exists():
        pytest.skip(f"needs {path.relative_to(BACKEND)}: {install}")
    return path


def whisper(*names: str) -> None:
    import importlib.util

    from app.services import transcript

    if importlib.util.find_spec("faster_whisper") is None:
        pytest.skip("needs backend/requirements_transcript.txt for Whisper")
    for name in names or (transcript.DEFAULT_MODEL,):
        if not (transcript.MODELS_ROOT / f"models--Systran--faster-whisper-{name}").is_dir():
            pytest.skip(f"needs Whisper {name} in {transcript.MODELS_ROOT} (a transcript fetches it on first use)")


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from app.main import app

    from app.core import window_key

    return TestClient(app, base_url="http://127.0.0.1:8060", headers={"x-formwav-local": "1", window_key.HEADER: window_key.KEY})


@pytest.fixture(scope="session")
def bare(client):
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app, base_url="http://127.0.0.1:8060", headers={"x-formwav-local": "1"})


@pytest.fixture(scope="session")
def jfk_wav() -> bytes:
    return (FIXTURES / "jfk.wav").read_bytes()


@pytest.fixture(scope="session")
def speech_48k() -> np.ndarray:
    if shutil.which("ffmpeg") is None:
        pytest.skip("needs ffmpeg on the PATH")
    done = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-i", str(FIXTURES / "jfk.wav"), "-ar", "48000", "-ac", "1", "-f", "f32le", "-"], capture_output=True, check=True)
    return np.frombuffer(done.stdout, np.float32).copy()


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextlib.contextmanager
def serve_engine(log_name: str = "engine.log"):
    port = _free_port()
    env = {**os.environ, "FORMWAV_DIST": str(ROOT / "frontend" / "dist")}
    log = open(Path(os.environ["FORMWAV_DATA_DIR"]) / log_name, "wb")
    proc = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)], cwd=BACKEND, env=env, stdout=log, stderr=subprocess.STDOUT)
    url = f"http://127.0.0.1:{port}"
    deadline = time.monotonic() + 60
    while True:
        try:
            if urllib.request.urlopen(url + "/api/health", timeout=2).status == 200:
                break
        except OSError:
            pass
        if proc.poll() is not None or time.monotonic() > deadline:
            proc.kill()
            pytest.fail(f"the engine did not start on port {port}; its log is {log.name}")
        time.sleep(0.2)
    try:
        yield url
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        log.close()


@pytest.fixture(scope="session")
def engine_url():
    with serve_engine() as url:
        yield url
