"""AA-12, automatic speech alignment of replacement dialogue (Audition's, VocAlign's): a re-recorded take re-timed to
follow the guide it replaces, word for word.

Both are described every 10 ms by 19 MFCCs, each recording's coefficients normalised over itself (a re-recorded take
comes through another microphone, EQ and room); dynamic time warping finds the cheapest path matching the take's
frames to the guide's, a sideways step costing 1.5 times a diagonal one so the path follows the speech rather than
freezing or skipping, each row computed at once by a min-plus prefix scan; the path becomes a time map, averaged per
guide frame, smoothed and kept monotonic; WSOLA renders the take along it (each 30 ms output frame read where the map
points, moved by up to 10 ms to the offset that best continues the previous frame's waveform), so the result lasts
exactly as long as the guide and speech keeps its pitch and timbre."""

import subprocess

import numpy as np

from . import media
from .transcript import _mfcc

FEATURE_RATE = 16000
HOP_S = 0.01
SIDE_STEP = 1.5
MAX_SECONDS = 30.0  # the path's table is guide frames by take frames: 3000 by 3000 in float32 is 36 MB


def _decode(media_id: str, start: float, length: float, rate: int, channels: int) -> np.ndarray:
    done = subprocess.run([media._tool("ffmpeg"), "-v", "error", "-nostdin", "-ss", f"{max(0.0, start):.6f}", "-t", f"{length:.6f}", "-i", str(media.media_dir() / f"{media_id}.wav"), "-f", "f32le", "-ac", str(channels), "-ar", str(rate), "-"],
                          capture_output=True, timeout=600)
    if done.returncode != 0:
        raise media.MediaError("a clip's audio could not be read")
    x = np.frombuffer(done.stdout, dtype="<f4").astype(np.float64)
    return x[: len(x) // channels * channels].reshape(-1, channels)


def _features(x: np.ndarray) -> np.ndarray:
    """MFCCs every 10 ms (the transcript's, 25 ms windows), normalised per coefficient over the recording."""
    m = _mfcc(x, FEATURE_RATE)
    if len(m) < 2:
        raise media.MediaError("a clip is too short to align")
    m = (m - m.mean(axis=0)) / (m.std(axis=0) + 1e-9)
    return m / (np.linalg.norm(m, axis=1, keepdims=True) + 1e-12)


def _path(g: np.ndarray, t: np.ndarray) -> np.ndarray:
    """The cheapest monotonic path from (0, 0) to the last frames of both, as (guide frame, take frame) pairs."""
    cost = 1.0 - g @ t.T  # cosine distance
    n, m = cost.shape
    w = SIDE_STEP
    d = np.full((n, m), np.inf, dtype=np.float32)
    s = np.cumsum(cost[0])
    d[0] = w * s - (w - 1) * cost[0, 0]  # the first row: the start, then sideways steps
    for i in range(1, n):
        c = cost[i]
        a = np.full(m, np.inf)
        a[1:] = d[i - 1, :-1] + c[1:]  # diagonal
        a = np.minimum(a, d[i - 1] + w * c)  # down
        s = np.cumsum(c)
        d[i] = w * s + np.minimum.accumulate(a - w * s)  # then any run of sideways steps, as one prefix scan
    i, j = n - 1, m - 1
    pairs = [(i, j)]
    while i > 0 or j > 0:
        options = []
        if i > 0 and j > 0:
            options.append((d[i - 1, j - 1] + cost[i, j], i - 1, j - 1))
        if i > 0:
            options.append((d[i - 1, j] + w * cost[i, j], i - 1, j))
        if j > 0:
            options.append((d[i, j - 1] + w * cost[i, j], i, j - 1))
        _, i, j = min(options)
        pairs.append((i, j))
    return np.array(pairs[::-1])


def _time_map(pairs: np.ndarray, guide_frames: int, smooth: int) -> np.ndarray:
    """For each guide frame, the take frame it matches: the path averaged per guide frame, smoothed, kept monotonic."""
    take = np.zeros(guide_frames)
    count = np.zeros(guide_frames)
    np.add.at(take, pairs[:, 0], pairs[:, 1])
    np.add.at(count, pairs[:, 0], 1)
    take = take / np.maximum(count, 1)
    if smooth > 1:
        pad = np.pad(take, (smooth, smooth), mode="edge")
        take = np.convolve(pad, np.ones(2 * smooth + 1) / (2 * smooth + 1), mode="same")[smooth:-smooth]
    return np.maximum.accumulate(take)


def _wsola(x: np.ndarray, rate: int, out_len: int, source_at) -> np.ndarray:
    """The take rendered along the map: each output frame (30 ms, half overlapping) read where `source_at(sample)`
    points, moved by up to 10 ms to the offset whose start best continues the previous frame's waveform."""
    frame = int(0.03 * rate) // 2 * 2
    hop = frame // 2
    tol = int(0.01 * rate)
    window = np.hanning(frame)
    pad = np.pad(x, ((frame + tol, frame + tol), (0, 0)))
    mono = pad.mean(axis=1)
    out = np.zeros((out_len + frame, x.shape[1]))
    norm = np.zeros(out_len + frame)
    prev = None
    for at in range(0, out_len, hop):
        want = int(round(source_at(at))) + frame + tol
        if prev is None:
            best = want
        else:
            natural = mono[prev + hop : prev + hop + frame]
            region = mono[want - tol : want + tol + frame]
            if len(region) < frame + 2 * tol or len(natural) < frame:
                best = want
            else:
                score = np.correlate(region, natural, mode="valid")
                energy = np.sqrt(np.convolve(region**2, np.ones(frame), mode="valid") + 1e-12)
                best = want - tol + int(np.argmax(score / energy))
        out[at : at + frame] += pad[best : best + frame] * window[:, None]
        norm[at : at + frame] += window
        prev = best
    return (out / np.maximum(norm, 1e-6)[:, None])[:out_len]


def align(guide_id: str, take_id: str, guide_in: float = 0.0, guide_len: float | None = None, take_in: float = 0.0, take_len: float | None = None, smooth_ms: float = 100.0) -> dict:
    """The take (its span from `take_in`, `take_len` seconds) re-timed to the guide's span; new media exactly as long as
    the guide's span, at the take's rate and channels."""
    from .audacity import _wav_bytes

    g_info, t_info = media.media_info(guide_id), media.media_info(take_id)
    guide_len = float(guide_len if guide_len is not None else g_info["frames"] / g_info["sampleRate"] - guide_in)
    take_len = float(take_len if take_len is not None else t_info["frames"] / t_info["sampleRate"] - take_in)
    if not (0.2 <= guide_len <= MAX_SECONDS and 0.2 <= take_len <= MAX_SECONDS):
        raise media.MediaError(f"alignment takes lines of 0.2 to {MAX_SECONDS:g} seconds")
    if not 0.5 <= take_len / guide_len <= 2.0:
        raise media.MediaError("the take is more than twice or under half the guide's length")
    g = _features(_decode(guide_id, guide_in, guide_len, FEATURE_RATE, 1)[:, 0])
    t = _features(_decode(take_id, take_in, take_len, FEATURE_RATE, 1)[:, 0])
    pairs = _path(g, t)
    smooth = max(1, int(round(smooth_ms / 1000 / HOP_S / 2)))
    mapped = _time_map(pairs, len(g), smooth)
    rate, channels = int(t_info["sampleRate"]), int(t_info.get("channels", 1))
    take = _decode(take_id, take_in, take_len, rate, channels)
    out_len = int(round(guide_len * rate))
    guide_frames = np.arange(len(g))
    # a guide frame's centre (MFCC frames start every 10 ms, 25 ms long) to the take's, in the take's samples
    centre = 0.0125 * rate

    def source_at(sample: int) -> float:
        f = (sample - centre) / (HOP_S * rate)
        return float(np.interp(f, guide_frames, mapped)) * HOP_S * rate + centre

    y = _wsola(take, rate, out_len, source_at)
    return media.import_wav(f"{str(t_info['name']).rsplit('.', 1)[0]} (aligned).wav", _wav_bytes([y[:, c].astype(np.float32) for c in range(channels)], rate))
