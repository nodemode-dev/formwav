"""RX-16: a dedicated dialogue model, DeepFilterNet3 (Hendrik Schroeter; MIT or Apache-2.0), run through the project's
own command-line build, deep-filter v0.5.6, so formwav's output is the reference's own (see HASHOUT_LOG)."""

import hashlib
import os
import platform
import shutil
import subprocess
import tempfile
import urllib.request
from pathlib import Path

import numpy as np

VERSION = "0.5.6"
RATE = 48000
ATTRIBUTION = "DeepFilterNet3 by Hendrik Schroeter (MIT or Apache-2.0)"
_ASSETS = {
    ("Darwin", "arm64"): ("aarch64-apple-darwin", "4601e7f4e4c03e59a4c5b5000216ef3add3e808799cfccd95e14e83ea4611081"),
    ("Darwin", "x86_64"): ("x86_64-apple-darwin", "d3be84003acb7c23e738ad7f70a158ec779a8d233a82e7fa3e717d112eb5b50f"),
    ("Windows", "AMD64"): ("x86_64-pc-windows-msvc.exe", "75e11fa16445f560cb6b021521ddb89e89270d13b83089705d98776f58fd7915"),
    ("Linux", "x86_64"): ("x86_64-unknown-linux-musl", "70775e251eee44c0f2451a1e833326cf8bcbbe304d3e7cd12851e6fce72ef7da"),
    ("Linux", "aarch64"): ("aarch64-unknown-linux-gnu", "14e02a1c0028f3ca0bdf83b62b3336e56ba0556894ef295a95e8573f06557166"),
}
_checked: Path | None = None


def binary() -> Path:
    """This platform's deep-filter: FORMWAV_DEEPFILTER when set, else the release build, fetched once into the models
    folder and checked against its pinned SHA-256."""
    global _checked
    given = os.environ.get("FORMWAV_DEEPFILTER")
    if given and Path(given).is_file():
        return Path(given)
    if _checked is not None and _checked.is_file():
        return _checked
    key = (platform.system(), platform.machine())
    if key not in _ASSETS:
        raise RuntimeError(f"no DeepFilterNet build for {key[0]} on {key[1]}")
    asset, sha = _ASSETS[key]
    root = Path(os.environ.get("FORMWAV_MODELS_ROOT", Path(__file__).resolve().parents[2] / "models")).expanduser()
    path = root / "deepfilter" / f"deep-filter-{VERSION}-{asset}"
    if not (path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == sha):
        url = f"https://github.com/Rikorose/DeepFilterNet/releases/download/v{VERSION}/deep-filter-{VERSION}-{asset}"
        data = urllib.request.urlopen(url, timeout=600).read()
        if hashlib.sha256(data).hexdigest() != sha:
            raise RuntimeError("the DeepFilterNet build downloaded does not match its checksum")
        path.parent.mkdir(parents=True, exist_ok=True)
        part = path.with_name(path.name + ".part")
        part.write_bytes(data)
        part.chmod(0o755)
        part.replace(path)
    _checked = path
    return path


def attenuation_limit(strength: float) -> float | None:
    """Strength in percent as the model's attenuation limit in dB (the original mixed back in, as RNNoise's mix was);
    None at 100 %, no limit."""
    if strength >= 100:
        return None
    return float(-20 * np.log10(max(1e-6, 1 - max(0.0, strength) / 100)))


def run_file(src: Path, out: Path, strength: float = 100) -> None:
    """The reference's own run on a 48 kHz WAV: its delay compensated (-D), the attenuation limited below 100 %."""
    args = [str(binary()), "-D"]
    limit = attenuation_limit(strength)
    if limit is not None:
        args += ["-a", f"{limit:.2f}"]
    with tempfile.TemporaryDirectory() as tmp:
        proc = subprocess.run([*args, "-o", tmp, str(src)], capture_output=True, text=True, timeout=3600)
        produced = Path(tmp) / src.name
        if proc.returncode != 0 or not produced.is_file():
            raise RuntimeError(f"DeepFilterNet failed: {(proc.stderr or proc.stdout).strip()[-200:]}")
        shutil.move(str(produced), str(out))


def isolate(x: np.ndarray, rate: int, strength: float = 100) -> np.ndarray:
    """Frames by channels in, the same out: through the model at 48 kHz (resampled there and back only when the clip
    is at another rate), its length kept."""
    from . import media
    from .audacity import _wav_bytes

    x = np.asarray(x, dtype=np.float32)
    frames, chans = x.shape
    ff = media._tool("ffmpeg")
    quiet = [ff, "-hide_banner", "-nostdin", "-loglevel", "error", "-y"]
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "in.wav"
        src.write_bytes(_wav_bytes([x[:, c] for c in range(chans)], rate))
        if rate != RATE:
            at48 = Path(tmp) / "in48.wav"
            subprocess.run([*quiet, "-i", str(src), "-ar", str(RATE), "-c:a", "pcm_f32le", str(at48)], check=True, timeout=600)
            src.unlink()
            at48.rename(src)
        out = Path(tmp) / "out.wav"
        run_file(src, out, strength)
        dec = subprocess.run([*quiet, "-i", str(out), "-ar", str(rate), "-ac", str(chans), "-f", "f32le", "-"], capture_output=True, check=True, timeout=600)
    y = np.frombuffer(dec.stdout, dtype="<f4").reshape(-1, chans)
    if len(y) < frames:
        y = np.pad(y, ((0, frames - len(y)), (0, 0)))
    return y[:frames].copy()
