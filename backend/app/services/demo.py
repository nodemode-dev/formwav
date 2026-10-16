"""PLAN_v13 S12: a demo session made in code, the same every time: sixteen bars at 104 BPM in A minor (Am, F, C, G a bar
each), a kick, a snare and hats synthesised as audio, a bass and a pad, a Keys note track the built-in instrument
plays, a Verb bus taking sends from the snare, the pad and the keys, and four markers. Every sound is made here from
its recipe (no file is read), so agents and tests have a known session to work on."""
from __future__ import annotations

import struct

import numpy as np

from . import media

BPM = 104
BARS = 16
CHORDS = [(57, 60, 64), (53, 57, 60), (48, 52, 55), (55, 59, 62)]


def _wav(mono: np.ndarray, rate: int) -> bytes:
    data = np.clip(mono, -1.0, 1.0).astype("<f4").tobytes()
    fmt = struct.pack("<IHHIIHH", 16, 3, 1, rate, rate * 4, 4, 32)
    return b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + fmt + b"data" + struct.pack("<I", len(data)) + data


def _hz(pitch: float) -> float:
    return 440.0 * 2 ** ((pitch - 69) / 12)


def _smooth(x: np.ndarray, width: int) -> np.ndarray:
    return np.convolve(x, np.ones(width) / width, mode="same")


def _tracks(rate: int) -> tuple[dict[str, np.ndarray], list[dict], int, int]:
    beat = int(round(rate * 60 / BPM))
    bar = beat * 4
    total = bar * BARS
    rng = np.random.default_rng(104)
    out = {name: np.zeros(total) for name in ("Kick", "Snare", "Hats", "Bass", "Pad")}

    def hit(name: str, at: int, sound: np.ndarray) -> None:
        end = min(total, at + len(sound))
        out[name][at:end] += sound[: end - at]

    t = np.arange(int(rate * 0.4)) / rate
    kick = np.sin(2 * np.pi * (45 * t + (120 - 45) * 0.04 * (1 - np.exp(-t / 0.04)))) * np.exp(-t / 0.12) * 0.9
    t = np.arange(int(rate * 0.25)) / rate
    snare = (rng.standard_normal(len(t)) * 0.5 + np.sin(2 * np.pi * 190 * t)) * np.exp(-t / 0.07) * 0.45
    t = np.arange(int(rate * 0.06)) / rate
    hat = np.diff(rng.standard_normal(len(t) + 1)) * np.exp(-t / 0.015) * 0.18
    notes: list[dict] = []
    for b in range(BARS):
        start = b * bar
        chord = CHORDS[b % 4]
        for k in range(4):
            if k in (0, 2) or b >= 8:
                hit("Kick", start + k * beat, kick)
            if k in (1, 3) and b >= 4:
                hit("Snare", start + k * beat, snare)
        if b >= 2:
            for e in range(8):
                hit("Hats", start + e * beat // 2, hat * (1.0 if e % 2 else 0.6))
        if b >= 4:
            root = _hz(chord[0] - 24)
            n = beat // 2
            tt = np.arange(n) / rate
            for e in range(8):
                saw = 2 * ((root * tt) % 1.0) - 1
                hit("Bass", start + e * n, _smooth(saw, 24) * np.exp(-tt / 0.25) * 0.35)
        tt = np.arange(bar) / rate
        env = np.minimum(1.0, tt / 0.4) * np.minimum(1.0, (bar / rate - tt) / 0.1)
        pad = sum(np.sin(2 * np.pi * _hz(p) * d * tt) for p in chord for d in (0.997, 1.003)) / 6
        hit("Pad", start, pad * env * 0.22)
        if b >= 8:
            for k in range(4):
                for p in chord:
                    notes.append({"at": start - 8 * bar + k * beat, "length": int(beat * 0.9), "pitch": p + 12, "velocity": 96 if k == 0 else 80})
    return out, notes, bar, total


def build(rate: int = 48000) -> dict:
    """The demo document, its media written to the engine's media folder."""
    audio, notes, bar, total = _tracks(rate)
    refs: dict[str, dict] = {}
    tracks: list[dict] = []
    sends = {"Snare": -12.0, "Pad": -10.0, "Keys": -8.0}
    gains = {"Kick": -8.0, "Snare": -9.0, "Hats": -13.0, "Bass": -10.0, "Pad": -14.0, "Keys": -11.0}
    for i, (name, mono) in enumerate(audio.items()):
        ref = media.import_wav(f"Demo {name}.wav", _wav(mono, rate))
        refs[ref["id"]] = ref
        tracks.append(_track(f"demo{i + 1}", name, gains[name], ref, 0, total, sends.get(name)))
    core = media._require_core()
    keys_len = total - 8 * bar
    frames = [(n["at"], n["length"], n["pitch"], n["velocity"]) for n in notes]
    raw = np.frombuffer(core.render_notes(frames, rate, "triangle", 0.005, 0.2, 0.5, 0.3, 0.25, 0.0, 0.707), dtype="<f4")
    mono = np.zeros(keys_len)
    mono[: min(keys_len, len(raw))] = raw[:keys_len]
    ref = media.import_wav("Demo Keys.wav", _wav(mono, rate))
    refs[ref["id"]] = ref
    keys = _track("demo6", "Keys", gains["Keys"], ref, 8 * bar, keys_len, sends["Keys"])
    keys["clips"][0]["notes"] = notes
    tracks.append(keys)
    return {
        "version": 1,
        "sampleRate": rate,
        "media": refs,
        "tempo": {"bpm": BPM, "beatsPerBar": 4},
        "key": {"name": "A minor", "camelot": "8A"},
        "markers": [{"id": f"demo-m{i}", "at": b * bar, "label": label} for i, (b, label) in enumerate([(0, "Intro"), (4, "Verse"), (8, "Chorus"), (12, "Outro")])],
        "tracks": tracks,
        "buses": [{"id": "demo-verb", "name": "Verb", "gainDb": 0, "pan": 0, "fx": [{"kind": "reverb", "room": 0.75, "damping": 0.4, "mix": 1, "width": 1}]}],
    }


def _track(tid: str, name: str, gain: float, ref: dict, start: int, length: int, send: float | None) -> dict:
    track = {
        "id": tid,
        "name": name,
        "channels": 1,
        "gainDb": gain,
        "pan": 0,
        "mute": False,
        "solo": False,
        "clips": [{"id": f"{tid}c", "mediaId": ref["id"], "start": start, "sourceIn": 0, "length": length, "gainDb": 0}],
    }
    if send is not None:
        track["sends"] = [{"busId": "demo-verb", "gainDb": send}]
    return track
