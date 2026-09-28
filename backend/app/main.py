from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.config import cors_origins
from .core.version import VERSION
from .routers import health

app = FastAPI(title="formwav engine", version=VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["*"],
)
app.include_router(health.router, prefix="/api")
