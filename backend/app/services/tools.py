"""Generate and Analyze, after Audacity's generators and analyzers, iZotope RX's signal generator, waveform
statistics and spectrogram, and Audition's amplitude statistics (behavioural references only; no code taken)."""

from __future__ import annotations

import re
import subprocess
import tempfile
from pathlib import Path

from ..core.paths import media_dir
from . import media

#: The keypad's DTMF pairs (low Hz, high Hz), ITU-T Q.23.
DTMF = {
    "1": (697, 1209), "2": (697, 1336), "3": (697, 1477), "A": (697, 1633),
    "4": (770, 1209), "5": (770, 1336), "6": (770, 1477), "B": (770, 1633),
    "7": (852, 1209), "8": (852, 1336), "9": (852, 1477), "C": (852, 1633),
    "*": (941, 1209), "0": (941, 1336), "#": (941, 1477), "D": (941, 1633),
}
KINDS = {"tone": "Tone", "noise-white": "White noise", "noise-pink": "Pink noise", "noise-brown": "Brown noise", "silence": "Silence", "chirp": "Chirp", "dtmf": "DTMF", "bleep": "Bleep"}
DTMF_TONE, DTMF_GAP = 0.1, 0.05


def _run(cmd: list[str], out: Path) -> bytes:
    done = subprocess.run(cmd, capture_output=True, timeout=600)
    if done.returncode != 0 or not out.exists():
        raise media.MediaError(done.stderr.decode(errors="replace").strip()[-300:] or "ffmpeg failed")
    return out.read_bytes()


def generate(kind: str, seconds: float, rate: int, freq: float = 440.0, digits: str = "") -> dict:
    """Renders a generated signal (mono, 32-bit float at `rate`) into new media."""
    if kind not in KINDS:
        raise media.MediaError(f"no generator named {kind}")
    seconds = max(0.01, min(float(seconds), 3600.0))
    ffmpeg = media._tool("ffmpeg")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "generated.wav"
        head = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y"]
        tail = ["-ac", "1", "-ar", str(rate), "-c:a", "pcm_f32le", str(out)]
        if kind == "dtmf":
            keys = [k for k in (digits or "0123456789*#").upper() if k in DTMF]
            if not keys:
                raise media.MediaError("DTMF needs digits from 0 to 9, *, # or A to D")
            parts, labels = [], []
            for i, key in enumerate(keys):
                lo, hi = DTMF[key]
                parts.append(f"aevalsrc='0.25*sin(2*PI*{lo}*t)+0.25*sin(2*PI*{hi}*t)':s={rate}:d={DTMF_TONE}[t{i}]")
                parts.append(f"anullsrc=r={rate}:cl=mono,atrim=duration={DTMF_GAP}[g{i}]")
                labels.append(f"[t{i}][g{i}]")
            graph = ";".join(parts) + ";" + "".join(labels) + f"concat=n={2 * len(keys)}:v=0:a=1[out]"
            data = _run(head + ["-filter_complex", graph, "-map", "[out]"] + tail, out)
            name = f"DTMF {''.join(keys)}.wav"
        else:
            source = {
                "tone": f"sine=frequency={freq}:sample_rate={rate}:duration={seconds},volume=4",
                "bleep": f"sine=frequency=1000:sample_rate={rate}:duration={seconds},volume=4",
                "noise-white": f"anoisesrc=color=white:amplitude=0.25:sample_rate={rate}:duration={seconds}",
                "noise-pink": f"anoisesrc=color=pink:amplitude=0.25:sample_rate={rate}:duration={seconds}",
                "noise-brown": f"anoisesrc=color=brown:amplitude=0.25:sample_rate={rate}:duration={seconds}",
                "silence": f"anullsrc=r={rate}:cl=mono,atrim=duration={seconds}",
                "chirp": f"aevalsrc='0.5*sin(2*PI*(100*t+(8000-100)*t*t/(2*{seconds})))':s={rate}:d={seconds}",
            }[kind]
            data = _run(head + ["-f", "lavfi", "-i", source] + tail, out)
            detail = f" {freq:g} Hz" if kind == "tone" else ""
            name = f"{KINDS[kind]}{detail} {seconds:g} s.wav"
    return media.import_wav(name, data)


_STAT_KEYS = {
    "Peak level dB": "peakDb", "RMS level dB": "rmsDb", "DC offset": "dcOffset", "Crest factor": "crestFactor",
    "Dynamic range": "dynamicRangeDb", "Number of samples": "samples", "Peak count": "peakCount", "Flat factor": "flatFactor",
}


