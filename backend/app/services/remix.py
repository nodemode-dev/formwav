"""Remix to a length (AA-09, Audition's Remix): a song shortened or lengthened by re-arranging it on its beats rather than
stretching it. The beats come from the tempo service's onset envelope (the tempo, then the phase that lines the beats
up with the onsets, each beat then moved to its nearest onset peak); each beat is described by its harmony (pitch-class
energy, chroma); a jump from one beat to another that sounds alike over the next four beats, at the same place in the
bar, cuts a span out (a jump ahead) or repeats one (a jump back). Jumps are chosen one at a time, each the one that brings
the length nearest the target, while one still helps; the pieces are joined on their beats with 10 ms crossfades, and
whatever separates the result from the target (under a beat, as a rule) is closed by a stretch of at most 4%."""

import numpy as np

from . import media, tempo
from .audacity import _wav_bytes
from .tools import _wav_view

LOOKAHEAD = 4  # beats compared after each side of a jump
MIN_SIMILARITY = 0.9


def _beats(mono22: np.ndarray, length_s: float) -> tuple[np.ndarray, float]:
    """Beat times in seconds, and the tempo."""
    env = tempo.envelope(mono22)
    bpm, _ = tempo.estimate(env)
    period = tempo.FPS * 60.0 / bpm
    # the phase: onsets below 150 Hz (the kick, the bass) weigh double, since full-band flux is led by bright off-beat
    # hats and put every beat a quarter beat late
    spec = np.fft.rfft(mono22)
    spec[np.fft.rfftfreq(len(mono22), 1 / tempo.RATE) > 150] = 0
    low = tempo.envelope(np.fft.irfft(spec, len(mono22)))
    n = min(len(env), len(low))
    # scaled by the 99th percentile, not the maximum: one spike (the first onset out of silence) shrank every kick
    scale = lambda e: e / (float(np.percentile(e, 99)) or 1.0)
    weigh = scale(env[:n]) + 2 * scale(low[:n])
    offsets = np.arange(0, period, 0.5)
    score = [weigh[idx[idx < n]].sum() for idx in (np.round(np.arange(o, n, period)).astype(int) for o in offsets)]
    first = offsets[int(np.argmax(score))]
    env = weigh
    # the beats stay on the exact grid at the phase found (to half a frame): moving each to its own onset peak added the
    # envelope's 10 ms frames as jitter, up to 16 ms at a splice; one tempo is estimated for the clip in any case
    grid = np.arange(first, len(env), period) / tempo.FPS
    return grid[grid < length_s], bpm


