"""AU-28: Nyquist, by Audacity's own interpreter (native/formwav-nyquist/fwnyq, Audacity 2.4.2's libnyquist).

A Nyquist Prompt's code, or one of Audacity's bundled Nyquist plug-ins with its controls, runs on a clip: the clip goes
in as *TRACK*, preceded by the settings Audacity 2.4.2 gives a version 4 plug-in (src/effects/nyquist/Nyquist.cpp: the
*AUDACITY*, *SYSTEM-DIR*, *PROJECT*, *SELECTION* and *TRACK* properties, the latency, *tracenable*, and each control
as (setf var value), reals to 14 significant digits); a sound that comes back becomes new media, anything else is
returned as it is.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

from . import media

_ROOT = Path(__file__).resolve().parents[3] / "native" / "formwav-nyquist"


def binary() -> str:
    return os.environ.get("FORMWAV_FWNYQ") or str(_ROOT / "fwnyq")


def _bundled(name: str) -> Path | None:
    """In the packaged app the runtime and plug-ins travel inside the frozen engine (build_macos_app adds them)."""
    import sys

    base = getattr(sys, "_MEIPASS", None)
    return Path(base) / name if base and (Path(base) / name).is_dir() else None


def runtime_dir() -> Path:
    return Path(os.environ.get("FORMWAV_NYQUIST_RUNTIME") or _bundled("nyquist_runtime") or _ROOT / "runtime")


def plugins_dir() -> Path:
    return Path(os.environ.get("FORMWAV_NYQUIST_PLUGINS") or _bundled("nyquist_plugins") or _ROOT / "plug-ins")


def _tokens(s: str) -> list[str]:
    """A header line's tokens: quoted strings, parenthesised groups (nested, as a version 4 choice list is:
    (("Up" (_ "Fade Up")) ...)), and bare words; a regex could not match the nesting and lost all but one choice."""
    out, i, n = [], 0, len(s)
    while i < n:
        ch = s[i]
        if ch.isspace():
            i += 1
        elif ch == '"':
            j = i + 1
            while j < n and s[j] != '"':
                j += 2 if s[j] == "\\" else 1
            out.append(s[i : j + 1])
            i = j + 1
        elif ch == "(":
            depth, j, quoted = 0, i, False
            while j < n:
                c = s[j]
                if quoted:
                    if c == "\\":
                        j += 1
                    elif c == '"':
                        quoted = False
                elif c == '"':
                    quoted = True
                elif c == "(":
                    depth += 1
                elif c == ")":
                    depth -= 1
                    if depth == 0:
                        break
                j += 1
            out.append(s[i : j + 1])
            i = j + 1
        else:
            j = i
            while j < n and not s[j].isspace() and s[j] not in '"()':
                j += 1
            if j == i:  # a stray close bracket: skipped (it made this loop for ever, an empty token at a time)
                i += 1
                continue
            out.append(s[i:j])
            i = j
    return out


def _scan(s: str, quoted: bool = False) -> tuple[int, bool]:
    """Brackets a line opens (or closes, below 0) outside quotes, and whether a quote is still open at its end: a
    label can be quoted over two lines (Limiter's "Input Gain (dB)\\nmono/Left"), which a count line by line lost,
    taking the rest of the plug-in's code for header and leaving it out."""
    d, k = 0, 0
    while k < len(s):
        c = s[k]
        if quoted:
            if c == "\\":
                k += 1
            elif c == '"':
                quoted = False
        elif c == '"':
            quoted = True
        elif c == "(":
            d += 1
        elif c == ")":
            d -= 1
        k += 1
    return d, quoted


def _depth(s: str) -> int:
    """Brackets a line (or joined lines) leaves open, quotes skipped."""
    return _scan(s)[0]


def _text(token: str) -> str:
    """A header token's text: a quoted string, or a translation (_ "text"), unquoted."""
    m = re.match(r'^\(_\s+("(?:[^"\\]|\\.)*")\s*\)$', token)
    if m:
        token = m.group(1)
    if token.startswith('"') and token.endswith('"'):
        return bytes(token[1:-1], "utf-8").decode("unicode_escape")
    return token


def parse_plugin(path: Path) -> dict:
    """A .ny plug-in's header: its name, type and controls (as Audacity reads ;name, ;type and ;control lines)."""
    info: dict = {"id": path.stem, "name": path.stem, "type": "process", "controls": []}
    raw_lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    joined, k = [], 0
    while k < len(raw_lines):
        line = raw_lines[k]
        if line.strip().startswith(("$", ";")):
            # a header line whose brackets are still open goes on over the next lines (a choice list spans several);
            # comment lines among them (translators' hints) are skipped
            while _depth(line) > 0 and k + 1 < len(raw_lines):
                k += 1
                if raw_lines[k].strip().startswith(";"):
                    continue
                line += " " + raw_lines[k].strip().lstrip("$")
        joined.append(line)
        k += 1
    for line in joined:
        s = line.strip()
        # version 4 headers start with $ (the translatable form, `$name (_ "...")`), older ones with ;
        if not (s.startswith(";") or s.startswith("$")):
            continue
        s = s.lstrip(";").strip().lstrip("$")
        tok = _tokens(s)
        if not tok:
            continue
        key = tok[0].lower()
        if key == "name" and len(tok) > 1:
            info["name"] = _text(tok[1])
        elif key == "type" and len(tok) > 1:
            info["type"] = tok[1].lower()
        elif key == "control" and len(tok) >= 4:
            var, label, kind = tok[1], _text(tok[2]), tok[3].lower()
            c: dict = {"var": var, "label": label, "type": kind}
            rest = tok[4:]
            if kind in ("real", "float", "int", "time", "float-text", "int-text"):
                c["unit"] = _text(rest[0]) if rest else ""
                nums = []
                for t in rest[1:4]:
                    try:
                        nums.append(float(t))
                    except ValueError:
                        nums.append(None)
                c["default"], c["min"], c["max"] = (nums + [None, None, None])[:3]
            elif kind == "choice":
                raw = rest[0] if rest else '""'
                if raw.startswith("("):
                    # each item a label, or (symbol (_ "label")) in version 4: the label is its last part
                    choices = [_text(_tokens(x[1:-1])[-1]) if x.startswith("(") and not x.startswith("(_") else _text(x) for x in _tokens(raw[1:-1])]
                else:
                    choices = [x.strip() for x in _text(raw).split(",")]
                c["choices"] = [ch for ch in choices if ch]
                c["default"] = float(rest[1]) if len(rest) > 1 and re.match(r"^-?\d+(\.\d+)?$", rest[1]) else 0.0
            elif kind in ("string", "file"):
                c["default"] = _text(rest[1]) if len(rest) > 1 else ""
            else:
                continue  # text (display only) and the like
            info["controls"].append(c)
    return info


def list_plugins() -> list[dict]:
    """Audacity's bundled Nyquist plug-ins that process audio, with their controls."""
    out = []
    for p in sorted(plugins_dir().glob("*.ny")):
        try:
            info = parse_plugin(p)
        except OSError:
            continue
        if info["type"] == "process" and info["controls"] is not None:
            out.append(info)
    return out


def _num(v: float) -> str:
    """A real as Audacity gives it to Nyquist: up to 14 significant digits, a dot for the decimal separator."""
    s = f"{float(v):.14g}"
    return s if any(ch in s for ch in ".e") else s + ".0"


def _escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


def preamble(rate: int, channels: int, frames: int, name: str, peak: list[float], rms: list[float], controls: list[dict], values: dict) -> str:
    """The settings Audacity 2.4.2 gives a version 4 plug-in before its code, for one whole clip on one track."""
    dur = frames / rate
    vec = (lambda xs: f"(vector {' '.join(_num(x) for x in xs)})") if channels > 1 else (lambda xs: _num(xs[0]))
    clips = f"(list (list {_num(0)} {_num(dur)}))"
    lines = [
        "(putprop '*AUDACITY* (list 2 4 2) 'VERSION)",
        "(putprop '*AUDACITY* \"en\" 'LANGUAGE)",
        "(setf *DECIMAL-SEPARATOR* #\\.)",
        f"(putprop '*SYSTEM-DIR* \"{_escape(str(runtime_dir()))}\" 'BASE)",
        f"(putprop '*SYSTEM-DIR* (list \"{_escape(str(plugins_dir()))}\") 'PLUGIN)",
        f"(putprop '*SYSTEM-DIR* (list \"{_escape(str(plugins_dir()))}\") 'PLUG-IN)",
        f"(putprop '*SYSTEM-DIR* \"{_escape(tempfile.gettempdir())}\" 'TEMP)",
        "(putprop '*PROJECT* 1 'PROJECTS)",
        "(putprop '*PROJECT* \"formwav\" 'NAME)",
        f"(putprop '*PROJECT* (float {_num(rate)}) 'RATE)",
        "(putprop '*PROJECT* 1 'TRACKS)",
        "(putprop '*PROJECT* 1 'WAVETRACKS)",
        "(putprop '*PROJECT* 0 'LABELTRACKS)",
        "(putprop '*PROJECT* 0 'MIDITRACKS)",
        "(putprop '*PROJECT* 0 'TIMETRACKS)",
        "(setf *PREVIEWP* NIL)",
        f"(putprop '*SELECTION* (float {_num(0)}) 'START)",
        f"(putprop '*SELECTION* (float {_num(dur)}) 'END)",
        "(putprop '*SELECTION* (list 1) 'TRACKS)",
        f"(putprop '*SELECTION* {channels} 'CHANNELS)",
        "(putprop '*SELECTION* NIL 'LOW-HZ)",
        "(putprop '*SELECTION* NIL 'CENTER-HZ)",
        "(putprop '*SELECTION* NIL 'HIGH-HZ)",
        "(putprop '*SELECTION* NIL 'BANDWIDTH)",
        "(snd-set-latency  0.1)",
        "(putprop '*TRACK* 1 'INDEX)",
        f"(putprop '*TRACK* \"{_escape(name)}\" 'NAME)",
        "(putprop '*TRACK* \"wave\" 'TYPE)",
        "(putprop '*TRACK* \"Waveform\" 'VIEW)",
        f"(putprop '*TRACK* {channels} 'CHANNELS)",
        "(putprop '*TRACK* NIL 'SPECTRAL-EDIT-ENABLED)",
        f"(putprop '*TRACK* (float {_num(0)}) 'START-TIME)",
        f"(putprop '*TRACK* (float {_num(dur)}) 'END-TIME)",
        f"(putprop '*TRACK* (float {_num(1)}) 'GAIN)",
        f"(putprop '*TRACK* (float {_num(0)}) 'PAN)",
        f"(putprop '*TRACK* (float {_num(rate)}) 'RATE)",
        "(putprop '*TRACK* 32.0 'FORMAT)",
        f"(putprop '*TRACK* {('(vector ' + clips + ' ' + clips + ')') if channels > 1 else clips} 'CLIPS)",
        f"(putprop '*SELECTION* {vec(peak)} 'PEAK)",
        f"(putprop '*SELECTION* (float {_num(max(peak))}) 'PEAK-LEVEL)",
        f"(putprop '*SELECTION* {vec(rms)} 'RMS)",
        "(setf *tracenable* NIL)",
    ]
    for c in controls:
        v = values.get(c["var"], c.get("default"))
        if c["type"] in ("real", "float", "time", "float-text"):
            lines.append(f"(setf {c['var']} {_num(v if v is not None else 0)})")
        elif c["type"] in ("int", "int-text", "choice"):
            lines.append(f"(setf {c['var']} {int(float(v or 0))})")
        elif c["type"] in ("string", "file"):
            lines.append(f"(setf {c['var']} \"{_escape(str(v or ''))}\")")
    return "\n".join(lines) + "\n"


def run(media_id: str, code: str | None = None, plugin: str | None = None, values: dict | None = None) -> dict:
    """Nyquist on the clip `media_id`: the prompt's `code`, or the bundled `plugin` (its file's name) with `values` for
    its controls. A sound comes back as new media; any other result as {"result": ...}."""
    import numpy as np

    from .tools import _wav_view

    values = values or {}
    if plugin:
        path = plugins_dir() / f"{Path(plugin).name}.ny"
        if not path.is_file():
            raise media.MediaError(f"no Nyquist plug-in named {plugin}")
        info = parse_plugin(path)
        # a version 4 header's lines start with $, which Lisp does not take as a comment: they would be evaluated
        # (errors on $CONTROL and the like, as my first run found); Audacity leaves them out, here they become comments
        # (with the lines a header's open brackets carry on to: a choice list's later items were evaluated otherwise)
        src_lines, kept, open_brackets, quoted = path.read_text(encoding="utf-8", errors="replace").splitlines(), [], 0, False
        for ln in src_lines:
            if open_brackets > 0 or quoted or ln.lstrip().startswith("$"):
                if quoted or not ln.lstrip().startswith(";"):
                    d, quoted = _scan(ln, quoted)  # a quote can run on to the next line (a two-line label)
                    open_brackets = max(0, open_brackets + d)
                kept.append(";" + ln)
            else:
                kept.append(ln)
        body = "\n".join(kept)
        label = info["name"]
        controls = info["controls"]
    else:
        if not code or not code.strip():
            raise media.MediaError("no Nyquist code to run")
        body, label, controls = code, "Nyquist Prompt", []
    if not Path(binary()).is_file():
        raise media.MediaError("Nyquist is not built here (native/formwav-nyquist/build_fwnyq makes fwnyq)")
    view, rate = _wav_view(media_id)
    x = np.asarray(view, dtype=np.float64)
    frames, channels = int(x.shape[0]), int(x.shape[1])
    peak = [float(np.abs(x[:, c]).max()) if frames else 0.0 for c in range(channels)]
    rms = [float(np.sqrt(np.mean(x[:, c] ** 2))) if frames else 0.0 for c in range(channels)]
    name = str(media.media_info(media_id).get("name", "track")).rsplit(".", 1)[0]
    with tempfile.TemporaryDirectory(prefix="formwav-nyquist-") as tmp:
        script = Path(tmp) / "script.lsp"
        script.write_text(preamble(rate, channels, frames, name, peak, rms, controls, values) + body + "\n", encoding="utf-8")
        out = Path(tmp) / "out.wav"
        try:
            done = subprocess.run([binary(), str(runtime_dir()), str(media.media_dir() / f"{media_id}.wav"), str(out), str(script)], capture_output=True, timeout=600)
        except subprocess.TimeoutExpired as err:
            raise media.MediaError("Nyquist did not finish within 10 minutes") from err
        except OSError as err:
            raise media.MediaError(f"Nyquist was built for another computer; run native/formwav-nyquist/build_fwnyq here ({err.strerror})") from err
        printed = (done.stderr or b"").decode("utf-8", errors="replace")
        lines = [ln for ln in (done.stdout or b"").decode("utf-8", errors="replace").splitlines() if ln.startswith("{")]
        if done.returncode != 0 or not lines:
            # Nyquist's own error lines (its break prompts, "1>" and the like, say nothing)
            errors = [ln.strip() for ln in printed.splitlines() if ln.strip().lower().startswith("error")]
            tail = errors[:2] or [ln for ln in printed.strip().splitlines() if ln.strip() and not ln.strip().endswith(">")][-2:]
            raise media.MediaError("Nyquist: " + (" | ".join(tail) or f"exit status {done.returncode}")[:400])
        result = json.loads(lines[-1])
        if result.get("type") == "audio":
            return media.import_wav(f"{name} ({label}).wav", out.read_bytes())
        return {"result": result, "printed": printed[-2000:]}
