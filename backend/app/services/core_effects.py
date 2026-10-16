"""PLAN_v13 S14: any realtime chain rendered into new media through the audio core (formwav_dsp.process_chain), each
stage built as an export builds it (render._stage), so audio rendered with a live effect sounds as the effect played
live. The live kinds and the core's processors join the effect catalogue as one group (ids live:<kind> and
live:processor:<id>), and a whole chain renders through render_chain."""

from __future__ import annotations

import json

from . import media, render

LIVE: list[tuple[str, str, list[tuple[str, str, float, float, float, str]]]] = [
    ("highpass", "High-pass", [("freq", "Frequency", 20, 20000, 1000, "Hz"), ("q", "Q", 0.1, 10, 0.707, "")]),
    ("lowpass", "Low-pass", [("freq", "Frequency", 20, 20000, 1000, "Hz"), ("q", "Q", 0.1, 10, 0.707, "")]),
    ("peak", "Bell", [("freq", "Frequency", 20, 20000, 1000, "Hz"), ("gainDb", "Gain", -24, 24, 0, "dB"), ("q", "Q", 0.1, 10, 0.707, "")]),
    ("lowshelf", "Low shelf", [("freq", "Frequency", 20, 20000, 1000, "Hz"), ("gainDb", "Gain", -24, 24, 0, "dB"), ("q", "Q", 0.1, 10, 0.707, "")]),
    ("highshelf", "High shelf", [("freq", "Frequency", 20, 20000, 1000, "Hz"), ("gainDb", "Gain", -24, 24, 0, "dB"), ("q", "Q", 0.1, 10, 0.707, "")]),
    ("compressor", "Compressor", [("thresholdDb", "Threshold", -60, 0, -20, "dB"), ("ratio", "Ratio", 1, 20, 4, ":1"), ("attackMs", "Attack", 0.1, 200, 10, "ms"), ("releaseMs", "Release", 5, 2000, 150, "ms"), ("makeupDb", "Makeup", 0, 24, 0, "dB")]),
    ("denoise", "Denoise", [("reductionDb", "Reduction", 0, 40, 12, "dB"), ("sensitivityDb", "Sensitivity", -10, 20, 3, "dB")]),
    ("reverb", "Reverb", [("room", "Room", 0, 1, 0.6, ""), ("damping", "Damping", 0, 1, 0.5, ""), ("mix", "Mix", 0, 1, 0.25, ""), ("width", "Width", 0, 1, 1, "")]),
    ("echo", "Echo", [("delayMs", "Delay", 1, 2000, 300, "ms"), ("feedback", "Feedback", 0, 0.95, 0.35, ""), ("mix", "Mix", 0, 1, 0.4, "")]),
    ("chorus", "Chorus", [("rateHz", "Rate", 0.05, 10, 0.8, "Hz"), ("depthMs", "Depth", 0, 20, 3, "ms"), ("mix", "Mix", 0, 1, 0.5, "")]),
    ("limiter", "Limiter", [("ceilingDb", "Ceiling", -24, 0, -1, "dB"), ("releaseMs", "Release", 1, 1000, 80, "ms")]),
    ("tremolo", "Tremolo", [("rateHz", "Rate", 0.1, 20, 4, "Hz"), ("depth", "Depth", 0, 1, 0.5, ""), ("spread", "Spread", 0, 1, 0, "")]),
    ("gate", "Gate", [("thresholdDb", "Threshold", -80, 0, -40, "dB"), ("releaseMs", "Release", 5, 2000, 100, "ms"), ("rangeDb", "Range", -90, 0, -60, "dB")]),
    ("phaser", "Phaser", [("rateHz", "Rate", 0.05, 10, 0.5, "Hz"), ("depth", "Depth", 0, 1, 1, ""), ("feedback", "Feedback", 0, 0.95, 0.5, "")]),
    ("flanger", "Flanger", [("rateHz", "Rate", 0.05, 10, 0.25, "Hz"), ("depthMs", "Depth", 0, 10, 3, "ms"), ("feedback", "Feedback", 0, 0.95, 0.5, "")]),
    ("voice", "Dialogue isolate", [("strength", "Strength", 0, 1, 1, "")]),
    ("dehum", "De-hum", [("baseHz", "Hum", 40, 70, 60, "Hz"), ("harmonics", "Harmonics", 1, 16, 8, ""), ("q", "Q", 5, 100, 30, "")]),
    ("declick", "De-click", [("sensitivity", "Sensitivity", 1, 30, 8, ""), ("maxMs", "Longest click", 0.1, 10, 1, "ms")]),
    ("dereverb", "De-reverb", [("t60", "Reverb time", 0.1, 5, 0.8, "s"), ("reductionDb", "Reduction", 0, 30, 6, "dB")]),
]


def _control(pid: str, label: str, lo: float, hi: float, default: float, unit: str) -> dict:
    return {"id": pid, "label": label, "min": lo, "max": hi, "default": default, "unit": unit}


def _processors() -> list[dict]:
    try:
        return json.loads(media._require_core().processors())
    except media.CoreMissing:
        return []


def catalogue_group() -> list[dict]:
    """The "Live effects, rendered" group of the effect catalogue: every live kind and processor, each with its
    controls at their live defaults."""
    effects = [{"id": f"live:{kind}", "label": f"{label} (live)", "params": [_control(*c) for c in controls], "retimes": False, "learnsNoise": False} for kind, label, controls in LIVE]
    for p in _processors():
        params = [_control(q["id"], q["name"], q["min"], q["max"], q["default"], "" if q.get("unit") in (None, "None", "Choice") else str(q["unit"])) for q in p.get("params", [])]
        effects.append({"id": f"live:processor:{p['id']}", "label": f"{p['name']} (live)", "params": params, "retimes": False, "learnsNoise": False})
    return [{"group": "Live effects, rendered", "effects": effects}]


def entry(name: str, params: dict | None) -> dict:
    """The live effect `name` (live:<kind> or live:processor:<id>) as a track's effect entry with `params`, a missing
    one at its default."""
    given = {k: float(v) for k, v in (params or {}).items() if isinstance(v, (int, float)) and not isinstance(v, bool)}
    if name.startswith("live:processor:"):
        pid = name.removeprefix("live:processor:")
        spec = next((p for p in _processors() if p["id"] == pid), None)
        if spec is None:
            raise media.MediaError(f"no processor named {pid}")
        return {"kind": "processor", "id": pid, "values": {q["id"]: given.get(q["id"], q["default"]) for q in spec.get("params", [])}}
    kind = name.removeprefix("live:")
    known = next((controls for k, _, controls in LIVE if k == kind), None)
    if known is None:
        raise media.MediaError(f"no live effect named {kind}")
    return {"kind": kind, **{c[0]: given.get(c[0], c[4]) for c in known}}


def render_chain(media_id: str, chain: list[dict], label: str) -> dict:
    """The whole file through `chain` (track effect entries in order, bypassed ones left out) as new stereo media of
    the same length, the chain's latency taken out."""
    import numpy as np

    from .audacity import _wav_bytes
    from .tools import _wav_view

    stages, processors = [], []
    for f in chain:
        s = render._stage(f)
        if s is None:
            continue
        if s[0] == 20:
            processors.append(s[1])
            s = (20, float(len(processors) - 1), 0.0, 0.0, 0.0, 0.0)
        stages.append(tuple(float(v) if i else int(v) for i, v in enumerate(s)))
    if not stages:
        raise media.MediaError("there is no live effect to render")
    view, rate = _wav_view(media_id)
    arr = np.asarray(view)
    x = np.ascontiguousarray(arr.astype("<f4") / 32768.0 if arr.dtype.kind == "i" else arr.astype("<f4"))
    if x.ndim == 1:
        x = x[:, None]
    try:
        raw = media._require_core().process_chain(x.tobytes(), int(x.shape[1]), float(rate), stages, processors)
    except ValueError as err:
        raise media.MediaError(str(err)) from err
    out = np.frombuffer(raw, dtype="<f4").reshape(-1, 2)
    stem = str(media.media_info(media_id)["name"]).rsplit(".", 1)[0]
    return media.import_wav(f"{stem} ({label}).wav", _wav_bytes([out[:, 0].copy(), out[:, 1].copy()], int(rate)))


def apply(media_id: str, name: str, params: dict | None) -> dict:
    """One live effect rendered over a stored media file (the effect catalogue's live:<kind> and live:processor:<id>)."""
    label = next((lbl for k, lbl, _ in LIVE if name == f"live:{k}"), None) or name.removeprefix("live:processor:")
    return render_chain(media_id, [entry(name, params)], label)
