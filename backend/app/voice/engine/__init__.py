"""formwave TTS engine — headless, UI-agnostic core.

Public API. Nothing in `ui`/`routers` should reach past these names into
engine internals. The engine is runnable without FastAPI (see __main__ block
in cli.py / tests) so it stays portable and testable.

Exports:
    TTSEngine          - the power engine: owns model cache, device, generation
    EngineConfig       - construction-time configuration
    GenerationParams   - per-request synthesis parameters
    GenerationResult   - non-streaming result (audio + metrics)
    AudioChunk         - one streamed chunk (audio + running metrics)
    DeviceInfo         - resolved device / dtype report
    list_known_models  - the catalog of Qwen3-TTS variants formwave understands
"""

from .config import EngineConfig
from .params import GenerationParams
from .types import AudioChunk, DeviceInfo, GenerationResult
from .catalog import list_known_models
from .core import TTSEngine

__all__ = [
    "TTSEngine",
    "EngineConfig",
    "GenerationParams",
    "GenerationResult",
    "AudioChunk",
    "DeviceInfo",
    "list_known_models",
]
