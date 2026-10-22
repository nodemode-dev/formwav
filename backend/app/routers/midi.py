"""Note tracks' engine side (AU-37, PT-14): a Standard MIDI File read into notes (services/midi.py) and the notes
rendered by the built-in instrument (the core's synth) into media the mixer plays like any audio. The notes stay the
clip's truth in the document; after an edit they are rendered again through /api/midi/render.
"""

from __future__ import annotations

import numpy as np
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ..services import media, midi
from ..services.aup_project import _wav_bytes

router = APIRouter(prefix="/api/midi", tags=["midi"])

WAVES = ("sine", "triangle", "saw", "square")


class Note(BaseModel):
    start: float = Field(ge=0)
    length: float = Field(ge=0)
    pitch: int = Field(ge=0, le=127)
    velocity: int = Field(ge=1, le=127)


class Patch(BaseModel):
    wave: str = "triangle"
    attack: float = Field(0.005, ge=0, le=10)
    decay: float = Field(0.15, ge=0, le=10)
    sustain: float = Field(0.7, ge=0, le=1)
    release: float = Field(0.2, ge=0, le=10)
    gain: float = Field(0.25, ge=0, le=2)
    cutoff: float = Field(0.0, ge=0, le=96000)
    resonance: float = Field(0.707, ge=0.3, le=24)


class Sampler(BaseModel):
    """PT-15: a session media played as the instrument, re-pitched from its root note."""

    media: str
    root: int = Field(60, ge=0, le=127)


class CoreInstrument(BaseModel):
    """S14: the subtractive or drum synth and its values in the core's order (engine/instruments.ts)."""

    kind: str
    values: list[float] = []


class RenderRequest(BaseModel):
    notes: list[Note]
    rate: int = Field(48000, ge=8000, le=192000)
    patch: Patch = Patch()
    name: str = "notes"
    sampler: Sampler | None = None
    # PT-15, S17: a CLAP or VST3 instrument from the plugin folder (plugin:<format>:<path>, as /api/midi/instruments lists them)
    plugin: str | None = None
    # S7: the rendering lasts at least this long (seconds), silent after its notes; with no notes, an empty note clip
    length: float = Field(0.0, ge=0, le=3600)
    instrument: CoreInstrument | None = None


@router.get("/devices")
def midi_devices() -> dict:
    """AU-37: the MIDI inputs the engine can read (for the desktop app, whose WebView has no Web MIDI), and the reason
    when there are none."""
    from ..services import midi_live

    return midi_live.devices()


