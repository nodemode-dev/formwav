"""PT-10's polyphonic half: the notes inside played chords found, and one moved to a new pitch without the others, as
Melodyne's Direct Note Access does, for harmonic instruments.

Finding: each frame's spectral peaks are scored for every candidate pitch (a tenth of a semitone apart, C2 to C7) by
how strongly they line up as its harmonics, a candidate needing a peak at its own fundamental (which keeps the octave
below out); the best is taken, its harmonics cancelled, and the next looked for, up to six notes a frame; frames are
joined into notes over time. Moving: in every frame every sounding note's partials are fitted together by least squares
at their known frequencies, so partials closer than a spectral bin (C4's fifth harmonic and E4's fourth are 10 Hz apart)
are told apart; the moved note's fitted partials are subtracted from the audio and resynthesised at the new pitch with
their own amplitude envelopes and continuous phase. Inharmonic instruments (a piano's stretched partials) and dense
mixes are harder cases than the harmonic ones this was built and measured on."""

import numpy as np

from . import media

MAX_NOTES = 6
HARMONICS = 16
# the ridge on partials' amplitude slopes, relative to the mean basis energy: swept over a harmonic, a piano-like stretched
# and a 15-cent vibrato C-E-G with E moved (0: 19.4 dB of E removed at worst, the vibrato; 0.01: 33.0, the stretched; 0.1:
# 25.1; 1: 22.9), so free slopes let a neighbour's partials soak up a sweeping one and a heavy penalty loses the decays
RAMP_RIDGE = 0.01
LO_MIDI, HI_MIDI = 36, 96


