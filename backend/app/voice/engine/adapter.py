"""Synthesis backend adapters.

The engine talks to exactly one of these. Each adapter wraps a concrete TTS
implementation and exposes a uniform, signature-stable surface so the rest of
formwave never imports the upstream package directly. Swapping implementations
(upstream PyTorch -> MLX, or a future fork) means adding an adapter here, not
editing the engine.

`QwenMPSAdapter` wraps the **upstream** Qwen3-TTS PyTorch implementation
(`qwen_tts.Qwen3TTSModel`) configured for Apple Silicon:
    - device_map = "mps"
    - attn_implementation = "sdpa"   (FlashAttention is unavailable on macOS)
    - torch.mps.synchronize()        (NOT torch.cuda.synchronize())

IMPORTANT — upstream API surface:
    The exact method names / return shapes of the upstream package are
    centralized in this file on purpose. If the installed `qwen_tts` version
    names things differently, adjust the small, clearly marked call sites in
    `generate()` and `_load_model()` here; nothing else in the engine needs to
    change. The candidate names below are tried in order so the adapter is
    resilient to minor upstream naming differences.
"""

from __future__ import annotations

import contextlib
import importlib
from pathlib import Path
from typing import Iterator

import numpy as np

from .catalog import (
    MODE_CUSTOM,
    MODE_VOICE_CLONE,
    MODE_VOICE_DESIGN,
    TOKENIZER_ID,
    folder_name_for,
)
from .config import EngineConfig, quiet_output, synchronize, torch_dtype_for
from .params import GenerationParams
from .types import DeviceInfo


def _first_attr(obj, names: tuple[str, ...]):
    """Return the first attribute present on obj from names, or None."""
    for n in names:
        fn = getattr(obj, n, None)
        if fn is not None:
            return fn
    return None


def _to_mono_float32(audio) -> np.ndarray:
    """Coerce a model audio return into mono float32 PCM in [-1, 1]."""
    if audio is None:
        return np.zeros(0, dtype=np.float32)
    # torch tensor -> numpy
    if hasattr(audio, "detach"):
        audio = audio.detach().to("cpu").float().numpy()
    arr = np.asarray(audio, dtype=np.float32)
    if arr.ndim > 1:
        arr = arr.squeeze()
        if arr.ndim > 1:                 # still multi-channel -> average
            arr = arr.mean(axis=0)
    return arr


def _concat(parts) -> np.ndarray:
    """Concatenate a list of audio arrays (or pass through a single array)."""
    if isinstance(parts, np.ndarray):
        return _to_mono_float32(parts)
    if hasattr(parts, "detach"):
        return _to_mono_float32(parts)
    chunks = [_to_mono_float32(p) for p in parts]
    chunks = [c for c in chunks if c.size > 0]
    return np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.float32)


