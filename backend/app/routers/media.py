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


@router.get("/effects")
def list_effects() -> list[dict]:
    from ..services import effects

    return effects.catalogue()


@router.post("/media/{media_id}/effect", status_code=201)
def apply_effect(media_id: str, name: str) -> dict:
    from ..services import effects

    try:
        return effects.apply(media_id, name)
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
