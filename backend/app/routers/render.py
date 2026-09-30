from fastapi import APIRouter, Body, HTTPException, Response

from ..services import export, media, render

router = APIRouter()


def _safe(name: str) -> str:
    return "".join("-" if ch in '\\/:*?"<>|' else ch for ch in name).strip() or "track"


@router.post("/render")
def render_session(document: dict = Body(...), format: str = "wav", what: str = "mix") -> Response:
    try:
        if what in ("stems", "multichannel"):
            import io
            import zipfile

            tracks = list(document.get("tracks") or [])
            if not tracks:
                raise render.RenderError("there are no tracks to export")
            stems_out = [
                render.render({**document, "tracks": [{**t, "solo": False, "mute": bool(t.get("mute")) if j == i else True} for j, t in enumerate(tracks)]})
                for i in range(len(tracks))
            ]
            stems = [s["wav"] for s in stems_out]
            if what == "multichannel":
                data, ext, mime = export.multichannel(stems, format, max(s["frames"] for s in stems_out))
                headers = {"X-Stems": str(len(stems)), "Content-Disposition": f'attachment; filename="multichannel.{ext}"'}
                return Response(content=data, media_type=mime, headers=headers)
            session_frames = max(s["frames"] for s in stems_out)
            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as bundle:
                for i, (t, wav) in enumerate(zip(tracks, stems), start=1):
                    data, ext, _ = export.encode(wav, format, session_frames)
                    bundle.writestr(f"{i:02d} {_safe(str(t.get('name') or 'track'))}.{ext}", data)
            return Response(content=buffer.getvalue(), media_type="application/zip", headers={"X-Stems": str(len(stems)), "Content-Disposition": 'attachment; filename="stems.zip"'})
        result = render.render(document)
        if what == "preview":
            # iZotope RX's streaming preview: the mix as it sounds after a lossy codec, decoded back into new media.
            if format not in ("mp3", "mp3-192", "ogg", "m4a"):
                raise render.RenderError("a streaming preview needs a lossy format: MP3, OGG or M4A")
            import subprocess
            import tempfile
            from pathlib import Path

            encoded, ext, _ = export.encode(result["wav"], format)
            rate = int(document.get("sampleRate") or 48000)
            with tempfile.TemporaryDirectory() as tmp:
                src, dst = Path(tmp) / f"enc.{ext}", Path(tmp) / "dec.wav"
                src.write_bytes(encoded)
                done = subprocess.run([media._tool("ffmpeg"), "-v", "error", "-nostdin", "-y", "-i", str(src), "-ar", str(rate), "-c:a", "pcm_f32le", str(dst)], capture_output=True, timeout=900)
                if done.returncode != 0:
                    raise media.MediaError(done.stderr.decode(errors="replace").strip()[-300:])
                return media.import_wav(f"Streaming preview ({export.FORMATS[format][3]}).wav", dst.read_bytes())
        data, ext, mime = export.encode(result["wav"], format)
    except KeyError as err:
        raise HTTPException(404, "the session uses media the engine does not have") from err
    except media.CoreMissing as err:
        raise HTTPException(503, str(err)) from err
    except (render.RenderError, media.MediaError, ValueError) as err:
        raise HTTPException(400, str(err)) from err
    headers = {
        "X-Frames": str(result["frames"]),
        "X-Peak-Left-dBFS": result["peakLeft"],
        "X-Peak-Right-dBFS": result["peakRight"],
        "X-Skipped-Clips": str(result["skipped"]),
        "X-Loudness-LUFS": result["loudness"],
        "Content-Disposition": f'attachment; filename="mix.{ext}"',
    }
    return Response(content=data, media_type=mime, headers=headers)
