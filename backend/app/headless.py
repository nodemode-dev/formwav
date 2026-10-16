"""PLAN_v13 S12: formwav with no window. `python -m app.headless run (--in FILE.fmw | --demo) [--cmd JSON]... [--cmds
FILE] [--bounce OUT.wav] [--save OUT.fmw] [--inspect]` opens a saved session (or makes the demo), applies engine
commands (JSON, one per --cmd or one per line of --cmds) through the interface's own reducer, and bounces, saves or
summarises the result; `python -m app.headless commands [words]` lists every engine command and its parameters.
Commands are applied by frontend/src/engine (through Node and the interface's packages, as a checkout has them) and
the bounce is the engine's own export, so what this writes is what the app would."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def engine(op: str, doc: dict | None = None, commands: list | None = None):
    node = shutil.which("node")
    frontend = ROOT / "frontend"
    if node is None or not (frontend / "node_modules" / "vite").is_dir():
        raise SystemExit("formwav: the headless command line needs Node and the interface's packages (./formwav install)")
    done = subprocess.run([node, str(Path(__file__).with_name("headless.mjs")), str(frontend)], input=json.dumps({"op": op, "doc": doc or {"sampleRate": 48000, "tracks": [], "media": {}, "markers": []}, "commands": commands or []}), capture_output=True, text=True, timeout=600)
    if done.returncode != 0:
        line = next((l for l in reversed(done.stderr.splitlines()) if "Error" in l), done.stderr.strip()[-300:])
        raise SystemExit(f"formwav: {line}")
    return json.loads(done.stdout)


def load(path: Path) -> dict:
    from .services import media, projects

    if path.suffix.lower() != ".fmw" or not path.is_file():
        raise SystemExit(f"formwav: {path} is not a .fmw session file")
    try:
        _, doc, z = projects._read(path)
    except (zipfile.BadZipFile, projects.ProjectError) as err:
        raise SystemExit(f"formwav: {path}: {err}") from err
    with z:
        for mid in projects._media_ids(doc):
            media.import_wav(doc["media"][mid].get("name", f"{mid}.wav"), z.read(f"media/{mid}.wav"))
    return doc


def save(doc: dict, path: Path) -> None:
    from .core.paths import media_dir
    from .core.version import VERSION
    from .services import projects

    manifest = {"format": projects.FORMAT, "formatVersion": projects.FORMAT_VERSION, "app": "formwav", "appVersion": VERSION, "name": path.stem, "revision": 1, "savedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=".fmw")
    try:
        with os.fdopen(fd, "wb") as fh, zipfile.ZipFile(fh, "w", compression=zipfile.ZIP_DEFLATED) as z:
            z.writestr("manifest.json", json.dumps(manifest, indent=2))
            z.writestr("session.json", json.dumps(doc))
            for mid in sorted(projects._media_ids(doc)):
                z.write(media_dir() / f"{mid}.wav", f"media/{mid}.wav", compress_type=zipfile.ZIP_STORED)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(prog="formwav cli", description="formwav with no window: engine commands on a saved session")
    sub = p.add_subparsers(dest="verb", required=True)
    c = sub.add_parser("commands", help="every engine command and its parameters")
    c.add_argument("words", nargs="*")
    r = sub.add_parser("run", help="apply engine commands to a session and bounce, save or summarise it")
    src = r.add_mutually_exclusive_group(required=True)
    src.add_argument("--in", dest="source", type=Path, help="a .fmw session file")
    src.add_argument("--demo", action="store_true", help="the demo session made in code")
    r.add_argument("--cmd", action="append", default=[], help='an engine command as JSON, e.g. {"type": "set-track-gain", "trackId": "t1", "gainDb": -6}')
    r.add_argument("--cmds", type=Path, help="a file of engine commands, one JSON object a line")
    r.add_argument("--bounce", type=Path, help="write the mix to this .wav")
    r.add_argument("--save", type=Path, help="write the session to this .fmw")
    r.add_argument("--inspect", action="store_true", help="print the session's summary as JSON")
    a = p.parse_args(argv)
    if a.verb == "commands":
        words = [w.lower() for w in a.words]
        for e in engine("catalogue"):
            if all(w in f"{e['type']} {e['label']} {e['params']}".lower() for w in words):
                print(f"{e['type']:<26} {e['params']}")
        return 0
    from .services import demo, render

    doc = demo.build() if a.demo else load(a.source)
    commands = [json.loads(x) for x in a.cmd]
    if a.cmds:
        commands += [json.loads(line) for line in a.cmds.read_text().splitlines() if line.strip()]
    if commands:
        out = engine("apply", doc, commands)
        doc = out["doc"]
        for cmd, step in zip(commands, out["steps"]):
            print(f"{cmd.get('type')}: {step or 'no change'}", file=sys.stderr)
    if a.bounce:
        a.bounce.parent.mkdir(parents=True, exist_ok=True)
        a.bounce.write_bytes(render.render(doc)["wav"])
        print(f"bounced {a.bounce}", file=sys.stderr)
    if a.save:
        save(doc, a.save)
        print(f"saved {a.save}", file=sys.stderr)
    if a.inspect:
        print(json.dumps(engine("inspect", doc), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
