"""AU-28: Nyquist, by its own interpreter (native/formwav-nyquist/fwnyq, the vendored 2.4.2 libnyquist).

A Nyquist Prompt's code, or one of the bundled Nyquist plug-ins with its controls, runs on a clip: the clip goes
in as *TRACK*, preceded by the settings a version 4 plug-in is given (the
host version and language, *SYSTEM-DIR*, *PROJECT*, *SELECTION* and *TRACK* properties, the latency, *tracenable*, and each control
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


PLUGIN_SOURCE = "https://raw.githubusercontent.com/audacity/audacity/Audacity-2.4.2/plug-ins/"
PLUGIN_PINS = {
    "SilenceMarker.ny": "27163e80d0f2c0949f90176379662443dcfdcf2e4e827629b26c564ba3d4d0fd",
    "SoundFinder.ny": "82945887fd3ed6ac74a2bfa001f6963d43dbdfb113e3b4ec24155a8e7b7b493b",
    "SpectralEditMulti.ny": "f839c7dc005d389774614732f482c27124377de089f475a25fb20c32897ed1e2",
    "SpectralEditParametricEQ.ny": "58a5cd8e11026edfdad225e1d72f14a014c2537e2ce5acab68b29004bd8edd90",
    "SpectralEditShelves.ny": "d581d58cf5228426e72130c6b3498af03a716c55714a76b583e6ba2f1e596c78",
    "StudioFadeOut.ny": "3758373e60cb0d892ddfd3c56c3747d8953c09d7d486bfa52cc1500f1b0386f3",
    "adjustable-fade.ny": "f2971f2414ee6fca2e3cf939583c37c87b814654cbfd70750b58f423bb1ce986",
    "beat.ny": "2effbf1ca5fee198c79942435c7c18058a086f41748366227d0394d40e0a92e4",
    "clipfix.ny": "7dac6ddf8905bd35b5bf534ebafc53596cabe553562a9e5371bdeee5491edd50",
    "crossfadeclips.ny": "3d8893cff7803f6d918c944b0f99389ce859fa0ec83b79b4d67056632fb3b2a9",
    "crossfadetracks.ny": "0b03df1f672cef85c355310303f4036291954e02aa7093a1118f8d611d3ddf1d",
    "delay.ny": "6219f82c9529a78c3df0771fd405e696007ecedfc90989fa0a1f670da510252d",
    "eq-xml-to-txt-converter.ny": "1cc8e7d83d4042e05c17ea139326640c40724cf5ae862d4ec768ee1b5f851041",
    "equalabel.ny": "322c87af4b834c8e38d13167e243c14ebc3d023cd607895c206229114248a28a",
    "highpass.ny": "5f4f22e98ca1609128525bcbf8b61e5cacc50692c5bdd47b6652e768ae28aa78",
    "limiter.ny": "2e87f3814b0e7a6ad722976f7c2a081c617d685fb4473be73b2bf352dd6fe451",
    "lowpass.ny": "1e3beb91de75894b3f2e3380ae48a95b3dd1ab4dae9392c77c418f8d3628b401",
    "noisegate.ny": "74d92281d527ae32cd13f32f9144e37d26511ed8b13d606e73c44aa6d5160c7c",
    "notch.ny": "27fe135716bd7851f5a877aa64b71cbdc8c5cc990c4807a498ef7abf4b9548da",
    "nyquist-plug-in-installer.ny": "df909cf00c352f9b4fbe8f950c4ecacc65c987ce656e4f33e2e167d262660cd3",
    "pluck.ny": "3a14aff19896fe762d7fd69ad6b12cf6fae14a3630622fe22756e9018ab98f2d",
    "rhythmtrack.ny": "4087db34b524f134089f1336845be6657f482e4a54dc4a025a49a21e94da217e",
    "rissetdrum.ny": "c5aae37565d5d4bf15bd47376dd14a43e87fb17e9609f55167200dcdbff2a193",
    "rms.ny": "e5c6733f2b313f1a0b05773948f6c2811b6cce12b6244c8bfbf93cbf39928869",
    "sample-data-export.ny": "b3f449584b4d2b9f3ac5d71699ddaf552a7a2805f078674913eb4344361c1ea0",
    "sample-data-import.ny": "da6b4d0feaae9097a3d8503a53b1103ebccda19da62e731fadfa9b812f7eae25",
    "spectral-delete.ny": "0b3b6ef201aa5be62528cf98a4f27b02ee5c32831951d437a166d8eeebbcff22",
    "tremolo.ny": "33d7cd8d198d09e604bb2d30bfde2a27fd47cfa444e427027632c4dc6fc9e507",
    "vocalrediso.ny": "639d37b0e30d6ce7b6726c0fffc3f627ac95c3eafec67b987271016d9836d8df",
    "vocoder.ny": "398c78eb560830f7551dc05d00f6b6702605cfd13c28af0075383aa947be9739",
}


def installed_dir() -> Path:
    from ..core import paths

    return paths.data_dir() / "nyquist-plugins"


def plugins_dir() -> Path:
    """The plug-ins are GPL-2.0 and never ship in the app: a person installs them (install_plugins); a checkout uses its own copy."""
    if os.environ.get("FORMWAV_NYQUIST_PLUGINS"):
        return Path(os.environ["FORMWAV_NYQUIST_PLUGINS"])
    if any(installed_dir().glob("*.ny")) or _bundled("frontend_dist"):
        return installed_dir()
    return _ROOT / "plug-ins"


def install_plugins() -> dict:
    """Downloads the 30 plug-ins from their publisher's repository at the pinned tag, each checked against its SHA-256."""
    import hashlib
    import urllib.request

    target = installed_dir()
    target.mkdir(parents=True, exist_ok=True)
    got = 0
    for name, pin in PLUGIN_PINS.items():
        path = target / name
        if path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == pin:
            got += 1
            continue
        try:
            with urllib.request.urlopen(PLUGIN_SOURCE + name, timeout=60) as response:
                data = response.read(2_000_000)
        except OSError as err:
            raise media.MediaError(f"the Nyquist plug-ins could not be downloaded ({name}: {err})") from err
        if hashlib.sha256(data).hexdigest() != pin:
            raise media.MediaError(f"{name} did not match its pinned checksum, so it was not installed")
        temporary = path.with_suffix(".download")
        temporary.write_bytes(data)
        temporary.replace(path)
        got += 1
    return {"installed": got, "dir": str(target), "licence": "GPL-2.0", "source": PLUGIN_SOURCE}


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
    """A .ny plug-in's header: its name, type and controls (read from its ;name, ;type and ;control lines)."""
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
    """The bundled Nyquist plug-ins that process audio, with their controls."""
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
    """A real as Nyquist takes it: up to 14 significant digits, a dot for the decimal separator."""
    s = f"{float(v):.14g}"
    return s if any(ch in s for ch in ".e") else s + ".0"


def _escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')


def preamble(rate: int, channels: int, frames: int, name: str, peak: list[float], rms: list[float], controls: list[dict], values: dict) -> str:
    """The settings a version 4 plug-in is given before its code, for one whole clip on one track."""
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
        # (errors on $CONTROL and the like, as my first run found); here they become comments
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
