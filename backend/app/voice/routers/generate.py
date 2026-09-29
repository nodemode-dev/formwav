"""Generation routes: /generate (JSON) and /generate/stream (SSE).

Both preserve the reference demo's request fields and response payloads so the
existing frontend works unchanged. Generation runs in a worker thread; the SSE
route streams chunk/queued/done/error events identical in shape to the demo,
with metrics (ttfa_ms, rtf, total_audio_s) computed by the engine.

Final audio passes through any registered audio postprocessors (extension
seam) before being returned.
"""

from __future__ import annotations

import asyncio
import json
import os
import threading
import time

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse

from ..core.state import state
from ..engine import GenerationParams
from ._audio import to_wav_b64

router = APIRouter()


def _audio_too_large(size_bytes: int) -> HTTPException:
    mb = size_bytes / 1024 / 1024
    return HTTPException(
        status_code=400,
        detail=(
            f"Audio file too large ({mb:.1f} MB). Voice cloning works best with "
            f"short clips — please upload a shorter recording."
        ),
    )


async def _resolve_ref_audio(
    ref_preset: str, ref_audio: UploadFile | None
) -> tuple[str | None, str]:
    """Return (ref_audio_path, ref_text_default) from preset or upload.

    Presets aren't bundled in formwave by default (the demo fetched them from
    GitHub). Upload is the supported path; preset support can be added as an
    extension later.
    """
    if ref_audio and ref_audio.filename:
        content = await ref_audio.read()
        if len(content) > state.config.max_audio_bytes:
            raise _audio_too_large(len(content))
        return state.cache_ref_audio(content), ""
    return None, ""


def _build_params(
    *,
    text: str,
    language: str,
    mode: str,
    ref_text: str,
    speaker: str,
    instruct: str,
    xvec_only: bool,
    temperature: float,
    top_k: int,
    repetition_penalty: float,
    non_streaming_mode: bool | None,
    chunk_size: int,
    max_new_tokens: int,
    seed: int | None,
    ref_audio_path: str | None,
) -> GenerationParams:
    return GenerationParams(
        text=text,
        mode=mode,
        language=language,
        ref_audio_path=ref_audio_path,
        ref_text=ref_text,
        xvec_only=xvec_only,
        speaker=speaker,
        instruct=instruct,
        temperature=temperature,
        top_k=top_k,
        repetition_penalty=repetition_penalty,
        seed=seed,
        max_new_tokens=max_new_tokens,
        chunk_size=chunk_size,
        non_streaming_mode=non_streaming_mode,
    )


@router.post("/generate")
async def generate_non_streaming(
    text: str = Form(...),
    language: str = Form("English"),
    mode: str = Form("voice_clone"),
    ref_text: str = Form(""),
    speaker: str = Form(""),
    instruct: str = Form(""),
    xvec_only: bool = Form(True),
    temperature: float = Form(0.9),
    top_k: int = Form(50),
    repetition_penalty: float = Form(1.05),
    non_streaming_mode: bool | None = Form(None),
    max_new_tokens: int = Form(360),
    seed: int | None = Form(None),
    ref_preset: str = Form(""),
    ref_audio: UploadFile = File(None),
):
    if not state.engine.active_model_id:
        raise HTTPException(status_code=400, detail="Model not loaded. Click 'Load' first.")

    ref_path, ref_default = await _resolve_ref_audio(ref_preset, ref_audio)
    params = _build_params(
        text=text, language=language, mode=mode,
        ref_text=ref_text or ref_default, speaker=speaker, instruct=instruct,
        xvec_only=xvec_only, temperature=temperature, top_k=top_k,
        repetition_penalty=repetition_penalty, non_streaming_mode=non_streaming_mode,
        chunk_size=8, max_new_tokens=max_new_tokens, seed=seed,
        ref_audio_path=ref_path,
    )

    state.generation_waiters += 1
    acquired = False
    try:
        await state.generation_lock.acquire()
        acquired = True
        state.generation_waiters -= 1

        def run():
            result = state.engine.generate(params)
            audio = state.ext_ctx.apply_postprocessors(result.audio)
            return audio, result

        try:
            audio, result = await asyncio.to_thread(run)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        return JSONResponse({
            "audio_b64": to_wav_b64(audio, result.sample_rate),
            "sample_rate": result.sample_rate,
            "metrics": {
                "total_ms": round(result.elapsed_ms),
                "audio_duration_s": round(result.audio_duration_s, 3),
                "rtf": round(result.rtf, 3),
            },
        })
    finally:
        if acquired:
            state.generation_lock.release()
        else:
            state.generation_waiters -= 1


