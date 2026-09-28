import os

DEFAULT_ORIGINS = "http://localhost:3060,http://127.0.0.1:3060,http://localhost:3061,http://127.0.0.1:3061"


def cors_origins() -> list[str]:
    raw = os.environ.get("FORMWAV_CORS_ORIGINS", DEFAULT_ORIGINS)
    return [origin.strip() for origin in raw.split(",") if origin.strip()]