def _chroma(mono22: np.ndarray, beats: np.ndarray) -> np.ndarray:
    """Each beat's pitch-class energy, normalised (rows: beats)."""
    n = 4096
    freqs = np.fft.rfftfreq(n, 1 / tempo.RATE)
    valid = (freqs > 55) & (freqs < 4000)
    pc = np.zeros(len(freqs), dtype=int)
    pc[valid] = np.round(12 * np.log2(freqs[valid] / 440.0)).astype(int) % 12
    out = np.zeros((len(beats), 12))
    win = np.hanning(n)
    for k in range(len(beats)):
        a = int(beats[k] * tempo.RATE)
        b = int(beats[k + 1] * tempo.RATE) if k + 1 < len(beats) else len(mono22)
        seg = mono22[a : max(b, a + n)]
        for s in range(0, max(1, len(seg) - n + 1), n // 2):
            frame = seg[s : s + n]
            if len(frame) < n:
                break
            mag = np.abs(np.fft.rfft(frame * win)) ** 2
            np.add.at(out[k], pc[valid], mag[valid])
    norms = np.linalg.norm(out, axis=1, keepdims=True)
    return out / np.where(norms > 0, norms, 1.0)


def plan(beats: np.ndarray, chroma: np.ndarray, length_s: float, target_s: float, bar: int = 4, max_jumps: int = 8) -> list[tuple[float, float]]:
    """The pieces to play, as (from, to) seconds of the source, in order: jumps chosen one at a time."""
    nb = len(beats)
    sim = np.full((nb, nb), -1.0)
    for i in range(nb - LOOKAHEAD):
        for j in range(nb - LOOKAHEAD):
            if i != j and (i - j) % bar == 0:
                sim[i, j] = float(np.mean([chroma[i + d] @ chroma[j + d] for d in range(LOOKAHEAD)]))
    pieces = [(0.0, length_s)]
    for _ in range(max_jumps):
        total = sum(b - a for a, b in pieces)
        if abs(total - target_s) < 0.5 * (beats[1] - beats[0] if nb > 1 else 0.5):
            break
        best = None
        for p, (a, b) in enumerate(pieces):
            inside = [k for k in range(nb) if a < beats[k] < b]
            for i in inside:
                for j in range(nb):
                    if sim[i, j] < MIN_SIMILARITY:
                        continue
                    # play [a, beats[i]], jump to beats[j], play on to the piece's end b (if j < i, the span repeats)
                    if j > i and not (beats[j] < b):
                        continue
                    new_total = total - (beats[j] - beats[i])
                    gain = abs(total - target_s) - abs(new_total - target_s)
                    if gain > 1e-6 and (best is None or (gain, sim[i, j]) > best[0]):
                        best = ((gain, sim[i, j]), p, i, j)
        if best is None:
            break
        _, p, i, j = best
        a, b = pieces[p]
        pieces[p : p + 1] = [(a, float(beats[i])), (float(beats[j]), b)]
    return pieces


def remix(media_id: str, target_s: float) -> dict:
    """The media re-arranged on its beats to `target_s` seconds (a new media); refuses a target the beats cannot reach
    within the 4% the closing stretch allows."""
    import subprocess
    import tempfile
    from pathlib import Path

    info = media.media_info(media_id)
    view, rate = _wav_view(media_id)
    raw = np.asarray(view)
    x = (raw / 32768.0).astype(np.float32) if raw.dtype == np.int16 else raw.astype(np.float32)
    length_s = len(x) / rate
    if not 0.25 * length_s <= target_s <= 4 * length_s:
        raise media.MediaError("remix to between a quarter of the clip's length and four times it")
    mono22 = tempo._decode(media_id, None, None)
    beats, bpm = _beats(mono22, length_s)
    if len(beats) < 2 * LOOKAHEAD + 2:
        raise media.MediaError("too few beats found to re-arrange this clip")
    pieces = plan(beats, _chroma(mono22, beats), length_s, float(target_s))
    fade = int(0.01 * rate)
    out: list[np.ndarray] = []
    for a, b in pieces:
        # a later piece starts its crossfade before its beat, as pre-roll: the overlap then takes no time, where taking
        # the fade from the beat itself shortened every join by 10 ms and put the beat across it 10 ms early
        start = int(round(a * rate)) - (fade if out else 0)
        seg = x[max(0, start) : int(round(b * rate))].copy()
        if out and fade and len(seg) > fade and len(out[-1]) > fade:
            ramp = np.linspace(0, 1, fade, dtype=np.float32)[:, None]
            seg[:fade] = out[-1][-fade:] * (1 - ramp) + seg[:fade] * ramp
            out[-1] = out[-1][:-fade]
        out.append(seg)
    y = np.vstack(out)
    got = len(y) / rate
    ratio = got / float(target_s)
    if abs(ratio - 1) > 0.04:
        raise media.MediaError(f"the beats reach {got:.2f} s, more than 4% from {target_s:.2f} s; try a length nearer a whole number of bars")
    if abs(ratio - 1) > 1e-4:
        with tempfile.TemporaryDirectory() as tmp:
            src, dst = Path(tmp) / "remix.wav", Path(tmp) / "fit.wav"
            src.write_bytes(_wav_bytes([y[:, c] for c in range(y.shape[1])], rate))
            done = subprocess.run([media._tool("ffmpeg"), "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", str(src),
                                   "-af", f"rubberband=tempo={ratio:.6f}:window=short", "-c:a", "pcm_f32le", str(dst)], capture_output=True, timeout=600)
            if done.returncode != 0:
                raise media.MediaError("the closing stretch failed")
            z, _ = _read(dst)
            want = int(round(float(target_s) * rate))
            y = z[:want] if len(z) >= want else np.vstack([z, np.zeros((want - len(z), z.shape[1]), dtype=np.float32)])
    stem = str(info["name"]).rsplit(".", 1)[0]
    result = media.import_wav(f"{stem} (remixed).wav", _wav_bytes([y[:, c] for c in range(y.shape[1])], rate))
    return {**result, "remix": {"bpm": round(bpm, 1), "beats": len(beats), "pieces": [[round(a, 3), round(b, 3)] for a, b in pieces], "stretch": round(ratio, 5)}}


def _read(path) -> tuple[np.ndarray, int]:
    import struct

    raw = path.read_bytes()
    fmt = raw.index(b"fmt ")
    channels, rate = struct.unpack("<HI", raw[fmt + 10 : fmt + 16])
    data = raw.index(b"data") + 8
    return np.frombuffer(raw[data:], dtype="<f4").reshape(-1, channels), rate
