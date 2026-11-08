"""The models on this computer, as Preferences > Models on this computer manages them (2.25.0): removing an installed
model, opening the models folder in the system's file manager, and what the models take on disk.

A model's files live in one folder under the models folder (FORMWAV_MODELS_ROOT, backend/models from a checkout): Kokoro's
two files in kokoro, TIGER-DnR in tiger-dnr, EzAudio in ezaudio, SoulX-Singer in soulx-singer, acestep.cpp in
acestep-cpp, each dubbing pair in translate/en_<lang>. Remove deletes only those, and only after checking that the
resolved path lies inside the models folder and is not the folder itself; a symbolic link is unlinked, never followed.
SoulX-Singer's voices folder holds the person's own singers and is kept. Pocket TTS and Chatterbox install no files in
the models folder (their packages live in the speech runtime), so Remove uninstalls their package from that runtime;
the shared PyTorch stays for the other engines. Nothing installing is removed."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

from . import local_dub, local_speech
from .providers import ProviderError

#: Engine id to the paths below the models folder that Remove deletes (and the package it uninstalls, if any).
ENGINE_PATHS: dict[str, list[str]] = {
    "kokoro": ["kokoro/kokoro-v1.0.onnx", "kokoro/voices-v1.0.bin"],
    "pocket": [],
    "chatterbox": [],
    "tiger": ["tiger-dnr"],
    "ezaudio": ["ezaudio"],
    "soulx-singer": ["soulx-singer/code"],
    "acestep": ["acestep-cpp"],
}


def root() -> Path:
    return Path(os.environ.get("FORMWAV_MODELS_ROOT", Path(__file__).resolve().parents[2] / "models")).expanduser()


def _inside(path: Path) -> Path:
    """`path` under the models folder, or a refusal: the one check every delete passes."""
    base = root().resolve()
    target = path if path.is_symlink() else path.resolve()
    parent = target.parent.resolve()
    if target.resolve() == base or (parent != base and base not in parent.parents):
        raise ProviderError(400, "that is not inside the models folder")
    return target


def _delete(path: Path) -> None:
    target = _inside(path)
    if target.is_symlink() or target.is_file():
        target.unlink(missing_ok=True)
    elif target.is_dir():
        shutil.rmtree(target)


def _forget(engine: str) -> None:
    """The services remember that an engine is installed; after a removal they must look again."""
    from . import acestep_local, local_sfx, singing, tiger_dnr

    local_speech._known.pop(engine, None)
    for module, key in ((tiger_dnr, "tiger"), (local_sfx, "ezaudio"), (singing, "soulx"), (acestep_local, "acestep")):
        module._known.pop(key, None)


def _busy(engine: str) -> bool:
    from . import acestep_local, local_sfx, singing, tiger_dnr

    states = {
        "tiger": tiger_dnr._state["installing"],
        "ezaudio": local_sfx._state["installing"],
        "soulx-singer": singing._state["installing"],
        "acestep": acestep_local._state["installing"],
    }
    return (states.get(engine) or local_speech._installing.get(engine, "")).startswith("installing")


def _uninstall_package(engine: str) -> None:
    python = local_speech._python()
    if not python.exists():
        return
    done = subprocess.run([str(python), "-m", "pip", "uninstall", "-y", local_speech.ENGINES[engine]["package"].split("==")[0]], capture_output=True, timeout=600)
    if done.returncode != 0:
        raise ProviderError(502, f"{local_speech.ENGINES[engine]['name']} could not be uninstalled: {local_speech._last_line(done)}")


def remove_engine(engine: str) -> dict:
    """Deletes an installed engine's files inside the models folder (and uninstalls its package from the speech runtime)."""
    if engine not in ENGINE_PATHS:
        raise ProviderError(404, f"no model named {engine}")
    if _busy(engine):
        raise ProviderError(409, "that model is installing; wait for it to finish")
    if engine == "acestep":
        from . import acestep_local

        acestep_local._stop()
    for relative in ENGINE_PATHS[engine]:
        path = root() / relative
        if path.exists() or path.is_symlink():
            _delete(path)
    if engine in local_speech.ENGINES:
        _uninstall_package(engine)
    _forget(engine)
    return {"removed": engine}


def remove_dub(lang: str) -> dict:
    """Deletes one dubbing pair's translation model."""
    if lang not in local_dub.LANGS:
        raise ProviderError(404, f"no dubbing language {lang}")
    if local_dub._installing.get(lang, "").startswith("installing"):
        raise ProviderError(409, "that model is installing; wait for it to finish")
    base = local_dub._base(lang)
    if base.exists() or base.is_symlink():
        _delete(base)
    local_dub._installing.pop(lang, None)
    return {"removed": lang}


def _size(path: Path) -> int:
    if not path.exists():
        return 0
    if path.is_file():
        return path.stat().st_size
    total = 0
    for folder, _, names in os.walk(path):
        for name in names:
            try:
                total += (Path(folder) / name).lstat().st_size
            except OSError:
                continue
    return total


def disk() -> dict:
    """The models folder, what it holds, and the speech runtime's size (the PyTorch and packages the engines run on)."""
    folder = root()
    return {"folder": str(folder), "bytes": _size(folder), "runtimeBytes": _size(local_speech._runtime()), "exists": folder.is_dir()}


def open_folder() -> dict:
    """Shows the models folder in the system's file manager, made first if it is not there yet."""
    folder = root()
    folder.mkdir(parents=True, exist_ok=True)
    if sys.platform == "darwin":
        command = ["open", str(folder)]
    elif os.name == "nt":
        command = ["explorer", str(folder)]
    else:
        command = ["xdg-open", str(folder)]
    try:
        subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError as err:
        raise ProviderError(501, f"this computer has no file manager to open {folder}: {err}") from err
    return {"opened": str(folder)}
