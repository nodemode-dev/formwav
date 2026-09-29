"""Per-request synthesis parameters.

A single struct passed into every engine generate call, so adding a knob is a
one-line change here plus wiring in the router — not a signature change across
multiple methods.
"""

from __future__ import annotations

from dataclasses import dataclass

from .catalog import MODE_VOICE_CLONE


@dataclass
class GenerationParams:
    """Everything needed to synthesize one utterance.

    Mode-specific fields are ignored when not relevant to the active mode:
        voice_clone  -> ref_audio_path, ref_text, xvec_only
        custom       -> speaker, instruct
        voice_design -> instruct
    """

    text: str
    mode: str = MODE_VOICE_CLONE
    language: str = "English"

    # voice_clone
    ref_audio_path: str | None = None
    ref_text: str = ""
    xvec_only: bool = True

    # custom / voice_design
    speaker: str = ""
    instruct: str = ""

    # sampling
    temperature: float = 0.9
    top_k: int = 50
    repetition_penalty: float = 1.05
    seed: int | None = None

    # length / streaming
    max_new_tokens: int = 360     # 360 tokens ~= 30s at the 12 Hz codec
    chunk_size: int = 8           # streaming chunk granularity (tokens)
    non_streaming_mode: bool | None = None

    def resolved_non_streaming(self) -> bool:
        """Default non_streaming_mode by mode when caller left it unset.

        Voice clone benefits from the streaming path; the others default to the
        non-streaming decode (matches the reference demo's behavior).
        """
        if self.non_streaming_mode is not None:
            return self.non_streaming_mode
        return self.mode != MODE_VOICE_CLONE
