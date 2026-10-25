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
from urllib.parse import quote, urlencode

import httpx
from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

logging.getLogger("httpx").setLevel(logging.WARNING)  # one INFO line per engine request is noise on the client's stderr
ENGINE = os.environ.get("FORMWAV_ENGINE", "http://127.0.0.1:8060").rstrip("/")
VERSION = "2.21.3"
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
        "formwav_render_session (a stereo mix, 5.1, or ADM objects). Generation, speech, dubbing and separation tools make new media too; "
        "formwav_local_models_status says which engines are ready. The prompt formwav_repair_workflow describes the usual order. "
        "With formwav's window open, the open session is editable too: formwav_open_session_tools and "
        "formwav_open_session_call reach its tracks, clips and effects, and formwav_list_commands, formwav_describe_command, "
        "formwav_run_command and formwav_run_commands reach every menu, key and button action; see formwav_edit_session_workflow."
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
async def formwav_apply_effect(media_id: str, effect: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """Applies one effect or repair to a media and returns the new media (the source is kept). `effect` is an id from
    formwav_list_effects; `params` maps that effect's parameter ids to numbers (missing ones take their defaults, values
    are kept inside their ranges). Example: effect "dereverb", params {"amount": 70, "rt60": 0.8, "floor": 18}. For a
    CLAP or VST3 plug-in (effect "plugin:clap:..." or "plugin:vst3:..."), params also take "state" (the base64 state a
    previous run returned as plugin.state, loaded first) and "automation" ({"p<id>": [[seconds, value], ...]}, the
    parameter moving along the media); the result then carries plugin {name, state}."""
    query = f"name={quote(effect)}" + (f"&params={quote(json.dumps(params))}" if params else "")
    out = (await _call("POST", f"/api/media/{quote(media_id)}/effect?{query}")).json()
    return {**_media(out), **({"plugin": out["plugin"]} if isinstance(out.get("plugin"), dict) else {})}


@mcp.tool(annotations=MAKES_MEDIA, structured_output=True)
async def formwav_debleed(media_id: str, reference_media_id: str, offset_samples: int = 0, amount: float = 100) -> dict[str, Any]:
    """Removes what leaked into a recording from another recording (headphone spill, a backing track, an amp in the
    vocal mic) and returns the new media. `reference_media_id` is the source of the leak; `offset_samples` is the
    reference's sample at the recording's first sample (0 when both start together); `amount` 0 to 100 percent."""
    query = f"reference={quote(reference_media_id)}&offset={int(offset_samples)}&amount={max(0.0, min(100.0, float(amount)))}"
    return _media((await _call("POST", f"/api/media/{quote(media_id)}/debleed?{query}")).json())


@mcp.tool(annotations=MAKES_MEDIA, structured_output=True)
async def formwav_heal_selection(media_id: str, boxes: list[dict[str, float]]) -> dict[str, Any]:
    """Heals a selection of spectrogram boxes in one explicit step and returns the new media (the source is kept). The
    boxes are the selection: each has from and to (seconds of this media) and low and high (Hz), one box per event
    (a click, a crackle burst, a whistle); 1 to 2000 boxes, all healed in one pass. The sound inside them is rebuilt
    from the sound around them (a dropout is filled instead). Nothing is healed until this is called, and it is never a
    brush stroke: choose the boxes from measurements, call this, then measure the result with formwav_analyze_media."""
    return _media((await _call("POST", f"/api/media/{quote(media_id)}/heal-painted", content=json.dumps({"boxes": boxes}).encode(), headers={"content-type": "application/json"})).json())


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
    """One saved session: its sample rate, length, and each track with its realtime effect chain (the Effects tab's:
    each effect's kind, parameters and whether it is bypassed) and its clips (media_id, media name, where the clip starts
    on the timeline and how long it is, in seconds)."""
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
        tracks.append({"name": t.get("name"), "muted": bool(t.get("mute")), "effects": list(t.get("fx") or []), "clips": clips})
    return {"name": name, "sample_rate": rate, "seconds": round(end / rate, 3), "tracks": tracks}


#: The engine's export formats (backend/app/services/export.py FORMATS), each a key the render route takes
RENDER_FORMATS = ("wav", "wav32", "wav24", "wav16", "aiff", "aiff16", "aifc", "flac", "flac16", "mp3", "mp3-192", "ogg", "m4a")


@mcp.tool(annotations=WRITES_FILE, structured_output=True)
async def formwav_render_session(name: str, path: str, format: str = "wav", what: str = "mix", start: float | None = None, end: float | None = None, normalize: float | None = None, dither: bool = True) -> dict[str, Any]:
    """Renders a saved session's mix (every track, its effects and automation, as the app plays it) to a file on this
    machine: `format` wav (32-bit float), wav32, wav24, wav16, aiff (24-bit), aiff16, aifc (32-bit float), flac (24-bit),
    flac16, mp3, mp3-192, ogg or m4a; `path` the file to write in an existing folder (replaced if present). `what`: mix
    (stereo, the default), surround51 (six channels, L R C LFE Ls Rs), surround (the session's own layout, stereo to
    9.1.6, one channel per speaker with the WAVE speaker mask) or adm (an ADM BWF: tracks placed on the surround pad
    as objects, moving along their paths, and tracks marked Bed as a 5.1 bed; always WAV). `start` and `end`, in seconds,
    render that range only (a mix, surround51 or surround; an end past the last clip keeps the effects' tails); `normalize`, in
    dBFS, sets the mix's highest sample (-0.1 is usual); `dither` (on unless false) adds TPDF dither to the 16 and 24-bit
    formats. A WAV carries the session's timecode start in its BWF bext chunk. Returns the file, and for a mix its sample
    peak, true peak and loudness as written."""
    fmt = format.lower().strip()
    kind = what.lower().strip()
    if kind not in ("mix", "surround51", "surround", "adm"):
        raise ToolError("what must be mix, surround51, surround or adm.")
    if kind != "mix":
        fmt = "wav"
    if fmt not in RENDER_FORMATS:
        raise ToolError(f"format must be one of {', '.join(RENDER_FORMATS)}.")
    if kind == "adm" and (start is not None or end is not None):
        raise ToolError("An ADM file is always the whole session; leave start and end out.")
    if normalize is not None and kind != "mix":
        raise ToolError("normalize applies to a mix only.")
    target = Path(path).expanduser()
    if not target.parent.is_dir():
        raise ToolError(f"The folder {target.parent} does not exist. Choose a path in an existing folder.")
    doc = (await _call("GET", f"/api/projects/{quote(name)}")).json()
    doc = doc.get("document", doc)
    rate = int(doc.get("sampleRate") or 48000)
    query = {"format": fmt, "what": kind, "dither": "true" if dither else "false"}
    if start is not None:
        query["start"] = str(round(start * rate))
    if end is not None:
        query["end"] = str(round(end * rate))
    if normalize is not None:
        query["normalize"] = str(normalize)
    res = await _call("POST", f"/api/render?{urlencode(query)}", content=json.dumps(doc).encode(), headers={"Content-Type": "application/json"}, timeout=1800)
    target.write_bytes(res.content)
    out: dict[str, Any] = {"path": str(target), "bytes": target.stat().st_size, "format": fmt, "what": kind}
    if kind == "mix":
        peaks = [res.headers.get("X-Peak-Left-dBFS", "-inf"), res.headers.get("X-Peak-Right-dBFS", "-inf")]
        out.update({"seconds": round(int(res.headers.get("X-Frames", 0)) / rate, 3), "peak_dbfs": max(peaks, key=float), "true_peak_dbtp": res.headers.get("X-True-Peak-dBTP"),
                    "loudness_lufs": res.headers.get("X-Loudness-LUFS"), "normalized_by_db": res.headers.get("X-Normalize-dB")})
    if kind == "surround" and res.headers.get("X-Channel-Names"):
        out.update({"channels": res.headers["X-Channel-Names"].split(","), "levels_dbfs": json.loads(res.headers.get("X-Channel-Peaks") or "{}")})
    return out


@mcp.tool(annotations=MAKES_MEDIA, structured_output=True)
async def formwav_transcribe_media(media_id: str) -> dict[str, Any]:
    """Transcribes speech in a media: its words with start and end times in seconds (faster-whisper on this machine;
    cached, so a second call is instant). Fails with instructions when the speech model is not installed."""
    data = (await _call("POST", f"/api/media/{quote(media_id)}/transcript", timeout=1800)).json()
    words = data.get("words", [])
    return {"media_id": media_id, "language": data.get("language"), "text": " ".join(str(w.get("text", "")).strip() for w in words), "words": [{"text": w.get("text"), "start": w.get("start"), "end": w.get("end")} for w in words]}


def _post(path: str, body: dict[str, Any], timeout: float = 1800.0):
    return _call("POST", path, content=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, timeout=timeout)


# 3.1: what formwav has gained since the first twelve tools, each a thin call to a route the engine already serves

@mcp.tool(annotations=READ, structured_output=True)
async def formwav_local_models_status() -> dict[str, Any]:
    """What can make sound on this machine and in the cloud: the local speech engines (Kokoro, Pocket TTS, Chatterbox)
    and whether each is installed, the dubbing languages installed, whether ACE-Step's server answers, and which cloud
    providers have their keys; and for every model its source, the licence of its code and weights, where it runs and
    what leaves the machine. Call it before generating, to pick an engine that will work and that the person may use."""
    speech = (await _call("GET", "/api/providers/local-speech")).json().get("engines", [])
    dub = (await _call("GET", "/api/providers/local-dub")).json()
    listing = (await _call("GET", "/api/providers")).json()
    providers = listing.get("providers", [])
    return {"local_speech": [{"engine": e["id"], "installed": e["installed"], "size": e["size"]} for e in speech],
            "dubbing": {"translator": dub.get("translator"), "languages": [l["code"] for l in dub.get("languages", []) if l.get("installed")]},
            "providers": [{"id": p["id"], "ready": p["ready"], "needs": p.get("needs")} for p in providers],
            "provenance": listing.get("provenance", [])}


@mcp.tool(annotations=READ, structured_output=True)
async def formwav_list_voices(engine: str = "kokoro") -> dict[str, Any]:
    """The voices an engine speaks in: kokoro (on this machine, once installed) or elevenlabs (the account's voices,
    needs ELEVENLABS_API_KEY). Use a returned voice with formwav_generate_speech."""
    if engine == "kokoro":
        return {"engine": engine, "voices": (await _call("GET", "/api/providers/local-speech/kokoro/voices")).json().get("voices", [])}
    if engine == "elevenlabs":
        return {"engine": engine, "voices": [{"voice_id": v.get("voice_id"), "name": v.get("name")} for v in (await _call("GET", "/api/providers/elevenlabs/voices")).json().get("voices", [])]}
    raise ToolError("engine must be kokoro or elevenlabs.")


@mcp.tool(annotations=MAKES_MEDIA, structured_output=True)
async def formwav_generate_speech(text: str, engine: str = "kokoro", voice: str = "") -> dict[str, Any]:
    """Speech from text, as new media: engine kokoro (on this machine; voice a Kokoro voice such as af_heart) or
    elevenlabs (voice an ElevenLabs voice_id, needs ELEVENLABS_API_KEY)."""
    if engine == "kokoro":
        return _media((await _post("/api/providers/local-speech/kokoro/speak", {"text": text, "voice": voice})).json())
    if engine == "elevenlabs":
        return _media((await _post("/api/providers/elevenlabs/speech", {"text": text, "voice_id": voice})).json())
    raise ToolError("engine must be kokoro or elevenlabs.")


@mcp.tool(annotations=MAKES_MEDIA, structured_output=True)
async def formwav_generate_music(prompt: str, lyrics: str = "", seconds: float = 30, engine: str = "elevenlabs") -> dict[str, Any]:
    """Music or a song from a prompt, with lyrics sung when given, as new media: engine elevenlabs (needs
    ELEVENLABS_API_KEY; 3 s to 10 min) or acestep (ACE-Step 1.5 on this machine, installed from Install a model on this
    machine, or its own server, uv run acestep-api; 10 s to 10 min; installed here, about 6 minutes for 30 s on one CPU
    thread, and faster with more cores, as it uses half the machine's threads)."""
    if engine == "elevenlabs":
        return _media((await _post("/api/providers/elevenlabs/music", {"prompt": prompt, "lyrics": lyrics, "seconds": seconds})).json())
    if engine == "acestep":
        return _media((await _post("/api/providers/acestep/generate", {"task": "text2music", "prompt": prompt, "lyrics": lyrics, "seconds": seconds})).json())
    raise ToolError("engine must be elevenlabs or acestep.")


@mcp.tool(annotations=MAKES_MEDIA, structured_output=True)
async def formwav_generate_sound_effect(description: str, seconds: float = 5, loop: bool = False, engine: str = "elevenlabs", seed: int = 0) -> dict[str, Any]:
    """A sound effect from a description, as new media: engine elevenlabs (0.5 to 30 s, looping seamlessly when asked,
    needs ELEVENLABS_API_KEY) or local (EzAudio on this machine once installed: 1 to 10 whole seconds, no loop, the same
    seed and description make the same sound; about a minute or more on a laptop's CPU)."""
    if engine == "local":
        return _media((await _post("/api/providers/local-sfx/generate", {"text": description, "duration_s": seconds, "seed": seed}, timeout=3600.0)).json())
    if engine != "elevenlabs":
        raise ToolError("engine must be elevenlabs or local.")
    return _media((await _post("/api/providers/elevenlabs/sound", {"text": description, "duration_s": seconds, "loop": loop})).json())


@mcp.tool(annotations=READ, structured_output=True)
async def formwav_speech_regions(media_id: str) -> dict[str, Any]:
    """Where someone speaks in a media, in seconds (Silero VAD on this machine; under music too). Use it to find pauses
    for cuts: a cut inside a region lands in speech."""
    regions = (await _call("GET", f"/api/media/{quote(media_id)}/speech")).json().get("regions", [])
    return {"media_id": media_id, "regions": regions, "speech_seconds": round(sum(r["end"] - r["start"] for r in regions), 3)}


@mcp.tool(annotations=MAKES_MEDIA, structured_output=True)
async def formwav_transcribe_with_speakers(media_id: str, speakers: int = 0) -> dict[str, Any]:
    """Transcribes with ElevenLabs Scribe v2 (needs ELEVENLABS_API_KEY): words with times, which speaker said each, and
    sounds such as laughter as events; kept as the media's transcript too. `speakers` 0 lets it count them."""
    data = (await _post("/api/providers/elevenlabs/transcribe", {"media_id": media_id, "speakers": speakers or None})).json()
    return {"media_id": media_id, "language": data.get("language"), "words": data.get("words", [])}


@mcp.tool(annotations=MAKES_MEDIA, structured_output=True)
async def formwav_regenerate_words(media_id: str, start_seconds: float, end_seconds: float, text: str, engine: str = "elevenlabs") -> dict[str, Any]:
    """Replaces the speech between two times with new words in the speaker's own voice, cloned from the recording, as
    new media (the source is kept): engine elevenlabs (needs ELEVENLABS_API_KEY), pocket or chatterbox (installed on
    this machine). Find the times with formwav_transcribe_media."""
    path = "/api/providers/elevenlabs/regenerate" if engine == "elevenlabs" else f"/api/providers/local-speech/{quote(engine)}/regenerate"
    if engine not in ("elevenlabs", "pocket", "chatterbox"):
        raise ToolError("engine must be elevenlabs, pocket or chatterbox.")
    out = (await _post(path, {"media_id": media_id, "start_s": start_seconds, "end_s": end_seconds, "text": text})).json()
    return {**_media(out["media"]), "replaced_seconds": out.get("replaced_s"), "inserted_seconds": out.get("inserted_s")}


@mcp.tool(annotations=MAKES_MEDIA, structured_output=True)
async def formwav_dub_media(media_id: str, language: str = "es", engine: str = "local", own_voice: bool = False) -> dict[str, Any]:
    """Dubs a media's speech into another language, as new media the same length: engine local (Whisper, Argos
    Translate and Kokoro on this machine; es, fr, it or pt once installed; own_voice speaks it in the speaker's own
    voice with Chatterbox instead, about 100 s for an 11 s clip) or elevenlabs (needs ELEVENLABS_API_KEY; waits for
    the job, up to 20 minutes)."""
    if engine == "local":
        out = (await _post(f"/api/providers/local-dub/{quote(language)}", {"media_id": media_id, **({"voice": "own"} if own_voice else {})}, timeout=7200.0)).json()
        return {**_media(out["media"]), "language": language, "sentences": [{"start": p["start"], "text": p["text"], "translated": p.get("translated")} for p in out.get("sentences", [])]}
    if engine == "elevenlabs":
        import asyncio

        job = (await _post("/api/providers/elevenlabs/dub", {"media_id": media_id, "target_lang": language})).json()
        for _ in range(240):
            st = (await _call("GET", f"/api/providers/elevenlabs/dub/{quote(job['job'])}?lang={quote(language)}")).json()
            if st.get("status") == "dubbed":
                return {**_media(st["media"]), "language": language}
            if st.get("status") in ("failed", "error"):
                raise ToolError(f"ElevenLabs could not dub it: {st.get('error') or st.get('status')}")
            await asyncio.sleep(5)
        raise ToolError("ElevenLabs had not finished after 20 minutes; the job continues on its side.")
    raise ToolError("engine must be local or elevenlabs.")


@mcp.tool(annotations=MAKES_MEDIA, structured_output=True)
async def formwav_separate_speech_music_ambience(media_id: str) -> dict[str, Any]:
    """Splits a media into speech, music and effects, three new media that add up to it exactly, on this machine:
    DeepFilterNet3's speech, then music by the trained TIGER-DnR separator where it is installed (method "trained"; the
    effects part comes back under ambience) or by harmonic-percussive masks (method "rule")."""
    out = (await _post(f"/api/media/{quote(media_id)}/three-way", {})).json()
    return {**{k: _media(out[k]) for k in ("speech", "music", "ambience")}, "method": out.get("method", "rule")}


@mcp.tool(annotations=READ, structured_output=True)
async def formwav_list_inputs() -> dict[str, Any]:
    """The audio interfaces formwav's engine can record from natively, each with its channel count (every channel of an
    interface, where a browser takes two). Empty when the engine has no native audio here."""
    return (await _call("GET", "/api/audio/inputs")).json()


@mcp.tool(annotations=MAKES_MEDIA, structured_output=True)
async def formwav_record(seconds: float, channels: list[int] | None = None, device: str = "") -> dict[str, Any]:
    """Records a take of `seconds` (at most 600) from a native input (formwav_list_inputs names them; `device` empty for
    the default), the channels listed (0-based; default the first), as new media."""
    import asyncio

    if not 0 < seconds <= 600:
        raise ToolError("seconds must be above 0 and at most 600.")
    await _post("/api/audio/record/start", {"device": device or None, "tracks": [{"trackId": "mcp", "channels": channels or [0], "name": "MCP take"}]})
    await asyncio.sleep(seconds)
    out = (await _post("/api/audio/record/stop", {})).json()
    return {"takes": [{**_media(t["media"]), "channels": t.get("channels")} for t in out.get("takes", [])]}


@mcp.tool(annotations=READ, structured_output=True)
async def formwav_cloud_status() -> dict[str, Any]:
    """Which cloud stores (Google Drive, Dropbox) are set up and connected for saving and opening sessions and media.
    Connecting is done once in formwav's File > Cloud."""
    return (await _call("GET", "/api/cloud")).json()


@mcp.tool(annotations=READ, structured_output=True)
async def formwav_cloud_list_files(provider: str, folder: str = "") -> dict[str, Any]:
    """The files in a connected cloud store's formwav folder (provider google or dropbox): ids and names, to import with
    formwav_cloud_import."""
    return (await _call("GET", f"/api/cloud/{quote(provider)}/files?folder={quote(folder)}")).json()


@mcp.tool(annotations=MAKES_MEDIA, structured_output=True)
async def formwav_cloud_import(provider: str, file_id: str, name: str) -> dict[str, Any]:
    """Brings a file from a connected cloud store into formwav: a session (.fmw) becomes a saved session, audio becomes
    new media."""
    out = (await _post(f"/api/cloud/{quote(provider)}/import", {"id": file_id, "name": name})).json()
    return {"session": out["project"]} if "project" in out else _media(out["media"])


@mcp.tool(annotations=ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=True, open_world_hint=True), structured_output=True)
async def formwav_cloud_save(provider: str, session: str = "", media_id: str = "") -> dict[str, Any]:
    """Saves a saved session (by name) or a media (by id) to a connected cloud store (google or dropbox)."""
    if bool(session) == bool(media_id):
        raise ToolError("give either session or media_id.")
    return (await _post(f"/api/cloud/{quote(provider)}/upload", {"project": session or None, "mediaId": media_id or None})).json()


