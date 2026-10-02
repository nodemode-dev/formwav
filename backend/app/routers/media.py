from urllib.parse import unquote

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse

from ..core.paths import media_dir
from ..services import media

router = APIRouter()


def _rate(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        rate = int(value)
    except ValueError as err:
        raise HTTPException(400, "rate must be a whole number of hertz") from err
    if not 8000 <= rate <= 384000:
        raise HTTPException(400, "rate must be between 8000 and 384000")
    return rate


@router.post("/media", status_code=201)
async def import_media(request: Request) -> dict:
    name = unquote(request.headers.get("x-filename", "untitled.wav"))[:255]
    data = await request.body()
    if not data:
        raise HTTPException(400, "the request carried no audio")
    try:
        return media.import_audio(name, data, _rate(request.query_params.get("rate")))
    except media.CoreMissing as err:
        raise HTTPException(503, str(err)) from err
    except media.MediaError as err:
        raise HTTPException(415, str(err)) from err


@router.get("/library")
def library_catalogue() -> list[dict]:
    from ..services import library

    return library.catalogue()


@router.get("/library/{item}/preview.wav")
def library_preview(item: str) -> Response:
    from ..services import library

    try:
        return Response(library.wav(item), media_type="audio/wav", headers={"Cache-Control": "max-age=3600"})
    except KeyError as err:
        raise HTTPException(404, "no library item with that name") from err


@router.post("/library/{item}", status_code=201)
def library_add(item: str, rate: int = 48000) -> dict:
    from ..services import library

    try:
        return library.add(item, rate)
    except KeyError as err:
        raise HTTPException(404, "no library item with that name") from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.post("/generate", status_code=201)
def generate_signal(kind: str, seconds: float = 5.0, rate: int = 48000, freq: float = 440.0, digits: str = "") -> dict:
    from ..services import tools

    try:
        return tools.generate(kind, seconds, _rate(str(rate)) or rate, freq, digits)
    except media.CoreMissing as err:
        raise HTTPException(503, str(err)) from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.post("/media/{media_id}/excerpt", status_code=201)
def media_excerpt(media_id: str, start: float, end: float) -> dict:
    from ..services import tools

    try:
        return tools.excerpt(media_id, start, end)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.get("/media/{media_id}/transients")
def media_transients(media_id: str, sensitivity: float = 0.5) -> dict:
    """Transients (Pro Tools' transient detection, as a reference) in the file's own seconds, from the core."""
    try:
        media._check_id(media_id)
        path = media_dir() / f"{media_id}.wav"
        if not path.exists():
            raise KeyError(media_id)
        native = media._require_core()
        rate, found = native.onsets(path.read_bytes(), max(0.0, min(1.0, float(sensitivity))))
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.CoreMissing as err:
        raise HTTPException(503, str(err)) from err
    except (media.MediaError, ValueError) as err:
        raise HTTPException(422, str(err)) from err
    return {"rate": rate, "seconds": [round(s / rate, 6) for s in found]}


@router.post("/media/{media_id}/deconstruct", status_code=201)
def media_deconstruct(media_id: str, start: float = 0.0, end: float | None = None) -> list[dict]:
    from ..services import separate

    try:
        return separate.deconstruct(media_id, start, end)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except separate.SeparationUnavailable as err:
        raise HTTPException(503, str(err)) from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.post("/media/{media_id}/separate", status_code=201)
def media_separate(media_id: str, start: float = 0.0, end: float | None = None) -> list[dict]:
    from ..services import separate

    try:
        return separate.separate(media_id, start, end)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except separate.SeparationUnavailable as err:
        raise HTTPException(503, str(err)) from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.get("/media/{media_id}/mic-check")
def media_mic_check(media_id: str) -> dict:
    from ..services import tools

    try:
        return tools.mic_check(media_id)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.post("/media/{media_id}/debleed", status_code=201)
def media_debleed(media_id: str, reference: str, offset: int = 0, amount: float = 100.0) -> dict:
    """The recording with what leaked into it from the reference subtracted (services/effects.py: debleed)."""
    from ..services import effects

    if reference == media_id:
        raise HTTPException(422, "the reference must be another recording")
    try:
        return effects.debleed(media_id, reference, offset, max(0.0, min(100.0, amount)))
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.get("/media/{media_id}/pcm")
def media_pcm(media_id: str, start: int = 0, frames: int = 480000) -> Response:
    """Interleaved little-endian float32 frames from `start` (at most 100 s at 48 kHz per request), read from the stored
    WAV mapped from disk, so a long file can be streamed into the player in pieces."""
    import numpy as np

    from ..services import tools

    try:
        view, rate = tools._wav_view(media_id)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err
    total = int(view.shape[0])
    start = max(0, min(int(start), total))
    count = max(0, min(int(frames), 4_800_000, total - start))
    data = np.ascontiguousarray(view[start : start + count], dtype="<f4").tobytes()
    headers = {"X-Frames": str(count), "X-Start": str(start), "X-Total-Frames": str(total), "X-Channels": str(int(view.shape[1])), "X-Sample-Rate": str(rate)}
    return Response(data, media_type="application/octet-stream", headers=headers)


@router.get("/media/{media_id}/samples")
def media_samples(media_id: str, start: int = 0, count: int = 256) -> dict:
    from ..services import tools

    try:
        return tools.samples(media_id, start, count)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.post("/media/{media_id}/draw", status_code=201)
async def media_draw(media_id: str, request: Request) -> dict:
    from ..services import tools

    try:
        body = await request.json()
        return tools.draw(media_id, int(body.get("start", 0)), list(body.get("values", [])))
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except (media.MediaError, TypeError, ValueError) as err:
        raise HTTPException(422, str(err)) from err


@router.post("/media/{media_id}/room-tone", status_code=201)
async def media_room_tone(media_id: str, request: Request) -> dict:
    from ..services import tools

    try:
        b = await request.json()
        times = [float(b[k]) for k in ("learnFrom", "learnTo", "fillFrom", "fillTo")]
    except (KeyError, TypeError, ValueError) as err:
        raise HTTPException(422, "send learnFrom, learnTo, fillFrom and fillTo in seconds") from err
    try:
        return tools.room_tone(media_id, str(b.get("learnMedia", media_id)), *times)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.get("/media/{media_id}/stats")
def media_stats(media_id: str) -> dict:
    from ..services import tools

    try:
        return tools.stats(media_id)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.get("/media/{media_id}/spectrogram.png")
def media_spectrogram(media_id: str, w: int = 640, h: int = 240, legend: bool = True) -> Response:
    from ..services import tools

    try:
        return Response(content=tools.spectrogram_png(media_id, w, h, legend), media_type="image/png")
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.put("/media/{media_id}/transcript/word")
async def media_transcript_word(media_id: str, request: Request) -> dict:
    from ..services import transcript

    try:
        b = await request.json()
        index, start, end = int(b["index"]), float(b["start"]), float(b["end"])
    except (KeyError, TypeError, ValueError) as err:
        raise HTTPException(422, "send index, start and end (the media file's seconds)") from err
    try:
        return transcript.set_word(media_id, index, start, end, str(b.get("model", "")))
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.post("/media/{media_id}/transcript")
def media_transcript(media_id: str, model: str = "") -> dict:
    from ..services import transcript

    try:
        return transcript.transcript(media_id, model)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except transcript.TranscriptUnavailable as err:
        raise HTTPException(503, str(err)) from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.get("/effects")
def list_effects() -> list[dict]:
    from ..services import effects

    return effects.catalogue()


@router.get("/sam-audio/status")
def sam_audio_status() -> dict:
    """Which of SAM-Audio's preconditions are met: installed, Hugging Face login or a cached checkpoint, device."""
    from ..services import samaudio

    return samaudio.status()


@router.post("/media/{media_id}/isolate")
def isolate_sound(media_id: str, description: str, start: float | None = None, end: float | None = None,
                  spans: str = "", predict_spans: bool = False, candidates: int = 1) -> list:
    """SAM-Audio: the described sound and everything else from the region, as two media aligned with it; spans is a JSON
    list of [start, end] seconds from the region's start where the sound occurs (see services/samaudio.py)."""
    import json

    from ..services import samaudio
    from ..services.media import MediaError

    try:
        parsed = json.loads(spans) if spans else None
        if parsed is not None and not (isinstance(parsed, list) and all(isinstance(s, list) and len(s) == 2 for s in parsed)):
            raise ValueError
    except ValueError as err:
        raise HTTPException(422, "spans must be a JSON list of [start, end] pairs in seconds") from err
    try:
        return samaudio.isolate(media_id, description, start, end, parsed, predict_spans, candidates)
    except samaudio.Unavailable as err:
        raise HTTPException(503, str(err)) from err
    except MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.get("/media/{media_id}/key")
def media_key(media_id: str, start: float | None = None, end: float | None = None) -> dict:
    """Musical key, Camelot code and confidence of the media or a region in its own seconds (see services/key.py)."""
    from ..services import key
    from ..services.media import MediaError

    try:
        return key.detect(media_id, start, end)
    except MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.get("/media/{media_id}/tempo")
def media_tempo(media_id: str, start: float | None = None, end: float | None = None) -> dict:
    """Tempo and confidence of the media, or of a region in its own seconds (see services/tempo.py)."""
    from ..services import tempo
    from ..services.media import MediaError

    try:
        return tempo.detect(media_id, start, end)
    except MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.post("/media/{media_id}/eq-match", status_code=201)
def eq_match(media_id: str, reference: str, start: float | None = None, end: float | None = None,
             tstart: float | None = None, tend: float | None = None) -> dict:
    """iZotope RX's EQ Match: new media with the reference region's tonal balance, measured against the target region
    when one is given (see services/eqmatch.py)."""
    from ..services import eqmatch
    from ..services.media import MediaError

    try:
        return eqmatch.eq_match(media_id, reference, start, end, tstart, tend)
    except MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.post("/media/{media_id}/effect", status_code=201)
def apply_effect(media_id: str, name: str, params: str = "") -> dict:
    import json

    from ..services import effects

    try:
        values = json.loads(params) if params else None
    except json.JSONDecodeError as err:
        raise HTTPException(422, "params must be a JSON object") from err
    if values is not None and not isinstance(values, dict):
        raise HTTPException(422, "params must be a JSON object")
    try:
        return effects.apply(media_id, name, values)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.CoreMissing as err:
        raise HTTPException(503, str(err)) from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.post("/media/{media_id}/resample", status_code=201)
def resample(media_id: str, rate: int) -> dict:
    try:
        return media.resample_media(media_id, _rate(str(rate)) or rate)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.CoreMissing as err:
        raise HTTPException(503, str(err)) from err
    except media.MediaError as err:
        raise HTTPException(415, str(err)) from err


@router.get("/media/{media_id}")
def get_media(media_id: str) -> dict:
    try:
        return media.media_info(media_id)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.MediaError as err:
        raise HTTPException(400, str(err)) from err


@router.get("/media/{media_id}/peaks")
def get_peaks(media_id: str, spp: int = 256) -> Response:
    try:
        samples_per_peak, channels, blocks, payload = media.peaks(media_id, max(1, spp))
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.CoreMissing as err:
        raise HTTPException(503, str(err)) from err
    except media.MediaError as err:
        raise HTTPException(400, str(err)) from err
    headers = {
        "X-Samples-Per-Peak": str(samples_per_peak),
        "X-Channels": str(channels),
        "X-Blocks": str(blocks),
        "Cache-Control": "private, max-age=31536000, immutable",
    }
    return Response(content=payload, media_type="application/octet-stream", headers=headers)


@router.get("/media/{media_id}/audio")
def get_audio(media_id: str) -> FileResponse:
    try:
        media.media_info(media_id)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.MediaError as err:
        raise HTTPException(400, str(err)) from err
    return FileResponse(
        media_dir() / f"{media_id}.wav",
        media_type="audio/wav",
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )
