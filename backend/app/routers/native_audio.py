"""Native audio output (the core's NativeOutput, feature "native"): the session mixed by formwav's own Player straight
to an audio device, instead of in the browser's AudioWorklet.

The WebSocket speaks the worklet's protocol, so the interface drives native output with the messages it already sends
the worklet ("clips", "seek", "loop", "play", "stop") and reads back the worklet's own "position" report, about 30
times a second. Two messages differ: "open" chooses the device and rate (one output per connection, closed when the
connection ends, so a closed tab never holds the device), and "source" names a media id where the worklet receives
the samples themselves: the engine reads its own media store. Speed changes and the time track stay with the worklet;
native output plays at 1x. Origins are checked as for the terminal (core.security.ws_allowed).
"""

from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..core.security import ws_allowed
from ..services import media

router = APIRouter(prefix="/api/audio", tags=["audio"])


def _core():
    try:
        import formwav_dsp
    except ImportError:
        return None
    return formwav_dsp if hasattr(formwav_dsp, "NativeOutput") else None


@router.get("/devices")
def devices() -> dict:
    """Whether this engine has native output, and its output devices."""
    core = _core()
    return {"native": core is not None, "devices": core.NativeOutput.devices() if core else []}


@router.websocket("/native")
async def native(ws: WebSocket) -> None:
    if not ws_allowed(ws.headers.get("origin"), ws.headers.get("host")):
        await ws.close(code=1008)
        return
    await ws.accept()
    core = _core()
    if core is None:
        await ws.send_text(json.dumps({"type": "error", "message": "this engine was built without native output"}))
        await ws.close()
        return
    out = None
    loaded: dict[int, str] = {}

    async def report_loop() -> None:
        while True:
            await asyncio.sleep(1 / 30)
            if out is not None:
                await ws.send_text(out.report())

    reporter = asyncio.create_task(report_loop())
    try:
        while True:
            msg = json.loads(await ws.receive_text())
            kind = msg.get("type")
            try:
                if kind == "open":
                    if out is not None:
                        out.stop()
                        out.close()
                    out = None
                    loaded.clear()
                    out = await asyncio.to_thread(core.NativeOutput, int(msg.get("rate") or 48000), msg.get("device") or None)
                    await ws.send_text(json.dumps({"type": "ready", "device": out.device, "rate": out.rate}))
                elif out is None:
                    raise ValueError("open the output first")
                elif kind == "source":
                    number, media_id = int(msg["source"]), str(msg["mediaId"])
                    if loaded.get(number) != media_id:
                        media.media_info(media_id)  # a known media id, or MediaError
                        data = await asyncio.to_thread((media.media_dir() / f"{media_id}.wav").read_bytes)
                        await asyncio.to_thread(out.load_wav, number, data)
                        loaded[number] = media_id
                    await ws.send_text(json.dumps({"type": "loaded", "source": number}))
                elif kind == "clips":
                    out.set_mix(json.dumps(msg))
                elif kind == "seek":
                    out.seek(int(msg.get("position") or 0))
                elif kind == "loop":
                    out.set_loop(int(msg.get("start") or 0), int(msg.get("end") or 0))
                elif kind == "play":
                    out.play()
                elif kind == "stop":
                    out.stop()
                elif kind == "speed":
                    if float(msg.get("value") or 1) != 1:
                        raise ValueError("native output plays at 1x; speed changes play in the browser's engine")
            except (ValueError, KeyError, TypeError, OSError, media.MediaError) as err:
                await ws.send_text(json.dumps({"type": "error", "message": str(err)}))
    except WebSocketDisconnect:
        pass
    finally:
        reporter.cancel()
        if out is not None:
            out.stop()
            out.close()
