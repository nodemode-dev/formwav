"""Note tracks' engine side (AU-37, PT-14): a Standard MIDI File read into notes (services/midi.py) and the notes
rendered by the built-in instrument (the core's synth) into media the mixer plays like any audio. The notes stay the
clip's truth in the document; after an edit they are rendered again through /api/midi/render.
"""

from __future__ import annotations

import numpy as np
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ..services import media, midi
from ..services.audacity import _wav_bytes

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


class Sampler(BaseModel):
    """PT-15: a session media played as the instrument, re-pitched from its root note."""

    media: str
    root: int = Field(60, ge=0, le=127)


class RenderRequest(BaseModel):
    notes: list[Note]
    rate: int = Field(48000, ge=8000, le=192000)
    patch: Patch = Patch()
    name: str = "notes"
    sampler: Sampler | None = None


def _render(notes: list[dict], rate: int, patch: Patch, name: str, sampler: Sampler | None = None) -> dict:
    if patch.wave not in WAVES:
        raise HTTPException(status_code=422, detail=f"no waveform named {patch.wave} (one of {', '.join(WAVES)})")
    if not notes:
        raise HTTPException(status_code=422, detail="no notes to render")
    core = media._require_core()
    frames = [(int(round(n["start"] * rate)), max(1, int(round(n["length"] * rate))), int(n["pitch"]), int(n["velocity"])) for n in notes]
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
        out = np.frombuffer(raw, dtype="<f4").copy()
        return media.import_wav(f"{name}.wav", _wav_bytes([out, out], rate))
    raw = core.render_notes(frames, rate, patch.wave, patch.attack, patch.decay, patch.sustain, patch.release, patch.gain)
    mono = np.frombuffer(raw, dtype="<f4").copy()
    return media.import_wav(f"{name}.wav", _wav_bytes([mono, mono], rate))


@router.post("/import", status_code=201)
async def import_midi(request: Request, rate: int = 48000) -> dict:
    """A .mid file's notes (seconds), its first tempo, and their rendering by the built-in instrument as media."""
    data = await request.body()
    try:
        song = midi.read(data)
    except midi.MidiError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err
    name = (request.headers.get("x-filename") or "notes.mid").rsplit(".", 1)[0]
    rendered = _render(song["notes"], rate, Patch(), name)
    return {"notes": song["notes"], "tempo": song["tempo"], "duration": song["duration"], "media": rendered}


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
    """Edited notes rendered again by the built-in instrument, as new media."""
    return _render([n.model_dump() for n in body.notes], body.rate, body.patch, body.name, body.sampler)
