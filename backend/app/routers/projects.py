from fastapi import APIRouter, Body, HTTPException, Request
from fastapi.responses import FileResponse, Response

from ..services import audacity, media, projects

router = APIRouter()


@router.post("/projects/import-audacity")
async def import_audacity(request: Request) -> dict:
    data = await request.body()
    if not data:
        raise HTTPException(400, "the request carried no file")
    try:
        return audacity.import_aup_zip(data)
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.get("/projects")
def list_projects() -> list[dict]:
    return projects.list_projects()


@router.put("/projects/{name}")
def save_project(name: str, document: dict = Body(...), base: int | None = None) -> dict:
    try:
        return projects.save(name, document, base)
    except projects.RevisionConflict as err:
        message = (
            "a saved session with that name already exists"
            if base == 0
            else "the session was saved elsewhere since this copy was opened or saved"
        )
        raise HTTPException(409, {"message": message, "revision": err.current}) from err
    except projects.ProjectError as err:
        raise HTTPException(400, str(err)) from err


@router.post("/projects/open-file")
def open_project_file(body: dict = Body(...)) -> dict:
    try:
        return projects.open_file(str(body.get("path", "")))
    except media.CoreMissing as err:
        raise HTTPException(503, str(err)) from err
    except (projects.ProjectError, media.MediaError) as err:
        raise HTTPException(400, str(err)) from err


@router.get("/projects/{name}")
def open_project(name: str) -> dict:
    try:
        return projects.open_project(name)
    except KeyError as err:
        raise HTTPException(404, "no saved session with that name") from err
    except media.CoreMissing as err:
        raise HTTPException(503, str(err)) from err
    except (projects.ProjectError, media.MediaError) as err:
        raise HTTPException(400, str(err)) from err


@router.get("/projects/{name}/thumbnail.png")
def project_thumbnail(name: str) -> Response:
    try:
        return Response(projects.thumbnail(name), media_type="image/png", headers={"Cache-Control": "no-cache"})
    except KeyError as err:
        raise HTTPException(404, "that saved session has no thumbnail") from err
    except projects.ProjectError as err:
        raise HTTPException(400, str(err)) from err


@router.get("/projects/{name}/file")
def project_file(name: str) -> FileResponse:
    try:
        path = projects.file_path(name)
    except KeyError as err:
        raise HTTPException(404, "no saved session with that name") from err
    except projects.ProjectError as err:
        raise HTTPException(400, str(err)) from err
    return FileResponse(path, media_type="application/octet-stream", filename=path.name)
