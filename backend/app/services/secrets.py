"""API keys kept by the engine, set from Preferences, kept exactly as FormVis keeps its keys (its services/secrets.py,
1.52.5 and 1.98.9), with formwav's service name: in the system's password store (macOS Keychain, Windows Credential
Manager, the Secret Service on Linux) through keyring (MIT), or, where there is none, in a file in the data folder
readable only by the user. A password store that fails leaves the key in the file: a key is never lost.

A key in the environment (backend/.env fills it at start) comes first, as in FormVis: Preferences shows it as set in the
environment and its Clear stays off, since the engine cannot forget it. The page never receives a key: `summary` gives
whether one is kept, where it came from, its last four characters and whether the service refused it, nothing else.

The password store is reached only when a key is saved, removed or used. Status checks answer from keys.json, which
names the keys kept in the store with their last four characters, never a key. A key found in the file is moved to the
password store the first time a feature uses it, and the file copy removed; a key an earlier version saved in the store
without a keys.json entry is asked for once a session."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import threading
import time
from pathlib import Path

from ..core.paths import data_dir

SERVICE = "formwav"

#: The keys the engine sends, with the words Preferences shows for each provider and where to get one.
KEYS = {
    "ELEVENLABS_API_KEY": "ElevenLabs",
    "FAL_KEY": "fal",
    "ANTHROPIC_API_KEY": "Anthropic",
    "ACESTEP_API_KEY": "ACE-Step server",
}
LINKS = {
    "ELEVENLABS_API_KEY": "https://elevenlabs.io/app/settings/api-keys",
    "FAL_KEY": "https://fal.ai/dashboard/keys",
    "ANTHROPIC_API_KEY": "https://console.anthropic.com/settings/keys",
}
#: The provider words the engine's errors use, to the key a refusal is held against.
PROVIDER_KEY = {"ElevenLabs": "ELEVENLABS_API_KEY", "fal": "FAL_KEY", "Anthropic": "ANTHROPIC_API_KEY", "ACE-Step": "ACESTEP_API_KEY"}

#: Keys this session read from the password store or saved there, so a later status check need not ask again.
_held: dict[str, str] = {}
#: Names keys.json does not list that the password store had nothing for this session, so a use asks only once.
_asked: set[str] = set()
#: A fingerprint of each key a service refused, with the time it did; a new key, Clear or a later success lifts it.
_refused: dict[str, float] = {}
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


def _index() -> dict:
    return _read(_index_path())


def _index_set(name: str, value: str) -> None:
    _write(_index_path(), {**_index(), name: {"last4": _last4(value)}})


def _index_drop(name: str) -> None:
    found = _index()
    if name in found:
        _write(_index_path(), {k: v for k, v in found.items() if k != name})


def _entry(name: str) -> dict | None:
    found = _index().get(name)
    return found if isinstance(found, dict) else None


def _file_read(name: str) -> str | None:
    value = _read(_file_path()).get(name)
    return value.strip() if isinstance(value, str) and value.strip() else None


def _file_write(name: str, value: str) -> None:
    _write(_file_path(), {**_read(_file_path()), name: value})


def _file_clear(name: str) -> None:
    files = _read(_file_path())
    if name in files:
        _write(_file_path(), {k: v for k, v in files.items() if k != name})


def _last4(value: str | None) -> str:
    return value[-4:] if value and len(value) >= 8 else ""


def _env(name: str) -> str:
    return os.environ.get(name, "").strip()


def _print(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


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


def _ask(store, name: str) -> tuple[str | None, bool]:
    """The stored key, and whether the password store answered at all (False when it refused or failed)."""
    try:
        return store.get_password(SERVICE, name) or None, True
    except Exception:  # noqa: BLE001 - a store that refuses is a store that did not answer
        return None, False


def _keep(store, name: str, value: str) -> bool:
    """Saves `value` in the password store, read back, then names it in keys.json; the file copy goes last."""
    try:
        store.set_password(SERVICE, name, value)
        if store.get_password(SERVICE, name) != value:
            return False
        _index_set(name, value)
        _held[name] = value
        _asked.discard(name)
        _file_clear(name)
        return True
    except Exception:  # noqa: BLE001 - the file keeps the key rather than losing it
        return False


def _ask_once(store, name: str) -> str | None:
    """A key an earlier version saved in the password store without a keys.json entry: asked once a session."""
    if name in _asked:
        return None
    value, answered = _ask(store, name)
    if value:
        try:
            _index_set(name, value)
        except OSError:
            pass
        _held[name] = value
        return value
    if answered:
        _asked.add(name)
    return None


def _kept(name: str) -> str | None:
    """The key set in Preferences, for a feature about to use it: held this session, from the password store when
    keys.json names it, from the file (moved to the password store on this first use), or a key an earlier version saved
    in the password store."""
    if name in _held:
        return _held[name]
    store = _store()
    if store is None:
        return _file_read(name)
    if _entry(name) is not None:
        value, answered = _ask(store, name)
        if value:
            _held[name] = value
            return value
        if not answered:
            return _file_read(name)
        _index_drop(name)
        _asked.add(name)
    legacy = _file_read(name)
    if legacy:
        _keep(store, name, legacy)
        return legacy
    return _ask_once(store, name)


def get(name: str) -> str:
    """The key a feature is about to use: the environment's (backend/.env) first, else the one set in Preferences.
    Empty if none."""
    _check(name)
    env = _env(name)
    if env:
        return env
    with _lock:
        return (_kept(name) or "").strip()


def summary(name: str) -> dict:
    """Whether a key is available, where from ("environment", "system" for the password store, or "file"), its last
    four characters, and whether the service refused it. Never asks the password store, and never carries the key."""
    _check(name)
    with _lock:
        env = _env(name)
        if env:
            source, last4, value = "environment", _last4(env), env
        elif (entry := _entry(name)) is not None:
            value = _held.get(name)
            source, last4 = "system", _last4(value) if value else str(entry.get("last4", ""))
        elif value := _file_read(name):
            source, last4 = "file", _last4(value)
        else:
            source, last4, value = "", "", None
        refused_at = _refused.get(_print(value), 0) if value else 0
        if not value and source == "system" and _refused:
            refused_at = _refused.get(f"name:{name}", 0)
        return {"set": bool(source), "source": source, "last4": last4, "refused": bool(refused_at), "refusedAt": refused_at}


def has(name: str) -> bool:
    return summary(name)["set"]


def refused(name: str) -> None:
    """Called when a service answers 401 or 403 to the key in use: Preferences shows it refused until it changes."""
    if name not in KEYS:
        return
    with _lock:
        value = _env(name) or _held.get(name) or _file_read(name)
        stamp = round(time.time())
        if value:
            _refused[_print(value)] = stamp
        _refused[f"name:{name}"] = stamp


def accepted(name: str) -> None:
    """A service took the key in use: any refusal held against it is lifted."""
    if name not in KEYS or not _refused:
        return
    with _lock:
        value = _env(name) or _held.get(name) or _file_read(name)
        if value:
            _refused.pop(_print(value), None)
        _refused.pop(f"name:{name}", None)


def put(name: str, value: str) -> str:
    """Keeps `value`; where it went: "system" or "file". The file copy goes only after keys.json names the key."""
    _check(name)
    value = value.strip()
    if not value or len(value) > 512 or any(c.isspace() for c in value):
        raise ValueError(f"That does not look like a {KEYS[name]} key.")
    with _lock:
        _asked.discard(name)
        _refused.pop(f"name:{name}", None)
        store = _store()
        if store is not None and _keep(store, name, value):
            return "system"
        _held.pop(name, None)
        _index_drop(name)
        _file_write(name, value)
        return "file"


def delete(name: str) -> None:
    """Forgets the key set here when the person clears it: from the password store too, including a key an earlier
    version saved there and keys.json does not name. One in the environment is not touched."""
    _check(name)
    with _lock:
        store = _store()
        if store is not None:
            try:
                store.delete_password(SERVICE, name)
            except Exception:  # noqa: BLE001 - it was not there
                pass
        held = _held.pop(name, None) or _file_read(name)
        if held:
            _refused.pop(_print(held), None)
        _refused.pop(f"name:{name}", None)
        _index_drop(name)
        _asked.discard(name)
        _file_clear(name)


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
