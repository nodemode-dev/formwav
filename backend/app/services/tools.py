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
    media.media_info(media_id)
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
    return result


def spectrogram_png(media_id: str, width: int = 640, height: int = 240) -> bytes:
    """A spectrogram of the whole file, time left to right and frequency upwards (ffmpeg showspectrumpic)."""
    media.media_info(media_id)
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "spectrogram.png"
        return _run([media._tool("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", str(media_dir() / f"{media_id}.wav"),
                     "-lavfi", f"showspectrumpic=s={width}x{height}:legend=1:color=intensity:scale=log", "-frames:v", "1", str(out)], out)
