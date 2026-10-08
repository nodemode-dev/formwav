"""Export formats (Audacity's and iZotope RX's export choices, as references only): the engine renders 32-bit float
WAV; ffmpeg encodes it. Multichannel files put one track per channel, in track order, as WAV or FLAC."""

from __future__ import annotations

import struct
import subprocess
import tempfile
from pathlib import Path

from . import media

#: format key -> (extension, mime type, ffmpeg output arguments, label)
FORMATS: dict[str, tuple[str, str, list[str], str]] = {
    "wav": ("wav", "audio/wav", ["-c:a", "pcm_f32le"], "WAV, 32-bit float"),
    "wav32": ("wav", "audio/wav", ["-c:a", "pcm_s32le"], "WAV, 32-bit"),
    "wav24": ("wav", "audio/wav", ["-c:a", "pcm_s24le"], "WAV, 24-bit"),
    "wav16": ("wav", "audio/wav", ["-c:a", "pcm_s16le"], "WAV, 16-bit"),
    "aiff": ("aiff", "audio/aiff", ["-c:a", "pcm_s24be"], "AIFF, 24-bit"),
    "aiff16": ("aiff", "audio/aiff", ["-c:a", "pcm_s16be"], "AIFF, 16-bit"),
    "aifc": ("aifc", "audio/aiff", ["-c:a", "pcm_f32be"], "AIFF-C, 32-bit float"),
    "flac": ("flac", "audio/flac", ["-c:a", "flac", "-sample_fmt", "s32", "-bits_per_raw_sample", "24"], "FLAC, 24-bit lossless"),
    "flac16": ("flac", "audio/flac", ["-c:a", "flac", "-sample_fmt", "s16"], "FLAC, 16-bit lossless"),
    "mp3": ("mp3", "audio/mpeg", ["-c:a", "libmp3lame", "-b:a", "320k"], "MP3, 320 kbps"),
    "mp3-192": ("mp3", "audio/mpeg", ["-c:a", "libmp3lame", "-b:a", "192k"], "MP3, 192 kbps"),
    "ogg": ("ogg", "audio/ogg", ["-c:a", "libvorbis", "-q:a", "6"], "OGG Vorbis, quality 6"),
    "m4a": ("m4a", "audio/mp4", ["-c:a", "aac", "-b:a", "256k"], "M4A, AAC 256 kbps"),
}
#: The integer formats a bounce dithers, by their bits (TPDF at the format's own step)
DITHER_BITS = {"wav16": 16, "aiff16": 16, "flac16": 16, "wav24": 24, "aiff": 24, "flac": 24}
MULTICHANNEL = {"wav", "wav32", "wav24", "wav16", "flac", "flac16"}


