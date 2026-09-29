"""Extensions package.

Importing this package imports each feature module, which self-registers with
the registry. To add a feature: create `extensions/<feature>/__init__.py` that
calls `register(...)`, then add one import line below. To remove a feature:
delete its folder and its import line. The engine/core never change.
"""

from . import audio_export  # noqa: F401  registers "audio-export"
from . import peak_normalize  # noqa: F401  registers "peak-normalize"
from . import transcribe  # noqa: F401  registers "transcribe" (multi-backend ASR)

from .registry import activate_all, all_extensions, register  # noqa: F401
from .context import AppExtensionContext  # noqa: F401
