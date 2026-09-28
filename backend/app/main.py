from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.config import cors_origins
from .core.version import VERSION
from .routers import health, media, projects, render

app = FastAPI(title="formwav engine", version=VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["*"],
    expose_headers=["X-Samples-Per-Peak", "X-Channels", "X-Blocks"],
)
app.include_router(health.router, prefix="/api")
app.include_router(media.router, prefix="/api")
app.include_router(projects.router, prefix="/api")
app.include_router(render.router, prefix="/api")
