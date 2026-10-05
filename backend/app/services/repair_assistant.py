"""The comparison page's Automatic diagnosis row, after RX's Repair Assistant (see HASHOUT_LOG)."""

import numpy as np

from . import effects, media, tools

INTENSITIES = ("light", "medium", "heavy")
CLICKS_PER_MINUTE = 6.0
REVERB_SECONDS = 0.65


def _mono(media_id: str) -> tuple[np.ndarray, int]:
    view, _ = tools._wav_view(media_id)
    x = np.asarray(view, dtype=np.float64)
    return (x.mean(axis=1) if x.ndim == 2 else x), int(media.media_info(media_id)["sampleRate"])


def features(x: np.ndarray, rate: int) -> dict:
    hop = max(1, rate // 100)
    n = len(x) // hop
    if n < 50:
        return {"syllabic": 0.0, "flatness": 1.0, "onsetsPerSecond": 0.0, "pauses": 0.0}
    env = np.sqrt(np.mean(x[: n * hop].reshape(n, hop) ** 2, axis=1)) + 1e-9
    db = 20 * np.log10(env)
    spec = np.abs(np.fft.rfft(env - env.mean()))
    f = np.fft.rfftfreq(n, 0.01)
    syllabic = float(spec[(f >= 2) & (f <= 8)].sum() / (spec[(f >= 0.3) & (f <= 30)].sum() + 1e-12))
    rise = np.diff(db)
    onsets = int(np.sum((rise[1:] > 12) & (rise[:-1] <= 12)))
    win = 2048
    loud = 20 * np.log10(np.sqrt(np.mean(x**2)) + 1e-12)
    flat, peaky = [], []
    for i in range(0, len(x) - win, win):
        fr = x[i : i + win]
        if 20 * np.log10(np.sqrt(np.mean(fr**2)) + 1e-12) < loud - 20:
            continue
        m = np.abs(np.fft.rfft(fr * np.hanning(win)))[1:] ** 2 + 1e-18
        flat.append(float(np.exp(np.mean(np.log(m))) / np.mean(m)))
        peaky.append(float(np.sort(m)[-20:].sum() / m.sum()))
    return {
        "syllabic": round(syllabic, 3),
        "flatness": round(float(np.median(flat)) if flat else 1.0, 4),
        "peakiness": round(float(np.median(peaky)) if peaky else 0.0, 3),
        "onsetsPerSecond": round(onsets / (n / 100), 2),
        "pauses": round(float(np.mean(db < db.max() - 35)), 3),
    }


def material(feat: dict) -> str:
    if feat["onsetsPerSecond"] >= 2 and feat["flatness"] >= 0.1:
        return "percussive"
    if feat["syllabic"] >= 0.28:
        return "voice"
    if feat["peakiness"] >= 0.6:
        return "tonal"
    return "effects"


def clicks_per_minute(x: np.ndarray, rate: int) -> float:
    d = np.abs(np.diff(x))
    blk = max(8, int(rate * 0.02))
    n = len(d) // blk
    if n < 3:
        return 0.0
    b = d[: n * blk].reshape(n, blk)
    scale = np.maximum(np.median(b, axis=1), np.convolve(np.median(b, axis=1), np.ones(5) / 5, mode="same")) + 1e-6
    hits = np.flatnonzero((b > 12 * scale[:, None]).ravel())
    span = max(4, int(rate * 0.001))
    isolated = []
    for i in hits:
        around = np.concatenate([d[max(0, i - span) : max(0, i - 2)], d[i + 3 : i + span]])
        if not len(around) or around.max() < 0.25 * d[i]:
            isolated.append(i)
    if not isolated:
        return 0.0
    events = 1 + int(np.sum(np.diff(isolated) > int(rate * 0.002)))
    return events / (len(x) / rate / 60)


def _chain(found: dict, intensity: str, target: float) -> list[dict]:
    k = INTENSITIES.index(intensity)
    steps = []
    if "clipping" in found:
        steps.append({"effect": "de-clip", "params": {"threshold": (10, 8, 5)[k], "window": 55}})
    if "clicks" in found:
        steps.append({"effect": "click-removal", "params": {"threshold": (4, 2, 1.5)[k], "window": 55}})
    if "hum" in found:
        steps.append({"effect": "de-hum-adaptive", "params": {"mains": found["hum"]["mains"], "harmonics": (2, 4, 8)[k]}})
    if "noise" in found:
        steps.append({"effect": "denoise", "params": {"floor": float(np.clip(found["noise"]["floor"] + (-6, 0, 6)[k], -80, -20))}})
    if "reverb" in found:
        steps.append({"effect": "dereverb", "params": {"amount": (40, 70, 90)[k], "rt60": found["reverb"]["rt60"], "floor": 18}})
    if "level" in found:
        steps.append({"effect": "loudness-streaming", "params": {"target": target}})
    return steps


def analyse(media_id: str) -> dict:
    x, rate = _mono(media_id)
    feat = features(x, rate)
    kind = material(feat)
    mc = tools.mic_check(media_id)
    found: dict = {}
    if mc["clippedSamples"]:
        found["clipping"] = {"detail": f"{mc['clippedSamples']} samples at full scale"}
    cpm = clicks_per_minute(x, rate)
    if cpm >= CLICKS_PER_MINUTE:
        found["clicks"] = {"detail": f"about {cpm:.0f} clicks a minute"}
    hum = {int(k): v for k, v in (mc["humDb"] or {}).items() if v is not None}
    if hum and max(hum.values()) > (-30 if kind == "voice" else -20):
        mains = max(hum, key=hum.get)
        found["hum"] = {"detail": f"mains hum at {mains} Hz, {hum[mains]:.1f} dB against the signal", "mains": mains}
    noise = mc["noiseFloorDb"]
    if kind == "voice" and noise is not None and noise != float("-inf") and noise > (-30 if "hum" in found else -50):
        found["noise"] = {"detail": f"noise floor {noise:.1f} dB", "floor": float(noise)}
    rt60 = None
    if kind == "voice":
        y = x
        if "hum" in found:
            spec = np.fft.rfft(x)
            fy = np.fft.rfftfreq(len(x), 1 / rate)
            for h in range(1, 9):
                spec[np.abs(fy - h * found["hum"]["mains"]) < 3] = 0
            y = np.fft.irfft(spec, len(x))
        rt60 = round(float(effects._estimate_rt60(y, rate)), 2)
    if rt60 is not None and rt60 > REVERB_SECONDS:
        found["reverb"] = {"detail": f"room reverb about {rt60:.2f} s", "rt60": rt60}
    target = -16.0 if kind == "voice" else -14.0
    lufs = mc["lufs"]
    if lufs is not None and lufs != float("-inf") and abs(lufs - target) > 3:
        found["level"] = {"detail": f"{lufs:.1f} LUFS against {target:.0f}"}
    return {
        "material": kind,
        "features": feat,
        "measures": {"lufs": lufs, "clippedSamples": mc["clippedSamples"], "noiseFloorDb": noise, "humDb": hum, "clicksPerMinute": round(cpm, 1), "rt60": rt60},
        "findings": [{"problem": p, "detail": v["detail"]} for p, v in found.items()],
        "chains": {i: _chain(found, i, target) for i in INTENSITIES},
    }


def apply(media_id: str, intensity: str = "medium") -> dict:
    if intensity not in INTENSITIES:
        raise media.MediaError(f"intensity is one of {', '.join(INTENSITIES)}")
    report = analyse(media_id)
    steps = report["chains"][intensity]
    if not steps:
        raise media.MediaError("the assistant found nothing to repair")
    current = media_id
    for step in steps:
        current = effects.apply(current, step["effect"], step["params"])["id"]
    return {"media": media.media_info(current), "intensity": intensity, "steps": steps, "material": report["material"], "findings": report["findings"]}