@router.post("/generate/stream")
async def generate_stream(
    text: str = Form(...),
    language: str = Form("English"),
    mode: str = Form("voice_clone"),
    ref_text: str = Form(""),
    speaker: str = Form(""),
    instruct: str = Form(""),
    xvec_only: bool = Form(True),
    chunk_size: int = Form(8),
    temperature: float = Form(0.9),
    top_k: int = Form(50),
    repetition_penalty: float = Form(1.05),
    non_streaming_mode: bool | None = Form(None),
    max_new_tokens: int = Form(360),
    seed: int | None = Form(None),
    ref_preset: str = Form(""),
    ref_audio: UploadFile = File(None),
):
    if not state.engine.active_model_id:
        raise HTTPException(status_code=400, detail="Model not loaded. Click 'Load' first.")

    ref_path, ref_default = await _resolve_ref_audio(ref_preset, ref_audio)
    params = _build_params(
        text=text, language=language, mode=mode,
        ref_text=ref_text or ref_default, speaker=speaker, instruct=instruct,
        xvec_only=xvec_only, temperature=temperature, top_k=top_k,
        repetition_penalty=repetition_penalty, non_streaming_mode=non_streaming_mode,
        chunk_size=chunk_size, max_new_tokens=max_new_tokens, seed=seed,
        ref_audio_path=ref_path,
    )

    loop = asyncio.get_event_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def run_generation():
        try:
            t0 = time.perf_counter()
            for chunk in state.engine.generate_streaming(params):
                audio = state.ext_ctx.apply_postprocessors(chunk.audio)
                payload = {
                    "type": "chunk",
                    "audio_b64": to_wav_b64(audio, chunk.sample_rate),
                    "sample_rate": chunk.sample_rate,
                    "ttfa_ms": round(chunk.ttfa_ms),
                    "rtf": round(chunk.rtf, 3),
                    "total_audio_s": round(chunk.total_audio_s, 3),
                    "elapsed_ms": round(chunk.elapsed_ms),
                }
                loop.call_soon_threadsafe(queue.put_nowait, json.dumps(payload))

            total_ms = (time.perf_counter() - t0) * 1000.0
            done = {
                "type": "done",
                "total_ms": round(total_ms),
            }
            loop.call_soon_threadsafe(queue.put_nowait, json.dumps(done))
        except Exception as e:
            import traceback
            err = {"type": "error", "message": str(e), "detail": traceback.format_exc()}
            loop.call_soon_threadsafe(queue.put_nowait, json.dumps(err))
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    async def sse():
        acquired = False
        state.generation_waiters += 1
        ahead = state.generation_waiters - 1 + (1 if state.generation_lock.locked() else 0)
        try:
            if ahead > 0:
                yield f"data: {json.dumps({'type': 'queued', 'position': ahead})}\n\n"

            await state.generation_lock.acquire()
            acquired = True
            state.generation_waiters -= 1

            thread = threading.Thread(target=run_generation, daemon=True)
            thread.start()

            while True:
                msg = await queue.get()
                if msg is None:
                    break
                yield f"data: {msg}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            if acquired:
                state.generation_lock.release()
            else:
                state.generation_waiters -= 1

    return StreamingResponse(
        sse(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
