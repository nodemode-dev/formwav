"""EQ match (iZotope RX's EQ Match, as a reference): give a clip the tonal balance of a reference selection. Both are
measured as average power spectra in 30 third-octave bands from 25 Hz; the curve is the reference minus the target per
band, centred on its median so the balance moves and the loudness does not, clamped to 18 dB either way, and left at 0
where either side has nothing (or the band is past either file's Nyquist). The curve is rendered with firequalizer,
which interpolates between the band entries, into new media; the source is kept."""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

import numpy as np

from ..core.paths import media_dir
from . import media

CENTERS = [25 * 2 ** (i / 3) for i in range(30)]
FRAME = 8192


def _mono(media_id: str, start: float | None = None, end: float | None = None) -> tuple[np.ndarray, int]:
    info = media.media_info(media_id)
    rate = int(info["sampleRate"])
    cmd = [media._tool("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin"]
    if start is not None and start > 0:
        cmd += ["-ss", f"{start:.6f}"]
    if end is not None and end > (start or 0):
        cmd += ["-t", f"{end - (start or 0):.6f}"]
    cmd += ["-i", str(media_dir() / f"{media_id}.wav"), "-ac", "1", "-f", "f32le", "-"]
    done = subprocess.run(cmd, capture_output=True, timeout=300)
    if done.returncode != 0:
        raise media.MediaError(f"could not read the audio: {done.stderr.decode(errors='replace').strip()[-200:]}")
    return np.frombuffer(done.stdout, dtype="<f4"), rate


def bands(x: np.ndarray, rate: int) -> np.ndarray:
    """Average power in each third-octave band (Welch: Hann frames of 8192, half overlap)."""
    if len(x) < FRAME:
        x = np.pad(x, (0, FRAME - len(x)))
    window = np.hanning(FRAME)
    power = np.zeros(FRAME // 2 + 1)
    count = 0
    for i in range(0, len(x) - FRAME + 1, FRAME // 2):
        power += np.abs(np.fft.rfft(x[i : i + FRAME] * window)) ** 2
        count += 1
    power /= max(count, 1)
    freqs = np.fft.rfftfreq(FRAME, 1 / rate)
    out = np.zeros(len(CENTERS))
    for k, c in enumerate(CENTERS):
        sel = (freqs >= c / 2 ** (1 / 6)) & (freqs < c * 2 ** (1 / 6))
        if sel.any():
            out[k] = power[sel].mean()
    return out


def curve(target: np.ndarray, reference: np.ndarray, nyquist: float) -> np.ndarray:
    centers = np.array(CENTERS)
    usable = (target > target.max() * 1e-7) & (reference > reference.max() * 1e-7) & (centers < nyquist * 0.95)
    if usable.sum() < 3:
        raise media.MediaError("the two share too little of the spectrum to match")
    gain = np.zeros(len(CENTERS))
    gain[usable] = 10 * np.log10(reference[usable] / target[usable])
    gain[usable] -= np.median(gain[usable])
    return np.clip(gain, -18, 18)


def eq_match(media_id: str, reference_id: str, ref_start: float | None = None, ref_end: float | None = None) -> dict:
    target, rate = _mono(media_id)
    reference, ref_rate = _mono(reference_id, ref_start, ref_end)
    gain = curve(bands(target, rate), bands(reference, ref_rate), min(rate, ref_rate) / 2)
    entries = ";".join(f"entry({c:.2f},{g:.2f})" for c, g in zip(CENTERS, gain))
    info = media.media_info(media_id)
    channels = int(info["channels"])
    # firequalizer delays its output by `delay` (10 ms: 480 samples at 48 kHz, measured) and lengthens it (960 frames
    # at 48 kHz); an EQ must not move or stretch a clip, so the delay is trimmed off and the length restored exactly.
    lead = round(0.01 * rate)
    frames = int(info["frames"])
    af = f"firequalizer=delay=0.01:gain_entry='{entries}',atrim=start_sample={lead},asetpts=PTS-STARTPTS,apad,atrim=end_sample={frames},aresample={rate}"
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "eqmatch.wav"
        cmd = [media._tool("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", str(media_dir() / f"{media_id}.wav"),
               "-af", af, "-ac", str(channels), "-c:a", "pcm_f32le", str(out)]
        done = subprocess.run(cmd, capture_output=True, timeout=900)
        if done.returncode != 0 or not out.exists():
            raise media.MediaError(f"EQ match failed: {done.stderr.decode(errors='replace').strip()[-300:]}")
        data = out.read_bytes()
    stem = str(info["name"]).rsplit(".", 1)[0]
    return media.import_wav(f"{stem} (EQ matched).wav", data)
