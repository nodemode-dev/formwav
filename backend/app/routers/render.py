from fastapi import APIRouter, Body, HTTPException, Response

from ..services import media, render

router = APIRouter()


@router.post("/render")
def render_session(document: dict = Body(...)) -> Response:
    try:
        result = render.render(document)
    except KeyError as err:
        raise HTTPException(404, "the session uses media the engine does not have") from err
    except media.CoreMissing as err:
        raise HTTPException(503, str(err)) from err
    except (render.RenderError, media.MediaError, ValueError) as err:
        raise HTTPException(400, str(err)) from err
    headers = {
        "X-Frames": str(result["frames"]),
        "X-Peak-Left-dBFS": result["peakLeft"],
        "X-Peak-Right-dBFS": result["peakRight"],
        "X-Skipped-Clips": str(result["skipped"]),
        "Content-Disposition": 'attachment; filename="mix.wav"',
    }
    return Response(content=result["wav"], media_type="audio/wav", headers=headers)