def stats(media_id: str) -> dict:
    """Waveform statistics over the whole file (ffmpeg astats, overall block)."""
    info = media.media_info(media_id)
    done = subprocess.run([media._tool("ffmpeg"), "-hide_banner", "-nostdin", "-i", str(media_dir() / f"{media_id}.wav"), "-af", "astats", "-f", "null", "-"],
                          capture_output=True, text=True, timeout=600)
    overall = done.stderr.split("Overall", 1)[-1] if "Overall" in done.stderr else ""
    result: dict = {}
    for line in overall.splitlines():
        m = re.search(r"\]\s*([A-Za-z ]+?):\s*(-?[0-9.]+|-?inf)", line)
        if m and m.group(1) in _STAT_KEYS:
            value = m.group(2)
            result[_STAT_KEYS[m.group(1)]] = float("-inf") if value == "-inf" else float(value)
    if not result:
        raise media.MediaError("could not read the file's statistics")
    peak = result.get("peakDb")
    result["clipped"] = peak is not None and peak >= -0.01
    if int(info.get("channels") or 0) == 2:
        result["phaseCorrelation"] = _phase_correlation(media_id)
    return result


def _phase_correlation(media_id: str) -> float | None:
    """Pearson correlation of the left and right channels over the whole file, -1 (opposed) to 1 (mono), read in chunks."""
    import numpy as np

    proc = subprocess.Popen([media._tool("ffmpeg"), "-hide_banner", "-nostdin", "-loglevel", "error", "-i", str(media_dir() / f"{media_id}.wav"), "-f", "f32le", "-"], stdout=subprocess.PIPE)
    ll = rr = lr = 0.0
    assert proc.stdout is not None
    while True:
        chunk = proc.stdout.read(1 << 22)
        if not chunk:
            break
        frames = np.frombuffer(chunk[: len(chunk) - len(chunk) % 8], dtype="<f4").reshape(-1, 2).astype(np.float64)
        ll += float(np.dot(frames[:, 0], frames[:, 0]))
        rr += float(np.dot(frames[:, 1], frames[:, 1]))
        lr += float(np.dot(frames[:, 0], frames[:, 1]))
    proc.wait(timeout=600)
    if ll <= 0 or rr <= 0:
        return None
    return round(lr / (ll * rr) ** 0.5, 4)


def _run_text(args: list[str]) -> str:
    done = subprocess.run([media._tool("ffmpeg"), "-hide_banner", "-nostdin", *args, "-f", "null", "-"], capture_output=True, text=True, timeout=900)
    return done.stderr


def _num(pattern: str, text: str) -> float | None:
    found = re.findall(pattern, text)
    return float(found[-1]) if found else None


