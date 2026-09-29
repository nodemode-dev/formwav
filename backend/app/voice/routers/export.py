"""Export route: /export.

Generates audio (non-streaming) and returns it encoded in a requested format
(wav/flac/mp3, whatever the audio-export extension registered) as a file
download. This is the "more capable" counterpart to the demo, which only ever
produced PCM-16 WAV.

The available formats are whatever extensions registered into the context, so
adding an encoder (e.g. opus) is an extension change, not a route change.
"""

from __future__ import annotations

import asyncio
import io

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from ..core.state import state
from ..engine import GenerationParams

router = APIRouter()


_MIME = {
    "wav": "audio/wav",
    "flac": "audio/flac",
    "mp3": "audio/mpeg",
    "ogg": "audio/ogg",
    "opus": "audio/opus",
}


@router.get("/export/formats")
async def export_formats():
    """List formats the running build can encode (depends on libsndfile)."""
    return {"formats": state.ext_ctx.export_formats()}


@router.post("/export")
async def export_audio(
    text: str = Form(...),
    fmt: str = Form("wav"),
    language: str = Form("English"),
    mode: str = Form("voice_clone"),
    ref_text: str = Form(""),
    speaker: str = Form(""),
    instruct: str = Form(""),
    xvec_only: bool = Form(True),
    temperature: float = Form(0.9),
    top_k: int = Form(50),
    repetition_penalty: float = Form(1.05),
    max_new_tokens: int = Form(360),
    seed: int | None = Form(None),
    ref_audio: UploadFile = File(None),
):
    if not state.engine.active_model_id:
        raise HTTPException(status_code=400, detail="Model not loaded. Click 'Load' first.")

    fmt = fmt.lower()
    if fmt not in state.ext_ctx.export_formats():
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format '{fmt}'. Available: {state.ext_ctx.export_formats()}",
        )

    ref_path = None
    if ref_audio and ref_audio.filename:
        content = await ref_audio.read()
        if len(content) > state.config.max_audio_bytes:
            mb = len(content) / 1024 / 1024
            raise HTTPException(status_code=400, detail=f"Audio file too large ({mb:.1f} MB).")
        ref_path = state.cache_ref_audio(content)

    params = GenerationParams(
        text=text, mode=mode, language=language,
        ref_audio_path=ref_path, ref_text=ref_text, xvec_only=xvec_only,
        speaker=speaker, instruct=instruct,
        temperature=temperature, top_k=top_k, repetition_penalty=repetition_penalty,
        seed=seed, max_new_tokens=max_new_tokens,
    )

    state.generation_waiters += 1
    acquired = False
    try:
        await state.generation_lock.acquire()
        acquired = True
        state.generation_waiters -= 1

        def run() -> tuple[bytes, int]:
            result = state.engine.generate(params)
            audio = state.ext_ctx.apply_postprocessors(result.audio)
            data = state.ext_ctx.encode(fmt, audio, result.sample_rate)
            return data, result.sample_rate

        try:
            data, _sr = await asyncio.to_thread(run)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        headers = {"Content-Disposition": f'attachment; filename="formwave.{fmt}"'}
        return StreamingResponse(
            io.BytesIO(data),
            media_type=_MIME.get(fmt, "application/octet-stream"),
            headers=headers,
        )
    finally:
        if acquired:
            state.generation_lock.release()
        else:
            state.generation_waiters -= 1
