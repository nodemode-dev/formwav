"""Export formats (Audacity's and iZotope RX's export choices, as references only): the engine renders 32-bit float
WAV; ffmpeg encodes it. Multichannel files put one track per channel, in track order, as WAV or FLAC."""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

from . import media

#: format key -> (extension, mime type, ffmpeg output arguments, label)
FORMATS: dict[str, tuple[str, str, list[str], str]] = {
    "wav": ("wav", "audio/wav", ["-c:a", "pcm_f32le"], "WAV, 32-bit float"),
    "wav24": ("wav", "audio/wav", ["-c:a", "pcm_s24le"], "WAV, 24-bit"),
    "wav16": ("wav", "audio/wav", ["-af", "aresample=osf=s16:dither_method=triangular", "-c:a", "pcm_s16le"], "WAV, 16-bit (dithered)"),
    "flac": ("flac", "audio/flac", ["-c:a", "flac", "-sample_fmt", "s32", "-bits_per_raw_sample", "24"], "FLAC, 24-bit lossless"),
    "mp3": ("mp3", "audio/mpeg", ["-c:a", "libmp3lame", "-b:a", "320k"], "MP3, 320 kbps"),
    "mp3-192": ("mp3", "audio/mpeg", ["-c:a", "libmp3lame", "-b:a", "192k"], "MP3, 192 kbps"),
    "ogg": ("ogg", "audio/ogg", ["-c:a", "libvorbis", "-q:a", "6"], "OGG Vorbis, quality 6"),
    "m4a": ("m4a", "audio/mp4", ["-c:a", "aac", "-b:a", "256k"], "M4A, AAC 256 kbps"),
}
MULTICHANNEL = {"wav", "wav24", "wav16", "flac"}


def _ffmpeg(inputs: list[bytes], filters: list[str], fmt: str) -> bytes:
    ext, _, args, _ = FORMATS[fmt]
    with tempfile.TemporaryDirectory() as tmp:
        cmd = [media._tool("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin", "-y"]
        for i, data in enumerate(inputs):
            path = Path(tmp) / f"in{i}.wav"
            path.write_bytes(data)
            cmd += ["-i", str(path)]
        out = Path(tmp) / f"out.{ext}"
        done = subprocess.run(cmd + filters + args + [str(out)], capture_output=True, timeout=1800)
        if done.returncode != 0 or not out.exists():
            raise media.MediaError(f"{FORMATS[fmt][3]} export failed: {done.stderr.decode(errors='replace').strip()[-300:]}")
        return out.read_bytes()


def encode(wav: bytes, fmt: str, frames: int = 0) -> tuple[bytes, str, str]:
    """The rendered float WAV in `fmt`, padded with silence to `frames` when given: (bytes, extension, mime type)."""
    if fmt not in FORMATS:
        raise media.MediaError(f"no export format named {fmt}")
    ext, mime, args, _ = FORMATS[fmt]
    if not frames:
        return (wav if fmt == "wav" else _ffmpeg([wav], [], fmt)), ext, mime
    # One -af: the pad goes before any format filter (16-bit's dither) in the same chain.
    chain = [f"apad=whole_len={int(frames)}"] + ([args[args.index("-af") + 1]] if "-af" in args else [])
    rest = [a for i, a in enumerate(args) if not (a == "-af" or (i > 0 and args[i - 1] == "-af"))]
    ext, mime = FORMATS[fmt][0], FORMATS[fmt][1]
    with tempfile.TemporaryDirectory() as tmp:
        src, out = Path(tmp) / "in.wav", Path(tmp) / f"out.{ext}"
        src.write_bytes(wav)
        done = subprocess.run([media._tool("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", str(src), "-af", ",".join(chain), *rest, str(out)], capture_output=True, timeout=1800)
        if done.returncode != 0 or not out.exists():
            raise media.MediaError(f"{FORMATS[fmt][3]} export failed: {done.stderr.decode(errors='replace').strip()[-300:]}")
        return out.read_bytes(), ext, mime


def multichannel(stems: list[bytes], fmt: str, frames: int) -> tuple[bytes, str, str]:
    """One channel per stem (each folded to mono and padded to `frames`, the longest stem), in order, as WAV or FLAC;
    amerge stops at its shortest input, so every channel is padded first."""
    if fmt not in MULTICHANNEL:
        raise media.MediaError("multichannel export needs WAV or FLAC (MP3, OGG and M4A carry two channels here)")
    if not stems:
        raise media.MediaError("there are no tracks to export")
    fold = f"pan=mono|c0=0.5*c0+0.5*c1,apad=whole_len={int(frames)}"
    if len(stems) == 1:
        graph = ["-filter_complex", f"[0:a]{fold}[out]", "-map", "[out]"]
    else:
        folds = ";".join(f"[{i}:a]{fold}[m{i}]" for i in range(len(stems)))
        graph = ["-filter_complex", f"{folds};{''.join(f'[m{i}]' for i in range(len(stems)))}amerge=inputs={len(stems)}[out]", "-map", "[out]"]
    ext, mime, _, _ = FORMATS[fmt]
    return _ffmpeg(stems, graph, fmt), ext, mime
