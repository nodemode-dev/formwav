# HASHOUT_LOG · backend · formwav

Living log of all comment content, explainers, rationale, TODOs and removed code for the backend. Source files stay comment-free per dev-rules `sub-skills/hashout-log/SUB-SKILL.md`; everything they would have said lives here, indexed. Read this first, then edit code surgically.

Current build version: v0.38.0
Last updated: 2026-09-28 · .fmw revision checks: revision in the manifest, base on save, 409 on conflict, save lock

---

## Org-navi-map

```
backend/
├── .env.example                 env names with local defaults, copied to .env (never committed)
├── requirements.txt             pinned set · Linux, Windows, servers (includes maturin)
├── requirements_macos.txt       same membership, unpinned · Apple Silicon
├── oc_install / .bat            venv, requirements, then builds the Rust audio core into the venv
├── boot_backend / .bat          loads .env, runs uvicorn on 127.0.0.1:8060
├── data/                        runtime data (never committed): media/ holds imported audio and its JSON
└── app/
    ├── main.py                  FastAPI app, CORS, router mounts under /api
    ├── core/
    │   ├── config.py            env-driven settings (CORS origins)
    │   ├── paths.py             data and media folders
    │   └── version.py           VERSION, one of the version sites
    ├── routers/
    │   ├── health.py            GET /api/health, with the audio core's version
    │   ├── media.py             POST /api/media, GET /api/media/{id}, GET /api/media/{id}/peaks, GET /api/media/{id}/audio
    │   ├── projects.py          GET /api/projects, PUT and GET /api/projects/{name}, GET /api/projects/{name}/file
    │   └── render.py            POST /api/render: session document in, float32 stereo WAV out
    └── services/
        ├── media.py             import, probe, atomic storage, peak levels through formwav_dsp
        ├── projects.py          .fmw packages in data/projects: atomic save, verified open, list
        └── render.py            clip plan from the document, native render, WAV encoding
```

---

## Table of contents

