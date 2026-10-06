import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.config import cors_origins
from .core.security import LocalOnly
from .core.version import VERSION
from .routers import agent, cloud, health, remote, room, share, media, midi, native_audio, presets, projects, providers, render, terminal

app = FastAPI(title="formwav engine", version=VERSION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["*"],
    expose_headers=["X-Samples-Per-Peak", "X-Channels", "X-Blocks"],
)
app.add_middleware(LocalOnly)
app.include_router(health.router, prefix="/api")
app.include_router(media.router, prefix="/api")
app.include_router(presets.router, prefix="/api")
app.include_router(projects.router, prefix="/api")
app.include_router(render.router, prefix="/api")
app.include_router(terminal.router, prefix="/api")
app.include_router(native_audio.router)
app.include_router(midi.router)
app.include_router(agent.router, prefix="/api")
app.include_router(providers.router, prefix="/api")
app.include_router(cloud.router, prefix="/api")  # cloud projects: Google Drive and Dropbox, ported from formcut
app.include_router(remote.router)  # devices on the local network, paired; ported from formcut (its routes carry /api and /pair)
remote.resume(app)  # reopen the network listener at start if it was left on
app.include_router(room.router, prefix="/api")  # remote recording: a track per guest
app.include_router(room.page_router)  # /room, the guests' page
app.include_router(share.router, prefix="/api")  # shared editing: the hub that orders every editor's commands

# formwave's generative voice (app/voice): optional, as it needs numpy and soundfile to import and torch and the Qwen
# packages to load a model. Its runtime module goes first so its MPS settings apply before torch loads.
try:
    from .voice.core import runtime as _voice_runtime  # noqa: F401
    from .voice.routers import export as _voice_export
    from .voice.routers import generate as _voice_generate
    from .voice.routers import models as _voice_models
    from .voice.routers import transcribe as _voice_transcribe

    for _voice_router in (_voice_models, _voice_generate, _voice_export, _voice_transcribe):
        app.include_router(_voice_router.router, prefix="/api/voice")
except ImportError as _voice_error:
    from fastapi import APIRouter, HTTPException

    _voice_missing = str(_voice_error)
    _voice_fallback = APIRouter()

    @_voice_fallback.api_route("/voice/{rest:path}", methods=["GET", "POST"])
    def voice_unavailable(rest: str) -> None:
        raise HTTPException(
            503,
            f"the voice runtime is not installed ({_voice_missing}); install backend/requirements_voice.txt "
            "(requirements_voice_macos.txt on a Mac), then backend/requirements_voice_qwen.txt with --no-deps",
        )

    app.include_router(_voice_fallback, prefix="/api")

# The desktop app (desktop_entry.py) points FORMWAV_DIST at the interface built into it, served from the engine's own
# origin so the page and the API are one origin; mounted last, after every /api route. The web build leaves it unset.
_dist = os.environ.get("FORMWAV_DIST", "")
if _dist and os.path.isdir(_dist):
    from fastapi.staticfiles import StaticFiles

    app.mount("/", StaticFiles(directory=_dist, html=True), name="interface")
