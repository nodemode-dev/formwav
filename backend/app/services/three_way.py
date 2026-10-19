"""Speech, music and ambience as three faders (PLAN_v11 2.M4): a clip's range split into
three parts that sum back to it exactly, each placed on its own track so the session's own faders set the balance.

Speech is DeepFilterNet3's dialogue (services/deepfilter.py, RX-16's model, run through its own command-line build). What
is left, the clip less the speech, is split as separate.deconstruct splits a range (harmonic and
percussive separation with a margin: a 2048-point STFT, medians over 17 frames and 17 bins), in numpy so that it runs
where PyTorch is not installed, with soft masks: its tonal and transient parts are the music, and the ambience is the rest, defined as the
remainder less the music. So speech, music and ambience add up to the clip sample for sample, and faders left at 0 dB
change nothing. One mask serves every channel, which keeps the stereo picture. Demucs, where it is installed, separates
music further (separate.separate); this split needs no PyTorch.

Where the trained separator is installed (PLAN_v12 R1, services/tiger_dnr.py) the music mask is a trained model's
instead (trained_mask), and the third part is the effects: what TIGER-DnR, trained on the Divide and Remaster set, does
not call dialogue or music. Its file is named effects; the API keeps the key ambience, which its callers already read.
"""

import subprocess

import numpy as np

from . import deepfilter, media, tiger_dnr
from .aup_project import _wav_bytes

N_FFT, HOP, KERNEL, MARGIN = 2048, 512, 17, 2.0
TRAINED_HOP = 4.0
_BLOCK = 256  # frames per median block: memory stays bounded on long recordings


def _window() -> np.ndarray:
    return np.hanning(N_FFT + 1)[:-1].astype(np.float32)


def _stft(x: np.ndarray) -> np.ndarray:
    pad = N_FFT // 2
    xp = np.pad(x.astype(np.float32), (pad, pad + N_FFT))
    count = 1 + (len(xp) - N_FFT) // HOP
    idx = np.arange(N_FFT)[None, :] + HOP * np.arange(count)[:, None]
    return np.fft.rfft(xp[idx] * _window(), axis=1)


def _istft(spec: np.ndarray, n: int) -> np.ndarray:
    w = _window()
    frames = np.fft.irfft(spec, n=N_FFT, axis=1).astype(np.float32) * w
    out = np.zeros(HOP * (len(frames) - 1) + N_FFT, np.float32)
    norm = np.zeros_like(out)
    for i, f in enumerate(frames):
        out[i * HOP : i * HOP + N_FFT] += f
        norm[i * HOP : i * HOP + N_FFT] += w * w
    out /= np.maximum(norm, 1e-8)
    return out[N_FFT // 2 : N_FFT // 2 + n]


def _median(mag: np.ndarray, axis: int) -> np.ndarray:
    """A 17-point running median along time (axis 0) or frequency (axis 1), reflected at the edges, in blocks."""
    h = KERNEL // 2
    out = np.empty_like(mag)
    if axis == 1:
        for a in range(0, len(mag), _BLOCK):
            part = np.pad(mag[a : a + _BLOCK], ((0, 0), (h, h)), mode="reflect")
            out[a : a + _BLOCK] = np.median(np.lib.stride_tricks.sliding_window_view(part, KERNEL, axis=1), axis=-1)
        return out
    padded = np.pad(mag, ((h, h), (0, 0)), mode="reflect")
    for a in range(0, len(mag), _BLOCK):
        part = padded[a : a + _BLOCK + 2 * h]
        out[a : a + _BLOCK] = np.median(np.lib.stride_tricks.sliding_window_view(part, KERNEL, axis=0), axis=-1)
    return out


def music_mask(specs: list[np.ndarray]) -> np.ndarray:
    """How much of each bin is music, from the channels' mean magnitude: none where the medians over time (tonal) and over
    frequency (transient) agree, all of it where one is twice the other (deconstruct's margin), in proportion between.
    Measured against deconstruct's binary masks on a mix with known parts (verification/verify_three_way.py): music from
    -1.9 to 0.7 dB SI-SDR, ambience from -5.5 to -3.9 dB, and no musical noise from bins switched whole."""
    mag = np.mean([np.abs(s) for s in specs], axis=0).astype(np.float32)
    tonal_env, trans_env = _median(mag, 0), _median(mag, 1)
    ratio = np.maximum(tonal_env, trans_env) / np.maximum(np.minimum(tonal_env, trans_env), 1e-12)
    return np.clip((ratio - 1.0) / (MARGIN - 1.0), 0.0, 1.0).astype(np.float32)


def trained_mask(x: np.ndarray, rest: np.ndarray, rate: int) -> np.ndarray:
    """How much of each bin is music by the trained separator (services/tiger_dnr.py, PLAN_v12 R1): TIGER-DnR's music of
    the clip's mid channel as a share of the remainder's mid in each bin, clipped to [0, 1]; one mask for every channel,
    as music_mask's, so the stereo picture is kept and the parts still sum exactly. The model hears the whole mix, as it
    was trained to: from the remainder alone its music was 3 dB worse on a mix of recordings
    (sidecar verification/verify_dnr_split.json)."""
    music = tiger_dnr.separate(x.mean(axis=1, keepdims=True).astype(np.float32), rate, ("music",), TRAINED_HOP)["music"][:, 0]
    return np.clip(np.abs(_stft(music)) / np.maximum(np.abs(_stft(rest.mean(axis=1).astype(np.float32))), 1e-9), 0.0, 1.0).astype(np.float32)


def split(media_id: str, start: float = 0.0, end: float | None = None) -> dict:
    info = media.media_info(media_id)
    rate, chans = int(info["sampleRate"]), int(info["channels"])
    length = int(info["frames"]) / rate
    start = max(0.0, float(start))
    end = length if end is None else min(length, float(end))
    if end - start < 0.25:
        raise media.MediaError("choose at least a quarter of a second to separate")
    pcm = subprocess.run([media._tool("ffmpeg"), "-v", "error", "-nostdin", "-ss", f"{start:.6f}", "-t", f"{end - start:.6f}", "-i", str(media.media_dir() / f"{media_id}.wav"), "-f", "f32le", "-"],
                         capture_output=True, timeout=1800)
    if pcm.returncode != 0 or not pcm.stdout:
        raise media.MediaError("the range could not be read")
    x = np.frombuffer(pcm.stdout, "<f4").reshape(-1, chans).astype(np.float32)
    n = len(x)
    speech = deepfilter.isolate(x, rate, 100)[:n].astype(np.float32)
    rest = x - speech
    specs = [_stft(rest[:, c]) for c in range(chans)]
    trained = tiger_dnr.installed()
    mask = trained_mask(x, rest, rate) if trained else music_mask(specs)
    music = np.stack([_istft(specs[c] * mask, n) for c in range(chans)], axis=1)
    ambience = rest - music
    stem = str(info.get("name", "clip")).rsplit(".", 1)[0]
    out = {}
    for name, part in (("speech", speech), ("music", music), ("ambience", ambience)):
        out[name] = media.import_wav(f"{stem} - {'effects' if trained and name == 'ambience' else name}.wav", _wav_bytes([part[:, c] for c in range(chans)], rate))
    out["range"] = [start, end]
    out["method"] = "trained" if trained else "rule"
    return out
