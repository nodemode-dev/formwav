from fastapi import APIRouter

from ..core.version import VERSION

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "name": "formwav", "version": VERSION}