def _load(media_id: str) -> tuple[np.ndarray, int]:
    """The clip's audio as frames by channels, decoded by ffmpeg whatever its stored format."""
    import subprocess

    info = media.media_info(media_id)
    channels = int(info.get("channels", 1))
    done = subprocess.run([media._tool("ffmpeg"), "-v", "error", "-nostdin", "-i", str(media.media_dir() / f"{media_id}.wav"), "-f", "f32le", "-ac", str(channels), "-"], capture_output=True, timeout=600)
    if done.returncode != 0:
        raise media.MediaError("the clip's audio could not be read")
    x = np.frombuffer(done.stdout, dtype="<f4").astype(np.float64)
    return x[: len(x) // channels * channels].reshape(-1, channels), int(info["sampleRate"])


def _frame(rate: int) -> tuple[int, int]:
    n = 1 << int(np.ceil(np.log2(0.085 * rate)))  # about 85 ms: 4096 at 48 kHz
    return n, n // 4


def _peaks(spectrum: np.ndarray, rate: int, n: int) -> tuple[np.ndarray, np.ndarray]:
    """Local maxima within 60 dB of the frame's loudest, frequency and amplitude refined by a parabola in dB."""
    mag = np.abs(spectrum)
    top = mag.max()
    if top <= 1e-9:
        return np.zeros(0), np.zeros(0)
    k = np.where((mag[1:-1] > mag[:-2]) & (mag[1:-1] >= mag[2:]) & (mag[1:-1] > top * 1e-3))[0] + 1
    a, b, c = (20 * np.log10(mag[k + d] + 1e-12) for d in (-1, 0, 1))
    off = np.clip(0.5 * (a - c) / np.where(np.abs(a - 2 * b + c) < 1e-9, 1e-9, a - 2 * b + c), -0.5, 0.5)
    return (k + off) * rate / n, 10 ** ((b - 0.25 * (a - c) * off) / 20)


def _frame_pitches(freqs: np.ndarray, amps: np.ndarray) -> list[float]:
    """The notes sounding in one frame, as fundamental frequencies, by iterative harmonic salience and cancellation."""
    if len(freqs) == 0:
        return []
    order = np.argsort(freqs)
    freqs, amps = freqs[order], amps[order].copy()
    cands = 440.0 * 2 ** ((np.arange(LO_MIDI * 10, HI_MIDI * 10 + 1) / 10 - 69) / 12)
    hs = np.arange(1, HARMONICS + 1)
    weights = 1 / np.sqrt(hs)

    def nearest(targets: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        idx = np.clip(np.searchsorted(freqs, targets), 1, len(freqs) - 1)
        left = np.where(np.abs(freqs[idx - 1] - targets) < np.abs(freqs[idx] - targets), idx - 1, idx)
        return left, np.abs(freqs[left] / targets - 1) < 0.015  # within about 25 cents

    found: list[float] = []
    first = 0.0
    for _ in range(MAX_NOTES):
        targets = cands[:, None] * hs[None, :]
        idx, ok = nearest(targets)
        got = np.where(ok, amps[idx], 0.0)
        score = (got * weights).sum(axis=1) * (got[:, 0] > 0)  # a note needs a peak at its own fundamental
        best = int(np.argmax(score))
        if score[best] <= 0 or score[best] < 0.12 * first:
            break
        first = first or score[best]
        f0 = float(freqs[idx[best, 0]])  # refined from the fundamental's own peak
        found.append(f0)
        j, hit = nearest(f0 * hs)
        amps[j[hit]] = 0.0  # its harmonics cancelled before the next note is looked for
    return found


def _analyse(mono: np.ndarray, rate: int, keep_peaks: list | None = None) -> tuple[list[list[float]], int, int]:
    n, hop = _frame(rate)
    window = np.hanning(n)
    starts = list(range(0, max(1, len(mono) - n + 1), hop))
    level = np.array([np.sqrt(np.mean(mono[s : s + n] ** 2)) if len(mono[s : s + n]) else 0.0 for s in starts])
    # frames 35 dB below the loudest are not searched: a sampled piano's release tail gave ten false notes there
    gate = level.max(initial=0.0) * 10 ** (-35 / 20)
    frames = []
    for m, start in enumerate(starts):
        seg = mono[start : start + n]
        if len(seg) < n:
            seg = np.pad(seg, (0, n - len(seg)))
        freqs, amps = _peaks(np.fft.rfft(seg * window), rate, n)
        if keep_peaks is not None:
            keep_peaks.append(np.sort(freqs))
        frames.append(_frame_pitches(freqs, amps) if level[m] > gate else [])
    return frames, n, hop


def _stretch(f0: float, peaks: np.ndarray) -> float:
    """A note's inharmonicity in one frame (a piano's partials run sharp: f_h = h f0 sqrt(1 + B h^2)), the median over its
    partials 2 to 12 that have a peak within 1.5% of where a harmonic would be; 0 for a harmonic instrument."""
    est = []
    for h in range(2, 13):
        target = f0 * h
        if len(peaks) == 0 or target > peaks[-1] * 1.02:
            break
        k = int(np.clip(np.searchsorted(peaks, target), 1, len(peaks) - 1))
        p = peaks[k - 1] if abs(peaks[k - 1] - target) < abs(peaks[k] - target) else peaks[k]
        if abs(p / target - 1) < 0.015:
            est.append(((p / target) ** 2 - 1) / (h * h))
    return float(np.clip(np.median(est), 0.0, 0.003)) if len(est) >= 3 else 0.0


def _slope(frames: list[list[float]], m: int, f0: float, hop_s: float) -> float:
    """The note's pitch slope in Hz a second at frame m, from its frequency in the frames either side (0 at the ends)."""
    def near(k: int) -> float | None:
        if not 0 <= k < len(frames):
            return None
        best = min(frames[k], key=lambda f: abs(np.log2(f / f0)), default=None)
        return best if best is not None and abs(12 * np.log2(best / f0)) < 0.5 else None

    a, b = near(m - 1), near(m + 1)
    if a is not None and b is not None:
        return (b - a) / (2 * hop_s)
    if b is not None:
        return (b - f0) / hop_s
    if a is not None:
        return (f0 - a) / hop_s
    return 0.0


def _join(frames: list[list[float]], hop: int, n: int, rate: int) -> list[dict]:
    """Frames' pitches joined into notes: the same semitone continuing (a gap of up to two frames bridged), 4 frames
    or more; each note's pitch the median of its frames'."""
    open_notes: dict[int, dict] = {}
    notes = []
    for m, pitches in enumerate(frames):
        here = {}
        for f0 in pitches:
            midi = 69 + 12 * np.log2(f0 / 440.0)
            key = int(round(midi))
            if abs(midi - key) <= 0.45:
                here[key] = midi
        for key, midi in here.items():
            note = open_notes.get(key)
            if note and m - note["last"] <= 3:
                note["last"] = m
                note["values"].append(midi)
            else:
                if note:
                    notes.append(note)
                open_notes[key] = {"first": m, "last": m, "values": [midi], "key": key}
        for key in [k for k, v in open_notes.items() if m - v["last"] > 3]:
            notes.append(open_notes.pop(key))
    notes.extend(open_notes.values())
    out = []
    for note in notes:
        if note["last"] - note["first"] + 1 >= 4:
            out.append({"start": round((note["first"] * hop + n / 2) / rate - hop / (2 * rate), 4), "end": round((note["last"] * hop + n / 2) / rate + hop / (2 * rate), 4), "midi": round(float(np.median(note["values"])), 3)})
    return sorted(out, key=lambda x: (x["start"], x["midi"]))


def find_notes(media_id: str) -> dict:
    """The notes inside the clip's chords: {"notes": [{"start", "end", "midi"}], "curve": []} (the polyphonic editor
    has no single pitch line)."""
    x, rate = _load(media_id)
    frames, n, hop = _analyse(x.mean(axis=1), rate)
    return {"notes": _join(frames, hop, n, rate), "curve": [], "poly": True}


def move_notes(media_id: str, edits: list[dict]) -> dict:
    """Each edit {"start", "end", "midi", "shift"} moves that note (the one at that pitch in that span) by `shift`
    semitones, the other notes left as they were; returns the new media."""
    x, rate = _load(media_id)
    peaks: list = []
    frames, n, hop = _analyse(x.mean(axis=1), rate, peaks)
    window = np.hanning(n)
    t = np.arange(n) / rate
    centres = (np.arange(len(frames)) * hop + n / 2) / rate
    plan = []  # per edit: per frame, the index of its pitch in that frame's list (or -1)
    for e in edits:
        midi, s, en = float(e["midi"]), float(e["start"]), float(e["end"])
        at = []
        for m, pitches in enumerate(frames):
            k = -1
            if s - hop / rate <= centres[m] <= en + hop / rate:
                for i, f0 in enumerate(pitches):
                    if abs(69 + 12 * np.log2(f0 / 440.0) - midi) <= 0.5:
                        k = i
            at.append(k)
        plan.append((at, 2 ** (float(e.get("shift", 0)) / 12)))
    if not any(k >= 0 for at, _ in plan for k in at):
        raise media.MediaError("none of the moved notes was found in the audio")
    out = x.copy()
    total = len(x) + n
    for c in range(x.shape[1]):
        sig = np.pad(x[:, c], (0, n))
        num = [np.zeros(total) for _ in plan]
        den = np.zeros(total)
        amps = [np.zeros((len(frames), HARMONICS)) for _ in plan]
        phases = [np.zeros((len(frames), HARMONICS)) for _ in plan]
        f0s = [np.zeros(len(frames)) for _ in plan]
        stretches = [np.zeros(len(frames)) for _ in plan]
        for m, pitches in enumerate(frames):
            a = m * hop
            den[a : a + n] += window
            moving = [(p, at[m]) for p, (at, _) in enumerate(plan) if at[m] >= 0]
            if not moving:
                continue
            # every sounding note's partials fitted together, each where its own peaks put it (a stretched, piano-like
            # series) and sweeping at the note's pitch slope (vibrato inside the frame): with exact harmonics and steady
            # frequencies the moved note came out only 13.6 dB down when stretched and 21.5 dB with 15 cents of vibrato
            tc = t - n / (2 * rate)
            owners, fr, kr, stretch = [], [], [], {}
            for i, f0 in enumerate(pitches):
                stretch[i] = _stretch(f0, peaks[m])
                slope = _slope(frames, m, f0, hop / rate)
                for h in range(1, HARMONICS + 1):
                    s = h * np.sqrt(1 + stretch[i] * h * h)
                    if f0 * s < 0.45 * rate:
                        owners.append((i, h))
                        fr.append(f0 * s)
                        kr.append(slope * s)
            fr, kr = np.array(fr), np.array(kr)
            arg = 2 * np.pi * (fr[None, :] * tc[:, None] + 0.5 * kr[None, :] * tc[:, None] ** 2)
            cosb, sinb = np.cos(arg), np.sin(arg)
            # and each partial's amplitude may rise or fall across the frame (a decaying note changes 4% or more in 85 ms)
            ramp = tc[:, None] / (n / rate)
            basis = np.concatenate([cosb, sinb, ramp * cosb, ramp * sinb], axis=1) * window[:, None]
            gram = basis.T @ basis
            j0 = len(fr)
            reg = np.full(len(gram), 1e-6 * np.trace(gram) / len(gram))
            reg[2 * j0 :] += RAMP_RIDGE * np.trace(gram) / len(gram)  # a slope is used only where it clearly pays
            coef = np.linalg.solve(gram + np.diag(reg), basis.T @ (sig[a : a + n] * window))
            cosc, sinc, cosd, sind = coef[:j0], coef[j0 : 2 * j0], coef[2 * j0 : 3 * j0], coef[3 * j0 :]
            for p, k in moving:
                mine = [j for j, (i, _) in enumerate(owners) if i == k]
                comp = ((cosc[mine][None, :] + cosd[mine][None, :] * ramp) * cosb[:, mine] + (sinc[mine][None, :] + sind[mine][None, :] * ramp) * sinb[:, mine]).sum(axis=1)
                num[p][a : a + n] += window * comp
                f0s[p][m] = pitches[k]
                stretches[p][m] = stretch[k]
                for j in mine:
                    h = owners[j][1]
                    amps[p][m, h - 1] = np.hypot(cosc[j], sinc[j])
                    phases[p][m, h - 1] = np.arctan2(-sinc[j], cosc[j])
        safe = np.where(den > 1e-6, den, 1.0)
        for p, (at, ratio) in enumerate(plan):
            removed = (num[p] / safe)[: len(x)]
            live = np.where(f0s[p] > 0)[0]
            if not len(live):
                continue
            samples = np.arange(len(x)) / rate
            f0_track = np.interp(samples, centres[live], f0s[p][live]) * ratio
            b = float(np.median(stretches[p][live]))  # the note keeps its own stretch at its new pitch
            added = np.zeros(len(x))
            for h in range(1, HARMONICS + 1):
                env = np.interp(samples, centres, amps[p][:, h - 1], left=0.0, right=0.0)
                freq = f0_track * h * np.sqrt(1 + b * h * h)
                env[freq >= 0.45 * rate] = 0.0
                if env.max() <= 1e-7:
                    continue
                phase = phases[p][live[0], h - 1] + np.cumsum(2 * np.pi * freq / rate)
                added += env * np.cos(phase)
            out[:, c] += added - removed
    peak = float(np.max(np.abs(out))) if out.size else 0.0
    if peak > 1.0:
        out /= peak
    from .audacity import _wav_bytes

    return media.import_wav("notes moved.wav", _wav_bytes([out[:, c].astype(np.float32) for c in range(out.shape[1])], rate))
