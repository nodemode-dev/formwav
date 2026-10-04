"""formwav's MCP server (owner decision, Sprint D): the engine's sessions, media, effects, repairs and renders as tools.

A thin client over the running engine's HTTP API (FORMWAV_ENGINE, default http://127.0.0.1:8060), so it shares the
engine's media store and saved sessions and adds no state of its own: media ids and session names are the handles, and
every edit makes new media, keeping the source. Runs over stdio for local agents (Claude Desktop, Claude Code):

    backend/formwav_mcp/venv/bin/python -m formwav_mcp.server

or with --http as stateless Streamable HTTP with JSON responses on 127.0.0.1:8061/mcp (loopback only). Its own venv
keeps the MCP SDK's Starlette apart from the engine's FastAPI. Errors come back in the result, written as what to do
next. Nothing is logged to stdout, which is the stdio protocol.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx
from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

logging.getLogger("httpx").setLevel(logging.WARNING)  # one INFO line per engine request is noise on the client's stderr
ENGINE = os.environ.get("FORMWAV_ENGINE", "http://127.0.0.1:8060").rstrip("/")
VERSION = "1.57.0"
READ = ToolAnnotations(read_only_hint=True, destructive_hint=False, idempotent_hint=True, open_world_hint=False)
MAKES_MEDIA = ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=True, open_world_hint=False)
WRITES_FILE = ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=True, open_world_hint=False)

mcp = MCPServer(
    name="formwav",
    title="formwav audio editor",
    version=VERSION,
    instructions=(
        "formwav is an audio editor; these tools reach its engine. Media are referred to by media_id (from "
        "formwav_list_media, formwav_import_audio or any tool that makes media) and saved sessions by name (from "
        "formwav_list_sessions). Editing never changes a source: every effect and repair returns a new media_id. "
        "Measure before and after with formwav_analyze_media, and export with formwav_export_media or "
        "formwav_render_session. The prompt formwav_repair_workflow describes the usual order."
    ),
)


async def _call(method: str, path: str, *, content: bytes | None = None, headers: dict[str, str] | None = None, timeout: float = 600.0) -> httpx.Response:
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            res = await client.request(method, f"{ENGINE}{path}", content=content, headers={**(headers or {}), "x-formwav-local": "1"})
    except httpx.ConnectError as err:
        raise ToolError(f"The formwav engine is not running at {ENGINE}. Start formwav (or its engine with backend/boot_backend), then retry.") from err
    if res.status_code >= 400:
        try:
            detail = res.json().get("detail")
        except ValueError:
            detail = res.text[:300]
        raise ToolError(f"The engine refused {method} {path.split('?')[0]}: {detail if isinstance(detail, str) else json.dumps(detail)[:300]}")
    return res


def _media(info: dict[str, Any]) -> dict[str, Any]:
    frames, rate = int(info.get("frames", 0)), int(info.get("sampleRate", 0)) or 1
    return {"media_id": info.get("id"), "name": info.get("name"), "seconds": round(frames / rate, 3), "channels": info.get("channels"), "sample_rate": info.get("sampleRate")}


@mcp.tool(annotations=READ, structured_output=True)
async def formwav_status() -> dict[str, Any]:
    """The engine's version and health, and how many media and saved sessions it holds. Call this first to check the
    engine is reachable; every other tool needs it running."""
    health = (await _call("GET", "/api/health")).json()
    media = (await _call("GET", "/api/media?limit=1")).json()
    sessions = (await _call("GET", "/api/projects")).json()
    return {"engine": ENGINE, "version": health.get("version"), "core": health.get("core"), "media": media.get("total"), "sessions": len(sessions if isinstance(sessions, list) else sessions.get("projects", []))}


@mcp.tool(annotations=READ, structured_output=True)
async def formwav_list_media(query: str = "", limit: int = 50, offset: int = 0) -> dict[str, Any]:
    """Stored media, newest first: media_id, name, length in seconds, channels and sample rate. `query` keeps names that
    contain it (case-insensitive); page with `limit` (1 to 500) and `offset`. Use it to find the media_id another tool
    needs."""
    page = (await _call("GET", f"/api/media?query={quote(query)}&limit={max(1, min(int(limit), 500))}&offset={max(0, int(offset))}")).json()
    return {"total": page["total"], "offset": page["offset"], "media": [_media(m) for m in page["media"]]}


@mcp.tool(annotations=READ, structured_output=True)
async def formwav_analyze_media(media_id: str) -> dict[str, Any]:
    """Levels of one media: peak and RMS in dBFS, integrated loudness in LUFS, DC offset, clipped samples and length.
    Measure before and after a repair to show what it changed."""
    info = (await _call("GET", f"/api/media/{quote(media_id)}")).json()
    stats = (await _call("GET", f"/api/media/{quote(media_id)}/stats")).json()
    return {**_media(info), "stats": stats}


@mcp.tool(annotations=READ, structured_output=True)
async def formwav_list_effects(query: str = "") -> dict[str, Any]:
    """The effects and repairs formwav can apply, by group, each with its id and its parameters (id, label, min, max,
    default, unit). `query` keeps effects whose id or label contains it. Pass an effect's id and parameters to
    formwav_apply_effect; repairs include De-reverb, Spot heal, Wow and flutter, Pitch correction, Dialogue contour,
    De-click and denoisers."""
    cat = (await _call("GET", "/api/effects")).json()
    groups = cat.get("groups") if isinstance(cat, dict) else cat
    q = query.lower().strip()
    out = []
    for group in groups or []:
        items = [
            {"id": it.get("id"), "label": it.get("label"), "params": it.get("params", [])}
            for it in (group.get("items") or group.get("effects") or [])
            if not q or q in str(it.get("id", "")).lower() or q in str(it.get("label", "")).lower()
        ]
        if items:
            out.append({"group": group.get("group") or group.get("name"), "effects": items})
    return {"groups": out}


@mcp.tool(annotations=MAKES_MEDIA, structured_output=True)
async def formwav_apply_effect(media_id: str, effect: str, params: dict[str, float] | None = None) -> dict[str, Any]:
    """Applies one effect or repair to a media and returns the new media (the source is kept). `effect` is an id from
    formwav_list_effects; `params` maps that effect's parameter ids to numbers (missing ones take their defaults, values
    are kept inside their ranges). Example: effect "dereverb", params {"amount": 70, "rt60": 0.8, "floor": 18}."""
    query = f"name={quote(effect)}" + (f"&params={quote(json.dumps(params))}" if params else "")
    return _media((await _call("POST", f"/api/media/{quote(media_id)}/effect?{query}")).json())


@mcp.tool(annotations=MAKES_MEDIA, structured_output=True)
async def formwav_debleed(media_id: str, reference_media_id: str, offset_samples: int = 0, amount: float = 100) -> dict[str, Any]:
    """Removes what leaked into a recording from another recording (headphone spill, a backing track, an amp in the
    vocal mic) and returns the new media. `reference_media_id` is the source of the leak; `offset_samples` is the
    reference's sample at the recording's first sample (0 when both start together); `amount` 0 to 100 percent."""
    query = f"reference={quote(reference_media_id)}&offset={int(offset_samples)}&amount={max(0.0, min(100.0, float(amount)))}"
    return _media((await _call("POST", f"/api/media/{quote(media_id)}/debleed?{query}")).json())


@mcp.tool(annotations=MAKES_MEDIA, structured_output=True)
async def formwav_import_audio(path: str) -> dict[str, Any]:
    """Imports an audio or video file from this machine (any format ffmpeg reads) and returns its media. `path` is an
    absolute path or one starting with ~."""
    file = Path(path).expanduser()
    if not file.is_file():
        raise ToolError(f"No file at {file}. Give an absolute path to an audio or video file on this machine.")
    data = file.read_bytes()
    return _media((await _call("POST", "/api/media", content=data, headers={"X-Filename": file.name, "Content-Type": "application/octet-stream"})).json())


@mcp.tool(annotations=WRITES_FILE, structured_output=True)
async def formwav_export_media(media_id: str, path: str) -> dict[str, Any]:
    """Writes one media to a WAV file on this machine and returns the path written and its length. `path` is the file
    to write (its folder must exist); an existing file there is replaced."""
    target = Path(path).expanduser()
    if not target.parent.is_dir():
        raise ToolError(f"The folder {target.parent} does not exist. Choose a path in an existing folder.")
    info = (await _call("GET", f"/api/media/{quote(media_id)}")).json()
    target.write_bytes((await _call("GET", f"/api/media/{quote(media_id)}/audio")).content)
    return {"path": str(target), "bytes": target.stat().st_size, **_media(info)}


@mcp.tool(annotations=READ, structured_output=True)
async def formwav_list_sessions() -> dict[str, Any]:
    """Saved formwav sessions (.fmw), each with its name; pass a name to formwav_get_session or formwav_render_session."""
    data = (await _call("GET", "/api/projects")).json()
    rows = data if isinstance(data, list) else data.get("projects", [])
    return {"sessions": [{k: r.get(k) for k in ("name", "tracks", "seconds", "savedAt", "modified") if k in r} for r in rows]}


@mcp.tool(annotations=READ, structured_output=True)
async def formwav_get_session(name: str) -> dict[str, Any]:
    """One saved session: its sample rate, length, and each track with its clips (media_id, media name, where the clip
    starts on the timeline and how long it is, in seconds)."""
    doc = (await _call("GET", f"/api/projects/{quote(name)}")).json()
    doc = doc.get("document", doc)
    rate = int(doc.get("sampleRate") or 48000)
    media = doc.get("media", {})
    tracks = []
    end = 0
    for t in doc.get("tracks", []):
        clips = []
        for c in t.get("clips", []):
            end = max(end, int(c.get("start", 0)) + int(c.get("length", 0)))
            clips.append({"media_id": c.get("mediaId"), "media": (media.get(c.get("mediaId")) or {}).get("name"), "start_s": round(int(c.get("start", 0)) / rate, 3), "seconds": round(int(c.get("length", 0)) / rate, 3)})
        tracks.append({"name": t.get("name"), "muted": bool(t.get("mute")), "clips": clips})
    return {"name": name, "sample_rate": rate, "seconds": round(end / rate, 3), "tracks": tracks}


@mcp.tool(annotations=WRITES_FILE, structured_output=True)
async def formwav_render_session(name: str, path: str, format: str = "wav") -> dict[str, Any]:
    """Renders a saved session's mix (every track, its effects and automation, as the app plays it) to a file on this
    machine: `format` wav, flac or mp3; `path` the file to write in an existing folder (replaced if present)."""
    fmt = format.lower().strip()
    if fmt not in ("wav", "flac", "mp3"):
        raise ToolError("format must be wav, flac or mp3.")
    target = Path(path).expanduser()
    if not target.parent.is_dir():
        raise ToolError(f"The folder {target.parent} does not exist. Choose a path in an existing folder.")
    doc = (await _call("GET", f"/api/projects/{quote(name)}")).json()
    doc = doc.get("document", doc)
    target.write_bytes((await _call("POST", f"/api/render?format={fmt}&what=mix", content=json.dumps(doc).encode(), headers={"Content-Type": "application/json"}, timeout=1800)).content)
    return {"path": str(target), "bytes": target.stat().st_size, "format": fmt}


@mcp.tool(annotations=MAKES_MEDIA, structured_output=True)
async def formwav_transcribe_media(media_id: str) -> dict[str, Any]:
    """Transcribes speech in a media: its words with start and end times in seconds (faster-whisper on this machine;
    cached, so a second call is instant). Fails with instructions when the speech model is not installed."""
    data = (await _call("POST", f"/api/media/{quote(media_id)}/transcript", timeout=1800)).json()
    words = data.get("words", [])
    return {"media_id": media_id, "language": data.get("language"), "text": " ".join(str(w.get("text", "")).strip() for w in words), "words": [{"text": w.get("text"), "start": w.get("start"), "end": w.get("end")} for w in words]}


@mcp.prompt()
def formwav_repair_workflow(problem: str = "noise, reverb, clicks, hum, a leak from another track, or tuning") -> str:
    """How to repair a recording with formwav's tools, step by step."""
    return (
        f"Repair the recording's {problem} with formwav. 1) formwav_status to check the engine. 2) Find the media "
        "(formwav_list_media, or formwav_import_audio for a file). 3) formwav_analyze_media to measure it. "
        "4) formwav_list_effects with a word from the problem (dereverb, heal, flutter, bleed, pitch, denoise, click) to "
        "find the repair and its parameters. 5) formwav_apply_effect (or formwav_debleed with the leaking recording) "
        "with moderate settings first. 6) formwav_analyze_media on the result and compare with step 3; repeat step 5 "
        "on the original with other settings if needed (sources are never changed). 7) formwav_export_media to a file "
        "the user names. Report the before and after measurements."
    )


def main() -> None:
    if "--http" in sys.argv:
        port = int(os.environ.get("FORMWAV_MCP_PORT", "8061"))
        mcp.run(transport="streamable-http", host="127.0.0.1", port=port, json_response=True, stateless_http=True)
    else:
        mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
