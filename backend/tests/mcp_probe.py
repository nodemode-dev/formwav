import asyncio
import json
import os
import sys
import urllib.request
from pathlib import Path

from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client

ENGINE, JFK, BACKEND, OUT = sys.argv[1], sys.argv[2], sys.argv[3], Path(sys.argv[4])
results: dict = {}


def record(name, ok, detail):
    results[name] = {"ok": bool(ok), "detail": str(detail)[:400]}


def absent(name, reason):
    results[name] = {"ok": True, "skip": reason, "detail": ""}


def engine(method, path, body=None):
    request = urllib.request.Request(ENGINE + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={"Content-Type": "application/json", "x-formwav-local": "1"})
    return json.loads(urllib.request.urlopen(request, timeout=600).read() or b"{}")


def says(err, text, *words):
    return err and any(word.lower() in text.lower() for word in words)


async def main():
    params = StdioServerParameters(command=sys.executable, args=["-m", "formwav_mcp.server"], cwd=BACKEND, env={**os.environ, "FORMWAV_ENGINE": ENGINE})
    async with stdio_client(params) as (read, write), ClientSession(read, write) as s:
        await s.initialize()
        tools = (await s.list_tools()).tools
        record("lists its tools", len(tools) == 34, f"{len(tools)} tools")

        async def call(name, args=None):
            res = await s.call_tool(name, args or {})
            return res.is_error, (res.structured_content or {}), " ".join(getattr(c, "text", "") for c in res.content)

        err, out, text = await call("formwav_status")
        record("formwav_status", not err and "version" in json.dumps(out), text[:120])
        err, models, text = await call("formwav_local_models_status")
        record("formwav_local_models_status", not err and "local_speech" in models, text[:160])
        installed = {e["engine"] for e in models.get("local_speech", []) if e["installed"]}
        spanish = "es" in models.get("dubbing", {}).get("languages", [])

        err, out, text = await call("formwav_list_voices", {"engine": "kokoro"})
        record("formwav_list_voices kokoro", (not err and len(out["voices"]) == 54) if "kokoro" in installed else says(err, text, "install"), text[:120])
        err, out, text = await call("formwav_list_voices", {"engine": "elevenlabs"})
        record("formwav_list_voices elevenlabs without a key", says(err, text, "ELEVENLABS_API_KEY"), text[:120])
        err, speech, text = await call("formwav_generate_speech", {"text": "Formwav speaks through its MCP server.", "voice": "af_heart"})
        record("formwav_generate_speech kokoro", (not err and speech["seconds"] > 1) if "kokoro" in installed else says(err, text, "install"), text[:120])
        for engine_name, words in (("elevenlabs", ("ELEVENLABS_API_KEY",)), ("acestep", ("acestep-api",))):
            err, out, text = await call("formwav_generate_music", {"prompt": "folk", "engine": engine_name})
            record(f"formwav_generate_music {engine_name} not set up", says(err, text, *words), text[:140])
        err, out, text = await call("formwav_generate_sound_effect", {"description": "rain"})
        record("formwav_generate_sound_effect without a key", says(err, text, "ELEVENLABS_API_KEY"), text[:120])

        err, jfk, text = await call("formwav_import_audio", {"path": JFK})
        record("formwav_import_audio", not err and abs(jfk["seconds"] - 11.0) < 0.01, text[:120])
        media_id = jfk.get("media_id")
        if (Path(BACKEND) / "models" / "vad" / "silero_vad.onnx").is_file():
            err, out, text = await call("formwav_speech_regions", {"media_id": media_id})
            record("formwav_speech_regions", not err and len(out["regions"]) >= 1 and out["speech_seconds"] > 5, text[:160])
        else:
            absent("formwav_speech_regions", "needs backend/models/vad/silero_vad.onnx, which the tool fetches on first use")
        err, out, text = await call("formwav_transcribe_media", {"media_id": media_id})
        record("formwav_transcribe_media", (not err and "fellow Americans" in out["text"]) or says(err, text, "requirements_transcript"), (out or {}).get("text", text)[:120])
        err, out, text = await call("formwav_transcribe_with_speakers", {"media_id": media_id})
        record("formwav_transcribe_with_speakers without a key", says(err, text, "ELEVENLABS_API_KEY"), text[:120])
        err, out, text = await call("formwav_regenerate_words", {"media_id": media_id, "start_seconds": 0.3, "end_seconds": 1.0, "text": "Well then", "engine": "pocket"})
        record("formwav_regenerate_words pocket", (not err and out["seconds"] > 0) if "pocket" in installed else says(err, text, "not installed"), text[:140])
        err, out, text = await call("formwav_dub_media", {"media_id": media_id, "language": "es"})
        dubbed = not err and abs(out["seconds"] - 11.0) < 0.01 and "ustedes" in json.dumps(out.get("sentences", []), ensure_ascii=False)
        record("formwav_dub_media local es", dubbed if spanish and "kokoro" in installed else says(err, text, "install"), text[:160])
        folder = Path(os.environ.get("FORMWAV_MODELS_ROOT", Path(BACKEND) / "models"))
        if os.environ.get("FORMWAV_DEEPFILTER") or any((folder / "deepfilter").glob("deep-filter-*")):
            err, out, text = await call("formwav_separate_speech_music_ambience", {"media_id": media_id})
            record("formwav_separate_speech_music_ambience", (not err and all(abs(out[k]["seconds"] - 11.0) < 0.01 for k in ("speech", "music", "ambience"))) or says(err, text, "DeepFilterNet"), text[:160])
        else:
            absent("formwav_separate_speech_music_ambience", "needs DeepFilterNet in the models folder, which the tool fetches on first use")

        err, out, text = await call("formwav_analyze_media", {"media_id": media_id})
        record("formwav_analyze_media", not err, text[:120])
        err, out, text = await call("formwav_list_media", {"query": "jfk"})
        record("formwav_list_media", not err and media_id in text, text[:120])
        err, out, text = await call("formwav_list_effects", {"query": "reverb"})
        record("formwav_list_effects", not err and "reverb" in text.lower(), text[:120])
        err, normalized, text = await call("formwav_apply_effect", {"media_id": media_id, "effect": "normalize"})
        record("formwav_apply_effect", not err and normalized.get("media_id") not in (None, media_id), text[:120])
        err, out, text = await call("formwav_debleed", {"media_id": media_id, "reference_media_id": normalized.get("media_id")})
        record("formwav_debleed", not err and out.get("media_id") not in (None, media_id), text[:120])
        err, out, text = await call("formwav_debleed", {"media_id": media_id, "reference_media_id": media_id})
        record("formwav_debleed refuses the recording as its own reference", says(err, text, "another recording"), text[:120])
        exported = OUT / "exported.wav"
        err, out, text = await call("formwav_export_media", {"media_id": media_id, "path": str(exported)})
        record("formwav_export_media", not err and exported.stat().st_size > 1000, text[:120])

        err, inputs, text = await call("formwav_list_inputs")
        record("formwav_list_inputs", not err and "inputs" in inputs, text[:120])
        err, out, text = await call("formwav_record", {"seconds": 0.5})
        record("formwav_record", (not err and out["takes"]) or says(err, text, "device", "input", "native"), text[:160])

        err, out, text = await call("formwav_cloud_status")
        record("formwav_cloud_status", not err and "dropbox" in out, text[:120])
        for name, args in (("formwav_cloud_list_files", {"provider": "dropbox"}), ("formwav_cloud_import", {"provider": "dropbox", "file_id": "x", "name": "x.wav"}), ("formwav_cloud_save", {"provider": "dropbox", "media_id": media_id})):
            err, out, text = await call(name, args)
            record(f"{name} not connected", says(err, text, "connect"), text[:140])

        a = engine("POST", "/api/generate?kind=tone&seconds=3&freq=500")
        b = engine("POST", "/api/generate?kind=tone&seconds=3&freq=700")
        clip = lambda cid, m: {"id": cid, "mediaId": m["id"], "start": 0, "sourceIn": 0, "length": 144000, "gainDb": 0}
        engine("PUT", "/api/projects/MCP%20check", {"version": 1, "sampleRate": 48000, "media": {a["id"]: a, b["id"]: b}, "markers": [], "tracks": [
            {"id": "t1", "name": "moving", "gainDb": 0, "pan": 0, "mute": False, "solo": False, "clips": [clip("c1", a)], "surround": {"x": -0.5, "y": 0.866, "path": [{"at": 0, "x": -0.5, "y": 0.866}, {"at": 96000, "x": 0.5, "y": 0.866}]}},
            {"id": "t2", "name": "bed", "gainDb": 0, "pan": 0, "mute": False, "solo": False, "clips": [clip("c2", b)], "surround": {"x": 0, "y": 1, "bed": True}}]})
        err, out, text = await call("formwav_list_sessions")
        record("formwav_list_sessions", not err and "MCP check" in text, text[:120])
        err, out, text = await call("formwav_get_session", {"name": "MCP check"})
        record("formwav_get_session", not err and "moving" in text, text[:120])
        for what in ("mix", "surround51", "adm"):
            path = OUT / f"render_{what}.wav"
            err, out, text = await call("formwav_render_session", {"name": "MCP check", "path": str(path), "what": what})
            record(f"formwav_render_session {what}", not err and out.get("what") == what and path.stat().st_size > 1000, text[:120])
        path = OUT / "render_range.aiff"
        err, out, text = await call("formwav_render_session", {"name": "MCP check", "path": str(path), "format": "aiff", "start": 0.5, "end": 2.5, "normalize": -1.0})
        record("formwav_render_session a range as AIFF, normalized", not err and out.get("seconds") == 2.0 and path.read_bytes()[8:12] == b"AIFF" and abs(float(out.get("peak_dbfs") or "nan") + 1.0) < 0.01, text[:160])
        err, out, text = await call("formwav_render_session", {"name": "MCP check", "path": str(OUT / "range.wav"), "what": "adm", "start": 1.0})
        record("formwav_render_session refuses a range for ADM", says(err, text, "whole session"), text[:140])
        err, out, text = await call("formwav_open_session_tools")
        record("formwav_open_session_tools without a window", says(err, text, "window is not open"), text[:140])
        err, out, text = await call("formwav_run_commands", {"commands": [{"id": "transport.play"}]})
        record("formwav_run_commands without a window", says(err, text, "window is not open", "not open"), text[:140])


asyncio.run(main())
print(json.dumps(results))