- [oc_install](#oc-install)
- [boot_backend](#boot-backend)
- [app/main.py](#app-main)
- [app/core/config.py](#app-core-config)
- [app/core/paths.py](#app-core-paths)
- [app/core/version.py](#app-core-version)
- [app/routers/health.py](#app-routers-health)
- [app/routers/media.py](#app-routers-media)
- [app/services/media.py](#app-services-media)
- [app/routers/projects.py](#app-routers-projects)
- [app/services/projects.py](#app-services-projects)
- [app/routers/render.py](#app-routers-render)
- [app/services/render.py](#app-services-render)

---

## boot_backend {#boot-backend}

### boot_backend · host and port
- refers-to: boot_backend :: the uvicorn line (last line)
- kind: rationale
- logged: v0.1.0 · 2026-09-28

Binds `127.0.0.1` unless `HOST` is set, per dev-rules `references/scripts.md`: a local build never listens on the network, and deploy targets that need another address set `HOST` explicitly. The dev-rules template binds `0.0.0.0`; that line was not carried over. The port comes from `FORMWAV_PORT`, default 8060, matching the Vite proxy target and the README ports table. `.env` is exported into the shell before uvicorn starts so `HOST` and `FORMWAV_PORT` from it reach the command line, which uvicorn's own `--env-file` would not do.

### boot_backend.bat · .env loading
- refers-to: boot_backend.bat :: the `for /f` line
- kind: explainer
- logged: v0.1.0 · 2026-09-28

Reads `.env` as `NAME=value` lines, skipping lines that start with `#`, and sets each for the session before the defaults apply. Windows scripts are stored with CRLF line endings, pinned by the root `.gitattributes`.

---

## app/main.py {#app-main}

### app/main.py · CORS middleware
- refers-to: app/main.py :: `app.add_middleware(CORSMiddleware, ...)`
- kind: rationale
- logged: v0.1.0 · 2026-09-28

The dev server on 3060 proxies `/api` to the engine, so the browser normally never makes a cross-origin call. CORS is still configured for direct calls from the dev and preview origins (3060, 3061). Any other origin gets no CORS header; verified with a foreign `Origin` header in v0.1.0.

### app/main.py · router mounting
- refers-to: app/main.py :: `app.include_router(health.router, prefix="/api")`
- kind: rationale
- logged: v0.1.0 · 2026-09-28

Every route lives under `/api`, the prefix the Vite proxy forwards. New route modules are mounted here, one line each, until a feature registry replaces the list (formcut's lesson: routers mount from one declared list, never from inside a loop that mounts per module).

---

## app/core/config.py {#app-core-config}

### app/core/config.py · cors_origins
- refers-to: app/core/config.py :: `cors_origins()`
- kind: explainer
- logged: v0.1.0 · 2026-09-28

Comma-separated list from `FORMWAV_CORS_ORIGINS`; the default names the dev server and the preview server on both `localhost` and `127.0.0.1`.

---

## app/core/version.py {#app-core-version}

### app/core/version.py · VERSION
- refers-to: app/core/version.py :: `VERSION`
- kind: warning-context
- logged: v0.1.0 · 2026-09-28

One of the version sites, bumped by hand in the release commit together with `frontend/package.json`, both version fields in `frontend/package-lock.json`, `native/formwav-dsp/Cargo.toml` and the README badge. Always `x.y.z` with dots.

---

## app/routers/health.py {#app-routers-health}

### app/routers/health.py · health
- refers-to: app/routers/health.py :: `health()`
- kind: explainer
- logged: v0.1.0 · 2026-09-28

Liveness and identity: returns the engine's name and version. The interface reads it to show whether the engine is reachable.

### app/routers/health.py · core field
- refers-to: app/routers/health.py :: `health()`, the `core` key
- kind: explainer
- logged: v0.2.0 · 2026-09-28

The audio core's version, or `missing` when `formwav_dsp` is not importable, so a broken install is visible from one request.

---

## oc_install {#oc-install}

### oc_install · building the audio core
- refers-to: oc_install :: the `cargo` check and the `maturin develop` line (and the same two lines in oc_install.bat)
- kind: rationale
- logged: v0.2.0 · 2026-09-28

From v0.2.0 the engine's audio code is the Rust crate itself, built into the venv as the Python module `formwav_dsp`, so there is one implementation of decoding and peaks rather than a Rust one and a Python one. That makes Rust a requirement for installing from source; the script stops with the rustup address when `cargo` is missing. `maturin` is pinned in requirements.txt beside the runtime packages because it runs inside the same venv. The `.bat` lines were added with LF endings inside a CRLF file; `.gitattributes` normalises them on commit and checkout.

---

## app/core/paths.py {#app-core-paths}

### app/core/paths.py · data_dir
- refers-to: app/core/paths.py :: `data_dir()`, `media_dir()`
- kind: explainer
- logged: v0.2.0 · 2026-09-28

`FORMWAV_DATA_DIR` when set, otherwise `backend/data`, which the root `.gitignore` excludes. `media_dir()` creates `media/` on first use. A platform data folder (as formcut uses) replaces the default when the desktop build arrives.

---

## app/routers/media.py {#app-routers-media}

### app/routers/media.py · import without multipart
- refers-to: app/routers/media.py :: `import_media`
- kind: rationale
- logged: v0.2.0 · 2026-09-28

The file travels as the raw request body with its name in a URL-encoded `X-Filename` header, so no multipart parser is needed. Status codes: 201 imported, 400 empty body or bad id, 404 unknown id, 415 not a readable WAV (the decoder's reason in `detail`), 503 audio core not built.

### app/routers/media.py · peaks response
- refers-to: app/routers/media.py :: `get_peaks`
- kind: explainer
- logged: v0.2.0 · 2026-09-28

`spp` asks for a resolution; the engine returns the first level with at least that many samples per peak, or the coarsest level. The body is little-endian f32 (per block, per channel, min then max) and the headers `X-Samples-Per-Peak`, `X-Channels` and `X-Blocks` describe it; `main.py` exposes them to direct CORS callers. Content never changes for an id (ids are content hashes), hence the immutable cache header.

---

## app/services/media.py {#app-services-media}

### app/services/media.py · ids and storage
- refers-to: app/services/media.py :: `import_wav`, `_write_atomic`
- kind: rationale
- logged: v0.2.0 · 2026-09-28

A media id is the SHA-256 of the file's bytes, so importing the same audio twice stores it once and ids are safe to cache forever. Audio and its JSON description are written to a temporary file in the same folder, flushed, fsynced and renamed into place, so a crash never leaves a half-written file under a real name. Re-importing identical audio under a new name updates the name in the JSON only.

### app/services/media.py · peak cache
- refers-to: app/services/media.py :: `_levels`
- kind: todo
- logged: v0.2.0 · 2026-09-28

The full pyramid for the eight most recent media ids is kept in memory. Levels are not yet written to disk, and very long files are decoded whole; a disk cache and chunked decoding come with the jobs surface.

### app/routers/media.py · audio route
- refers-to: app/routers/media.py :: `get_audio`
- kind: rationale
- logged: v0.4.0 · 2026-09-28

Serves the stored WAV bytes unchanged so the interface decodes them with the same Rust decoder, compiled to WebAssembly, that the engine uses; the engine never decodes for playback. Validated like the other media routes (400 malformed id, 404 unknown). Content never changes for an id, hence the immutable cache header. Verified v0.4.0: 200, `audio/wav`, 576,044 bytes for the 3 s stereo test file.

---

## app/routers/projects.py {#app-routers-projects}

### app/routers/projects.py · routes and codes
- refers-to: app/routers/projects.py :: all routes
- kind: explainer
- logged: v0.6.0 · 2026-09-28

`GET /api/projects` lists saved sessions newest first (name, savedAt, tracks, bytes, appVersion), skipping unreadable files. `PUT /api/projects/{name}` takes the session document as the JSON body and saves it. `GET /api/projects/{name}` opens a session: its media are verified and stored in the media store, and the document is returned. `GET /api/projects/{name}/file` downloads the `.fmw`. Codes: 400 for a bad name, a malformed document, media the engine no longer has, or a damaged or foreign file; 404 for an unknown name; 503 when the audio core is missing.

---

## app/services/projects.py {#app-services-projects}

### app/services/projects.py · the .fmw format, version 1
- refers-to: app/services/projects.py :: `save`, `FORMAT`, `FORMAT_VERSION`
- kind: rationale
- logged: v0.6.0 · 2026-09-28

A zip holding `manifest.json` (format `formwav-session`, format version, app version, name, UTC save time), `session.json` (the interface's document as it is) and `media/<sha256>.wav` for every media id the session lists, stored uncompressed because audio does not deflate usefully. The file is self-contained: it opens on another machine with an empty media store. Written to a temporary file in the same folder, flushed, fsynced and renamed into place, so a crash leaves either the old file or the new one. Names allow letters, digits, spaces and `. , ' ( ) - _`, start with a letter or digit, and cannot contain a path separator. Sessions live in `data/projects/`, beside `data/media/`, both untracked.

### app/services/projects.py · opening verifies every byte
- refers-to: app/services/projects.py :: `open_project`, `_read`, `_media_ids`
- kind: warning-context
- logged: v0.6.0 · 2026-09-28

Opening checks the format name and refuses a newer format version, checks that every clip names listed media, and hashes every media file against its name before importing it through `media.import_wav`, which probes it with the audio core. A file with one flipped byte in its audio was refused as damaged (400) in v0.6.0.

### app/services/projects.py · verification v0.6.0
- refers-to: app/services/projects.py :: module
- kind: explainer
- logged: v0.6.0 · 2026-09-28

A two-track session (an imported WAV at -6 dB and a recorded take at 48,000 samples) saved to 965,403 bytes with both media hashes matching their names and no temporary files left; after a page reload it reopened with identical tracks, gains and positions, and its offline bounce equalled the pre-save bounce exactly (maximum difference 0 on both channels). Bad name 400, unknown 404, damaged 400, download 200 with the full file.

---

## app/routers/render.py {#app-routers-render}

### app/routers/render.py · POST /api/render
- refers-to: app/routers/render.py :: `render_session`
- kind: explainer
- logged: v0.7.0 · 2026-09-28

Takes a session document as the JSON body and returns the mix as a float32 stereo WAV (`attachment; filename="mix.wav"`), with `X-Frames`, `X-Peak-Left-dBFS`, `X-Peak-Right-dBFS` and `X-Skipped-Clips`. 400 for a malformed document or media id, 404 when a listed media file is missing, 503 when the audio core is not built. It is both the offline renderer of Phase 2's exit check and the basis of export; the interface has no Export button yet.

---

## app/services/render.py {#app-services-render}

### app/services/render.py · plan mirrors the interface
- refers-to: app/services/render.py :: `plan`
- kind: warning-context
- logged: v0.7.0 · 2026-09-28

The clip plan repeats `planClips` in `frontend/src/audio/player.ts` rule for rule: mute and solo, track plus clip gain in dB made linear with `10 ** (dB / 20)`, track pan defaulting to 0 for sessions saved before pan existed, and clips at another sample rate skipped and counted. Two copies of one rule set can drift; the null test between the two renderers is what guards them, so change both together and rerun `verify_render.py`. Verified v0.7.0: identical output (0.0) on a two-track session with gains and pans, and a v0.6 session without pan fields rendered.

### app/services/render.py · output
- refers-to: app/services/render.py :: `wav_float32_stereo`, `dbfs`
- kind: explainer
- logged: v0.7.0 · 2026-09-28

The WAV is IEEE float 32 (format tag 3), two channels, at the session rate, so nothing is lost to quantisation; peaks are reported in dBFS to two decimals (`-inf` for silence). The whole mix is built in memory; long sessions will need a streamed render with the jobs surface.

### app/services/render.py · fades in the plan
- refers-to: app/services/render.py :: `plan`
- kind: warning-context
- logged: v0.8.0 · 2026-09-28

Each clip tuple now ends with `fadeIn`, `fadeOut` (0 when absent) and the shape code (1 for "equal-power", otherwise 0), matching `planClips` in the interface field for field. Verified v0.8.0: identical to the browser's render for linear crossfades (0.0) and within 6.0e-8 for equal-power ones (the `sin` difference described in the native log).

### app/services/render.py and routers/render.py · loudness
- refers-to: app/services/render.py :: `render`; app/routers/render.py :: `X-Loudness-LUFS`
- kind: explainer
- logged: v0.10.0 · 2026-09-28

After rendering, the mix's integrated loudness is measured by `formwav_dsp.loudness` on the interleaved f32 bytes and reported in `X-Loudness-LUFS` to two decimals (`-inf` when every block is gated away). The interface's Export shows it; verified v0.10.0: an exported file was byte-identical to this route's output and the notice matched the headers. (This log's header stayed at v0.8.0 through v0.9.0 because the backend did not change in v0.9.0.)

### app/services/render.py · buses in the plan
- refers-to: app/services/render.py :: `plan`, `render`
- kind: warning-context
- logged: v0.11.0 · 2026-09-28

Unmuted buses are numbered from 1 in document order and passed as `(id, linear gain, pan)`; a track on a muted bus is left out like a muted track; a `busId` that names no bus, or none, routes to master (0). Each clip tuple ends with its bus index, and `plan` now returns the bus list as a sixth value. This is `planClips` in the interface rule for rule; verified v0.11.0 by identical browser and engine renders of a bused session (0.0).

### app/services/projects.py and routers/projects.py · revision checks
- refers-to: app/services/projects.py :: `save`, `RevisionConflict`, `_current_revision`, `_SAVE_LOCK`; app/routers/projects.py :: `save_project`
- kind: rationale
- logged: v0.12.0 · 2026-09-28

Every save writes `revision` into the manifest, one more than the file's current revision (0 when there is no file; files saved before v0.12.0 count as 1). `PUT /api/projects/{name}?base=N` saves only if the file is at revision N, with 0 meaning the name must be new; otherwise it answers 409 with `{"message", "revision"}` naming the current revision, so the interface can ask and retry against it. Leaving `base` out saves unconditionally, for scripts that mean to overwrite. The check and the write happen under one process-wide lock, so two saves cannot both pass the check; the engine is a single process, and several engine processes on one data folder would need a file lock. Open and list report the revision. Verified v0.12.0: the API sequence (new at 1, conflict at 1, 2, stale conflict at 2, unconditional 3); a pre-revision file opened as 1 and saved as 2; ten simultaneous saves of one new name gave exactly one success and nine conflicts.

### app/services/render.py · fade shape names
- refers-to: app/services/render.py :: clip planning (`fade_shape`)
- kind: explainer
- logged: v0.21.0 · 2026-09-28

The engine maps a clip's `fadeShape` through a table of the four names the core knows (linear, equal-power, s-curve, exponential), defaulting to linear, instead of testing for equal-power alone. Verified: for every shape the engine's render matched the browser's, exactly for linear and exponential and within 3e-8 for the sine and cosine curves.

### app/services/render.py · automation in the engine render
- refers-to: app/services/render.py :: `plan`, `render`
- kind: explainer
- logged: v0.31.0 · 2026-09-28

A track's `automation.volume` (dB points) and `automation.pan` points become core envelopes; when present, each replaces the track's static fader or pan for that track's clips, while clip gain still applies. `plan` now also returns the envelopes and `render` passes them to the core; it is the only caller of `plan`. Verified: with volume automation the engine's render equalled the browser's exactly over 480,000 frames, and with pan automation too within 3e-8.

### app/services/render.py · master fader in the engine render
- refers-to: app/services/render.py :: `render`
- kind: explainer
- logged: v0.34.0 · 2026-09-28

The engine passes the session's `masterGainDb` (0 when absent) to the core, which applies it to the finished mix. Verified: with the master at -6 dB the engine's render equalled the browser's exactly.

### app/services/media.py, app/routers/media.py · any format in, resampled to the session rate
- refers-to: app/services/media.py :: `STANDARD_RATES`, `_tool`, `_probe_stream`, `_transcode`, `import_audio`, `resample_media`; app/routers/media.py :: `import_media` (`?rate=`), `resample`
- kind: warning-context
- logged: v0.38.0 · 2026-09-29

Import accepted WAV only, and nothing resampled, so a clip at another rate than its session was silent: the owner's session had started at 24 kHz from its first file and its 48 kHz stereo clip played nothing. Every import now goes through ffmpeg (`FORMWAV_FFMPEG`, `FORMWAV_FFPROBE` override the paths): any audio format or a video's audio track is decoded to 32-bit float WAV at the session's rate (`?rate=`), resampled with soxr (ffmpeg's own resampler if soxr is missing), mono kept mono and more than two channels downmixed to stereo, through temporary files because MP4 and M4A need seekable input and a WAV header a seekable output. A WAV already at the target rate is still stored byte for byte. With no session yet a file at 44.1, 48, 88.2 or 96 kHz keeps its rate and anything else becomes 48 kHz. `POST /api/media/{id}/resample?rate=` converts stored media to new media, keeping the original. Without ffmpeg only WAV at the session rate imports, and the error says how to install it. Verified: FLAC, MP3, M4A (AAC), OGG (Vorbis), Opus, AIFF and an MP4's audio each imported at 48 kHz mono and measured as the 440 Hz test tone (RMS 0.343 to 0.357, 439 to 440 zero crossings a second, 10.0 s, AAC 5 ms longer); FLAC and AIFF decoded to identical bytes and so one media id; a 24 kHz WAV became 48 kHz; a non-audio file was refused with "no audio stream found in this file".

### app/voice/, app/main.py, requirements_voice*.txt · formwave's generative voice, vendored
- refers-to: app/voice/ (formwave's core, engine, extensions and routers); app/voice/engine/config.py :: `_DEFAULT_MODELS_ROOT`; app/main.py :: the voice mount and its fallback; requirements_voice.txt, requirements_voice_macos.txt, requirements_voice_qwen.txt
- kind: warning-context
- logged: v0.40.0 (in progress) · 2026-09-29

The owner's standalone formwave (Qwen3-TTS voice clone, preset voices and voice design; Qwen3-ASR and Whisper transcription; its export and post-processing extensions) never came across. Its backend packages are now vendored verbatim from the uploaded formwav.zip as `app/voice`, their relative imports unchanged, mounted at `/api/voice` with formwave's own routes and contract (`/status`, `/load`, `/generate`, `/generate/stream`, `/export`, `/export/formats`, `/asr/models`, `/asr/select`, `/transcribe`); its requirements files ride beside formwav's as `requirements_voice*.txt`. One change: the default models folder is one directory deeper (`parents[3]`, still `backend/models`); `FORMWAV_MODELS_ROOT` overrides it as in formwave. The voice runtime is optional: when it cannot import, every `/api/voice` route answers 503 naming the missing module and how to install it, and formwav starts and works as before. Verified in this container: without the runtime, health OK and voice routes 503 with the message; with formwave's pinned numpy and soundfile installed, the routes still answered 503 naming torch, as formwave's engine state detects the compute device when it imports, so formwave needs torch installed even to report its status. Not yet verified: the routes themselves, which need torch (next, with the CPU build) and, for generation, the Qwen weights on the owner's Mac.

### app/services/effects.py, app/routers/media.py · formcut's audio effects
- refers-to: app/services/effects.py :: `AUDIO_CHAINS`, `GROUPS`, `STEREO`, `catalogue`, `apply`; app/routers/media.py :: `list_effects`, `apply_effect`
- kind: rationale
- logged: v0.41.0 (in progress) · 2026-09-29

formcut v2.2.2's `AUDIO_CHAINS` (48 named ffmpeg filter chains, from voice-clean and denoise to reverbs, radio, pitch and octave shifts) is vendored verbatim and grouped for a menu (Clean up, Dynamics, Tone, Space, Character, Modulation, Pitch). `GET /api/effects` lists them; `POST /api/media/{id}/effect?name=` renders one through ffmpeg into new media at the source's rate (a trailing resample undoes loudnorm's and the pitch chains' internal rates), mono kept mono except the two stereo-image effects; the source is never changed. Verified: all 48 rendered over the 10 s tone with none failing or silent, each at 48 kHz with the right channel count; pitch up turned 440 Hz into 550, pitch down into 351, octave up into 880 and octave down into 220; four reverbs came out 0.3 to 1.2 s longer, their echo tail, which the clip's unchanged length leaves hidden until its end is dragged out.

### app/services/effects.py, app/services/tools.py, app/routers/media.py · coverage wave 1: Audacity, RX and Audition processing
- refers-to: app/services/effects.py :: `FORMWAV_CHAINS`, `ALL_CHAINS`, `GROUPS`, `STEREO_ONLY`, `apply` (peak normalize); app/services/tools.py :: `generate`, `stats`, `spectrogram_png`, `DTMF`; app/routers/media.py :: `generate_signal`, `media_stats`, `media_spectrogram`
- kind: rationale
- logged: v0.43.0 · 2026-09-29

The owner's standard is every PARITY row integrated, partially or fully (sidecar COVERAGE.md assigns all 224). This wave uses the proven render-to-new-media path for 37 processes written against the behaviour of Audacity's built-ins, iZotope RX's modules and Audition (references only; no code taken): amplify, invert, reverse, DC offset, click and short-gap repair, truncate silence, graphic EQ and filter curve, tempo, pitch and speed (rubberband), extreme stretch, de-clip, de-crackle, mouth de-click, de-plosive, de-wind, voice and guitar de-noise, strong de-ess, leveler, dither with Shibata noise shaping, phase rotation, azimuth, centre extract and remove, channel swap, mid-side encode and decode, peak normalize (measured with astats to the micro-dB, then gained to -1 dBFS), streaming and broadcast loudness, and an exciter; stereo-only processes refuse a mono clip with a message. Generators render tone, white, pink and brown noise, silence, chirp, DTMF (Q.23 pairs, 100 ms tone and 50 ms gap per key) and bleep at the session rate; statistics come from astats and a spectrogram from showspectrumpic. Found in verification: mouth de-click's adeclick window was below the filter's range (fixed), and peak normalize measured with volumedetect landed at -1.02 dBFS because that filter rounds to 0.1 dB (now astats). Verified (verify_wave1.py): 85 effects in the catalogue, all 37 new ones rendering on a stereo source; invert and reverse exact to the sample; amplify +6 dB peak 0.9974; peak normalize 0.8913 (-1 dBFS); tempo +10% 4.545 s at 440 Hz; +1 semitone 466 Hz at 5.0 s; speed +10% 4.545 s at 483 Hz; the mono guard; a 440 Hz tone at 0.5 peak for exactly 5 s, DTMF 159# exactly 0.6 s, a 1 kHz bleep, all-zero silence, audible noises and chirp; statistics -6.02 and -9.03 dBFS with zero DC on the tone; a PNG spectrogram.

### app/services/transcript.py, app/routers/media.py, requirements_transcript.txt · word-level transcripts (coverage wave 2)
- refers-to: app/services/transcript.py :: `transcript`, `mark_fillers`, `FILLERS`, `FILLER_PHRASES`, `TranscriptUnavailable`; app/routers/media.py :: `media_transcript`; requirements_transcript.txt
- kind: warning-context
- logged: v0.44.0 (in progress) · 2026-09-29

Descript-style editing needs word timings, which faster-whisper gives on the CPU, so the whole flow is tested here. The file is decoded by ffmpeg to 16 kHz mono floats and handed to faster-whisper as samples: its own decoder, PyAV, failed on a version mismatch (`metadata_errors`), and formwav decodes everything with ffmpeg already. faster-whisper 1.1.1 imports requests without declaring it, so the requirements file lists it. A verbatim prompt keeps disfluencies, which Whisper otherwise drops; fillers are um, uh, er, hmm and kin plus "you know" and "I mean" ("like" is left out as usually a real word). Transcripts are cached per media file and model; the model (base.en by default, `FORMWAV_WHISPER_MODEL`) downloads into the git-ignored `backend/models/whisper`. Without the runtime the route answers 503 with the install line. Verified: base.en loaded in 2.2 s and transcribed the 11 s JFK recording in 1.6 s as the exact 22-word sentence with word times; the filler marker flagged exactly um, you know, uh and I mean in a test phrase.

### app/services/effects.py, app/routers/media.py · adjustable effects (coverage wave 3)
- refers-to: app/services/effects.py :: `PARAMS`, `_values`, `_controls`, `catalogue`, `apply`; app/routers/media.py :: `apply_effect` (params)
- kind: rationale
- logged: v0.46.0 (in progress) · 2026-09-29

The commonest gap among the partial rows was a fixed preset instead of an amount. 17 effects now declare controls (label, range, default, unit) and build their chain from the values, each clamped to its range so no input makes a broken filter: Enhance speech strength (50% reproduces formcut's voice-clean exactly), amplify, peak normalize target, loudness target, compress threshold and ratio, noise gate, tempo, pitch in semitones, speed, extreme stretch, truncate silence threshold and length, denoise floor, de-ess intensity, bass, treble, presence frequency and gain, echo delay and decay. The catalogue lists each effect's controls, the route takes values as a JSON object, and the new file's name carries them. Verified (verify_params.py) on a 440 Hz tone: amplify -3 dB peak 0.3539; +100 dB clamped to +24, peak 7.9225; peak normalize to -6 dBFS 0.5012; tempo +25% 4.0 s at 440 Hz; pitch -12 semitones 220 Hz at 5.0 s; speed -20% 6.25 s at 351 Hz; stretch x2 10.0 s; Enhance at its default byte-identical to 50%; malformed values refused with 422.

### app/services/effects.py · effects that change timing (for range effects)
- refers-to: app/services/effects.py :: `RETIMING`, `catalogue` (`retimes`)
- kind: rationale
- logged: v0.47.0 · 2026-09-29

An effect applied to a range replaces only that part of a clip with the same part of a processed copy of the whole file, which holds only while the processed file lines up sample for sample with the source. Tempo, speed, extreme stretch, truncate silence and reverse change length or order, so the catalogue flags them (`retimes`) and the Inspector refuses them inside a range. Pitch shifts keep length and alignment and are allowed. Verified through verify_range_fx.py (Change tempo refused inside a range, the document unchanged).

### app/services/effects.py, app/services/tools.py, app/routers/media.py · EQs, click removal controls, excerpts
- refers-to: app/services/effects.py :: `eq-3band`, `graphic-eq-5`, `PARAMS["click-removal"]`; app/services/tools.py :: `excerpt`; app/routers/media.py :: `media_excerpt`
- kind: explainer
- logged: v0.48.0 · 2026-09-29

Wave 3 continues: a three-band parametric EQ (120 Hz low shelf, a mid band at any frequency from 200 Hz to 8 kHz, 8 kHz high shelf, each -15 to +15 dB), a five-band graphic EQ (60 Hz, 250 Hz, 1, 4 and 12 kHz through firequalizer), and click removal's threshold and window. For wave 2, `excerpt` cuts a time range of a file sample-exactly (atrim) into new media, which Make a clip uses. Verified (verify_wave3b.py): 87 effects, 20 adjustable; the parametric mid band +12 dB at 1 kHz gave 3.981 on a 1 kHz tone (exact); the high shelf -12 dB gave 0.413 at 10 kHz, the shelf still in its transition two kilohertz above its corner; the graphic 1 kHz band +6 dB gave 1.962 (+5.85 dB, firequalizer's interpolated curve) and flat gave 1.000; click removal ran with threshold 8 and a 30 ms window; an excerpt of 3.34 to 6.00 s was 2.66 s exactly and an empty one was refused.

### app/services/tools.py, app/routers/media.py · spectrogram size and legend
- refers-to: app/services/tools.py :: `spectrogram_png` (width, height, legend); app/routers/media.py :: `media_spectrogram` (`w`, `h`, `legend`)
- kind: explainer
- logged: v0.50.0 · 2026-09-29

The spectrogram route takes a size (clamped to 64 to 8192 by 32 to 1024) and can leave out the legend, so the image is the bare plot and its width maps to the file's length exactly, which the timeline's spectrogram view relies on. Verified through verify_spectrogram_view.py (a 2048 by 256 PNG, aligned under split clips).

### app/services/effects.py · Band gain, the first spectral edit
- refers-to: app/services/effects.py :: `band-gain` (chain, group, controls)
- kind: rationale
- logged: v0.50.0 · 2026-09-29

A gain curve 0 dB outside a frequency band and the chosen gain inside it (-60 to +24 dB), with 3% transitions at the edges (firequalizer), the edges sorted if given in reverse. It keeps timing, so it applies inside a Smart Tool range: a time and frequency selection's gain, and at -60 dB an attenuation of that region, until drawn spectral selections exist. Verified (verify_band_gain.py) on 440 Hz, 1 kHz and 3 kHz tones: -30 dB on 2 to 4 kHz gave 0.0316 at 3 kHz and 1.0000 at the others; +12 dB gave 3.9811 at 3 kHz; reversed edges gave the same; 88 effects, 21 adjustable.

### app/services/export.py, app/routers/render.py · export formats, stems, multichannel (coverage wave 5)
- refers-to: app/services/export.py :: `FORMATS`, `encode`, `multichannel`; app/routers/render.py :: `render_session` (`format`, `what`)
- kind: warning-context
- logged: v0.51.0 (in progress) · 2026-09-29

The engine still renders 32-bit float WAV; ffmpeg encodes it to WAV 24-bit, WAV 16-bit (triangular dither), FLAC 24-bit, MP3 320 or 192 kbps, OGG Vorbis or M4A AAC 256 kbps. Stems render the whole session once per track with the other tracks muted and solos cleared, zipped as `NN Track name.ext`; multichannel folds each stem to mono and merges them, one channel per track in track order, as WAV or FLAC only (the lossy containers here carry two channels). Two traps found in verification: the render plan ends at the last audible clip, so a stem of a shorter track came out shorter (3.0 s against 10.0 s) and amerge stops at its shortest input; every stem is now padded to the session's length and every multichannel channel to the longest stem. Integer formats clip at full scale by definition: a test mix peaking at +1.0 dBFS clipped 3,851 samples in 24-bit, 16-bit and FLAC, so exactness is measured below full scale. Verified (verify_export.py) on a two-track session: every format decoded at 48 kHz stereo and 10.0 s (MP3 10.032 s, the encoder's padding); below full scale 24-bit and FLAC differed from the float render by 0.0 and FLAC equalled the 24-bit WAV bit for bit, 16-bit by one step (the dither); stems both 10.0 s in float and 16-bit; multichannel two channels of 10.0 s, each exactly its folded stem; MP3 multichannel refused.

### app/services/tools.py, app/routers/media.py · Mic Check (coverage wave 6)
- refers-to: app/services/tools.py :: `mic_check`, `stats_filtered`, `_run_text`, `_num`; app/routers/media.py :: `media_mic_check`
- kind: warning-context
- logged: v0.54.0 (in progress) · 2026-09-30

After Adobe Podcast's mic analysis and iZotope RX's Repair Assistant (references only): integrated loudness (ebur128), clipped samples (volumedetect's 0 dB bin), noise floor (astats, with the mains frequencies notched out), mains hum (narrow 50 and 60 Hz bands against the whole signal) and DC offset, each finding naming the effect that addresses it. Checked against five crafted recordings: the first cut reported a 60 Hz hum as background noise too, the steady tone reading as the noise floor. Notching the mains frequencies, once and then twice, left about -45 dB of residue whose cause was not found, so a stated heuristic applies: with hum present, background noise is reported only above -40 dB (otherwise above -50). Verified: clean gave only its level; hum gave 60 Hz hum at -18.1 dB with Hum remover and a quiet background; noisy (pink noise at -35 dBFS) gave a -41.6 dB floor with Voice de-noise; clipped (+20 dB) gave 10,134 clipped samples with De-clip and very loud at -8.6 LUFS; quiet (-30 dB) gave -45.4 LUFS with the loudness effect.

### app/services/effects.py · Dialogue isolate, a learned noise suppressor (coverage wave 7)
- refers-to: app/services/effects.py :: `dialogue-isolate`, `_rnnoise_model`, `RNNOISE_URL`
- kind: rationale
- logged: v0.56.0 (in progress) · 2026-09-30

The first of wave 7's AI features that runs on the CPU here and can be measured: ffmpeg's arnndn with an RNNoise model trained on voice amid noise (GregorR/rnnoise-models, "beguiling-drafter"), strength as arnndn's mix. The 300 kB model is fetched once into the git-ignored backend/models/rnnoise and checked to be a model file; without a network it says where to place it. Verified with Mic Check's measurements: the noisy recording's noise floor fell from -41.6 to -54.1 dB at 100% (-45.5 at 50%) while its loudness moved from -15.5 to -15.7 LUFS; the clean recording moved by 0.1 LU; with the model removed, applying fetched it again byte for byte.

### app/services/separate.py, app/routers/media.py, requirements_separate.txt · Separate into stems (coverage wave 7)
- refers-to: app/services/separate.py :: `separate`, `_load`, `SeparationUnavailable`; app/routers/media.py :: `media_separate`; requirements_separate.txt
- kind: warning-context
- logged: v0.56.0 · 2026-09-30

Demucs htdemucs splits a time range of a file into vocals, drums, bass and other on the CPU (PyTorch's Apple GPU on the Mac), each written back at the file's rate through soxr so stems line up with the clip; the model (about 80 MB) caches in the git-ignored backend/models/torch; without Demucs the route answers 503 with the install line. A trap met here: installing demucs upgraded torchaudio to a CUDA 13 build this CPU-only machine could not load, breaking every PyTorch feature until the CPU builds were reinstalled; the requirements file pins torch and torchaudio 2.6.0 and says to install PyTorch's right build first. Verified on the JFK speech mixed with a 55 Hz tone and trimmed by 2 s: the vocals stem correlated 0.999 with the clean speech at zero lag (exact alignment to the trimmed range) and the other stems 0.003 to 0.061. Not good: the pure 55 Hz tone was largely dropped rather than placed in the bass stem (0.022 RMS against 0.125), so the stems summed to the piece only within 0.22; Demucs is trained on music, and how it treats real bass is not measured here for want of a music recording.

### app/routers/render.py · streaming preview (coverage wave 6)
- refers-to: app/routers/render.py :: `render_session` (`what=preview`)
- kind: explainer
- logged: v0.57.0 (in progress) · 2026-09-30

iZotope RX's streaming preview: the mix rendered, encoded with a lossy codec (MP3, OGG or M4A) and decoded back at the session's rate into new media, so the codec's effect can be heard against the mix; lossless formats are refused. Verified (verify_preview.py) on the JFK session: an MP3 192 kbps preview of 11.0 s, correlation 1.0 with the float mix at zero lag (the decoder trims the encoder's padding), differing by up to 0.024; FLAC refused.

### app/services/separate.py, app/routers/media.py · Deconstruct: tonal, noisy and transient parts (coverage wave 7)
- refers-to: app/services/separate.py :: `deconstruct`, `_median`; app/routers/media.py :: `media_deconstruct`
- kind: rationale
- logged: v0.57.0 (in progress) · 2026-09-30

iZotope RX's Deconstruct, as a reference: harmonic-percussive separation with PyTorch (scipy is not in the runtime; torch is, for separation): a 2048-point STFT, a 17-wide median along time for the tonal envelope and along frequency for the transient one, a part claiming a bin when its envelope exceeds twice the other's and the noisy part taking the rest. The masks partition the spectrum, so the parts sum back to the range. Verified on a 440 Hz tone at 0.3 with a click every 0.5 s at 0.9 and white noise at 0.05: the parts summed to the input within 2.4e-7; tonal correlated 0.999 with the tone; transient held the clicks (0.569 at the click times) and not the tone (0.017); noisy's level was 0.0285 against the noise's 0.029, with part of the broadband clicks (0.31), which firm masks cannot keep out.

### app/routers/render.py · a track's active regions, for automatic ducking (coverage wave 10)
- refers-to: app/routers/render.py :: `track_activity`
- kind: warning-context
- logged: v0.58.0 (in progress) · 2026-09-30

POST /api/render/activity renders one track alone (others muted, solos cleared) and returns where it is active: silences over 0.3 s found by silencedetect, inverted. Two faults found on the JFK recording: a fixed -40 dBFS threshold never saw its pause (the background sits at -41 to -39 dB), so the threshold now defaults to the track's loud level (the 90th percentile of 50 ms RMS windows, measured natively by astats) minus 20 dB within -60 to -20 dBFS, -31.3 dB there; and a 2.6 ms noise spike inside the pause came back as activity and chained the ducking across it, so active regions under 0.1 s are dropped. Verified: the pause found (regions 0.33 to 2.5 s and 3.22 to 11 s), and through the app the ducking measured below.

### app/services/effects.py · loudness effects land on their target; matched clip loudness (coverage wave 10)
- refers-to: app/services/effects.py :: `apply` (the `loudnorm=` branch)
- kind: warning-context
- logged: v0.59.0 (in progress) · 2026-09-30

Proving Audition's matched clip volume (Loudness to a target with Apply to all clips) found the loudness effects off target: single-pass loudnorm left two clips at -20.9 LUFS for a -20 target, and two-pass loudnorm (measured, then linear) still left -19.5, and -22.5 for the -23 broadcast preset, against the ebur128 meter the app measures with. They now measure integrated loudness with ebur128 and apply the exact linear gain, with a limiter at -1 dBFS only when the gain would push the sample peak past it. Verified: clips at -15.5 and -45.4 LUFS matched to -20.0 and -20.1 in one undo step (verify_match_loudness.py); the broadcast preset gave -23.0 and a -14 target -14.0 with peaks held at -1.0 dBFS. Not reached: a -8 LUFS target gave -11.1, the limiter holding peaks at -1 dBFS instead of limiting harder; very loud targets fall short rather than distort.

### app/services/render.py · track effects in the export render
- refers-to: app/services/render.py :: `FX_KINDS`, `plan` (`fx`), `render`
- kind: explainer
- logged: v0.61.0 (in progress) · 2026-09-30

A track's `fx` list (kind, freq, gainDb, q, bypass) becomes filter stages on each of its clips in the core's render, with the session's rate; bypassed and unknown stages are left out, so exports carry exactly what playback will. Verified with the export render and an FFT against renders without effects: a 1 kHz high-pass took 100 Hz down 40.03 dB and left 5 kHz within 0.01 dB; a bypassed stage rendered byte for byte as none; a +6 dB peak at 1 kHz gave +6.00 dB.

### app/services/render.py · master effects in the export render
- refers-to: app/services/render.py :: `render` (`master_fx`)
- kind: explainer
- logged: v0.62.0 (in progress) · 2026-09-30

The document's `masterFx` (the same kinds and bypass rule as tracks) becomes the core's master chain in exports. Verified by FFT: a 2 kHz master high-pass -52.14 dB at 100 Hz, -12.38 dB at 1 kHz, -0.10 dB at 5 kHz; bypassed, byte for byte as none.

### app/services/render.py · the compressor in the export plan
- refers-to: app/services/render.py :: `FX_KINDS`, `_stage`, `plan` (`chains`, the track's own bus), `render`
- kind: warning-context
- logged: v0.63.0 (in progress) · 2026-09-30

One `_stage` rule turns an effect entry into a core stage (filters: frequency, gain, Q; the compressor: threshold, ratio, attack, release, makeup). A track holding a compressor and routed to the master plays through a bus of its own (unity gain, centre) whose chain is the track's whole chain in order; the master's effects travel as ordered master stages, so it takes a compressor too. Not placed yet: a compressor on a track routed to a user bus (its filters still run per clip). Verified: see the core log's export measurements (-16.00 dBFS against the curve's -16.51; transparent below threshold to four decimals; the master matching; the high-pass regression at -40.03 dB).

### app/routers/media.py · the transients route
- refers-to: app/routers/media.py :: `media_transients`
- kind: explainer
- logged: v0.64.0 (in progress) · 2026-09-30

GET /api/media/{id}/transients?sensitivity= returns onset times in the file's own seconds from the core's detector (503 without the core). Verified: the drum-like bursts at 0.30, 0.80, 1.55, 2.10 and 2.70 s came back at 0.301, 0.8018, 1.5509, 2.1005 and 2.7024 s; JFK's speech gave 3, 7 and 14 onsets at sensitivities 0.2, 0.5 and 0.8.
