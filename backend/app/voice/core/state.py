"""Shared application state.

Builds the single TTSEngine and the extension context once, activates
extensions, and exposes them to routers. Keeping this in one module avoids
import cycles and gives routers a single import point.
"""

from __future__ import annotations

# Ensure MPS fallback + warning filters are set before the engine imports torch.
from . import runtime as _runtime  # noqa: F401

import asyncio
import hashlib
import os
import tempfile
import threading
from pathlib import Path

from ..engine import EngineConfig, TTSEngine
from ..extensions import AppExtensionContext, activate_all


class AppState:
    """Container for engine, extension context, and concurrency primitives."""

    def __init__(self) -> None:
        self.config = EngineConfig.from_env()
        self.engine = TTSEngine(self.config)
        self.ext_ctx = AppExtensionContext(self.engine)
        self.activated_extensions = activate_all(self.ext_ctx)

        # Async single-flight generation lock + a small queue counter so the
        # UI can show "N ahead of you" (mirrors the reference demo behavior).
        self.generation_lock = asyncio.Lock()
        self.generation_waiters = 0

        # Reference-audio dedupe cache: sha1(content) -> temp wav path.
        self._ref_cache: dict[str, str] = {}
        self._ref_lock = threading.Lock()

    # ── reference audio caching ─────────────────────────────────────────────

    def cache_ref_audio(self, content: bytes) -> str:
        """Write reference audio to a temp file keyed by content hash."""
        digest = hashlib.sha1(content).hexdigest()
        with self._ref_lock:
            cached = self._ref_cache.get(digest)
            if cached and os.path.exists(cached):
                return cached
            path = Path(tempfile.gettempdir()) / f"formwave_ref_{digest}.wav"
            if not path.exists():
                path.write_bytes(content)
            self._ref_cache[digest] = str(path)
            return str(path)


# Process-wide singleton, created on import of this module.
state = AppState()
