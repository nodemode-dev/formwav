#!/usr/bin/env python3
"""Copies the three browser demos' recordings into the app build, so Home > Demos opens them as real sessions.

The demos in demo/ (Mix), demos/repair and demos/produce carry their media as JavaScript data packs (base64 of an mp3
or a 16-bit WAV, for file://). This decodes the packs the in-app sessions use into plain files under
frontend/public/demos/<demo>/, which Vite copies into frontend/dist and the desktop app serves from there, and writes
peaks.json beside them (48 peaks a file, 0 to 1) for the Start page's thumbnails. Every file is one the demo folders'
CREDITS.md lists; nothing else is copied. Needs ffmpeg for the peaks. Run from anywhere:

    python3 scripts/demo-media.py
"""
from __future__ import annotations

import base64
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "frontend" / "public" / "demos"
PACKS = {
    "mix": ("demo/assets/media", ["launch-radio", "narration", "narration-take2", "piano", "saturn"]),
    "repair": ("demos/repair/assets/media", ["onestep", "shellac"]),
    "produce": ("demos/produce/assets/media", ["piano", "saturn", "launch-roar", "keys-a", "keys-b", "keys-brk", "keys-c", "drums-a", "drums-b", "drums-c", "bass-b", "bass-c", "loop-kit-a", "loop-kit-b"]),
}
# the repair demo reads two recordings from the first demo's packs, unchanged
SHARED = {"repair": ("demo/assets/media", ["narration-take2", "launch-radio"])}
PEAKS = 48


def decode(pack: Path) -> tuple[bytes, str]:
    text = pack.read_text()
    m = re.search(r'\]="([A-Za-z0-9+/=]+)"', text)
    if not m:
        raise SystemExit(f"{pack}: no data in the pack")
    data = base64.b64decode(m.group(1))
    return data, ".wav" if data[:4] == b"RIFF" else ".mp3"


def peaks(path: Path) -> list[float]:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", "8000", "-f", "f32le", "-"], check=True, capture_output=True).stdout
    import array

    a = array.array("f")
    a.frombytes(raw[: len(raw) // 4 * 4])
    n = max(1, len(a) // PEAKS)
    out = [max((abs(x) for x in a[i * n : (i + 1) * n]), default=0.0) for i in range(PEAKS)]
    top = max(out) or 1.0
    return [round(v / top, 3) for v in out]


def main() -> None:
    for demo, (folder, names) in PACKS.items():
        dest = OUT / demo
        dest.mkdir(parents=True, exist_ok=True)
        table: dict[str, dict] = {}
        jobs = [(folder, n) for n in names] + [(SHARED[demo][0], n) for n in SHARED.get(demo, ("", []))[1]]
        for src, name in jobs:
            data, ext = decode(ROOT / src / f"{name}.js")
            file = dest / f"{name}{ext}"
            file.write_bytes(data)
            table[name] = {"file": file.name, "peaks": peaks(file)}
        (dest / "peaks.json").write_text(json.dumps(table, separators=(",", ":")) + "\n")
        print(f"{demo}: {len(table)} files")


if __name__ == "__main__":
    main()
