"""API keys kept by the engine, set from Preferences (2.25.0): in the system's password store (macOS Keychain, Windows
Credential Manager, the Secret Service on Linux) through keyring (MIT) where there is one, otherwise in a file in the
data folder that only the user can read. The same way FormVis keeps its keys, with formwav's service name.

A key the person has not set here is still read from the environment, which backend/.env fills at start, so an
existing setup keeps working: `get` answers the store first, then the environment. The page never receives a key:
`summary` gives whether one is kept, where it came from and its last four characters, and nothing else.

The password store is reached only when a key is saved, removed or used. Status checks answer from keys.json, which
names the keys kept in the store with their last four characters, never a key."""

from __future__ import annotations

import json
import os
import tempfile
import threading
from pathlib import Path

from ..core.paths import data_dir

SERVICE = "formwav"

#: The keys the engine knows, with the words Preferences shows for each provider.
KEYS = {
    "ELEVENLABS_API_KEY": "ElevenLabs",
    "FAL_KEY": "fal",
    "ANTHROPIC_API_KEY": "Anthropic",
}

_held: dict[str, str] = {}
_lock = threading.RLock()


def _index_path() -> Path:
    return data_dir() / "keys.json"


def _file_path() -> Path:
    return data_dir() / "keys-file.json"


def _read(path: Path) -> dict:
    try:
        found = json.loads(path.read_text())
        return found if isinstance(found, dict) else {}
    except (OSError, ValueError):
        return {}


def _write(path: Path, content: dict) -> None:
    """Replaces the file whole, readable by the user alone from its first byte."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(dir=path.parent, prefix=".keys-", suffix=".tmp")
    try:
        os.chmod(temp, 0o600)
        with os.fdopen(fd, "w") as handle:
            json.dump(content, handle)
        os.replace(temp, path)
    except BaseException:
        try:
            os.unlink(temp)
        except OSError:
            pass
        raise


def _last4(value: str | None) -> str:
    return value[-4:] if value and len(value) >= 8 else ""


def _store():
    """The system's password store, or None where there is none (keyring missing, or its fail and null backends)."""
    try:
        import keyring
        from keyring.backends import fail, null

        found = keyring.get_keyring()
    except Exception:  # noqa: BLE001 - any failure to reach a store means the file is used
        return None
    if isinstance(found, (fail.Keyring, null.Keyring)) or getattr(found, "priority", 1) <= 0:
        return None
    return found


def where() -> dict:
    found = _store()
    return {"store": "system" if found else "file", "backend": type(found).__name__ if found else "file readable only by you"}


def _check(name: str) -> None:
    if name not in KEYS:
        raise KeyError(name)


def _kept(name: str) -> str | None:
    """The key as this engine holds it: from the password store when keys.json names it there, else from the file."""
    if name in _held:
        return _held[name]
    if name in _read(_index_path()):
        found = _store()
        if found is not None:
            try:
                value = found.get_password(SERVICE, name)
            except Exception:  # noqa: BLE001 - a store that refuses leaves the file copy
                value = None
            if value:
                _held[name] = value
                return value
    value = _read(_file_path()).get(name)
    return value if isinstance(value, str) and value else None


def get(name: str) -> str:
    """The key a feature is about to use: the one set in Preferences, else the environment's (backend/.env). Empty if none."""
    _check(name)
    with _lock:
        return (_kept(name) or os.environ.get(name, "")).strip()


def summary(name: str) -> dict:
    """Whether a key is available, where from ("store", "file" or "environment") and its last four characters. Never asks
    the password store, and never carries the key."""
    _check(name)
    with _lock:
        index = _read(_index_path())
        if name in index:
            held = _held.get(name)
            entry = index[name] if isinstance(index[name], dict) else {}
            return {"set": True, "source": "store", "last4": _last4(held) if held else str(entry.get("last4", ""))}
        value = _read(_file_path()).get(name)
        if isinstance(value, str) and value:
            return {"set": True, "source": "file", "last4": _last4(value)}
        env = os.environ.get(name, "").strip()
        return {"set": bool(env), "source": "environment" if env else "", "last4": _last4(env)}


def has(name: str) -> bool:
    return summary(name)["set"]


def put(name: str, value: str) -> str:
    """Keeps `value`; where it went, "store" or "file". The store is read back before the file copy is dropped."""
    _check(name)
    value = value.strip()
    if not value:
        raise ValueError("a key is not empty")
    with _lock:
        found = _store()
        if found is not None:
            try:
                found.set_password(SERVICE, name, value)
                if found.get_password(SERVICE, name) == value:
                    _write(_index_path(), {**_read(_index_path()), name: {"last4": _last4(value)}})
                    _held[name] = value
                    files = _read(_file_path())
                    if name in files:
                        _write(_file_path(), {k: v for k, v in files.items() if k != name})
                    return "store"
            except Exception:  # noqa: BLE001 - the file keeps the key rather than losing it
                pass
        _held.pop(name, None)
        index = _read(_index_path())
        if name in index:
            _write(_index_path(), {k: v for k, v in index.items() if k != name})
        _write(_file_path(), {**_read(_file_path()), name: value})
        return "file"


def delete(name: str) -> None:
    """Forgets the key set here, in the password store and the file; one in the environment is not touched."""
    _check(name)
    with _lock:
        found = _store()
        if found is not None:
            try:
                found.delete_password(SERVICE, name)
            except Exception:  # noqa: BLE001 - it was not there
                pass
        index = _read(_index_path())
        if name in index:
            _write(_index_path(), {k: v for k, v in index.items() if k != name})
        files = _read(_file_path())
        if name in files:
            _write(_file_path(), {k: v for k, v in files.items() if k != name})
        _held.pop(name, None)


# The agent's model name is the one other setting the engine keeps for Preferences: a plain value, in settings.json.
def _settings() -> dict:
    return _read(data_dir() / "settings.json")


def agent_model() -> str:
    """The model the in-app agent uses: the one chosen in Preferences, else FORMWAV_AGENT_MODEL, else the default."""
    chosen = _settings().get("agentModel")
    if isinstance(chosen, str) and chosen.strip():
        return chosen.strip()
    return os.environ.get("FORMWAV_AGENT_MODEL", "").strip() or DEFAULT_AGENT_MODEL


def set_agent_model(model: str) -> str:
    model = model.strip()
    if len(model) > 80 or any(c.isspace() for c in model):
        raise ValueError("a model name is one word of at most 80 characters")
    found = _settings()
    if model:
        found["agentModel"] = model
    else:
        found.pop("agentModel", None)
    with _lock:
        (data_dir()).mkdir(parents=True, exist_ok=True)
        _write(data_dir() / "settings.json", found)
    return agent_model()


DEFAULT_AGENT_MODEL = "claude-sonnet-5-5"
