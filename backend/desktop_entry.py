"""formwav's engine as the desktop app's sidecar (tauri-compiler-skill: tauri-backend-engine). PyInstaller freezes this
file into `formwav-engine`; the Tauri shell starts it with FORMWAV_PORT=0, reads the port from uvicorn's bind line and
opens its window there. `--selfcheck` prints one JSON line and exits, for the build script to gate on.

A onefile binary unpacks into a temporary folder that is deleted when it exits, so nothing the user makes may live
beside the code: media, sessions and transcripts go to the per-user data folder (FORMWAV_DATA_DIR when set), and the
engine's keys are read from a .env in that folder (KEY=VALUE lines, never overriding the environment).
"""

import json
import os
import shutil
import sys
from pathlib import Path

APP_ID = "ai.nodemode.formwav"


def resource_dir() -> str:
    return getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))


def user_data_dir() -> Path:
    if os.environ.get("FORMWAV_DATA_DIR"):
        return Path(os.environ["FORMWAV_DATA_DIR"])
    home = Path.home()
    if sys.platform == "darwin":
        return home / "Library" / "Application Support" / APP_ID
    if os.name == "nt":
        return Path(os.environ.get("APPDATA", home)) / APP_ID
    return Path(os.environ.get("XDG_DATA_HOME", home / ".local" / "share")) / APP_ID


def tool_path() -> None:
    """An app opened from Finder gets a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin), without Homebrew's tools, so the
    engine would not find ffmpeg (imports of MP3, AAC and video, MP3 export) or rubberband (time-stretch), although the
    same build run from a terminal does. Homebrew's usual places are added, where they exist and are not already there."""
    have = os.environ.get("PATH", "").split(os.pathsep)
    extra = [d for d in ("/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin") if os.path.isdir(d) and d not in have]
    if extra:
        os.environ["PATH"] = os.pathsep.join([p for p in have if p] + extra)


def load_env(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def selfcheck() -> int:
    info = {"python": sys.version.split()[0]}
    for name in ("fastapi", "uvicorn", "numpy", "formwav_dsp"):
        try:
            mod = __import__(name)
            info[name] = getattr(mod, "__version__", "ok")
        except Exception as exc:
            info[name] = f"missing: {exc}"
    from app.core.version import VERSION

    info["formwav"] = VERSION
    info["dist_bundled"] = os.path.isfile(os.path.join(resource_dir(), "frontend_dist", "index.html"))
    info["data_dir"] = str(user_data_dir())
    info["ffmpeg_on_path"] = bool(shutil.which("ffmpeg"))
    # the core's native features (native audio output, MIDI input for the desktop app's WebView, which has no Web
    # MIDI): every desktop build up to v1.91.0 left them out unnoticed, so a build without them now fails here
    load_error = None
    try:
        import formwav_dsp

        info["native_output"] = hasattr(formwav_dsp, "NativeOutput")
        info["midi_input"] = hasattr(formwav_dsp, "MidiInput")
    except Exception as exc:  # the core could not be loaded at all (macOS 27 refused a misaligned strip, say)
        load_error = str(exc)
        info["native_output"] = info["midi_input"] = False
    engine_error = None
    try:
        from app.main import app as _engine  # noqa: F401

        info["engine_imports"] = True
    except Exception as exc:
        engine_error = str(exc)
        info["engine_imports"] = False
    print(json.dumps(info))
    if load_error:
        print(f"selfcheck: the audio core could not be loaded: {load_error[:400]}", file=sys.stderr)
        return 1
    if engine_error:
        print(f"selfcheck: the engine could not be imported: {engine_error[:400]}", file=sys.stderr)
        return 1
    if not (info["native_output"] and info["midi_input"]):
        print("selfcheck: the audio core was built without its native features (maturin --features python,native)", file=sys.stderr)
        return 1
    return 0


def main() -> int:
    if "--selfcheck" in sys.argv:
        return selfcheck()
    if "--mcp-stdio" in sys.argv:
        os.environ.setdefault("FORMWAV_DATA_DIR", str(user_data_dir()))
        from app.services import mcp_stdio

        return mcp_stdio.main()
    if os.environ.get("FORMWAV_EXIT_WITH_STDIN") == "1":
        # The shell holds the write end of this stdin pipe; it closes however the shell ends (a quit, a crash, a
        # SIGKILL), and then the engine ends too. Its own kill alone cannot do it: SIGKILL reaches only the onefile
        # bootloader, never the Python process serving, which would live on as an orphan.
        import threading

        def exit_with_shell() -> None:
            try:
                while sys.stdin.buffer.read(65536):
                    pass
            finally:
                os._exit(0)

        threading.Thread(target=exit_with_shell, daemon=True).start()
    tool_path()
    data = user_data_dir()
    data.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("FORMWAV_DATA_DIR", str(data))
    load_env(data / ".env")
    os.environ.setdefault("FORMWAV_DIST", os.path.join(resource_dir(), "frontend_dist"))
    import uvicorn

    from app.main import app as fastapi_app

    port = int(os.environ.get("FORMWAV_PORT", "0") or 0)
    if port == 0:
        import socket

        with socket.socket() as probe:
            try:
                probe.bind(("127.0.0.1", 8060))
                port = 8060
            except OSError:
                port = 0
    from app.services import mcp_stdio

    port_file = data / mcp_stdio.PORT_FILE
    try:
        if port:
            port_file.write_text(str(port))
        else:
            port_file.unlink(missing_ok=True)
    except OSError:
        pass
    uvicorn.run(fastapi_app, host="127.0.0.1", port=port, log_level="info")
    return 0


if __name__ == "__main__":
    sys.exit(main())
