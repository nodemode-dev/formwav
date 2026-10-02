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
    print(json.dumps(info))
    return 0


def main() -> int:
    if "--selfcheck" in sys.argv:
        return selfcheck()
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
    data = user_data_dir()
    data.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("FORMWAV_DATA_DIR", str(data))
    load_env(data / ".env")
    os.environ.setdefault("FORMWAV_DIST", os.path.join(resource_dir(), "frontend_dist"))
    import uvicorn

    from app.main import app as fastapi_app

    port = int(os.environ.get("FORMWAV_PORT", "0") or 0)
    uvicorn.run(fastapi_app, host="127.0.0.1", port=port, log_level="info")
    return 0


if __name__ == "__main__":
    sys.exit(main())
