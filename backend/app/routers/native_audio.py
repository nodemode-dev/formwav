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


# The comparison's Multitrack recording row: capture through the engine, every channel of an interface (a browser's
# capture stops at two). One recording at a time; a thread drains the take every quarter second into a file per track
# (the channels that track records), so a long take with many channels never sits whole in memory.
import struct  # noqa: E402
import tempfile  # noqa: E402
import threading  # noqa: E402
import time  # noqa: E402
from pathlib import Path  # noqa: E402

from fastapi import HTTPException  # noqa: E402
from pydantic import BaseModel  # noqa: E402

_rec: dict = {"input": None}
_rec_lock = threading.Lock()


class RecordTrack(BaseModel):
    trackId: str
    channels: list[int]
    name: str = ""


class RecordStart(BaseModel):
    device: str | None = None
    rate: int = 48000
    deviceChannels: int | None = None  # the interface's width, as an I/O set-up names it; the most it offers when absent
    tracks: list[RecordTrack]


def _capture() -> object:
    core = _core()
    if core is None or not hasattr(core, "NativeInput"):
        raise HTTPException(501, "this engine was built without native capture")
    return core


def _drain(rec: dict, raw: bytes) -> None:
    """Interleaved frames from the device, split into each track's channels and appended to its file."""
    import numpy as np

    if not raw:
        return
    x = np.frombuffer(raw, dtype="<f4").reshape(-1, rec["channels"])
    for t in rec["tracks"]:
        rec["files"][t.trackId].write(np.ascontiguousarray(x[:, t.channels]).tobytes())


def _wav_f32(path: Path, channels: int, rate: int) -> bytes:
    data = path.read_bytes()
    header = b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 3, channels, rate, rate * 4 * channels, 4 * channels, 32)
    return header + b"data" + struct.pack("<I", len(data)) + data


@router.get("/inputs")
def inputs() -> dict:
    """The interfaces native capture can open, each with its most channels."""
    core = _core()
    if core is None or not hasattr(core, "native_input_devices"):
        return {"native": False, "inputs": []}
    return {"native": True, "inputs": [{"name": n, "channels": ch} for n, ch in core.native_input_devices()]}


@router.post("/record/start")
def record_start(body: RecordStart) -> dict:
    """Opens the interface with the most channels it offers and starts a take; each track names the channels it takes."""
    core = _capture()
    if not body.tracks or any(not t.channels or min(t.channels) < 0 for t in body.tracks):
        raise HTTPException(422, "each track names the channels it records")
    with _rec_lock:
        if _rec["input"] is not None:
            raise HTTPException(409, "a native take is already recording")
        try:
            inp = core.NativeInput(body.rate, body.device, body.deviceChannels)
        except ValueError as err:
            raise HTTPException(404, str(err)) from err
        need = max(c for t in body.tracks for c in t.channels) + 1
        if inp.channels < need:
            inp.close()
            raise HTTPException(422, f"{inp.device} has {inp.channels} channels; channel {need} was asked for")
        scratch = Path(tempfile.mkdtemp(prefix="formwav-capture-"))
        rec = {"input": inp, "channels": inp.channels, "rate": inp.rate, "device": inp.device, "tracks": body.tracks, "scratch": scratch,
               "files": {t.trackId: open(scratch / f"{t.trackId}.f32", "wb") for t in body.tracks}, "stop": threading.Event()}

        def drainer() -> None:
            while not rec["stop"].wait(0.25):
                _drain(rec, inp.drain())

        inp.start()
        rec["started"] = time.time()
        rec["thread"] = threading.Thread(target=drainer, name="formwav-capture-drain", daemon=True)
        rec["thread"].start()
        _rec.update(rec)
        return {"started": rec["started"], "device": inp.device, "channels": inp.channels, "rate": inp.rate}


@router.get("/record/levels")
def record_levels() -> dict:
    with _rec_lock:
        inp = _rec["input"]
        return {"recording": inp is not None, "peaks": inp.peaks() if inp is not None else []}


@router.post("/record/stop")
def record_stop() -> dict:
    """Ends the take: each track's channels become a float WAV in the media store, with the take's start (engine clock)."""
    with _rec_lock:
        rec = dict(_rec)
        if rec["input"] is None:
            raise HTTPException(409, "no native take is recording")
        _rec.clear()
        _rec["input"] = None
    rec["stop"].set()
    rec["thread"].join()
    inp = rec["input"]
    _drain(rec, inp.stop())
    inp.close()
    takes = []
    for t in rec["tracks"]:
        f = rec["files"][t.trackId]
        f.close()
        data = _wav_f32(Path(f.name), len(t.channels), rec["rate"])
        label = t.name or f"input {'+'.join(str(c + 1) for c in t.channels)}"
        takes.append({"trackId": t.trackId, "channels": t.channels, "media": media.import_wav(f"{label} (native take).wav", data)})
        Path(f.name).unlink(missing_ok=True)
    rec["scratch"].rmdir()
    return {"started": rec["started"], "device": rec["device"], "rate": rec["rate"], "takes": takes}