async def _window(method: str, params: dict[str, Any]) -> Any:
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    out = (await _call("POST", "/mcp", content=body, headers={"content-type": "application/json", "x-formwav-agent": "formwav's MCP server"}, timeout=900.0)).json()
    if "error" in out:
        raise ToolError(str(out["error"].get("message")))
    return out.get("result")


def _text_result(result: Any) -> Any:
    parts = (result or {}).get("content") or []
    text = "".join(p.get("text", "") for p in parts if isinstance(p, dict))
    if (result or {}).get("isError"):
        raise ToolError(text or "the tool failed")
    try:
        return json.loads(text)
    except ValueError:
        return text


@mcp.tool(annotations=READ, structured_output=True)
async def formwav_open_session_tools() -> dict[str, Any]:
    """The tools of the session open in formwav's window (tracks, clips, effects, transcript, markers, loop, the command
    catalogue): names, descriptions and input schemas. They run inside the open window, so formwav must be open with a
    session; call formwav_open_session_call with a name from this list."""
    result = await _window("tools/list", {})
    tools = (result or {}).get("tools") or []
    if not tools:
        raise ToolError("formwav's window is not open, so the open session's tools are unavailable. Open formwav (./formwav), then retry.")
    return {"tools": tools}


@mcp.tool(annotations=ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=False, open_world_hint=False), structured_output=True)
async def formwav_open_session_call(tool: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
    """Runs one tool of the open session (from formwav_open_session_tools), for example get_session, set_track_gain,
    split_clip or apply_effect_to_clip. Every change is one undoable step in the window."""
    return {"result": _text_result(await _window("tools/call", {"name": tool, "arguments": arguments or {}}))}


@mcp.tool(annotations=READ, structured_output=True)
async def formwav_list_commands(group: str = "", text: str = "") -> dict[str, Any]:
    """The open session's command catalogue: every menu, key and button action, with its id and group. Filter by group
    or by words in text. Needs formwav's window open."""
    q = urlencode({k: v for k, v in (("group", group), ("text", text)) if v})
    out = (await _call("GET", f"/api/commands{'?' + q if q else ''}")).json()
    return out if isinstance(out, dict) else {"commands": out}


@mcp.tool(annotations=READ, structured_output=True)
async def formwav_describe_command(command_id: str) -> dict[str, Any]:
    """One catalogue command's parameters, defaults and what it does, before running it with formwav_run_command."""
    out = (await _call("GET", f"/api/commands/{quote(command_id)}")).json()
    return out if isinstance(out, dict) else {"command": out}


@mcp.tool(annotations=ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=False, open_world_hint=False), structured_output=True)
async def formwav_run_command(command_id: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """Runs one catalogue command on the open session with its params (see formwav_describe_command). One undo step."""
    return (await _post(f"/api/commands/{quote(command_id)}", {"params": params or {}})).json()


@mcp.tool(annotations=ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=False, open_world_hint=False), structured_output=True)
async def formwav_run_commands(commands: list[dict[str, Any]]) -> dict[str, Any]:
    """Runs several catalogue commands in order, each {"id": ..., "params": {...}}; stops at the first that fails and
    takes back everything the batch did, so the session is never left half-edited."""
    return {"result": _text_result(await _window("tools/call", {"name": "run_commands", "arguments": {"commands": commands}}))}


@mcp.prompt()
def formwav_edit_session_workflow(goal: str = "tighten the edit and balance the tracks") -> str:
    """How to edit the session open in formwav's window, step by step."""
    return (
        f"Edit the open formwav session to {goal}. 1) formwav_status, then formwav_open_session_tools (formwav must be "
        "open). 2) formwav_open_session_call with get_session to read tracks, clips and their ids. 3) Find the action: "
        "a named session tool, or formwav_list_commands with a word (split, fade, quantize, surround, marker) then "
        "formwav_describe_command. 4) Change it with formwav_open_session_call, formwav_run_command, or formwav_run_commands "
        "for several steps that must succeed together. 5) Read get_session again to confirm, and render with "
        "formwav_render_session after the user saves. Every step is undoable in the window."
    )


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
