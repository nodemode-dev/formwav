"""Transcription route: /transcribe.

Auto-transcribes an uploaded reference clip so Advanced clone mode can prefill
the transcript. Backed by whatever transcriber the transcribe-parakeet
extension registered. If no transcriber is registered (extension disabled or
nano_parakeet unavailable), returns 503 and the frontend leaves the field empty
for manual entry — matching the demo's graceful-degradation behavior.
"""

from __future__ import annotations

import asyncio
import logging
import traceback

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from ..core.state import state

router = APIRouter()
logger = logging.getLogger("formwave.transcribe")


@router.get("/asr/models")
async def asr_models():
    """List ASR backends, which are available, and which is active."""
    mgr = state.ext_ctx.transcription
    if mgr is None:
        return {"models": [], "active": None}
    return {"models": mgr.list_models(), "active": mgr.active_id}


@router.post("/asr/select")
async def asr_select(asr_id: str = Form(...)):
    """Switch the active ASR backend."""
    mgr = state.ext_ctx.transcription
    if mgr is None:
        raise HTTPException(status_code=503, detail="Transcription not available.")
    try:
        mgr.set_active(asr_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"active": mgr.active_id}


@router.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    if not state.ext_ctx.has_transcriber():
        raise HTTPException(status_code=503, detail="Transcription not available.")

    content = await audio.read()
    if len(content) > state.config.max_audio_bytes:
        mb = len(content) / 1024 / 1024
        raise HTTPException(status_code=400, detail=f"Audio file too large ({mb:.1f} MB).")

    def run() -> str:
        return state.ext_ctx.transcribe(content)

    try:
        text = await asyncio.to_thread(run)
    except Exception as e:
        # Log the full traceback server-side so the failure is diagnosable,
        # and return the actual error text (not just a generic 500) to the UI.
        tb = traceback.format_exc()
        logger.error("Transcription failed:\n%s", tb)
        print(tb, flush=True)
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")
    return {"text": text}