class QwenMPSAdapter:
    """Upstream Qwen3-TTS wrapped for Apple Silicon / CPU execution."""

    def __init__(self, cfg: EngineConfig, device_info: DeviceInfo):
        self.cfg = cfg
        self.device_info = device_info
        self._model = None
        self._model_id: str | None = None
        self._sample_rate: int = 24000  # corrected from the model after load

    # ── lifecycle ──────────────────────────────────────────────────────────

    def load(self, model_id: str) -> None:
        """Load a checkpoint by id from the local models root onto the device."""
        self._model = self._load_model(model_id)
        self._model_id = model_id
        # Try to read the model's true output sample rate; fall back to 24k.
        sr = getattr(self._model, "sample_rate", None) or getattr(
            self._model, "sampling_rate", None
        )
        if isinstance(sr, int) and sr > 0:
            self._sample_rate = sr

    def unload(self) -> None:
        """Drop references and free device memory."""
        self._model = None
        self._model_id = None
        with contextlib.suppress(Exception):
            import torch

            if self.device_info.device == "mps" and getattr(torch, "mps", None):
                torch.mps.empty_cache()
            elif self.device_info.device == "cuda":
                torch.cuda.empty_cache()

    @property
    def sample_rate(self) -> int:
        return self._sample_rate

    def device_report(self) -> dict:
        """Where the model's parameters actually live (MPS vs CPU fallback).

        Walks the underlying nn.Module(s) and tallies parameter devices. If a
        chunk of params sits on 'cpu' while we asked for 'mps', that indicates a
        silent fallback that would slow the decode loop dramatically.
        """
        report = {"requested": self.device_info.device, "param_devices": {}}
        if self._model is None:
            return report
        try:
            import torch  # noqa: F401

            counts: dict[str, int] = {}
            seen = False
            # The upstream wrapper may hold the nn.Module under .model or be one.
            candidates = [self._model]
            inner = getattr(self._model, "model", None)
            if inner is not None:
                candidates.append(inner)
            for obj in candidates:
                params = getattr(obj, "parameters", None)
                if not callable(params):
                    continue
                for p in params():
                    seen = True
                    d = str(p.device).split(":")[0]
                    counts[d] = counts.get(d, 0) + 1
                if seen:
                    break
            report["param_devices"] = counts
        except Exception:
            pass
        return report

    @property
    def model_id(self) -> str | None:
        return self._model_id

    def supported_speakers(self) -> list[str]:
        """Preset speaker ids for CustomVoice checkpoints (else empty)."""
        if self._model is None:
            return []
        getter = _first_attr(
            self._model,
            ("get_supported_speakers", "list_speakers", "speakers"),
        )
        try:
            spk = getter() if callable(getter) else getter
            return list(spk) if spk else []
        except Exception:
            return []

    # ── model construction ─────────────────────────────────────────────────

    def _resolve_local_path(self, model_id: str) -> str:
        """Map a model id to its on-disk folder under the models root."""
        folder = folder_name_for(model_id)
        path = self.cfg.models_root / folder
        if path.exists():
            return str(path)
        # Fall back to the id itself (lets HF resolve from its cache if present).
        return model_id

    def _load_model(self, model_id: str):
        """Instantiate the upstream model on the configured device.

        ── UPSTREAM CALL SITE ──
        Adjust here if your installed qwen_tts exposes a different class or
        from_pretrained signature.
        """
        qwen_tts = importlib.import_module("qwen_tts")
        model_cls = _first_attr(qwen_tts, ("Qwen3TTSModel", "Qwen3TTS", "QwenTTS"))
        if model_cls is None:
            raise RuntimeError(
                "Could not find a Qwen3-TTS model class in the installed "
                "`qwen_tts` package. Expected `Qwen3TTSModel`."
            )

        model_path = self._resolve_local_path(model_id)
        tokenizer_path = self._resolve_local_path(TOKENIZER_ID)
        torch_dtype = torch_dtype_for(self.device_info.dtype)

        # Build kwargs defensively: pass tokenizer path only if the local
        # tokenizer folder actually exists (some builds bundle it in the model).
        kwargs = dict(
            device_map=self.device_info.device,
            attn_implementation=self.device_info.attn_implementation,
            dtype=torch_dtype,
        )
        if (self.cfg.models_root / folder_name_for(TOKENIZER_ID)).exists():
            kwargs["tokenizer_path"] = tokenizer_path

        with quiet_output():
            try:
                return model_cls.from_pretrained(model_path, **kwargs)
            except TypeError:
                # Older signature: torch_dtype instead of dtype, no tokenizer_path.
                kwargs.pop("tokenizer_path", None)
                kwargs.pop("dtype", None)
                kwargs["torch_dtype"] = torch_dtype
                return model_cls.from_pretrained(model_path, **kwargs)

    # ── generation ──────────────────────────────────────────────────────────

    def generate(self, p: GenerationParams) -> tuple[np.ndarray, int]:
        """Non-streaming synthesis. Returns (mono float32 audio, sample_rate).

        ── UPSTREAM CALL SITE ──
        The per-mode method names are tried in order. Adjust if your qwen_tts
        version names them differently.
        """
        if self._model is None:
            raise RuntimeError("No model loaded.")

        self._seed(p.seed)
        common = dict(
            text=p.text,
            language=p.language,
            temperature=p.temperature,
            top_k=p.top_k,
            repetition_penalty=p.repetition_penalty,
            max_new_tokens=p.max_new_tokens,
        )

        if p.mode == MODE_VOICE_CLONE:
            fn = _first_attr(
                self._model,
                ("generate_voice_clone", "voice_clone", "clone"),
            )
            out = self._call_clone(fn, p, common)
        elif p.mode == MODE_CUSTOM:
            if not p.speaker:
                raise ValueError("Speaker id is required for custom voice.")
            fn = _first_attr(
                self._model,
                ("generate_custom_voice", "custom_voice", "generate"),
            )
            out = fn(speaker=p.speaker, instruct=p.instruct, **common)
        elif p.mode == MODE_VOICE_DESIGN:
            fn = _first_attr(
                self._model,
                ("generate_voice_design", "voice_design", "design"),
            )
            out = fn(instruct=p.instruct, **common)
        else:
            raise ValueError(f"Unknown mode: {p.mode}")

        audio, sr = self._split_audio_sr(out)
        synchronize(self.device_info.device)
        return _concat(audio), sr

    def generate_streaming(
        self, p: GenerationParams
    ) -> Iterator[tuple[np.ndarray, int]]:
        """Streaming synthesis yielding (mono float32 chunk, sample_rate).

        If the upstream package exposes a *_streaming generator we use it;
        otherwise we fall back to a single non-streaming result yielded once,
        so the SSE route still works (just without intra-utterance streaming).

        ── UPSTREAM CALL SITE ──
        """
        if self._model is None:
            raise RuntimeError("No model loaded.")

        self._seed(p.seed)
        common = dict(
            text=p.text,
            language=p.language,
            temperature=p.temperature,
            top_k=p.top_k,
            repetition_penalty=p.repetition_penalty,
            max_new_tokens=p.max_new_tokens,
            chunk_size=p.chunk_size,
        )

        if p.mode == MODE_VOICE_CLONE:
            fn = _first_attr(
                self._model,
                ("generate_voice_clone_streaming", "voice_clone_streaming"),
            )
            kwargs = self._clone_kwargs(p, common)
        elif p.mode == MODE_CUSTOM:
            if not p.speaker:
                raise ValueError("Speaker id is required for custom voice.")
            fn = _first_attr(
                self._model,
                ("generate_custom_voice_streaming", "custom_voice_streaming"),
            )
            kwargs = dict(speaker=p.speaker, instruct=p.instruct, **common)
        elif p.mode == MODE_VOICE_DESIGN:
            fn = _first_attr(
                self._model,
                ("generate_voice_design_streaming", "voice_design_streaming"),
            )
            kwargs = dict(instruct=p.instruct, **common)
        else:
            raise ValueError(f"Unknown mode: {p.mode}")

        if fn is None:
            # No streaming support upstream — emit one full result.
            audio, sr = self.generate(p)
            yield audio, sr
            return

        gen = fn(**kwargs)
        for item in gen:
            audio, sr = self._split_audio_sr(item)
            # NOTE: do NOT synchronize per chunk. torch.mps.synchronize() forces
            # a full GPU/CPU barrier; calling it every chunk serializes the
            # decode loop and destroys throughput. The chunk data is already
            # materialized by the time the generator yields it.
            yield _concat(audio), sr

    # ── helpers ──────────────────────────────────────────────────────────────

    def _clone_kwargs(self, p: GenerationParams, common: dict) -> dict:
        """Build voice-clone kwargs, naming the xvec flag the way upstream wants.

        The upstream model gates ICL vs x-vector mode on a boolean whose name
        has varied across versions (e.g. `x_vector_only_mode`, `xvec_only`).
        We include the most likely name; if the call rejects it we retry
        without it (see _call_clone). When xvec_only is True we omit ref_text
        so an empty transcript never reaches the ICL path.
        """
        kwargs = dict(ref_audio=p.ref_audio_path, **common)
        kwargs["x_vector_only_mode"] = p.xvec_only
        if not p.xvec_only:
            kwargs["ref_text"] = p.ref_text
        return kwargs

    def _call_clone(self, fn, p: GenerationParams, common: dict):
        """Call the clone fn, retrying with alternate xvec parameter spellings."""
        kwargs = self._clone_kwargs(p, common)
        try:
            return fn(**kwargs)
        except TypeError:
            # Retry with the shorter flag name some versions use.
            alt = dict(kwargs)
            if "x_vector_only_mode" in alt:
                alt["xvec_only"] = alt.pop("x_vector_only_mode")
            try:
                return fn(**alt)
            except TypeError:
                # Last resort: drop the flag entirely and pass ref_text only.
                bare = dict(ref_audio=p.ref_audio_path, **common)
                if not p.xvec_only:
                    bare["ref_text"] = p.ref_text
                return fn(**bare)

    @staticmethod
    def _split_audio_sr(out) -> tuple[object, int]:
        """Normalize a model return into (audio, sample_rate).

        Upstream returns are commonly (audio, sr) or (audio, sr, timing). Some
        return just audio; default the rate to 24 kHz in that case.
        """
        if isinstance(out, tuple):
            if len(out) >= 2 and isinstance(out[1], int):
                return out[0], out[1]
            return out[0], 24000
        return out, 24000

    @staticmethod
    def _seed(seed: int | None) -> None:
        if seed is None:
            return
        import torch

        torch.manual_seed(seed)
        with contextlib.suppress(Exception):
            if getattr(torch, "mps", None) is not None:
                torch.mps.manual_seed(seed)
        np.random.seed(seed % (2**32 - 1))