def mic_check(media_id: str) -> dict:
    """Adobe Podcast's mic analysis and RX's Repair Assistant, as references: measurements of a recording and findings
    with the effect that addresses each. Loudness from ebur128, clipping from volumedetect's 0 dB bin, noise floor and
    DC offset from astats, mains hum from narrow 50 and 60 Hz bands against the whole signal."""
    info = media.media_info(media_id)
    src = str(media_dir() / f"{media_id}.wav")
    loud = _run_text(["-i", src, "-af", "ebur128"])
    lufs = _num(r"I:\s+(-?[0-9.]+|-inf) LUFS", loud)
    vol = _run_text(["-i", src, "-af", "volumedetect"])
    peak = _num(r"max_volume:\s+(-?[0-9.]+) dB", vol)
    clipped = int(_num(r"histogram_0db:\s+([0-9]+)", vol) or 0)
    st = stats(media_id)
    # The mains notches keep a steady hum from reading as the noise floor (it is reported as hum instead); one pass
    # left a -14 dB hum reading as -44 dB of noise, so each frequency is notched twice.
    one = "bandreject=f=50:width_type=q:w=4,bandreject=f=60:width_type=q:w=4,bandreject=f=100:width_type=q:w=4,bandreject=f=120:width_type=q:w=4"
    notch = f"{one},{one}"
    noise = _num(r"Noise floor dB:\s+(-?[0-9.]+|-inf)", _run_text(["-i", src, "-af", f"{notch},astats=measure_overall=Noise_floor:measure_perchannel=none"]))
    rms_all = st.get("rmsDb")
    hum = {}
    for f in (50, 60):
        band = stats_filtered(src, f"bandpass=f={f}:width_type=h:w=4")
        hum[f] = None if band is None or rms_all is None or rms_all == float("-inf") else round(band - rms_all, 1)
    dc = st.get("dcOffset") or 0.0
    findings: list[dict] = []
    if lufs is None or lufs == float("-inf"):
        findings.append({"level": "bad", "text": "The clip is silent.", "suggest": None})
    elif lufs < -30:
        findings.append({"level": "warn", "text": f"Quiet: {lufs:.1f} LUFS. Speech usually sits around -16 to -20 LUFS.", "suggest": "loudness-streaming"})
    elif lufs > -12:
        findings.append({"level": "warn", "text": f"Very loud: {lufs:.1f} LUFS.", "suggest": "loudness-streaming"})
    else:
        findings.append({"level": "ok", "text": f"Level: {lufs:.1f} LUFS.", "suggest": None})
    if clipped > 0:
        findings.append({"level": "bad", "text": f"Clipping: {clipped} samples at full scale.", "suggest": "de-clip"})
    elif peak is not None and peak > -1:
        findings.append({"level": "warn", "text": f"Peaks reach {peak:.1f} dBFS, close to clipping.", "suggest": "peak-limiter"})
    worst = max((v for v in hum.values() if v is not None), default=None)
    hum_found = worst is not None and worst > -30
    # Heuristic, stated: a strong hum leaves about -45 dB of residue in the noise-floor reading even after notching,
    # so with hum present background noise is reported only above -40 dB (without hum, above -50 dB).
    noise_limit = -40 if hum_found else -50
    if noise is not None and noise != float("-inf"):
        if noise > noise_limit:
            findings.append({"level": "warn", "text": f"Noisy background: noise floor {noise:.1f} dB.", "suggest": "voice-denoise"})
        else:
            findings.append({"level": "ok", "text": f"Quiet background: noise floor {noise:.1f} dB.", "suggest": None})
    if hum_found:
        mains = 50 if (hum[50] or -999) >= (hum[60] or -999) else 60
        findings.append({"level": "warn", "text": f"Mains hum at {mains} Hz: {worst:.1f} dB against the whole signal.", "suggest": "hum-remover"})
    if abs(dc) > 0.001:
        findings.append({"level": "warn", "text": f"DC offset {dc:.4f}.", "suggest": "dc-offset"})
    return {"name": info["name"], "lufs": lufs, "peakDb": peak, "clippedSamples": clipped, "noiseFloorDb": noise, "humDb": hum, "dcOffset": dc, "findings": findings}


def stats_filtered(src: str, chain: str) -> float | None:
    """RMS level in dB of the file through a filter chain (astats overall)."""
    text = _run_text(["-i", src, "-af", f"{chain},astats=measure_perchannel=none"])
    return _num(r"RMS level dB:\s+(-?[0-9.]+)", text)


def spectrogram_png(media_id: str, width: int = 640, height: int = 240, legend: bool = True) -> bytes:
    """A spectrogram of the whole file, time left to right and frequency upwards (ffmpeg showspectrumpic); without the
    legend the image is the bare plot, so its width maps to the file's length exactly."""
    media.media_info(media_id)
    width, height = max(64, min(int(width), 8192)), max(32, min(int(height), 1024))
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "spectrogram.png"
        return _run([media._tool("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", str(media_dir() / f"{media_id}.wav"),
                     "-lavfi", f"showspectrumpic=s={width}x{height}:legend={1 if legend else 0}:color=intensity:scale=log", "-frames:v", "1", str(out)], out)


def excerpt(media_id: str, start: float, end: float) -> dict:
    """The part of a media file between `start` and `end` (its own seconds) as new media, sample-exact via atrim."""
    info = media.media_info(media_id)
    rate = int(info["sampleRate"])
    length = int(info["frames"]) / rate
    start, end = max(0.0, float(start)), min(length, float(end))
    if end - start < 0.01:
        raise media.MediaError("the excerpt is empty; choose a range inside the file")
    a, b = round(start * rate), round(end * rate)
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "excerpt.wav"
        data = _run([media._tool("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", str(media_dir() / f"{media_id}.wav"),
                     "-af", f"atrim=start_sample={a}:end_sample={b}", "-c:a", "pcm_f32le", str(out)], out)
    stem = str(info["name"]).rsplit(".", 1)[0]
    return media.import_wav(f"{stem} (clip {start:.2f} to {end:.2f} s).wav", data)
