from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import FileResponse

from ..services import media, projects

router = APIRouter()


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


@router.get("/projects/{name}/file")
def project_file(name: str) -> FileResponse:
    try:
        path = projects.file_path(name)
    except KeyError as err:
        raise HTTPException(404, "no saved session with that name") from err
    except projects.ProjectError as err:
        raise HTTPException(400, str(err)) from err
    return FileResponse(path, media_type="application/octet-stream", filename=path.name)
