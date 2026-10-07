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

_OWN_DATA = None if "FORMWAV_DATA_DIR" in os.environ else tempfile.mkdtemp(prefix="formwav-tests-")
if _OWN_DATA:
    os.environ["FORMWAV_DATA_DIR"] = _OWN_DATA
    _runtime = BACKEND / "data" / "speech-runtime"
    if _runtime.is_dir():
        os.symlink(_runtime, Path(_OWN_DATA) / "speech-runtime", target_is_directory=True)


def pytest_sessionfinish(session, exitstatus):
    if _OWN_DATA:
        shutil.rmtree(_OWN_DATA, ignore_errors=True)


needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg on the PATH")


def model(path: Path, install: str) -> Path:
    if not path.exists():
        pytest.skip(f"needs {path.relative_to(BACKEND)}: {install}")
    return path


@pytest.fixture(scope="session")
def client():
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


@pytest.fixture(scope="session")
def engine_url():
    port = _free_port()
    env = {**os.environ, "FORMWAV_DIST": str(ROOT / "frontend" / "dist")}
    log = open(Path(os.environ["FORMWAV_DATA_DIR"]) / "engine.log", "wb")
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
    yield url
    proc.terminate()
    try:
        proc.wait(10)
    except subprocess.TimeoutExpired:
        proc.kill()
    log.close()
