"""formwav's engine as the desktop app's sidecar (tauri-compiler-skill: tauri-backend-engine). PyInstaller freezes this
file into `formwav-engine`; the Tauri shell starts it with FORMWAV_PORT=0, reads the port from uvicorn's bind line and
opens its window there. `--selfcheck` prints one JSON line and exits, for the build script to gate on.

A onefile binary unpacks into a temporary folder that is deleted when it exits, so nothing the user makes may live
beside the code: media, sessions and transcripts go to the per-user data folder (FORMWAV_DATA_DIR when set), and the
engine's keys are read from a .env in that folder (KEY=VALUE lines, never overriding the environment).
"""

import os
import sys

if sys.stdin is None:
    sys.stdin = open(os.devnull, encoding="utf-8")
if sys.stdout is None:
    sys.stdout = open(os.devnull, "w", encoding="utf-8")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w", encoding="utf-8")

import copy
import json
import logging
import shutil
from logging.handlers import RotatingFileHandler
from pathlib import Path

APP_ID = "ai.nodemode.formwav"
LOG_NAME = "formwav-engine.log"
LOG_HANDLER = "formwav-file"
LOG_BYTES = 1_048_576
LOG_KEEP = 3
LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s %(message)s"


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
    try:
        return serve()
    except BaseException as err:
        if not isinstance(err, SystemExit):
            logging.getLogger("formwav").exception("the engine stopped on an error")
        raise


def start_logging(data: Path) -> Path:
    folder = data / "Logs"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / LOG_NAME
    for held in logging.getLogger("formwav").handlers:
        if held.get_name() == LOG_HANDLER and getattr(held, "baseFilename", "") == os.path.abspath(path):
            return path
    handler = RotatingFileHandler(path, maxBytes=LOG_BYTES, backupCount=LOG_KEEP, encoding="utf-8")
    handler.setFormatter(logging.Formatter(LOG_FORMAT))
    handler.set_name(LOG_HANDLER)
    logger = logging.getLogger("formwav")
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
    logger.info("engine started, pid %s, data folder %s", os.getpid(), data)
    return path


def log_config() -> dict:
    from uvicorn.config import LOGGING_CONFIG

    held = next((h for h in logging.getLogger("formwav").handlers if h.get_name() == LOG_HANDLER), None)
    config = copy.deepcopy(LOGGING_CONFIG)
    if held is None:
        return config
    config["handlers"][LOG_HANDLER] = {"()": lambda: held}
    for name in ("uvicorn", "uvicorn.access"):
        config["loggers"][name]["handlers"].append(LOG_HANDLER)
    return config


def give_up(lock: Path) -> None:
    from app.core import startup

    try:
        if startup.read_lock(lock).get("pid") == os.getpid():
            lock.unlink()
    except OSError:
        pass


def watch_shell(lock: Path) -> None:
    from app.core import startup

    shell = startup.shell_pid()
    if shell <= 1:
        return

    def leave() -> None:
        logging.getLogger("formwav").info("the app that started this engine is gone (process %s), stopping", shell)
        give_up(lock)
        os._exit(0)

    startup.watch(shell, leave)


def serve() -> int:
    from app.core import startup

    tool_path()
    data = user_data_dir()
    try:
        data.mkdir(parents=True, exist_ok=True)
        logs = start_logging(data).parent
    except OSError as err:
        print(f"formwav cannot use its data folder {data}: {err}", file=sys.stderr)
        return 5
    startup.keep_errors(logs)
    log = logging.getLogger("formwav")
    if startup.alone():
        beside = startup.app_beside(Path(sys.executable))
        if beside is not None and startup.open_app(beside):
            log.info("started without its app, so it opened %s and stopped", beside)
            return 0
        log.error("started without its app, and no app program was found near %s", sys.executable)
        print("formwav-engine is a part of FormWav and serves nothing on its own. Open FormWav instead.", file=sys.stderr)
        return 4
    try:
        lock, replaced = startup.claim(data, startup.shell_pid())
    except startup.Busy as err:
        log.error("%s", err)
        print(err, file=sys.stderr)
        return 2
    if replaced:
        log.warning("an engine left running without its app was stopped (process %s)", replaced)
    try:
        return run_engine(data, lock)
    finally:
        give_up(lock)


def run_engine(data: Path, lock: Path) -> int:
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
                give_up(lock)
                os._exit(0)

        threading.Thread(target=exit_with_shell, daemon=True).start()
    watch_shell(lock)
    os.environ.setdefault("FORMWAV_DATA_DIR", str(data))
    load_env(data / ".env")
    os.environ.setdefault("FORMWAV_MODELS_ROOT", str(data / "models"))
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
                probe.bind(("127.0.0.1", 0))
                port = probe.getsockname()[1]
    from app.services import mcp_stdio

    try:
        (data / mcp_stdio.PORT_FILE).write_text(str(port))
    except OSError:
        pass
    from app.core import window_key

    if window_key.stdout_mode():
        print(window_key.LINE + window_key.KEY, flush=True)
    uvicorn.run(fastapi_app, host="127.0.0.1", port=port, log_level="info", log_config=log_config())
    return 0


if __name__ == "__main__":
    sys.exit(main())
