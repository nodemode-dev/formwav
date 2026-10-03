"""Generate and Analyze, after Audacity's generators and analyzers, iZotope RX's signal generator, waveform
statistics and spectrogram, and Audition's amplitude statistics (behavioural references only; no code taken)."""

from __future__ import annotations

import re
import subprocess
import tempfile
from pathlib import Path

import numpy as np

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


WAVEFORMS = ("sine", "square", "sawtooth", "triangle")


def _tone(freq: float, seconds: float, rate: int, waveform: str, amplitude: float) -> bytes:
    """A tone as WAV bytes: sine exactly, the others band-limited, one cycle summed from the harmonics below Nyquist
    (square: odd at 1/n; sawtooth: all at 1/n; triangle: odd at 1/n squared, alternating), scaled to its peak and read
    by phase, so a high tone carries no aliases at any length."""
    from .audacity import _wav_bytes

    n = int(round(seconds * rate))
    phase = (np.arange(n, dtype=np.float64) * (freq / rate)) % 1.0
    if waveform == "sine":
        wave = np.sin(2 * np.pi * phase)
    else:
        size = 8192
        cycle = np.arange(size) / size
        table = np.zeros(size)
        top = max(1, int((rate / 2 - 1) // freq))
        for h in range(1, top + 1):
            if waveform == "sawtooth":
                table += np.sin(2 * np.pi * h * cycle) / h
            elif h % 2:
                table += (np.sin(2 * np.pi * h * cycle) / h) if waveform == "square" else ((-1) ** ((h - 1) // 2) * np.sin(2 * np.pi * h * cycle) / (h * h))
        table /= np.abs(table).max() or 1.0
        pos = phase * size
        i0 = pos.astype(np.int64) % size
        frac = pos - np.floor(pos)
        wave = table[i0] * (1 - frac) + table[(i0 + 1) % size] * frac
    return _wav_bytes([(amplitude * wave).astype(np.float32)], rate)


def generate(kind: str, seconds: float, rate: int, freq: float = 440.0, digits: str = "", waveform: str = "sine", amplitude: float = 0.5, freq_end: float = 8000.0, curve: str = "linear") -> dict:
    """Renders a generated signal (mono, 32-bit float at `rate`) into new media."""
    if kind not in KINDS:
        raise media.MediaError(f"no generator named {kind}")
    seconds = max(0.01, min(float(seconds), 3600.0))
    if kind == "chirp":
        # RX-39: a sweep from `freq` to `freq_end`, linear or logarithmic (equal time per octave, as acoustic
        # measurement uses), at `amplitude`; the phase in closed form, so the instantaneous frequency is exact
        from .audacity import _wav_bytes

        f0, f1 = float(freq), float(freq_end)
        if not (1 <= f0 < rate / 2 and 1 <= f1 < rate / 2):
            raise media.MediaError(f"a sweep's frequencies must be from 1 Hz to below {rate // 2} Hz")
        if curve not in ("linear", "log"):
            raise media.MediaError("a sweep's curve is linear or log")
        amplitude = max(0.0, min(float(amplitude), 1.0))
        t = np.arange(int(round(seconds * rate)), dtype=np.float64) / rate
        if curve == "log" and f0 != f1:
            k = np.log(f1 / f0) / seconds
            phase = 2 * np.pi * f0 * (np.exp(k * t) - 1) / k
        else:
            phase = 2 * np.pi * (f0 * t + (f1 - f0) * t * t / (2 * seconds))
        name = f"Sweep {f0:g} to {f1:g} Hz {curve} {seconds:g} s.wav"
        return media.import_wav(name, _wav_bytes([(amplitude * np.sin(phase)).astype(np.float32)], rate))
    if kind == "tone":
        if waveform not in WAVEFORMS:
            raise media.MediaError(f"no waveform named {waveform} (one of {', '.join(WAVEFORMS)})")
        if not 1 <= freq < rate / 2:
            raise media.MediaError(f"a tone's frequency must be from 1 Hz to below {rate // 2} Hz")
        amplitude = max(0.0, min(float(amplitude), 1.0))
        name = f"Tone {freq:g} Hz {waveform} {seconds:g} s.wav"
        return media.import_wav(name, _tone(float(freq), seconds, rate, waveform, amplitude))
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
    # Crest factor and dynamic range (RX-50): astats reports them per channel only, never in its overall block, so the
    # panel's rows stayed empty; they are measured here exactly: peak over RMS across every channel, and the loudest
    # less the quietest non-silent 50 ms RMS window in dB (Audition's definition)
    view, rate = _wav_view(media_id)
    x = np.asarray(view, dtype=np.float64)
    if x.size:
        rms = float(np.sqrt(np.mean(x**2)))
        if rms > 0:
            result["crestFactor"] = round(float(np.abs(x).max()) / rms, 3)
        win = max(1, int(rate * 0.05))
        blocks = x.shape[0] // win
        if blocks >= 1:
            levels = 10 * np.log10(np.mean(x[: blocks * win].reshape(blocks, win, -1) ** 2, axis=(1, 2)) + 1e-30)
            live = levels[levels > -120]
            if live.size:
                result["dynamicRangeDb"] = round(float(live.max() - live.min()), 2)
                # AA-04, Audition's amplitude statistics: the loudest and quietest non-silent 50 ms RMS windows, and
                # how the windows spread across levels (3 dB bins from -60 to 0 dBFS, quieter ones in the first)
                result["maxRmsDb"] = round(float(live.max()), 2)
                result["minRmsDb"] = round(float(live.min()), 2)
                counts, _ = np.histogram(np.clip(live, -60.0, -1e-9), bins=20, range=(-60.0, 0.0))
                result["rmsHistogram"] = [int(c) for c in counts]
    if int(info.get("channels") or 0) == 2:
        result["phaseCorrelation"] = _phase_correlation(media_id)
    return result


def find_similar(media_id: str, start: int, length: int, threshold: float = 0.8) -> list[dict]:
    """Find similar events (RX-22): the reference range's pattern, a log-magnitude spectrogram in 32 bands at about
    11 ms a frame, correlated with every position in the clip (per-band sliding correlations and running sums, so
    long clips stay quick); the best positions at or above `threshold`, at least a reference length apart, in order
    of time, the reference itself among them."""
    view, rate = _wav_view(media_id)
    x = np.asarray(view, dtype=np.float64).mean(axis=1)
    n, hop, bands = 1024, 512, 32
    frames = 1 + (len(x) - n) // hop if len(x) >= n else 0
    first, span = max(0, int(start) // hop), max(2, int(length) // hop)
    if frames < span or first + span > frames:
        raise media.MediaError("the reference range must lie inside the clip and last at least two frames")
    idx = np.arange(n)[None, :] + hop * np.arange(frames)[:, None]
    mag = np.abs(np.fft.rfft(x[idx] * np.hanning(n), axis=1))[:, : bands * 16]
    feat = np.log1p(100 * mag.reshape(frames, bands, 16).mean(axis=2))
    ref = feat[first : first + span] - feat[first : first + span].mean()
    num = sum(np.correlate(feat[:, b], ref[:, b], "valid") for b in range(bands))
    rows, sq = feat.sum(axis=1), (feat**2).sum(axis=1)
    c1, c2 = np.concatenate([[0], np.cumsum(rows)]), np.concatenate([[0], np.cumsum(sq)])
    s1, s2 = c1[span:] - c1[:-span], c2[span:] - c2[:-span]
    var = np.maximum(s2 - s1**2 / (span * bands), 1e-12)
    score = num / np.sqrt(var * np.sum(ref**2))
    picks: list[int] = []
    for p in np.argsort(-score):
        if score[p] < threshold:
            break
        if all(abs(int(p) - q) >= span for q in picks):
            picks.append(int(p))
    return [{"at": p * hop, "score": round(float(score[p]), 3)} for p in sorted(picks)]


def _wav_view(media_id: str):
    """A stored WAV's samples as a read-only (frames, channels) array mapped from disk, and its rate; float32 or 16-bit PCM."""
    import struct

    import numpy as np

    media.media_info(media_id)
    path = media_dir() / f"{media_id}.wav"
    fmt = None
    with open(path, "rb") as f:
        head = f.read(12)
        if head[:4] != b"RIFF" or head[8:12] != b"WAVE":
            raise media.MediaError("the stored media is not a WAV file")
        while True:
            chunk = f.read(8)
            if len(chunk) < 8:
                raise media.MediaError("the stored WAV has no data chunk")
            cid, size = chunk[:4], struct.unpack("<I", chunk[4:])[0]
            if cid == b"fmt ":
                body = f.read(size + (size % 2))
                tag, channels, rate = struct.unpack("<HHI", body[:8])
                bits = struct.unpack("<H", body[14:16])[0]
                if tag == 0xFFFE and size >= 26:
                    tag = struct.unpack("<H", body[24:26])[0]
                fmt = (tag, channels, rate, bits)
            elif cid == b"data":
                offset = f.tell()
                break
            else:
                f.seek(size + (size % 2), 1)
    if fmt is None:
        raise media.MediaError("the stored WAV has no format chunk")
    tag, channels, rate, bits = fmt
    if tag == 3 and bits == 32:
        dtype = "<f4"
    elif tag == 1 and bits == 16:
        dtype = "<i2"
    else:
        raise media.MediaError(f"the stored WAV is format {tag} at {bits} bits, which sample drawing does not read")
    frames = size // (channels * (bits // 8))
    raw = np.memmap(path, dtype=dtype, mode="r", offset=offset, shape=(frames, channels))
    view = raw if dtype == "<f4" else _Scaled(raw, 1.0 / 32768.0)
    return view, rate


class _Scaled:
    """A 16-bit WAV mapped from disk that reads as float32 slice by slice: indexing converts only what it returns, so a
    window of a long file costs the window (converting the whole file per read cost hundreds of megabytes a request)."""

    def __init__(self, raw, scale: float):
        self.raw = raw
        self.scale = scale
        self.shape = raw.shape

    def __getitem__(self, key):
        import numpy as np

        return np.asarray(self.raw[key], dtype=np.float32) * np.float32(self.scale)

    def __array__(self, dtype=None, copy=None):
        import numpy as np

        whole = np.asarray(self.raw, dtype=np.float32) * np.float32(self.scale)
        return whole if dtype is None else whole.astype(dtype, copy=False)


def samples(media_id: str, start: int, count: int) -> dict:
    """Up to 20000 samples of a stored media from `start`, per channel, for drawing at single-sample zoom."""
    view, rate = _wav_view(media_id)
    frames = int(view.shape[0])
    start = max(0, min(int(start), max(0, frames - 1)))
    count = max(1, min(int(count), 20000, frames - start))
    seg = view[start : start + count]
    return {"start": start, "count": int(seg.shape[0]), "rate": rate, "frames": frames, "channels": [[float(v) for v in seg[:, c]] for c in range(seg.shape[1])]}


def draw(media_id: str, start: int, values: list) -> dict:
    """A new media equal to `media_id` with `values` written into every channel from sample `start`; the rest byte-identical."""
    import numpy as np

    from .audacity import _wav_bytes

    view, rate = _wav_view(media_id)
    frames, channels = int(view.shape[0]), int(view.shape[1])
    if not values or len(values) > 100000:
        raise media.MediaError("draw between 1 and 100000 samples at a time")
    arr = np.asarray(values, dtype=np.float32)
    if not np.all(np.isfinite(arr)):
        raise media.MediaError("drawn samples must be numbers")
    if start < 0 or start + len(arr) > frames:
        raise media.MediaError(f"the drawn samples must lie inside the audio (samples 0 to {frames - 1})")
    out = np.array(view, dtype=np.float32)
    out[start : start + len(arr), :] = np.clip(arr, -1.0, 1.0)[:, None]
    stem = str(media.media_info(media_id)["name"]).rsplit(".", 1)[0]
    name = stem if stem.endswith(" (drawn)") else f"{stem} (drawn)"
    return media.import_wav(f"{name}.wav", _wav_bytes([out[:, c] for c in range(channels)], rate))


def room_tone(media_id: str, learn_media: str, learn_from: float, learn_to: float, fill_from: float, fill_to: float) -> dict:
    """A new media equal to `media_id` with [fill_from, fill_to) seconds replaced by noise matched to the spectrum and level
    of [learn_from, learn_to) seconds of `learn_media`: Welch's power spectrum of the learned range shapes fresh white
    noise of the gap's length, crossfaded over 10 ms at each end inside the gap; the rest byte-identical."""
    import hashlib

    import numpy as np

    from .audacity import _wav_bytes

    view, rate = _wav_view(media_id)
    src, src_rate = (view, rate) if learn_media == media_id else _wav_view(learn_media)
    if src_rate != rate:
        raise media.MediaError("the room tone and the clip to fill have different sample rates")
    frames, channels = int(view.shape[0]), int(view.shape[1])
    ls, le = int(round(learn_from * rate)), int(round(learn_to * rate))
    fs, fe = int(round(fill_from * rate)), int(round(fill_to * rate))
    if not (0 <= ls < le <= int(src.shape[0])) or le - ls < int(0.1 * rate):
        raise media.MediaError("the room tone must be a range of at least 0.1 s inside its clip")
    if not (0 <= fs < fe <= frames):
        raise media.MediaError("the range to fill must lie inside the clip")
    n = min(4096, 1 << int(np.log2(le - ls)))
    hop = n // 2
    window = np.hanning(n)
    norm = float(np.sum(window**2))
    length = fe - fs
    fade = min(int(0.01 * rate), length // 4)
    env = np.ones(length)
    if fade > 0:
        ramp = np.linspace(0.0, 1.0, fade, endpoint=False)
        env[:fade] = ramp
        env[-fade:] = ramp[::-1]
    rng = np.random.default_rng(int.from_bytes(hashlib.sha256(f"{media_id}:{fs}:{fe}".encode()).digest()[:8], "little"))
    out = np.array(view, dtype=np.float32)
    for c in range(channels):
        x = np.asarray(src[ls:le, min(c, int(src.shape[1]) - 1)], dtype=np.float64)
        psd = np.mean([np.abs(np.fft.rfft(x[i : i + n] * window)) ** 2 for i in range(0, len(x) - n + 1, hop)], axis=0) / norm
        shaped = np.fft.rfft(rng.standard_normal(length)) * np.sqrt(np.interp(np.fft.rfftfreq(length), np.fft.rfftfreq(n), psd))
        tone = np.fft.irfft(shaped, n=length)
        out[fs:fe, c] = (out[fs:fe, c] * (1.0 - env) + tone * env).astype(np.float32)
    stem = str(media.media_info(media_id)["name"]).rsplit(".", 1)[0]
    name = stem if stem.endswith(" (room tone)") else f"{stem} (room tone)"
    return media.import_wav(f"{name}.wav", _wav_bytes([out[:, c] for c in range(channels)], rate))


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
