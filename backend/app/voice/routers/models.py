"""Model management routes: /status and /load.

Preserves the reference demo's response shape (so the frontend stays a drop-in)
and adds formwave extras: device info, per-model modes, on_disk flags, and the
list of registered export formats / extensions.
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Form, HTTPException

from ..core.state import state

router = APIRouter()


@router.get("/status")
async def get_status():
    st = state.engine.status()
    st["queue_depth"] = state.generation_waiters
    st["export_formats"] = state.ext_ctx.export_formats()
    st["extensions"] = state.activated_extensions
    # The reference frontend expects these keys; provide compatible values.
    st["transcription_available"] = state.ext_ctx.has_transcriber()
    mgr = state.ext_ctx.transcription
    st["asr_models"] = mgr.list_models() if mgr else []
    st["asr_active"] = mgr.active_id if mgr else None
    st["preset_refs"] = []
    return st


@router.post("/load")
async def load_model(model_id: str = Form(...)):
    # Hold the generation lock during load to avoid OOM from concurrent infer.
    async with state.generation_lock:
        try:
            result = await asyncio.to_thread(state.engine.load, model_id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:  # surface load failures clearly to the UI
            raise HTTPException(status_code=500, detail=f"Load failed: {e}")
    return {"status": result, "model": model_id}
