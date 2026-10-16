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
        if data.startswith(b"SQLite format 3\x00"):  # AU-33: an Audacity 3 project
            return audacity.import_aup3(data, request.headers.get("x-filename", "Audacity project.aup3").rsplit("/", 1)[-1].rsplit(".", 1)[0])
        return audacity.import_aup_zip(data)
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.post("/projects/import-aaf")
async def import_aaf(request: Request) -> dict:
    """PT-30: an AAF's timeline as tracks of clips, its embedded audio imported (services/aaf.py)."""
    from ..services import aaf

    data = await request.body()
    if not data:
        raise HTTPException(400, "the request carried no file")
    try:
        return aaf.import_aaf(data)
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.post("/projects/conform")
def conform_edit(payload: dict = Body(...)) -> dict:
    """PT-31: {"edl", "media": [ids], "fps", "split", "rate"}: the edit's audio events built from the recorder files
    (services/conform.py)."""
    from ..services import conform

    try:
        return conform.conform(str(payload.get("edl", "")), [str(m) for m in payload.get("media") or []], float(payload.get("fps", 25)), bool(payload.get("split")), int(payload.get("rate", 48000)))
    except (media.MediaError, ValueError, TypeError) as err:
        raise HTTPException(422, str(err)) from err


@router.post("/projects/export-aaf")
def export_aaf(document: dict = Body(...)) -> Response:
    """PT-30: the session's timeline as an AAF with its audio embedded."""
    from ..services import aaf

    try:
        data = aaf.export_aaf(document)
    except (media.MediaError, KeyError) as err:
        raise HTTPException(422, str(err)) from err
    return Response(content=data, media_type="application/octet-stream", headers={"Content-Disposition": 'attachment; filename="formwav-session.aaf"'})


@router.post("/projects/export-otio")
def export_otio(document: dict = Body(...), name: str = "formwav session") -> Response:
    """PLAN_v14 W4: the session's timeline as OpenTimelineIO, an .otioz bundle with the clips' audio (services/otio.py)."""
    from ..services import otio

    try:
        data = otio.export_otioz(document, name)
    except (media.MediaError, KeyError, ValueError) as err:
        raise HTTPException(422, str(err)) from err
    return Response(content=data, media_type="application/zip", headers={"Content-Disposition": 'attachment; filename="formwav-session.otioz"'})


def _autosave_file():
    from ..core.paths import data_dir

    folder = data_dir() / "autosave"
    folder.mkdir(parents=True, exist_ok=True)
    return folder / "session.json"


@router.put("/autosave")
def put_autosave(body: dict = Body(...)) -> dict:
    """PLAN_v14 W4: the open session's latest unsaved state, kept by the window every half minute while it has unsaved
    changes, written whole to a temporary file and renamed so a crash mid-write leaves the last good copy."""
    import json
    import os
    import time

    doc = body.get("document")
    if not isinstance(doc, dict) or not isinstance(doc.get("tracks"), list):
        raise HTTPException(400, "document must be a session")
    path = _autosave_file()
    tmp = path.with_suffix(".tmp")
    record = {"name": str(body.get("name") or "Untitled session")[:200], "savedAt": time.time(), "document": doc}
    tmp.write_text(json.dumps(record))
    os.replace(tmp, path)
    return {"savedAt": record["savedAt"]}


@router.get("/autosave")
def get_autosave(full: bool = False) -> dict:
    import json

    path = _autosave_file()
    try:
        record = json.loads(path.read_text())
    except (OSError, ValueError):
        return {"exists": False}
    doc = record.get("document") or {}
    summary = {"exists": True, "name": record.get("name"), "savedAt": record.get("savedAt"), "tracks": len(doc.get("tracks") or []), "clips": sum(len(t.get("clips") or []) for t in doc.get("tracks") or [])}
    return {**summary, "document": doc} if full else summary


@router.delete("/autosave")
def delete_autosave() -> dict:
    try:
        _autosave_file().unlink()
    except FileNotFoundError:
        pass
    return {"ok": True}


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


@router.post("/projects/clips-file")
def clips_file(group: dict = Body(...)) -> Response:
    """PLAN_v13 S13: clips and their media as a .fwclips file (services/projects.pack_clips)."""
    try:
        data = projects.pack_clips(group)
    except projects.ProjectError as err:
        raise HTTPException(400, str(err)) from err
    except media.CoreMissing as err:
        raise HTTPException(503, str(err)) from err
    return Response(data, media_type="application/zip", headers={"Content-Disposition": 'attachment; filename="clips.fwclips"'})


@router.post("/projects/clips-file/open")
async def open_clips_file(request: Request) -> dict:
    """A .fwclips file read back: its media brought in, its clips returned track by track."""
    try:
        return projects.unpack_clips(await request.body())
    except projects.ProjectError as err:
        raise HTTPException(400, str(err)) from err
    except (media.CoreMissing, media.MediaError) as err:
        raise HTTPException(422, str(err)) from err


@router.post("/projects/demo")
def demo_session(rate: int = 48000) -> dict:
    """PLAN_v13 S12: the demo session made in code (services/demo.py), its media written to the engine."""
    from ..services import demo

    if rate not in (44100, 48000, 88200, 96000):
        raise HTTPException(400, "the demo is made at 44100, 48000, 88200 or 96000 Hz")
    try:
        return {"name": "Demo", "document": demo.build(rate)}
    except media.CoreMissing as err:
        raise HTTPException(503, str(err)) from err


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
