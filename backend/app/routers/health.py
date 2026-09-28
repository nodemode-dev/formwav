from fastapi import APIRouter

from ..core.version import VERSION
from ..services.media import core_version

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "name": "formwav", "version": VERSION, "core": core_version() or "missing"}
