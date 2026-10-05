"""AP-08: a learned assessment of a recording's speech, background and overall quality, DNSMOS P.835 (Microsoft's
DNS Challenge, CC BY 4.0), scored as its reference script (dnsmos_local.py) scores it (see HASHOUT_LOG)."""

import hashlib
import os
import urllib.request
from pathlib import Path

import numpy as np

URL = "https://raw.githubusercontent.com/microsoft/DNS-Challenge/master/DNSMOS/DNSMOS/sig_bak_ovr.onnx"
SHA256 = "269fbebdb513aa23cddfbb593542ecc540284a91849ac50516870e1ac78f6edd"
RATE = 16000
INPUT_LENGTH = 9.01
P_SIG = np.poly1d([-0.08397278, 1.22083953, 0.0052439])
P_BAK = np.poly1d([-0.13166888, 1.60915514, -0.39604546])
P_OVR = np.poly1d([-0.06766283, 1.11546468, 0.04602535])
ATTRIBUTION = "DNSMOS P.835, Microsoft DNS Challenge (CC BY 4.0)"

_session = None


def model_path() -> Path:
    root = Path(os.environ.get("FORMWAV_MODELS_ROOT", Path(__file__).resolve().parents[2] / "models")).expanduser()
    return root / "dnsmos" / "sig_bak_ovr.onnx"


def _ensure_model() -> Path:
    path = model_path()
    if path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == SHA256:
        return path
    data = urllib.request.urlopen(URL, timeout=60).read()
    if hashlib.sha256(data).hexdigest() != SHA256:
        raise RuntimeError("the DNSMOS model downloaded does not match its checksum")
    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_suffix(".part")
    part.write_bytes(data)
    part.replace(path)
    return path


def score(audio: np.ndarray) -> dict:
    """Speech (SIG), background (BAK) and overall (OVRL) scores from 1 to 5 for mono audio at 16 kHz."""
    global _session
    if _session is None:
        import onnxruntime as ort

        _session = ort.InferenceSession(str(_ensure_model()), providers=["CPUExecutionProvider"])
    audio = np.asarray(audio, dtype=np.float64).reshape(-1)
    actual = len(audio)
    if actual == 0:
        raise ValueError("no audio to assess")
    need = int(INPUT_LENGTH * RATE)
    while len(audio) < need:
        audio = np.append(audio, audio)
    hops = int(np.floor(len(audio) / RATE) - INPUT_LENGTH) + 1
    sig, bak, ovr = [], [], []
    for i in range(hops):
        seg = audio[int(i * RATE) : int((i + INPUT_LENGTH) * RATE)]
        if len(seg) < need:
            continue
        s, b, o = _session.run(None, {"input_1": seg.astype("float32")[np.newaxis, :]})[0][0]
        sig.append(P_SIG(s))
        bak.append(P_BAK(b))
        ovr.append(P_OVR(o))
    return {"sig": float(np.mean(sig)), "bak": float(np.mean(bak)), "ovrl": float(np.mean(ovr)), "seconds": round(actual / RATE, 2), "windows": hops}