def frames_of(wav: bytes):
    """A 32-bit float WAV's samples, frames by channels (a read-only view; RIFF or RF64), and its rate."""
    import numpy as np

    channels, rate, wide, i = 2, 48000, None, 12
    while i + 8 <= len(wav):
        cid, size = wav[i : i + 4], struct.unpack("<I", wav[i + 4 : i + 8])[0]
        if cid == b"ds64":
            wide = struct.unpack("<Q", wav[i + 16 : i + 24])[0]
        elif cid == b"fmt ":
            channels, rate = struct.unpack("<HI", wav[i + 10 : i + 16])
        elif cid == b"data":
            data = wav[i + 8 : i + 8 + (wide if size == 0xFFFFFFFF and wide is not None else size)]
            return np.frombuffer(data, dtype="<f4")[: len(data) // (4 * channels) * channels].reshape(-1, channels), rate
        i += 8 + size + (size & 1)
    raise media.MediaError("the render holds no sample data")


def _float_wav(samples, rate: int) -> bytes:
    import numpy as np

    from .render import wav_float32_stereo

    return wav_float32_stereo(np.ascontiguousarray(samples, dtype="<f4").tobytes(), rate, samples.shape[1])


def dithered(wav: bytes, bits: int, seed: int = 0) -> bytes:
    """The float WAV's samples on the `bits`-bit grid, TPDF-dithered (two uniform draws of one step each, a triangle of
    two steps), so the format's encoder converts them exactly; samples at exact zero stay zero (digital silence silent)."""
    import numpy as np

    x, rate = frames_of(wav)
    step = float(2 ** (bits - 1))
    rng = np.random.default_rng(seed)
    q = np.round(x * step + (rng.random(x.shape) - rng.random(x.shape)))
    q[x == 0] = 0
    return _float_wav(np.clip(q, -step, step - 1) / step, rate)


def normalized(wav: bytes, target_db: float) -> tuple[bytes, float]:
    """The float WAV scaled so its highest sample sits at `target_db` dBFS, and the gain in dB (none when silent)."""
    import math

    import numpy as np

    x, rate = frames_of(wav)
    peak = float(np.abs(x).max()) if x.size else 0.0
    if peak <= 0:
        return wav, 0.0
    gain = target_db - 20 * math.log10(peak)
    return _float_wav(x * np.float32(10 ** (gain / 20)), rate), gain


def encode(wav: bytes, fmt: str, frames: int = 0, dither: bool = True, bext: dict[str, str] | None = None, seed: int = 0) -> tuple[bytes, str, str]:
    """The rendered float WAV in `fmt`, padded with silence to `frames` when given: (bytes, extension, mime type). A 16 or
    24-bit format is TPDF-dithered unless `dither` is off (then rounded); a WAV carries `bext` as its BWF bext chunk
    (ffmpeg's metadata names) and is written as RF64 past 4 GiB."""
    if fmt not in FORMATS:
        raise media.MediaError(f"no export format named {fmt}")
    ext, mime, args, label = FORMATS[fmt]
    if dither and fmt in DITHER_BITS:
        wav = dithered(wav, DITHER_BITS[fmt], seed)
    if fmt == "wav" and not frames and not bext:
        return wav, ext, mime
    extra = ["-rf64", "auto"] if ext == "wav" else []
    if bext and ext == "wav":
        extra += ["-write_bext", "1"] + [part for key, value in bext.items() for part in ("-metadata", f"{key}={value}")]
    with tempfile.TemporaryDirectory() as tmp:
        src, out = Path(tmp) / "in.wav", Path(tmp) / f"out.{ext}"
        src.write_bytes(wav)
        pad = ["-af", f"apad=whole_len={int(frames)}"] if frames else []
        done = subprocess.run([media._tool("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", str(src), *pad, *args, *extra, str(out)], capture_output=True, timeout=1800)
        if done.returncode != 0 or not out.exists():
            raise media.MediaError(f"{label} export failed: {done.stderr.decode(errors='replace').strip()[-300:]}")
        return out.read_bytes(), ext, mime


def multichannel(stems: list[bytes], fmt: str, frames: int, dither: bool = True, bext: dict[str, str] | None = None) -> tuple[bytes, str, str]:
    """One channel per stem (each folded to mono, half of each side, and padded to `frames`, the longest stem), in
    order, as WAV or FLAC, dithered as encode dithers, after the fold so the samples stay on the format's grid."""
    if fmt not in MULTICHANNEL:
        raise media.MediaError("multichannel export needs WAV or FLAC (MP3, OGG and M4A carry two channels here)")
    if not stems:
        raise media.MediaError("there are no tracks to export")
    import numpy as np

    columns, rate = [], 48000
    for wav in stems:
        x, rate = frames_of(wav)
        mono = np.zeros(int(frames), dtype=np.float32)
        n = min(len(x), int(frames))
        mono[:n] = 0.5 * x[:n, 0] + 0.5 * x[:n, -1]
        columns.append(mono)
    return encode(_float_wav(np.stack(columns, axis=1), rate), fmt, dither=dither, bext=bext)
