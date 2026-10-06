from urllib.parse import unquote

from fastapi import APIRouter, Body, HTTPException, Request, Response
from fastapi.responses import FileResponse

from ..core.paths import media_dir
from ..services import media

router = APIRouter()


def _rate(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        rate = int(value)
    except ValueError as err:
        raise HTTPException(400, "rate must be a whole number of hertz") from err
    if not 8000 <= rate <= 384000:
        raise HTTPException(400, "rate must be between 8000 and 384000")
    return rate


@router.post("/media", status_code=201)
async def import_media(request: Request) -> dict:
    name = unquote(request.headers.get("x-filename", "untitled.wav"))[:255]
    data = await request.body()
    if not data:
        raise HTTPException(400, "the request carried no audio")
    try:
        return media.import_audio(name, data, _rate(request.query_params.get("rate")))
    except media.CoreMissing as err:
        raise HTTPException(503, str(err)) from err
    except media.MediaError as err:
        raise HTTPException(415, str(err)) from err


@router.get("/library")
def library_catalogue() -> list[dict]:
    from ..services import library

    return library.catalogue()


@router.get("/library/catalogue/search")
def catalogue_search(q: str, limit: int = 20) -> dict:
    """DS-14: recorded sound effects and music on Wikimedia Commons matching the words, royalty-free licences only
    (public domain, CC0, CC BY), each with its credit (services/catalogue.py)."""
    from ..services import catalogue

    try:
        return {"results": catalogue.search(q, max(1, min(50, limit)))}
    except media.MediaError as err:
        raise HTTPException(status_code=502, detail=str(err)) from err


@router.get("/library/catalogue/preview")
def catalogue_preview(url: str) -> Response:
    """DS-14: a catalogue file's bytes for the interface to play before adding, from Commons' upload host only."""
    from ..services import catalogue

    try:
        data, kind = catalogue.preview(url)
    except media.MediaError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    return Response(content=data, media_type=kind)


@router.post("/library/catalogue/import", status_code=201)
def catalogue_import(body: dict = Body(...), rate: int | None = None) -> dict:
    """DS-14: a catalogue file imported as media ({"url", "title", "credit"}), its credit kept on the media for the
    session."""
    from ..services import catalogue

    try:
        return catalogue.import_item(str(body.get("url", "")), str(body.get("title", "")), str(body.get("credit", "")), rate)
    except media.MediaError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err


@router.get("/library/{item}/preview.wav")
def library_preview(item: str) -> Response:
    from ..services import library

    try:
        return Response(library.wav(item), media_type="audio/wav", headers={"Cache-Control": "max-age=3600"})
    except KeyError as err:
        raise HTTPException(404, "no library item with that name") from err


@router.post("/library/{item}", status_code=201)
def library_add(item: str, rate: int = 48000) -> dict:
    from ..services import library

    try:
        return library.add(item, rate)
    except KeyError as err:
        raise HTTPException(404, "no library item with that name") from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.post("/generate", status_code=201)
def generate_signal(kind: str, seconds: float = 5.0, rate: int = 48000, freq: float = 440.0, digits: str = "", waveform: str = "sine", amplitude: float = 0.5, freq_end: float = 8000.0, curve: str = "linear") -> dict:
    from ..services import tools

    try:
        return tools.generate(kind, seconds, _rate(str(rate)) or rate, freq, digits, waveform, amplitude, freq_end, curve)
    except media.CoreMissing as err:
        raise HTTPException(503, str(err)) from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.post("/media/{media_id}/excerpt", status_code=201)
def media_excerpt(media_id: str, start: float, end: float) -> dict:
    from ..services import tools

    try:
        return tools.excerpt(media_id, start, end)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.get("/media/{media_id}/transients")
def media_transients(media_id: str, sensitivity: float = 0.5) -> dict:
    """Transients (Pro Tools' transient detection, as a reference) in the file's own seconds, from the core."""
    try:
        media._check_id(media_id)
        path = media_dir() / f"{media_id}.wav"
        if not path.exists():
            raise KeyError(media_id)
        native = media._require_core()
        rate, found = native.onsets(path.read_bytes(), max(0.0, min(1.0, float(sensitivity))))
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.CoreMissing as err:
        raise HTTPException(503, str(err)) from err
    except (media.MediaError, ValueError) as err:
        raise HTTPException(422, str(err)) from err
    return {"rate": rate, "seconds": [round(s / rate, 6) for s in found]}


@router.post("/media/{media_id}/deconstruct", status_code=201)
def media_deconstruct(media_id: str, start: float = 0.0, end: float | None = None, tonalSens: float = 5.0, transientSens: float = 5.0,
                      rebalance: bool = False, tonalDb: float = 0.0, noisyDb: float = 0.0, transientDb: float = 0.0) -> list[dict]:
    from ..services import separate

    try:
        # RX-15: the split sensitivities, and with rebalance=true one result of the parts at their gains
        gains = (tonalDb, noisyDb, transientDb) if rebalance else None
        return separate.deconstruct(media_id, start, end, tonal_sens=tonalSens, transient_sens=transientSens, gains_db=gains)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except separate.SeparationUnavailable as err:
        raise HTTPException(503, str(err)) from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.post("/media/{media_id}/separate", status_code=201)
def media_separate(media_id: str, start: float = 0.0, end: float | None = None) -> list[dict]:
    from ..services import separate

    try:
        return separate.separate(media_id, start, end)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except separate.SeparationUnavailable as err:
        raise HTTPException(503, str(err)) from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.get("/media/{media_id}/mic-check")
def media_mic_check(media_id: str) -> dict:
    from ..services import tools

    try:
        return tools.mic_check(media_id)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.get("/media/{media_id}/repair-assistant")
def media_repair_assistant(media_id: str) -> dict:
    from ..services import repair_assistant

    try:
        return repair_assistant.analyse(media_id)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.post("/media/{media_id}/repair-assistant")
def media_repair_assistant_apply(media_id: str, intensity: str = "medium") -> dict:
    from ..services import repair_assistant

    try:
        return repair_assistant.apply(media_id, intensity)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.get("/media")
def media_list(query: str = "", limit: int = 100, offset: int = 0) -> dict:
    """The stored media, newest first, a page at a time (services/media.py: list_media)."""
    return media.list_media(query, limit, offset)


@router.get("/vamp/plugins")
def vamp_plugins() -> list[dict]:
    """AU-40: the Vamp analysis plugins on the Vamp path, with their parameters and outputs."""
    from ..services import vamp

    try:
        return vamp.list_plugins()
    except media.MediaError as err:
        raise HTTPException(503, str(err)) from err


@router.post("/media/{media_id}/vamp")
def media_vamp(media_id: str, payload: dict) -> dict:
    """AU-40: {"key", "params"}: the Vamp plugin run on the media (services/vamp.py); every output's features."""
    from ..services import vamp

    try:
        return vamp.run(media_id, str(payload.get("key", "")), payload.get("params") or {})
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.post("/media/{media_id}/nyquist", status_code=201)
def media_nyquist(media_id: str, payload: dict) -> dict:
    """AU-28: {"code"} (a Nyquist Prompt) or {"plugin", "values"} (one of Audacity's bundled Nyquist plug-ins and its
    controls) run on the clip by Audacity's own Nyquist (services/nyquist.py); a sound comes back as new media."""
    from ..services import nyquist

    try:
        return nyquist.run(media_id, payload.get("code"), payload.get("plugin"), payload.get("values") or {})
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.get("/nyquist/plugins")
def nyquist_plugins() -> list[dict]:
    """AU-28: Audacity's bundled Nyquist plug-ins that process audio, with their controls."""
    from ..services import nyquist

    return nyquist.list_plugins()


@router.post("/media/{media_id}/debleed-clicks", status_code=201)
def media_debleed_clicks(media_id: str, amount: float = 100.0) -> dict:
    """RX-05 without a reference: a headphone click track found by its steady tempo and taken out (services/effects.py:
    debleed_clicks); a recording with no click track is answered with 422 and left alone."""
    from ..services import effects

    try:
        return effects.debleed_clicks(media_id, max(0.0, min(100.0, amount)))
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.post("/media/{media_id}/debleed", status_code=201)
def media_debleed(media_id: str, reference: str, offset: int = 0, amount: float = 100.0, pathMs: float | None = None) -> dict:
    """The recording with what leaked into it from the reference subtracted (services/effects.py: debleed); pathMs
    fits a longer path than the default 2.7 ms (a room between the source and the mic, up to 500 ms)."""
    from ..services import effects

    if reference == media_id:
        raise HTTPException(422, "the reference must be another recording")
    try:
        return effects.debleed(media_id, reference, offset, max(0.0, min(100.0, amount)), pathMs)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.get("/media/{media_id}/pcm")
def media_pcm(media_id: str, start: int = 0, frames: int = 480000) -> Response:
    """Interleaved little-endian float32 frames from `start` (at most 100 s at 48 kHz per request), read from the stored
    WAV mapped from disk, so a long file can be streamed into the player in pieces."""
    import numpy as np

    from ..services import tools

    try:
        view, rate = tools._wav_view(media_id)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err
    total = int(view.shape[0])
    start = max(0, min(int(start), total))
    count = max(0, min(int(frames), 4_800_000, total - start))
    data = np.ascontiguousarray(view[start : start + count], dtype="<f4").tobytes()
    headers = {"X-Frames": str(count), "X-Start": str(start), "X-Total-Frames": str(total), "X-Channels": str(int(view.shape[1])), "X-Sample-Rate": str(rate)}
    return Response(data, media_type="application/octet-stream", headers=headers)


@router.get("/media/{media_id}/samples")
def media_samples(media_id: str, start: int = 0, count: int = 256) -> dict:
    from ..services import tools

    try:
        return tools.samples(media_id, start, count)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.post("/media/{media_id}/draw", status_code=201)
async def media_draw(media_id: str, request: Request) -> dict:
    from ..services import tools

    try:
        body = await request.json()
        channel = body.get("channel")
        return tools.draw(media_id, int(body.get("start", 0)), list(body.get("values", [])), None if channel is None else int(channel))
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except (media.MediaError, TypeError, ValueError) as err:
        raise HTTPException(422, str(err)) from err


async def roomtone_gap(request: Request) -> dict:
    """RX-01: room tone for a gap between clips, moving from the left clip's edge to the right clip's."""
    from ..services import tools

    try:
        b = await request.json()
        edge = lambda e: (str(e["media"]), float(e["from"]), float(e["to"]))  # noqa: E731
        return tools.gap_tone(edge(b["left"]), edge(b["right"]) if b.get("right") else None, float(b["seconds"]), str(b.get("seed", "")))
    except KeyError as err:
        raise HTTPException(404 if "media" not in str(err) and "left" not in str(err) and "seconds" not in str(err) else 422, f"missing or unknown {err}") from err
    except (TypeError, ValueError, media.MediaError) as err:
        raise HTTPException(422, str(err)) from err


router.add_api_route("/roomtone/gap", roomtone_gap, methods=["POST"], status_code=201)


@router.post("/media/{media_id}/room-tone", status_code=201)
async def media_room_tone(media_id: str, request: Request) -> dict:
    from ..services import tools

    try:
        b = await request.json()
        times = [float(b[k]) for k in ("learnFrom", "learnTo", "fillFrom", "fillTo")]
    except (KeyError, TypeError, ValueError) as err:
        raise HTTPException(422, "send learnFrom, learnTo, fillFrom and fillTo in seconds") from err
    try:
        return tools.room_tone(media_id, str(b.get("learnMedia", media_id)), *times)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.post("/batch")
def batch_process(body: dict = Body(...)) -> Response:
    """A queue of files processed outside a session (AP-03, RX-52): each uploaded file run through the chain's steps
    in order and the results returned together as a zip, named after the files, the session untouched."""
    import io
    import zipfile

    from ..core.paths import media_dir
    from ..services import effects

    ids, steps = body.get("media") or [], body.get("steps") or []
    if not isinstance(ids, list) or not 1 <= len(ids) <= 50 or not isinstance(steps, list) or not 1 <= len(steps) <= 16:
        raise HTTPException(422, "a batch is 1 to 50 files and a chain of 1 to 16 steps")
    buffer = io.BytesIO()
    names: set[str] = set()
    try:
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            for mid in ids:
                stem = str(media.media_info(mid).get("name") or mid).rsplit(".", 1)[0]
                current = mid
                for step in steps:
                    if not isinstance(step, dict) or not isinstance(step.get("name"), str):
                        raise HTTPException(422, "each step names an effect")
                    current = effects.apply(current, step["name"], step.get("params") or None)["id"]
                name, n = f"{stem} (processed).wav", 2
                while name in names:
                    name, n = f"{stem} (processed {n}).wav", n + 1
                names.add(name)
                archive.write(media_dir() / f"{current}.wav", arcname=name)
    except KeyError as err:
        raise HTTPException(404, "a file in the batch is not in the engine") from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err
    return Response(content=buffer.getvalue(), media_type="application/zip", headers={"X-Files": str(len(ids)), "Content-Disposition": 'attachment; filename="batch.zip"'})


@router.get("/media/{media_id}/similar")
def media_similar(media_id: str, start: int, length: int, threshold: float = 0.8) -> list[dict]:
    """Events like the reference range (RX-22): positions in the media's frames with their similarity."""
    from ..services import tools

    try:
        return tools.find_similar(media_id, start, length, max(0.3, min(threshold, 0.99)))
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.get("/media/{media_id}/stats")
def media_stats(media_id: str) -> dict:
    from ..services import tools

    try:
        return tools.stats(media_id)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.get("/media/{media_id}/spectrum")
def media_spectrum(media_id: str, fft: int = 4096, start: float = 0.0, end: float = 0.0, channel: str = "both") -> dict:
    """An averaged spectrum at a chosen FFT size over a range (RX-43, AA-03); channel both, mid or side (RX-54)."""
    from ..services import tools

    if channel not in ("both", "mid", "side"):
        raise HTTPException(422, "channel is both, mid or side")
    try:
        return tools.spectrum(media_id, fft, start, end, channel)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.get("/media/{media_id}/spectrogram.png")
def media_spectrogram(media_id: str, w: int = 640, h: int = 240, legend: bool = True, channel: str = "both", fscale: str = "lin") -> Response:
    from ..services import tools

    if channel not in ("both", "mid", "side"):
        raise HTTPException(422, "channel is both, mid or side")
    if fscale not in ("lin", "log"):
        raise HTTPException(422, "fscale is lin or log")
    try:
        return Response(content=tools.spectrogram_png(media_id, w, h, legend, channel, fscale), media_type="image/png")
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.post("/media/{media_id}/transcript/speakers")
async def media_transcript_speakers(media_id: str, request: Request) -> dict:
    """DS-12, RX-59: {"speakers": optional count}: the transcript's words labelled by speaker, told apart by voice."""
    from ..services import transcript

    try:
        b = await request.json() if (await request.body()) else {}
        count = int(b["speakers"]) if isinstance(b, dict) and b.get("speakers") else None
        return transcript.diarize(media_id, count, str(b.get("model", "")) if isinstance(b, dict) else "")
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except (media.MediaError, ValueError, TypeError) as err:
        raise HTTPException(422, str(err)) from err


@router.put("/media/{media_id}/transcript/word")
async def media_transcript_word(media_id: str, request: Request) -> dict:
    from ..services import transcript

    try:
        b = await request.json()
        index, start, end = int(b["index"]), float(b["start"]), float(b["end"])
    except (KeyError, TypeError, ValueError) as err:
        raise HTTPException(422, "send index, start and end (the media file's seconds)") from err
    try:
        return transcript.set_word(media_id, index, start, end, str(b.get("model", "")), b.get("text") if isinstance(b.get("text"), str) else None)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.post("/media/{media_id}/transcript")
def media_transcript(media_id: str, model: str = "") -> dict:
    from ..services import transcript

    try:
        return transcript.transcript(media_id, model)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except transcript.TranscriptUnavailable as err:
        raise HTTPException(503, str(err)) from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.get("/effects")
def list_effects() -> list[dict]:
    from ..services import effects

    return effects.catalogue()


@router.get("/plugins")
def list_plugins(refresh: bool = False) -> dict:
    """The CLAP and VST3 plugins installed here (services/plugins.py); refresh=1 scans again."""
    from ..services import plugins

    return {"plugins": plugins.scan(refresh)}


@router.get("/plugins/params")
def plugin_params(name: str) -> dict:
    """A scanned plugin's parameters as effect controls (services/plugins.py), for its generated controls."""
    from ..services import plugins

    try:
        return {"params": plugins.params(name)}
    except media.MediaError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err


@router.get("/ara/plugins")
def ara_plugins(refresh: bool = False) -> dict:
    """PT-24: the installed CLAP plug-ins that offer ARA (services/plugins.py), each with what it can analyze."""
    from ..services import plugins

    return {"plugins": plugins.ara_plugins(refresh)}


@router.post("/media/{media_id}/ara/analyze")
def ara_analyze(media_id: str, name: str) -> dict:
    """PT-24: the media analyzed by an ARA plug-in: the notes it found, and its stored state (an archive, base64) for
    the session to keep on the clip."""
    from ..services import plugins

    try:
        return plugins.ara_analyze(media_id, name)
    except media.MediaError as err:
        raise HTTPException(status_code=404 if "no installed" in str(err) else 400, detail=str(err)) from err


@router.post("/media/{media_id}/ara/render", status_code=201)
def ara_render(media_id: str, name: str, body: dict = Body(default={})) -> dict:
    """PT-24: the media rendered by an ARA plug-in as its playback renderer into new media, its state first restored from
    the archive in the body ({"archive": base64}) when the clip has one."""
    from ..services import plugins

    try:
        return plugins.ara_render(media_id, name, (body or {}).get("archive"))
    except media.MediaError as err:
        raise HTTPException(status_code=404 if "no installed" in str(err) else 400, detail=str(err)) from err


@router.get("/sam-audio/status")
def sam_audio_status() -> dict:
    """Which of SAM-Audio's preconditions are met: installed, Hugging Face login or a cached checkpoint, device."""
    from ..services import samaudio

    return samaudio.status()


@router.post("/media/{media_id}/isolate")
def isolate_sound(media_id: str, description: str, start: float | None = None, end: float | None = None,
                  spans: str = "", predict_spans: bool = False, candidates: int = 1) -> list:
    """SAM-Audio: the described sound and everything else from the region, as two media aligned with it; spans is a JSON
    list of [start, end] seconds from the region's start where the sound occurs (see services/samaudio.py)."""
    import json

    from ..services import samaudio
    from ..services.media import MediaError

    try:
        parsed = json.loads(spans) if spans else None
        if parsed is not None and not (isinstance(parsed, list) and all(isinstance(s, list) and len(s) == 2 for s in parsed)):
            raise ValueError
    except ValueError as err:
        raise HTTPException(422, "spans must be a JSON list of [start, end] pairs in seconds") from err
    try:
        return samaudio.isolate(media_id, description, start, end, parsed, predict_spans, candidates)
    except samaudio.Unavailable as err:
        raise HTTPException(503, str(err)) from err
    except MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.get("/media/{media_id}/key")
def media_key(media_id: str, start: float | None = None, end: float | None = None) -> dict:
    """Musical key, Camelot code and confidence of the media or a region in its own seconds (see services/key.py)."""
    from ..services import key
    from ..services.media import MediaError

    try:
        return key.detect(media_id, start, end)
    except MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.get("/media/{media_id}/tempo")
def media_tempo(media_id: str, start: float | None = None, end: float | None = None) -> dict:
    """Tempo and confidence of the media, or of a region in its own seconds (see services/tempo.py)."""
    from ..services import tempo
    from ..services.media import MediaError

    try:
        return tempo.detect(media_id, start, end)
    except MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.post("/media/{media_id}/eq-match", status_code=201)
def eq_match(media_id: str, reference: str, start: float | None = None, end: float | None = None,
             tstart: float | None = None, tend: float | None = None) -> dict:
    """iZotope RX's EQ Match: new media with the reference region's tonal balance, measured against the target region
    when one is given (see services/eqmatch.py)."""
    from ..services import eqmatch
    from ..services.media import MediaError

    try:
        return eqmatch.eq_match(media_id, reference, start, end, tstart, tend)
    except MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.post("/share/video")
def share_video(payload: dict) -> Response:
    """DS-08: {"document", "words": [{"text", "start", "end"}] (session seconds), "layout" (square, portrait or
    landscape), "title", "start", "end"}: the session, or that span of it, as a captioned waveform MP4."""
    from ..services import share

    try:
        mp4 = share.video(payload.get("document"), payload.get("words") or [], str(payload.get("layout") or "square"), str(payload.get("title") or ""), payload.get("start"), payload.get("end"))
    except (media.MediaError, ValueError, TypeError, KeyError) as err:
        raise HTTPException(422, str(err)) from err
    return Response(content=mp4, media_type="video/mp4", headers={"Content-Disposition": 'attachment; filename="formwav-share.mp4"'})


@router.post("/media/{media_id}/remix", status_code=201)
def media_remix(media_id: str, payload: dict) -> dict:
    """AA-09: {"seconds"}: the media re-arranged on its beats to that length (services/remix.py)."""
    from ..services import remix

    try:
        return remix.remix(media_id, float(payload.get("seconds")))
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except (media.MediaError, ValueError, TypeError) as err:
        raise HTTPException(422, str(err)) from err


@router.get("/media/{media_id}/notes")
def media_notes(media_id: str, poly: bool = False) -> dict:
    """PT-10: the media's notes (start, end, median pitch) and its pitch curve, for the note editor; with poly, the notes
    inside its chords (services/polyphonic.py), several at once."""
    from ..services import effects

    try:
        if poly:
            from ..services import polyphonic

            return polyphonic.find_notes(media_id)
        return effects.detect_notes(media_id)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except (media.MediaError, ValueError) as err:
        raise HTTPException(422, str(err)) from err


@router.post("/media/{media_id}/align", status_code=201)
def media_align(media_id: str, payload: dict) -> dict:
    """AA-12: {"guide", "guideIn", "guideLen", "takeIn", "takeLen", "smoothMs"}: this media (the replacement take)
    re-timed to follow the guide's span (services/align.py); new media as long as the guide's span."""
    from ..services import align

    try:
        return align.align(str(payload["guide"]), media_id, float(payload.get("guideIn", 0)), payload.get("guideLen"), float(payload.get("takeIn", 0)), payload.get("takeLen"), float(payload.get("smoothMs", 100)))
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except (media.MediaError, ValueError, TypeError) as err:
        raise HTTPException(422, str(err)) from err


@router.post("/media/{media_id}/retune-notes", status_code=201)
def media_retune_notes(media_id: str, payload: dict) -> dict:
    """PT-10: {"notes": [{"start", "end", "shift"}], "formants", "glide"}: those notes moved, everything else kept."""
    from ..services import effects

    try:
        if payload.get("poly"):
            # notes inside chords: each edit names its note by pitch as well as span ({"start", "end", "midi", "shift"})
            from ..services import polyphonic

            return polyphonic.move_notes(media_id, list(payload.get("notes") or []))
        return effects.retune_notes(media_id, payload.get("notes"), bool(payload.get("formants", True)), float(payload.get("glide", 30)))
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except (media.MediaError, ValueError, TypeError) as err:
        raise HTTPException(422, str(err)) from err


@router.post("/share/into-video")
def share_into_video(payload: dict) -> Response:
    """AP-02: {"document", "mediaId" (the audio a video was imported as), "at" (session seconds of the video's first
    frame)}: the video with the session's mix as its audio, the picture copied."""
    from ..services import share

    try:
        mp4 = share.into_video(payload.get("document"), str(payload.get("mediaId", "")), float(payload.get("at") or 0.0))
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except (media.MediaError, ValueError, TypeError) as err:
        raise HTTPException(422, str(err)) from err
    return Response(content=mp4, media_type="video/mp4", headers={"Content-Disposition": 'attachment; filename="formwav-video.mp4"'})


@router.post("/media/{media_id}/warp", status_code=201)
def warp_media(media_id: str, payload: dict) -> dict:
    """PT-09: {"segments": [{"from", "to", "length"}, ...]} in seconds, the media re-timed piecewise between warp
    markers (services/effects.py: warp)."""
    from ..services import effects

    try:
        return effects.warp(media_id, payload.get("segments"))
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except (media.MediaError, ValueError, TypeError) as err:
        raise HTTPException(422, str(err)) from err


@router.post("/media/{media_id}/effect-masked", status_code=201)
def apply_effect_masked(media_id: str, payload: dict) -> dict:
    """AA-05: {"name", "params", "boxes": [{"from", "to", "low", "high"}, ...]}: the effect applied and its change kept
    only inside the drawn selection (services/effects.py: limit_to_boxes)."""
    from ..services import effects

    try:
        name = str(payload.get("name", ""))
        return effects.limit_to_boxes(media_id, effects.apply(media_id, name, payload.get("params") or None), payload.get("boxes"))
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except (media.MediaError, ValueError, TypeError) as err:
        raise HTTPException(422, str(err)) from err


@router.post("/media/{media_id}/heal-painted", status_code=201)
def heal_painted(media_id: str, payload: dict) -> dict:
    """AA-06, the heal brush: {"boxes": [{"from", "to", "low", "high"}, ...]} in the media's seconds and Hz, healed in
    one pass (services/effects.py: heal_painted)."""
    from ..services import effects

    try:
        return effects.heal_painted(media_id, payload.get("boxes"))
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except (media.MediaError, ValueError, TypeError) as err:
        raise HTTPException(422, str(err)) from err


@router.post("/media/{media_id}/effect", status_code=201)
def apply_effect(media_id: str, name: str, params: str = "", band_low: float | None = None, band_high: float | None = None) -> dict:
    import json

    from ..services import effects

    if band_low is not None and band_high is not None:
        # AU-31: any effect limited to a frequency band, the effect's change kept only inside it
        try:
            values = json.loads(params) if params else None
            return effects.limit_to_band(media_id, effects.apply(media_id, name, values), float(band_low), float(band_high))
        except KeyError as err:
            raise HTTPException(404, "no media with that id") from err
        except (media.MediaError, ValueError) as err:
            raise HTTPException(422, str(err)) from err

    try:
        values = json.loads(params) if params else None
    except json.JSONDecodeError as err:
        raise HTTPException(422, "params must be a JSON object") from err
    if values is not None and not isinstance(values, dict):
        raise HTTPException(422, "params must be a JSON object")
    try:
        return effects.apply(media_id, name, values)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.CoreMissing as err:
        raise HTTPException(503, str(err)) from err
    except media.MediaError as err:
        raise HTTPException(422, str(err)) from err


@router.post("/media/{media_id}/resample", status_code=201)
def resample(media_id: str, rate: int) -> dict:
    try:
        return media.resample_media(media_id, _rate(str(rate)) or rate)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.CoreMissing as err:
        raise HTTPException(503, str(err)) from err
    except media.MediaError as err:
        raise HTTPException(415, str(err)) from err


@router.get("/media/{media_id}")
def get_media(media_id: str) -> dict:
    try:
        return media.media_info(media_id)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.MediaError as err:
        raise HTTPException(400, str(err)) from err


@router.get("/media/{media_id}/peaks")
def get_peaks(media_id: str, spp: int = 256) -> Response:
    try:
        samples_per_peak, channels, blocks, payload = media.peaks(media_id, max(1, spp))
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.CoreMissing as err:
        raise HTTPException(503, str(err)) from err
    except media.MediaError as err:
        raise HTTPException(400, str(err)) from err
    headers = {
        "X-Samples-Per-Peak": str(samples_per_peak),
        "X-Channels": str(channels),
        "X-Blocks": str(blocks),
        "Cache-Control": "private, max-age=31536000, immutable",
    }
    return Response(content=payload, media_type="application/octet-stream", headers=headers)


@router.get("/media/{media_id}/audio")
def get_audio(media_id: str) -> FileResponse:
    try:
        media.media_info(media_id)
    except KeyError as err:
        raise HTTPException(404, "no media with that id") from err
    except media.MediaError as err:
        raise HTTPException(400, str(err)) from err
    return FileResponse(
        media_dir() / f"{media_id}.wav",
        media_type="audio/wav",
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )
