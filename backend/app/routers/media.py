from urllib.parse import unquote

from fastapi import APIRouter, HTTPException, Request, Response

from ..services import media

router = APIRouter()


@router.post("/media", status_code=201)
async def import_media(request: Request) -> dict:
    name = unquote(request.headers.get("x-filename", "untitled.wav"))[:255]
    data = await request.body()
    if not data:
        raise HTTPException(400, "the request carried no audio")
    try:
        return media.import_wav(name, data)
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
