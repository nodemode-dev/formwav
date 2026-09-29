"""Catalog of Qwen3-TTS model variants formwave understands.

This is data, not logic. The engine resolves a model id to a local directory
under the models root; this table tells the rest of the system which modes a
given checkpoint supports and how to present it. Keep it in sync with whatever
you actually download into `backend/models/`.
"""

from __future__ import annotations

from dataclasses import dataclass, field


# Generation modes a checkpoint can serve.
MODE_VOICE_CLONE = "voice_clone"
MODE_CUSTOM = "custom"
MODE_VOICE_DESIGN = "voice_design"


@dataclass(frozen=True)
class ModelSpec:
    """Static description of one Qwen3-TTS checkpoint."""

    id: str                      # HF-style id, also the local folder name
    name: str                    # short display name
    sub: str                     # one-line descriptor for the UI
    modes: tuple[str, ...]       # which generation modes this checkpoint serves
    params: str                  # rough parameter count, for display
    aliases: tuple[str, ...] = field(default_factory=tuple)


# The five public Qwen3-TTS 12 Hz checkpoints, mapped to the mode each one drives.
# A checkpoint's folder name under the models root is its `id` with the
# "Qwen/" prefix stripped (resolved in config.py / core.py).
_CATALOG: tuple[ModelSpec, ...] = (
    ModelSpec(
        id="Qwen/Qwen3-TTS-12Hz-0.6B-Base",
        name="0.6B Base",
        sub="Fastest clone",
        modes=(MODE_VOICE_CLONE,),
        params="0.6B",
    ),
    ModelSpec(
        id="Qwen/Qwen3-TTS-12Hz-1.7B-Base",
        name="1.7B Base",
        sub="Higher-quality clone",
        modes=(MODE_VOICE_CLONE,),
        params="1.7B",
    ),
    ModelSpec(
        id="Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
        name="0.6B CustomVoice",
        sub="Fastest preset voices",
        modes=(MODE_CUSTOM,),
        params="0.6B",
    ),
    ModelSpec(
        id="Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
        name="1.7B CustomVoice",
        sub="Higher-quality preset voices",
        modes=(MODE_CUSTOM,),
        params="1.7B",
    ),
    ModelSpec(
        id="Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign",
        name="1.7B VoiceDesign",
        sub="Describe any voice",
        modes=(MODE_VOICE_DESIGN,),
        params="1.7B",
    ),
)

# The tokenizer is shared by every checkpoint and lives in its own folder.
TOKENIZER_ID = "Qwen/Qwen3-TTS-Tokenizer-12Hz"

_BY_ID: dict[str, ModelSpec] = {}
for _spec in _CATALOG:
    _BY_ID[_spec.id] = _spec
    for _alias in _spec.aliases:
        _BY_ID[_alias] = _spec


def list_known_models() -> list[ModelSpec]:
    """All checkpoints formwave knows about, in display order."""
    return list(_CATALOG)


def get_spec(model_id: str) -> ModelSpec | None:
    """Resolve an id (or alias) to its spec, or None if unknown."""
    return _BY_ID.get(model_id)


def folder_name_for(model_id: str) -> str:
    """Local folder name for a model id (strips the org prefix)."""
    return model_id.split("/", 1)[-1]