@router.get("/stream")
async def midi_stream(device: str, request: Request):
    """AU-37: the device's messages as server-sent events; the device is opened first, so a missing one is answered
    with 404 (or 503 when MIDI itself fails) rather than an empty stream."""
    from fastapi.responses import StreamingResponse

    from ..services import midi_live

    try:
        poll, close = midi_live.open_reader(device)
    except LookupError as err:
        raise HTTPException(404, str(err)) from err
    except RuntimeError as err:
        raise HTTPException(503, f"MIDI: {err}") from err
    return StreamingResponse(
        midi_live.events(poll, close, request.is_disconnected),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class Words(BaseModel):
    words: list[str] = Field(default_factory=list, max_length=2000)


@router.post("/phonemes")
def lyric_phonemes(body: Words) -> dict:
    """L2: each lyric word's ARPAbet phonemes and where they came from (dictionary, derived or guess)."""
    from ..services import g2p

    return {"words": g2p.pronounce_all(body.words)}


class SungNote(BaseModel):
    start: float
    length: float
    pitch: int = Field(ge=0, le=127)
    lyric: str | None = None
    phonemes: list[str] | None = None


class Sing(BaseModel):
    notes: list[SungNote] = Field(max_length=4000)
    singer: str = "vocalset_f1"
    rate: int | None = None
    name: str = "Singing"


@router.get("/singers")
def lyric_singers() -> dict:
    """L4: the stock singers and whether SoulX-Singer is installed."""
    from ..services import singing

    return {"singers": singing.singers(), "engine": singing.status()}


@router.post("/sing", status_code=201)
def lyric_sing(body: Sing) -> dict:
    """L4: notes sung by SoulX-Singer as new media, phrase by phrase, unchanged phrases from the cache."""
    from ..services import singing
    from ..services.providers import ProviderError

    try:
        return singing.sing([n.model_dump() for n in body.notes], body.singer, body.rate, body.name[:80])
    except ProviderError as err:
        raise HTTPException(status_code=err.status, detail=str(err)) from err


@router.post("/test")
def midi_test(payload: dict) -> dict:
    """AU-37 tests only: a message for the test keyboard, present when the engine runs with FORMWAV_MIDI_TEST=1."""
    from ..services import midi_live

    if not midi_live.testing():
        raise HTTPException(404, "not found")
    midi_live.send_test(list(payload.get("data") or []))
    return {"queued": True}


@router.get("/instruments")
def list_instruments() -> list[dict]:
    """PT-15, S17: the CLAP and VST3 instruments in the plugin folder, for a note track's Instrument choice."""
    from ..services import plugins

    return plugins.instruments()


def _padded(mono: np.ndarray, rate: int, length: float) -> np.ndarray:
    """S7: a rendering made at least `length` seconds long with silence after it."""
    want = int(round(length * rate))
    return np.concatenate([mono, np.zeros(want - len(mono), dtype=mono.dtype)]) if want > len(mono) else mono


def _render(notes: list[dict], rate: int, patch: Patch, name: str, sampler: Sampler | None = None, plugin: str | None = None, length: float = 0.0, instrument: CoreInstrument | None = None) -> dict:
    if patch.wave not in WAVES:
        raise HTTPException(status_code=422, detail=f"no waveform named {patch.wave} (one of {', '.join(WAVES)})")
    if not notes:
        if length <= 0:
            raise HTTPException(status_code=422, detail="no notes to render")
        silence = np.zeros(max(1, int(round(length * rate))), dtype="<f4")
        return media.import_wav(f"{name}.wav", _wav_bytes([silence, silence], rate))
    frames = [(int(round(n["start"] * rate)), max(1, int(round(n["length"] * rate))), int(n["pitch"]), int(n["velocity"])) for n in notes]
    if plugin is not None:
        # PT-15, S17: the notes played on a CLAP or VST3 instrument by the plugin host
        from ..services import plugins

        try:
            return plugins.play_instrument(plugin, frames, rate, name)
        except media.MediaError as err:
            raise HTTPException(status_code=422, detail=str(err)) from err
    core = media._require_core()
    if instrument is not None:
        if instrument.kind not in ("subtractive", "drums"):
            raise HTTPException(status_code=422, detail=f"no instrument named {instrument.kind} (subtractive or drums)")
        raw = core.render_instrument(frames, rate, instrument.kind, [float(v) for v in instrument.values])
        out = _padded(np.frombuffer(raw, dtype="<f4").copy(), rate, length)
        return media.import_wav(f"{name}.wav", _wav_bytes([out, out], rate))
    if sampler is not None:
        # PT-15: the sampler plays the media, mixed to mono, re-pitched from its root, through the patch's envelope
        from ..services import tools

        try:
            view, sample_rate = tools._wav_view(sampler.media)
        except (KeyError, FileNotFoundError) as err:
            raise HTTPException(status_code=404, detail="no media with that id for the sampler") from err
        except (OSError, ValueError, media.MediaError) as err:
            raise HTTPException(status_code=422, detail=f"the sampler's media cannot be read: {err}") from err
        mono = np.asarray(view, dtype=np.float32).mean(axis=1).astype("<f4")
        raw = core.render_sampled(frames, rate, mono.tobytes(), int(sample_rate), sampler.root, patch.attack, patch.decay, patch.sustain, patch.release, patch.gain)
        out = _padded(np.frombuffer(raw, dtype="<f4").copy(), rate, length)
        return media.import_wav(f"{name}.wav", _wav_bytes([out, out], rate))
    try:
        raw = core.render_notes(frames, rate, patch.wave, patch.attack, patch.decay, patch.sustain, patch.release, patch.gain, patch.cutoff, patch.resonance)
    except TypeError:
        raw = core.render_notes(frames, rate, patch.wave, patch.attack, patch.decay, patch.sustain, patch.release, patch.gain)
    mono = _padded(np.frombuffer(raw, dtype="<f4").copy(), rate, length)
    return media.import_wav(f"{name}.wav", _wav_bytes([mono, mono], rate))


@router.post("/import", status_code=201)
async def import_midi(request: Request, rate: int = 48000) -> dict:
    """A .mid file as tracks (S8): each track's name, notes and controllers (seconds) and its rendering by the built-in
    instrument as media, with the file's tempo map, meters, markers and keys; `notes` and `media` are the first
    track's, as before."""
    data = await request.body()
    try:
        song = midi.read_song(data)
    except midi.MidiError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err
    if not song["tracks"]:
        raise HTTPException(status_code=422, detail="the file has no notes")
    base = (request.headers.get("x-filename") or "notes.mid").rsplit(".", 1)[0]
    for track in song["tracks"]:
        track["media"] = _render(track["notes"], rate, Patch(), track["name"] if len(song["tracks"]) > 1 else base)
    first = song["tracks"][0]
    return {**song, "notes": first["notes"], "media": first["media"]}


@router.post("/from-audio", status_code=201)
def midi_from_audio(media_id: str, mode: str = "melodic", start: float = 0.0, length: float | None = None, rate: int = 48000) -> dict:
    """PT-13: a clip's audio as MIDI notes (melodic, polyphonic or rhythmic, services/audio_midi.py) and their rendering
    by the built-in instrument, shaped as MIDI import answers so the interface makes the same note clip."""
    from ..services import audio_midi

    try:
        notes = audio_midi.to_notes(media_id, mode, start, length)
    except KeyError as err:
        raise HTTPException(status_code=404, detail="no media with that id") from err
    except media.MediaError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err
    if not notes:
        raise HTTPException(status_code=422, detail="no notes were found in this clip")
    name = f"{media.media_info(media_id)['name'].rsplit('.', 1)[0]} ({mode} MIDI)"
    duration = max(n["start"] + n["length"] for n in notes)
    return {"notes": notes, "tempo": 120.0, "duration": duration, "media": _render(notes, rate, Patch(), name)}


@router.post("/render", status_code=201)
def render_notes(body: RenderRequest) -> dict:
    """Edited notes rendered again by the built-in instrument, as new media (S7: at least `length` seconds long, and
    silence of that length for no notes)."""
    return _render([n.model_dump() for n in body.notes], body.rate, body.patch, body.name, body.sampler, body.plugin, body.length, body.instrument)


@router.get("/instrument-params")
def instrument_params(kind: str) -> list[dict]:
    """S14: the core's parameters for the subtractive (`subtractive`) or drum (`drums`) synth, in the order it takes
    their values."""
    import json

    try:
        return json.loads(media._require_core().instrument_params(kind))
    except ValueError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
