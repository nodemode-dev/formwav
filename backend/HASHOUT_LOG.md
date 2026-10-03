# HASHOUT_LOG · backend · formwav

Living log of all comment content, explainers, rationale, TODOs and removed code for the backend. Source files stay comment-free per dev-rules `sub-skills/hashout-log/SUB-SKILL.md`; everything they would have said lives here, indexed. Read this first, then edit code surgically.

Current build version: v0.85.0
Last updated: 2026-09-30 · the Space group's four echoes named as echoes (the last entry below); the header had read v0.38.0 while entries ran to v0.84.0's SAM-Audio service

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

### app/services/effects.py · Change tempo, rhythmic
- refers-to: app/services/effects.py :: `stretch-rhythmic` (chain, control, menu entry, `RETIMING`)
- kind: rationale
- logged: v0.68.0 (in progress) · 2026-09-30

A pitch-keeping tempo change for rhythmic material: Rubber Band with a short window, beside Change tempo and with the same Tempo control, marked as timing-changing. Measured with the core's onset detector on a 12-hit pattern stretched from 99.9 to 110 BPM: Rubber Band's defaults kept 6 attacks at a 0.5601 s spacing (0.5449 expected), the percussive detector alone changed nothing, and a short window kept the spacing at 0.5435 s with 16 onsets, a few attacks still splitting. The catalogue is now 90 effects.

### app/routers/presets.py, app/main.py · one store of effect presets (coverage wave 8)
- refers-to: app/routers/presets.py :: `list_presets`, `save_presets`, `_clean`; app/main.py :: the router's mount
- kind: explainer
- logged: v0.73.0 (in progress) · 2026-09-30

Audacity's one preset system across built-in, destructive and realtime effects: GET and PUT /api/presets over one JSON file in the data folder, so presets outlive a browser and a session. Each preset is a name, an effect key (rendered effects "fx:<id>", realtime ones "rt:<kind>") and its named numeric settings; the whole list is validated (at most 500 presets, 16 settings each, finite numbers) and written by atomic replacement. Verified through the app (the frontend log's verify_presets.py): saved presets appeared in the store with their settings, persisted across a reload, and a deleted one left it.

### app/services/render.py · pitched clips in the export plan
- refers-to: app/services/render.py :: `plan` (`play_id`)
- kind: explainer
- logged: v0.75.0 (in progress) · 2026-09-30

A clip carrying `pitchMediaId` (non-destructive pitch) exports that same-length render instead of its original media, as playback does. Verified by FFT of exports (the frontend log's verify_pitch.py): 880.0 Hz at +12, 220.5 Hz at -12 and 440.0 Hz at 0 from a 440 Hz clip.

### app/services/render.py · a user bus's effects in the export plan
- refers-to: app/services/render.py :: `plan` (`bus_chains`)
- kind: explainer
- logged: v0.76.0 (in progress) · 2026-09-30

A user bus's `fx` become stage chains on that bus (target 1, its index), collected while buses are read and placed first in `chains`, so the core processes the sum of every track routed to the bus. Verified by FFT of exports (the frontend log's verify_busfx.py): a 2000 Hz high-pass on a bus cut its routed track's 100 Hz by 52.14 dB and left an unrouted track's 1 kHz unchanged.

### app/services/eqmatch.py, app/routers/media.py · EQ match (coverage wave 10)
- refers-to: app/services/eqmatch.py :: `bands`, `curve`, `eq_match`; app/routers/media.py :: `eq_match`
- kind: warning-context
- logged: v0.78.0 (in progress) · 2026-09-30

iZotope RX's EQ Match: POST /api/media/{id}/eq-match?reference=&start=&end= gives the clip the tonal balance of a reference region. Both are averaged (Welch, 8192-sample Hann frames) into 30 third-octave bands from 25 Hz; the per-band difference, zero where either side is empty or past Nyquist, centred on its median and clamped to 18 dB, is rendered with firequalizer into new media. firequalizer delayed the content by 480 samples and lengthened the file by 960 frames at 48 kHz, which would have moved and stretched the clip (set-clip-media scales a clip whose media changes length); its delay is now fixed at 10 ms, trimmed off, and the original frame count restored, measured as identical length and 0-sample lag. Median-centring over all 30 bands does not hold loudness exactly: the median band from 100 Hz to 10 kHz rose 2.6 dB in the test. Verified with independent band levels: dark noise (300 Hz first-order low-pass) matched to white noise moved from 8.54 dB to 0.38 dB mean deviation from 100 Hz to 10 kHz (worst band 3.66 dB); a missing reference answered 422.

### app/services/eqmatch.py, app/routers/media.py · EQ match measured over a target region
- refers-to: app/services/eqmatch.py :: `eq_match` (`target_start`, `target_end`); app/routers/media.py :: `eq_match` (`tstart`, `tend`)
- kind: explainer
- logged: v0.79.0 (in progress) · 2026-09-30

The target can be measured over a region (tstart, tend in its media's seconds) so a range edit compares like with like; the whole file is still rendered, at its exact length, and the app keeps only the range. Verified through the app (the frontend log's verify_eqmatch_range.py): a dark range inside a clip that is bright elsewhere matched to within 0.58 dB of the learned bright range.

### app/services/render.py · VCAs in the export plan
- refers-to: app/services/render.py :: `plan` (`vcas`, the member skip and `track_db`)
- kind: explainer
- logged: v0.80.0 (in progress) · 2026-09-30

A track assigned to a VCA plays at its fader (or its volume automation) plus the VCA's gain, and a muted VCA silences it; no audio passes through the VCA. Verified by FFT of exports with two of three tracks on a VCA: at -6 dB the members fell 6.00 dB and the unassigned track 0.00 dB; muted, the members fell over 169 dB and the unassigned track did not move.

### app/services/tempo.py, app/routers/media.py · tempo detection that holds on real music
- refers-to: app/services/tempo.py :: `envelope`, `estimate`, `detect`; app/routers/media.py :: `media_tempo`
- kind: warning-context
- logged: v0.82.0 (in progress) · 2026-09-30

GET /api/media/{id}/tempo?start=&end= returns a tempo and confidence from an onset-strength envelope (log spectral flux at 22050 / 220 = 100.227 frames a second, local mean removed), scored per candidate from 60 to 200 BPM by its autocorrelation averaged over every multiple of the period within 12 s, with a gentle preference for tempos near 120 to settle half against whole tempo. It replaces a comb over discrete onset times, which returned confidence 0.08 to 0.18 on the owner's 2:44 song. Assuming 100 frames a second read every tempo 0.23% low; the exact rate fixed it. Measured: the song 126.9 BPM at confidence 0.474, its drum stem 126.9 at 0.551, a 30 s region 126.9, and every 30 s window of the song 126.8 to 127.0; synthetic beats 100.0, 60.0 and 137.0 at 0.34 to 0.42; irregular hits and speech 0.025 and 0.028. The owner's tempo software reports 129. librosa's tempo estimate also reads 129.20 on this file, which is exactly its lag-20 bin at its default frame grid (60 x 22050 / 512 / 20; the next bin is 123.05), while librosa's own beat tracker spans 126.96 BPM from first to last of its 321 beats (127.10, 126.88 and 126.87 by thirds); a phase-coherence check on the drum onsets was inconclusive. The evidence says the file's average tempo is 126.9 and that 129 is a grid value; the owner is given click tracks at both tempos to judge by ear.

### app/services/key.py, app/routers/media.py · key detection with Camelot codes (owner-requested)
- refers-to: app/services/key.py :: `chroma`, `estimate`, `camelot`, `detect`; app/routers/media.py :: `media_key`
- kind: warning-context
- logged: v0.83.0 (in progress) · 2026-09-30

GET /api/media/{id}/key?start=&end= returns the key, tonic, mode, Camelot code and a confidence (the best of 24 correlations' margin over the runner-up). The chroma comes from the harmonic part of the spectrogram (a numpy median-filter split, no scipy), 150 Hz to 4 kHz, linear magnitudes, against Temperley's profiles; Camelot numbers follow the circle of fifths ((7 x major pitch class + 8) mod 12, minors sharing their relative major's number). Found while building it: log-compressed chroma read everything a fifth high (the owner's song as C minor, C major as G major), because a note's third harmonic lands a fifth above; with linear chroma and a 55 Hz floor the song's mode was a coin toss (0.02); the 150 Hz floor made two independent profile sets agree. Tuned against one real song (F minor, 4A, from the owner's analysis software) and four synthetic progressions, a thin basis stated as such. Measured through the engine: the song F minor, 4A, confidence 0.236, in 4 s; C major 8B, A minor 8A, F minor 4A and Ab major 4B progressions all right (0.22 to 0.29); the Camelot arithmetic right at ten known wheel positions.

### app/services/samaudio.py, app/routers/media.py, requirements_sam_audio.txt · SAM-Audio, isolate a described sound (owner addition)
- refers-to: app/services/samaudio.py :: `status`, `_load`, `isolate`, `Unavailable`; app/routers/media.py :: `sam_audio_status`, `isolate_sound`; requirements_sam_audio.txt
- kind: warning-context
- logged: v0.84.0 (in progress) · 2026-09-30

GET /api/sam-audio/status names each precondition (installed, Hugging Face login or a cached checkpoint, device) and the first one missing; POST /api/media/{id}/isolate?description=&start=&end=&spans= returns the described sound and everything else as two media at the region's rate and exact frame count, spans being SAM-Audio's positive anchors in seconds from the region's start. A missing precondition answers 503 with the step to take, bad input 422. The component is optional (requirements_sam_audio.txt, pinned to the source commit bb4c6999 it was written against) and cannot run in the build container: the checkpoints are manually gated (an unauthenticated download answered 401) and 5.10 to 14.86 GB against about 4 GB free, and Meta recommends a GPU. Written from the source, not only the README: result.target and result.residual are lists of mono tensors (the README's result.target.cpu() would fail), the processor takes a tensor as given, so the region is decoded to 48 kHz mono here. Verified to the model boundary, not on real weights: as installed here, status and isolate say SAM-Audio is not installed with the install command; with a stand-in of the package (verification/stand_ins, not in the repository) that records its calls, a gated load answered "Hugging Face refused facebook/sam-audio-small (GatedRepoError): request access on its page, then run: hf auth login", bad spans and an empty description 422, and the interface path (frontend log) passed the lowercased description and the exact anchor, with outputs aligned to the frame and reconstructing the original to -183 dB. How well SAM-Audio isolates sounds is measured only once it runs on the owner's machine.

### app/services/effects.py · the Space group's four echoes named as echoes
- refers-to: app/services/effects.py :: `AUDIO_CHAINS` (`room`, `hall`, `cathedral`, `plate`), the Space entry of the catalogue groups
- kind: rationale
- logged: v0.85.0 (in progress) · 2026-09-30

Room, Hall, Cathedral and Plate are ffmpeg `aecho` chains, three or four discrete taps with decays, which is a multi-tap echo and not a reverb (no diffuse tail, no density growth). The v6 comparison page read the chains and asked that they be named for what they are or replaced by a reverb. The labels now read Room echo, Hall echo, Cathedral echo and Plate echo; the ids, chains, presets and saved chains are unchanged, so nothing that referenced them by id moves. A real reverb (a convolution against a decaying-noise impulse through `afir`, or a stage in the Rust core) stays open in BUILD_NOTES. Verified: the running engine's `GET /api/effects` lists the four new labels under Space with the same ids, still 90 effects in eleven groups.

### app/services/effects.py · controls on the six fixed repair chains (coverage wave 4 and 10; the v6 page's first build item)
- refers-to: app/services/effects.py :: `PARAMS` entries `de-clip`, `de-crackle`, `mouth-declick`, `de-plosive`, `de-wind`, `hum-remover`
- kind: explainer
- logged: v0.86.0 (in progress) · 2026-09-30

Each chain's ffmpeg filter already took the parameter RX exposes, so the entries give it a range whose default reproduces the fixed chain: De-clip threshold 1 to 100 (adeclip's own default 10) and window 10 to 100 ms (55); De-crackle threshold 1 to 20 (5) and window (20 ms); Mouth de-click threshold (2) and window (10 ms) after its 60 Hz high-pass; De-plosive cutoff 40 to 300 Hz (100); De-wind cutoff 60 to 400 Hz (150) and afftdn noise floor -80 to -20 dB (-30); Hum remover harmonics 1 to 6 (2: the 50 and 60 Hz families to their second harmonic, as before) and notch width as Q 1 to 30 (4). Nothing in the interface changed: the Inspector renders sliders from the catalogue. Verified on the engine: at their defaults all six outputs are byte-identical to the old fixed chains on the mic fixtures; De-plosive at 40 Hz left a 100 Hz tone at -0.11 dB and at 300 Hz cut it 19.14 dB (200 Hz 7.83, 1 kHz 0.04); De-wind at 400 Hz cut 100 Hz by 24.33 dB, and its floor at -80 changed a -30 dB noise band by 0.0 dB, at -30 by -10.3 and at -20 by -12.0 with the 1 kHz tone unchanged; Hum remover at 2 harmonics left 200 and 300 Hz within 0.4 dB and at 6 cut them 80 and 98 dB, width 1Q took 55 Hz down 33 dB where 30Q left it at -0.3 dB, 50 Hz down 34 to 77 dB throughout, 1 kHz within 0.2 dB; De-crackle threshold 1 took 40 clicks in a 440 Hz tone from -36.5 to -46.0 dB against the clean tone and 20 left them at -36.3; Mouth de-click threshold 1 to -46.8 and 20 to -36.3 against the high-passed clean tone; De-clip on a 32%-clipped tone: window 10 ms reconstructed to -31.0 dB against the unclipped tone (the clipped source -27.7), 55 ms -23.4, 100 ms -20.2, and threshold 100 differed from 10 (14890 against 14851 samples still at the clip level) while 1 equalled 10, so adeclip's reconstruction of a pure tone is worse than the source at the wider windows, stated; on a 57%-clipped tone the threshold had no effect at all; in Chromium the six effects show their labelled sliders, De-clip applied at 20 and 10 ms in one undo step as "mild (De-clip 20 10ms).wav", the params fit at 1024 px (screenshot), verify_params.py lists 29 adjustable, verify_mic_check.py still applies the Hum remover through Use; no page errors.

### app/services/effects.py · a real reverb in the Space group (AU-B16; the v6 page's third build item)
- refers-to: app/services/effects.py :: `FORMWAV_CHAINS["reverb"]`, `PARAMS["reverb"]`, the Space entry of the catalogue groups
- kind: explainer
- logged: v0.88.0 (in progress) · 2026-09-30

ffmpeg 6.1 has no algorithmic reverb, and `afir` needs an impulse as a second input, which the one-input `-af` chain the apply path runs cannot supply from a file. The impulse is made inside the graph from the input itself: `asplit=3` gives the dry signal, a branch trimmed to Size seconds whose samples `aeval` replaces with `(random(0)*2-1)*exp(-t/Decay)` (decaying white noise, the classic synthetic room), and the signal to convolve; `afir` with `gtype=rms` normalises the impulse so the wet level tracks the dry level, and `amix` with `normalize=0` blends dry and wet by Mix. A stereo input gets an independent noise impulse per channel, so the tail is decorrelated. Controls: Size 0.2 to 6 s (1.5), Decay 0.1 to 5 s (0.8; the amplitude falls by 8.7 dB per Decay), Mix 0 to 100% (30). Verified on the engine with a single click at 1.0 s: the output has the same frame count, its first sample and its peak fall at exactly 1.0 s (no added latency, so `set-clip-media` keeps the clip in place), the tail at defaults reads -37.8, -40.5 and -46.0 dB at +0.25, +0.5 and +1.0 s and is gone by +2 s (the 1.5 s Size), Size 4 with Decay 2.5 reads -33.6 to -39.7 dB across the same points, Size 0.3 with Decay 0.1 is gone by +0.5 s; Mix 0 is byte-identical to the source; a stereo file keeps 2 channels and its 144000 frames; the catalogue lists 91 effects, 30 adjustable; in Chromium the Reverb shows Size, Decay and Mix, applied at 3 s, 2 s, 50% in one undo step as "tone (Reverb 3s 2s 50%).wav" with the clip's length unchanged; no page errors. Two things stated: the impulse's noise seed is aeval's, so two renders with the same settings may differ in their fine tail; and the notice reads "Applied Reverb... to the clip" with the label's dots, as every "..." effect has since v0.46.0.

### app/services/effects.py · renders land where their source did: afftdn, anlmdn and alimiter delays stripped
- refers-to: app/services/effects.py :: `apply`, the `delay` computed after the chain is final (before the aresample the apply path appends)
- kind: warning-context
- logged: v0.89.0 (in progress) · 2026-09-30

Found while prototyping a learned noise profile: a click at 1.0 s came back from `afftdn` at 1.025 s. Three filters in the catalogue add fixed lookahead delays that were never compensated: `afftdn` delays by 25 ms at any rate (1200 samples at 48 kHz, 1102 at 44.1, 2400 at 96), `anlmdn` at the catalogue's settings by its patch plus research window, 8 ms (p=0.002 and r=0.006), and `alimiter` by its 5 ms attack less one sample (239 at 48 kHz, measured against 240 with a click: 239 puts the click back exactly). Every chain carrying one shifted its render late by that much since v0.41.0: Enhance speech (afftdn and alimiter, 30 ms together), Denoise, Deep denoise, Hiss cut, Guitar de-noise, De-wind, Voice de-noise, Peak limiter, and the loudness targets when their limiter engages; because the apply path renders a clip's media and the range path re-places an excerpt sample-exactly, a range render of any of them landed late inside its clip. Filters whose latency is length-changing (firequalizer) were already handled at v0.48.0; these three keep the length and were missed. The fix: after the chain is final, `atrim=start_sample=N,apad=pad_len=N` with N the sum of the delays present, computed at the media's own rate, so the output keeps its frame count and its content lines up with the source. Verified on the engine with a single click at 1.0 s at 48 kHz and 44.1 kHz: Denoise, De-wind, Enhance speech, Voice de-noise, Hiss cut, Deep denoise, Guitar de-noise, Peak limiter and Loudness to a target all answer at the click's own sample (the 1-sample readings on Hiss cut and Voice de-noise are the low-pass smearing the peak, and the frame count is unchanged in every case); on the noisy fixture Denoise at -40 dB kept the click at 192000 and took the noise range from -39.5 to -42.6 dB; verify_range_fx.py and verify_params.py unchanged and passing. Stated: Enhance speech at 50% is no longer byte-identical to formcut's voice-clean (v0.46.0's evidence), it is that render moved 30 ms earlier; the other filters in the catalogue were checked by the same click (acompressor, highpass, deesser, speechnorm add nothing).

### app/services/effects.py · Repair short gaps takes its window and order (RX-25)
- refers-to: app/services/effects.py :: `PARAMS["gap-repair"]`
- kind: explainer
- logged: v0.89.0 (in progress) · 2026-09-30

The last fixed adeclick: `adeclick=w=10:o=50:a=4` becomes Window 10 to 100 ms (10) and Order 0 to 25 (4, the autoregression order the interpolation fits), the overlap staying at 50. Verified on the engine: the default output is byte-identical to the fixed chain on the clicks fixture; against the clean tone the 40 clicks read -36.5 dB at the source, -37.3 at the default, -43.1 with a 50 ms window and -37.0 at order 25, so the window is the control that repairs and the order barely moves this input, stated; the catalogue lists 31 adjustable; verify_params.py lists them; no page errors.

### app/services/samaudio.py · the integration read against the pinned source again
- refers-to: app/services/samaudio.py :: `_load`, `isolate`
- kind: warning-context
- logged: v0.90.0 (in progress) · 2026-09-30

The owner asked whether SAM-Audio is integrated properly. The pinned commit bb4c6999 was fetched and read beside the service: `SAMAudio` and `SAMAudioProcessor` are exported from the package root; both `from_pretrained` come from the hub mixin; `SAMAudioProcessor.__call__(descriptions, audios, anchors, masked_videos)` takes tensors shaped (channels, time), downmixes with `mean(0)` and does not resample tensors, so decoding at `processor.audio_sampling_rate` (48 kHz) here is right; `Anchor` is `(str, float, float)` and the positive kind is `"+"`; `Batch.to(device)` exists; `separate(batch, noise, ode_opt, reranking_candidates, predict_spans)` applies span prediction only when `batch.anchors is None`, which is the condition the service sends; and `SeparationResult.target` is built as a list of one tensor per input (`[wav[idx] for ...]`) although the dataclass annotates a tensor, so `result.target[0]` is right and the README's `.cpu()` on it would fail, as the service header said. Every name and shape the service relies on matches the source at that commit; what is not verified anywhere in this container remains the weights, gated and 5 to 15 GB, and with them the quality of the isolation, the span prediction and the re-ranking. FW-04, FW-05 and FW-07 stay partial until the owner's run.

### app/services/tools.py · phase correlation in Statistics (AA-02)
- refers-to: app/services/tools.py :: `stats` (the `phaseCorrelation` key), `_phase_correlation`
- kind: explainer
- logged: v0.91.0 (in progress) · 2026-09-30

Audition's phase meter reads the correlation between two channels; formwav's Statistics now carries it for stereo files as a Pearson correlation over the whole file, -1 (opposed) to 1 (mono), computed in 4 MB chunks of decoded float so a two-hour file never sits in memory at once, and left out for mono files. Verified on the engine: identical channels 1.0, an inverted copy -1.0, independent noise -0.0066, a channel that is half the other plus half fresh noise 0.7069 (theory 0.5 over the square root of 0.5, 0.7071), a mono file carries no key; in Chromium the Statistics list shows "Phase correlation 0.71" as its last row for that clip. Stated: a whole-file figure, not the running meter Audition draws.

### app/services/effects.py · a noise profile learned from a range, for every afftdn effect
- refers-to: app/services/effects.py :: `_noise_range`, `LEARNS_NOISE`, the `noise` wrap in `apply`, the `learnsNoise` key in `catalogue`
- kind: explainer
- logged: v0.96.0 (in progress) · 2026-10-01

Audacity, RX and Audition all learn noise from a selection; afftdn can sample a profile at runtime but only from the stream it is processing, and the apply path's one-input graph cannot read a second file. So the profile is learned in the graph itself: `asplit` the input, trim the learned range out of one branch and `concat` it in front of the other, `asendcmd` turns `sn` on at 0 and off 50 ms before the prefix ends, the effect's own chain runs (afftdn now holding the sampled profile), and `atrim` drops the prefix; the delay compensation then lands after as for any afftdn chain. `noise_from` and `noise_to` ride in the params dict beside the sliders (ignored by `_values`), must lie inside the file and last 0.1 s, and are refused for an effect without afftdn; `LEARNS_NOISE` is derived from the chains (voice-clean, denoise, deep-denoise, hiss-cut, de-wind, guitar-denoise) and published as `learnsNoise` in the catalogue. Verified on the engine with the noisy fixture (coloured noise at -39.5 dB with tone bursts from 2 s and a click at 4.0 s): Denoise at -40 with the 0.2 to 1.8 s range took that range to -45.1 dB against -42.6 for the plain estimate and -39.5 at the source, the signal band unchanged at -16.5 dB, 288000 frames in and out, the click at 192000 in and out; Enhance speech with the range likewise aligned; Amplify with a range answered 422 naming the effects that learn; a range outside the clip and a 0.05 s range answered 422 with the numbers. Stated: a range of pure noise is the user's to choose, and the sampled profile is afftdn's own, so the gain over its estimate is a few dB on steady noise rather than RX's spectral subtraction.

### app/services/effects.py · Ramp tempo and pitch (AU-B18, RX-47, RX-48)
- refers-to: app/services/effects.py :: `_ramp_chain`, `PARAMS["ramp"]`, the `ramp` branch in `apply`, `RETIMING`
- kind: explainer
- logged: v0.98.0 (in progress) · 2026-10-01

Audacity's Sliding Stretch and RX's variable time and pitch change tempo and pitch gradually across a selection; ffmpeg's rubberband takes `tempo` and `pitch` as runtime commands, so the ramp is `asendcmd` driving both in 100 steps across the clip's duration (known only at apply time, so the chain is built there rather than by the PARAMS builder), each step set at its own centre; tempo moves linearly in rate (50 to 200%) and pitch linearly in semitones (geometric in the factor, -12 to +12). One trap, measured: when the pitch factor equals the tempo factor at a step (a tape-style ramp, tempo 100 to 200% with pitch 0 to 12 st) rubberband's effective stretch ratio sits at exactly 1 and its output length goes wrong (1.944 s where 2.773 was due, and 6.041 where 3.697 was); a 0.1% nudge of the pitch factor (1.7 cents) whenever the two are within 0.002 restores it (2.788 and 3.767 s). Verified on the engine with a 440 Hz tone of 4 s: pitch 0 to 12 st alone kept 192000 frames and read 520, 625 and 740 Hz at 1, 2 and 3 s against 523, 622 and 740 on the semitone line; tempo 100 to 200% alone gave 2.788 s against the input-time integral's 2.773 with the pitch held at 440; tempo 200 to 50% with pitch 12 to -12 gave 3.754 s against 3.697 with the frequency falling from 738 to 258 Hz; four single tempo ramps in both directions landed within 1.3% of their integrals; neutral settings keep the length and pitch; in the Inspector the four sliders apply in one undo step ("Ramp tempo and pitch 100% 200% 0st 12st"), the clip reading 2.798 s; the effect is in RETIMING so it applies to whole clips; 92 effects, 32 adjustable; verify_params.py passing; no page errors. Stated: a piecewise ramp (100 steps, within about 1.5% of the continuous curve), linear in rate and in semitones only, no drawn curve.

### app/services/audacity.py, app/routers/projects.py · Audacity 2.x projects (.aup with _data) open as sessions (AU-34)
- refers-to: app/services/audacity.py :: `import_aup_zip`, `_read_au`, `_clip_samples`, `_wav_bytes`; app/routers/projects.py :: `POST /api/projects/import-audacity`
- kind: explainer
- logged: v0.99.0 (in progress) · 2026-10-01

A 2.x project is an .aup XML beside a _data folder of .au blocks, so the reader takes the two zipped together (a browser cannot pick a folder with its file), walks wavetrack, waveclip, sequence and waveblock, concatenates each clip's simpleblockfile and silentblockfile blocks in start order, and refuses the aliased block kinds that reference audio outside the folder. The .au header is Audacity's own quirk: written in the machine's byte order, so the magic reads "dns." and the fields are little-endian, with float32 samples (format 262159) or int16 (131073) at the header's data offset past the summaries; both byte orders are accepted. A linked pair (channel 0 with linked="1" and the channel 1 that follows) becomes one stereo track when the clips' offsets line up, otherwise two mono tracks; gain becomes dB, pan and mute and solo carry over; label tracks become markers (t equals t1) and regions. The document returned has the project's rate, the clips at their offsets in samples, and media refs for the WAVs stored. Verified on the engine with a project built by hand from the format (a linked stereo pair of two blocks per channel at 0.5 s with gain 0.5, a mono track at 2.0 s with pan -0.25, a point label and a span label): 2 tracks, 2 clips, 2 labels; Music stereo at -6.02 dB with its clip at 22050 for 44100, Voice mono with pan -0.25 at 88200, a marker at 44100 and a region 110250 to 154350; every sample of all three channels byte-identical to the arrays the fixture was made from; in Chromium the zip through the picker opened the session with the notice naming what was and was not carried over, two lanes and two clips, and a further import still landed. Stated: the fixture follows the format, not a file Audacity wrote, so the row is partial until the owner opens a real 2.x project; envelopes (clip gain curves), effects and the view state are not carried over; .aup3 is not read, its project document being a binary tokenised blob this reader does not guess at.

### app/services/tools.py, app/routers/media.py · samples read in place and drawn into a copy (AU-13)
- refers-to: app/services/tools.py :: `_wav_view`, `samples`, `draw`; app/routers/media.py :: `GET /api/media/{id}/samples`, `POST /api/media/{id}/draw`
- kind: explainer
- logged: v1.1.0 (in progress) · 2026-10-01

Sample drawing needs the raw samples of a window and a way to write some back. `_wav_view` parses the stored WAV's chunks (the engine writes WAVE_FORMAT_EXTENSIBLE with the IEEE-float subformat, so the subformat code is read from the extension; 16-bit PCM is accepted too) and maps the data chunk from disk with numpy's memmap, so a window of a long file costs a window, not the file. `samples` returns up to 20000 samples per channel from a start; `draw` copies the whole file, writes the values into every channel from the start (clipped to -1 to 1), and stores the copy as new media named "(drawn)" once, so the clip's old media stays for undo. Refused: an empty or 100000-plus run, non-numbers, and a run past either end, each with the numbers. Verified on the engine with a 4 s 440 Hz tone: a 256-sample window from 47872 matched the file exactly; a 128-sample ramp drawn from 47936 read back with zero error, every other sample of the 192000 byte-identical, the frame count unchanged; both refusals answered 422 with their reasons. Stated: drawing writes every channel alike.

### app/services/tools.py, app/routers/media.py · room tone matched to a learned range, into a gap (RX-01)
- refers-to: app/services/tools.py :: `room_tone`; app/routers/media.py :: `POST /api/media/{id}/room-tone`
- kind: explainer
- logged: v1.3.0 (in progress) · 2026-10-01

RX's ambience match fills edits with a background bed matched to the recording's. The engine takes a learned range (on the same or another media at the same rate, at least 0.1 s) and a range to fill: Welch's power spectrum of the learned range (Hann frames of up to 4096 samples at half overlap, normalised by the window's power so a white input reads its own variance) shapes fresh white noise of the gap's length in one FFT, which gives the shaped noise the learned variance by Parseval, and the result replaces the gap with 10 ms linear crossfades inside it at each end; the noise is seeded from the media and the range so a render repeats exactly; the copy is stored as "(room tone)" media and the rest is byte-identical. Verified on the engine with a fixture of low-heavy room tone at -39.8 dBFS, two 300 Hz bursts and a 1 s gap of digital silence: filled from 0.2 to 1.8 s's tone, the gap's middle read -39.88 dB against -39.81 learned, the octave bands at 125 Hz, 500 Hz, 2 kHz and 8 kHz within 0.72, 0.25, 0.41 and 0.08 dB of the learned, the correlation with the learned audio 0.02 (synthesised, not copied), the gap's first sample 0 rising over 10 ms, everything outside the gap identical, a second render identical to the first; a 0.05 s learn, a fill past the end and a missing field answered 422 with their reasons. Stated: stationary noise only (a spectrum averaged over the learned range, so hum that drifts or a room with movement is matched on average), channels filled independently.

### app/services/projects.py, app/routers/projects.py · saved sessions carry a thumbnail (AU-32)
- refers-to: app/services/projects.py :: `THUMBNAIL_MAX_SECONDS`, `_thumbnail`, `thumbnail`, the `thumbnail` key in the manifest and the summary, `thumbnail.png` in the zip; app/routers/projects.py :: `GET /api/projects/{name}/thumbnail.png`
- kind: explainer
- logged: v1.5.0 (in progress) · 2026-10-01

A save now renders the session's mix through the engine's own renderer and draws it with ffmpeg's showwavespic (320 by 64, the accent colour, a square-root scale so quiet sessions still read) into thumbnail.png inside the .fmw, before the save lock is taken; the manifest names it, the session summary reports it, and a route serves it. The picture is optional: an empty session, one longer than 5 minutes (rendering a long mix whole would hold hundreds of megabytes for a picture) or any failure saves without one, and a .fmw from before this release, with no thumbnail, opens and lists as before (the format version is unchanged, readers ignore the extra entry). Verified on the engine: an Audacity project of two tracks saved in 0.25 s with manifest, session and thumbnail.png in the zip, the route serving the stored bytes exactly, and the picture's pixels lit only where the session has audio (0 per column over 0 to 0.5 s and 1.5 to 2 s, 6 over the music, 5 over the voice); a 6 s session with room tone, two bursts and a silent gap saved in 0.22 s with 5 lit pixels per column over the room tone, 27 over the bursts and 0 over the gap; a 6-minute session saved in 0.27 s without a thumbnail and the route answered 404 saying so. Stated: no picture for sessions over 5 minutes yet (a picture from the clips' peaks would scale to any length), and the picture is the mix's waveform, not a view of the tracks.

### app/services/transcript.py, app/routers/media.py · one transcript word's boundaries can be moved (DS-11)
- refers-to: app/services/transcript.py :: `set_word`; app/routers/media.py :: `PUT /api/media/{id}/transcript/word`
- kind: explainer
- logged: v1.6.0 (in progress) · 2026-10-01

Descript lets a word's edges be dragged when the recogniser's timing is off, so that deleting the word removes exactly the word. The cached transcript (data/transcripts/{media}.{model}.json, written by faster-whisper on first transcription) gains an edit: index, start and end in the media file's seconds, validated to start before it ends and to stay between the previous word's end and the next word's start (or the file's ends), rounded to milliseconds like the recogniser's own times, and written back. Verified with a transcript seeded in the cache's format over a fixture of four 440 Hz bursts (faster-whisper is not installed in this container, so the cache stood in for its output): word one moved from 0.52 to 0.85 s to 0.5 to 0.9 s and read back from the file so; an end of 1.5 s, past the next word's start at 1.4 s, answered 422 naming the bounds. Stated: the edit changes the cached transcript of that media for every clip that uses it, and a re-transcription with another model keeps its own timings.

### app/services/library.py, app/routers/media.py · a stock library of synthesised sounds (DS-14)
- refers-to: app/services/library.py :: `ITEMS`, `catalogue`, `render`, `wav`, `add`; app/routers/media.py :: `GET /api/library`, `GET /api/library/{item}/preview.wav`, `POST /api/library/{item}`
- kind: explainer
- logged: v1.8.0 (in progress) · 2026-10-01

Descript ships a stock library. formwav's is synthesised, so royalty-free by construction: ten items in five categories (line-up and timing: a 1 kHz reference tone at -18 dBFS, a 120 BPM click track with accented downbeats, a countdown; room tone: a quiet room and air conditioning with mains hum; transitions: a riser, a whoosh, an impact; a bell stinger; an A minor drone bed), each rendered with numpy from a fixed recipe with a seed from its id at the session's rate, stored as media (the same item at the same rate is the same media). Verified on the engine: the reference tone peaked at -18.00 dBFS at 1000 Hz over 480000 frames; the click track's 16 clicks fell every 0.5 s with the downbeats at 0.6 and the others at 0.4; the quiet room measured -50.01 dBFS RMS with 98.8% of its power below 1 kHz; the riser's spectral centroid climbed 1111, 2042, 3942 and 7044 Hz across its four seconds; adding an item twice returned the same media; the tone rendered at 44.1 kHz as 441000 frames; the bell's preview served a WAV; an unknown item answered 404. Stated: synthesised sounds only, not a licensed library of recorded music and effects.

### app/services/render.py · exports follow a clip's gain envelope, merged with track automation (AU-12)
- refers-to: app/services/render.py :: `_env_gain`, `_clip_envelope`, the per-clip envelope in `plan`
- kind: explainer
- logged: v1.9.0 (in progress) · 2026-10-01

A clip may carry an envelope of dB points at its media's frames. The export planner maps them to session time (start plus frame minus trim), and when the track has volume automation multiplies the two the way the core interpolates (linear in gain between dB points): sampled at both sets of breakpoints and eight times inside each span, with points before the session start folded into one at 0; the clip then uses that envelope instead of the track's. The browser planner does the same (player.ts), so playback and export agree. Verified on the engine with a 4 s 440 Hz tone and points at 1, 2 and 3 s of 0, -20 and 0 dB: 100 ms windows read 0, -0.10, -5.18, -18.19, -5.18 and 0 dB relative to the tone at 0.5, 1.0, 1.5, 2.0, 2.5 and 3.5 s, against 0, -0.1, -5.19, -18.19, -5.19 and 0 for the same windows over the line (the -20 dB corner averaged by the window); with -6 dB of track automation every reading fell by 6 dB; after a 0.5 s trim of the clip's left edge the -20 dB point still sat at 2.0 s; verify_export.py and verify_automation_parity.py unchanged and passing (automation parity 0.0 and 3e-8).

### app/routers/media.py, app/services/tools.py, app/services/tempo.py · PCM pieces from the mapped file; 16-bit read by the slice; tempo in bounded memory
- refers-to: app/routers/media.py :: `GET /api/media/{id}/pcm`; app/services/tools.py :: `_Scaled`, `_wav_view`; app/services/tempo.py :: `envelope`
- kind: warning-context
- logged: v1.11.0 (in progress) · 2026-10-01

Three changes, two of them fixes found by measuring the streaming work. The new route serves any frame range of a stored file as interleaved float32 (at most 100 s at 48 kHz a request) from the file mapped on disk. `_wav_view` had converted a 16-bit file to float32 whole on every call, so each 2 s piece of a 30-minute file cost a full-file conversion (and Draw samples and room tone fill paid the same on 16-bit files since v1.1.0 and v1.3.0); a 16-bit file now reads as float32 slice by slice and converts whole only when a caller asks for the whole. The tempo detector, which the interface runs on every import, built its spectral flux by windowing and transforming every frame at once, gigabytes for ten minutes, and on a 30-minute import that got the engine killed for memory three times in this 4 GB container; it now runs 4096 frames at a time with an identical result. Verified on the engine's worker process (under --reload the worker is a child of the reloader, which is what the first readings had measured by mistake): 100 pieces of the 30-minute file held the worker at about 71 MB and took about 3 ms each, the piece at 25:00 equal to ffmpeg's own read of the file to 0.0; the blocked flux equal to the old one to 0.0 on 90 s, ten minutes adding 40 MB at peak; a 30-minute import through the interface peaked at 1.08 GB with no kill (it had been killed at 2.3 to 2.9 GB); verify_tempo.py still reads 100, 60 and 137 BPM; Draw samples reads a 16-bit file's window at 30 s.

### app/services/effects.py · De-reverb, late-reverberation suppression, and a numpy path for effects (RX-12)
- refers-to: app/services/effects.py :: `_dereverb`, `NUMPY_EFFECTS`, the numpy branch in `apply`, the `dereverb` catalogue entry, chain and controls
- kind: explainer
- logged: v1.13.0 (in progress) · 2026-10-01

ffmpeg has no de-reverb, so effects gain a numpy path: an effect in NUMPY_EFFECTS renders from the stored file in numpy and is stored and named like the rest. De-reverb follows Lebart and Boucher: in a short-time spectrum (periodic Hann, 2048 points at 48 kHz, quarter hop, which overlap-adds exactly, so Amount 0 returns the input), the late reverberant power at a frame is the power about 50 ms earlier decayed at the rate the Reverb time implies; powers are smoothed over about 20 ms first (a tail's power in one bin fluctuates so widely that unsmoothed ratios left the gain open: the first version moved the tail only 2.25 dB at 70%), Amount 100% over-subtracts twice the estimate, and the gain is floored at Floor dB; frames run 1024 at a time, so memory is bounded. Verified on a fixture of four tone bursts through a synthetic 0.8 s room (a direct impulse and a decaying noise tail of equal energy): Amount 0 returned the input to 4e-17; at 50, 70 and 100% the tail-to-burst ratio fell from -14.22 dB to -17.38, -18.86 and -20.40 dB while the bursts lost 1.51, 2.30 and 3.61 dB; with Reverb time set to 0.4 s it removed less (-15.68) and at 1.6 s more (-20.98); the output's length equals the input's. Stated: a waveform match against the dry signal does not improve (5.21 dB wet, 5.04 at 70%), since subtraction also reshapes the direct sound, so this reduces reverb rather than restoring the dry recording; one room was measured; no neural model.

### app/services/effects.py · Spot heal, spectral repair of a box from its surroundings (AA-06)
- refers-to: app/services/effects.py :: `_spot_heal`, `NUMPY_EFFECTS["spot-heal"]`, the `spot-heal` catalogue entry, chain and controls
- kind: explainer
- logged: v1.14.0 (in progress) · 2026-10-01

Audition's Spot Healing Brush and RX's Spectral Repair repair a painted area from what surrounds it. Spot heal takes a box (Low and High Hz, From and To in the media's seconds) and, in a short-time spectrum, caps each bin's magnitude inside it at the level the four frames before and after the box predict (interpolated across the box in dB), the phase kept: an artifact standing above its surroundings comes down to them, and material running through the box at its surroundings' level passes. Every frame whose window overlaps the box is repaired (the first version took only frames centred in it, which left a click in a 10 ms box at 0.537 of its 0.896 peak); only a segment around the box is transformed, and frames outside it reconstruct exactly. Verified on the engine with a 440 Hz tone over a -50 dBFS floor carrying a 3 kHz whistle and a click: the whistle's band over the box fell from 63.35 to -2.40 dB (the clean band elsewhere 1.24) with the tone's band unchanged at 58.91 dB; the click's peak fell from 0.896 to 0.300, the tone's own peak, its 5 to 20 kHz energy by 19 dB, the tone's band moving 0.02 dB; outside both boxes the audio was unchanged to 0.0. Stated: the attenuate mode only (no replacement from a learned pattern), so an artifact that removes material, a dropout, is not filled.

### app/services/effects.py · Wow and flutter, a tracked speed curve resampled away (RX-51)
- refers-to: app/services/effects.py :: `_wow_flutter`, `NUMPY_EFFECTS["wow-flutter"]`, the `wow-flutter` catalogue entry, chain and controls
- kind: explainer
- logged: v1.15.0 (in progress) · 2026-10-01

RX's Wow & Flutter tracks a steady component and undoes the speed drift it reveals. A component between Track from and Track to is tracked every 5 ms (the strongest STFT peak, refined by a parabola through its log magnitudes); its frequency over its median is the speed curve, and since drift shifts every component by the same ratio, the audio is resampled by the inverse curve (cubic interpolation), the positions kept at frame resolution and the output rendered a million samples at a time; Amount scales the correction; a jump to another component (over 8%) is not taken for a speed change. The analysis window spans about 20 periods of the lowest frequency tracked and no more: the first version used 8192 points at 48 kHz, one whole period of 6 Hz flutter, and left 0.176% where the window now leaves 0.115%; the default band starts at 500 Hz for that reason. Verified against an instrument independent of the tracker (each tone's instantaneous frequency from its analytic signal, 10 ms averages) on two tones at 1 and 3.3 kHz with 0.5% wow at 0.5 Hz and 0.2% flutter at 6 Hz built analytically: peak-to-peak deviation fell from 1.385% to 0.115% on both tones alike (12 times, 21.6 dB), Amount 50% left 0.727%, and a band from 100 Hz (the longest window) left 0.36%; a steady input stayed steady (0.0032 to 0.0034%), its samples moving -30 dB relative to it from the tracker's own sub-sample noise; lengths stay within 0.02% of the input. Stated: it needs a steady component in the band (a held note, a hum, a bias or test tone), one curve is applied to all channels, and flutter much faster than 6 Hz is tracked less well.

### app/services/effects.py, app/routers/media.py · De-bleed against a reference recording (RX-05)
- refers-to: app/services/effects.py :: `debleed`; app/routers/media.py :: `POST /api/media/{id}/debleed?reference=&offset=&amount=`
- kind: explainer
- logged: v1.16.0 (in progress) · 2026-10-01

RX's De-bleed removes what leaked into a recording from another source, given that source. The leak is the reference through a fixed path, a delay and a short filter: the delay is found by cross-correlation (from 50 ms early to 250 ms late) and a 128-tap filter starting 16 samples before it by least squares over at most the first minute, both from FFT correlations, then the reference through that filter is subtracted in the time domain by blocks of FFT convolution; `offset` is the reference's frame at the recording's frame 0, and Amount scales the subtraction. The first version estimated one transfer value per frequency bin from the cross-spectrum, and wherever the wanted sound was louder than the bleed its estimates drowned: it cut 5.7 dB and a reference misaligned by half a second did nearly as well. Verified on a melodic line with a backing track (drum-like noise bursts, a bass line and a pad, starting 0.5 s before it) bled in through a 4 ms delay, a 3 kHz low-pass and -15 dB: the bleed left relative to the line fell from -15.81 to -25.10 dB (9.3 dB) with the line kept (correlation 0.998), Amount 50% left -20.78 dB, the same reference misaligned by 0.5 s left -20.66 dB, Amount 0 returned the input exactly, and the recording as its own reference is refused. Stated: 9.3 dB on this fixture, where the line's 494 Hz harmonic shares a pitch with the pad and limits any estimate made from a reference; no reference-free mode; a path longer than about 2.7 ms after the delay is only partly caught.

### app/services/effects.py · De-bleed re-fits the path weighted toward where the wanted sound is quiet (RX-05)
- refers-to: app/services/effects.py :: `debleed`, the second fit (`placed`, the block weights)
- kind: warning-context
- logged: v1.16.0 (in progress) · 2026-10-01

De-bleed's first fit cut 9.3 dB on the line-and-backing fixture. Two diagnostics found why: the bleed alone cancelled by 33.5 dB, and the same line with the backing's pad moved off its harmonics by 24.3 dB, so the line's 494 Hz harmonic, on a pad note, was being taken for leak. The path is now fitted a second time with each 50 ms block weighted by the inverse of what the first fit left in it, so pauses, breaths and gaps carry the fit when there are some, and without them the weights stay near uniform (a cut at the quietest 30% of blocks was tried first and still took in sung blocks: 25.5 dB). Verified: the shared-pitch fixture's bleed fell from -15.81 to -48.78 dB relative to the line, the line kept to a correlation of 0.99999; the off-pitch fixture to -48.65 dB; the bleed alone stayed at -33.53 dB; Amount 50% left -21.82 dB, a reference misaligned by 0.5 s -22.43 dB, Amount 0 the input exactly. Stated: the second fit leans on quiet moments, so a recording with none gets the first fit's accuracy.

### app/services/effects.py · Pitch correction to the nearest note of a key and scale (PT-10)
- refers-to: app/services/effects.py :: `_f0_track`, `_pitch_correct`, `NUMPY_EFFECTS["pitch-correct"]`, the `pitch-correct` catalogue entry, chain and controls
- kind: explainer
- logged: v1.17.0 (in progress) · 2026-10-01

Pro Tools corrects pitch through Melodyne; Auto-Tune's correction is the model. The pitch is tracked every 5 ms by YIN on a 16 kHz copy (60 to 1000 Hz, with voicing); each voiced frame's target is the nearest note of the Key and Scale (chromatic, major or minor); the correction glides to it with the Retune speed (0 snaps), is scaled by Amount, and glides back to none where unvoiced; rubberband applies it over time from a command file, a command only when the ratio moves by half a cent. Two faults were found on the way, both by measuring the applied shift every 100 ms rather than trusting the commands: 100 commands a second throughout, and then rubberband's default crisp transients, which reset phase inside held notes and left them wobbling over 40 to 100 cents; its consistency mode with smooth transients holds every note within about a cent, and Amount 0 now returns the input untouched instead of passing it through rubberband. Verified on four harmonic notes held 30 cents sharp, 40 flat, 20 sharp and 10 sharp (the tracker reading each within 0.4 Hz of the truth): chromatic at speed 0 they landed at -0.5, -0.0, -1.3 and -0.3 cents, by an FFT measurement independent of the tracker; in C major the out-of-scale C sharp went to D (-0.2 cents); Amount 50% left +14.7, -20.5, +9.4 and +4.3 against +15, -20, +10 and +5; with a 200 ms retune speed a note began near the previous note's correction and was on target (-1.3 cents) by its middle; lengths were kept. Stated: one pitch per moment (no chords), no drawn pitch curve or note editor, the formants move with the pitch, and the controls are numbers (Key 0 to 11, Scale 0 to 2) rather than named menus.

### app/services/effects.py · Dialogue contour, and the rubberband step shared with Pitch correction (RX-17)
- refers-to: app/services/effects.py :: `_dialogue_contour`, `_rubberband_pitch` (now used by `_pitch_correct` too), the `dialogue-contour` catalogue entry, chain and controls
- kind: explainer
- logged: v1.18.0 (in progress) · 2026-10-01

RX's Dialogue Contour reshapes a line's intonation. Between From and To (the whole clip when To is not after From), the pitch is tracked every 5 ms and its slow contour (voiced pitch smoothed over Smoothing ms, gaps bridged) is scaled about its median by Intonation range (0% flat, 100% as it was, 200% twice the movement); a ramp from Shift at start to Shift at end is added; the voice's small fast movements are kept, unvoiced moments follow the ramp, the shift eases in and out over 20 ms at the span's edges, and rubberband applies it with the formants kept where they were (formant=preserved); Range 100% with no shift returns the input untouched. Pitch correction's rubberband step became a helper both use, with the same behaviour. Verified on a spoken-style phrase of eight syllables with a 3-semitone intonation arc and fixed resonances at 700 and 1200 Hz, read by a harmonic-product instrument independent of the tracker and confined to the phrase's range (it matched the true contour within 4.3 cents; unconfined, and a plain FFT peak before it, it slipped octaves on the weak fundamental, which is why both were replaced before any result was kept): the syllables' spread of 85.3 cents became 9.6 at 0%, 43.4 at 50% and 167.7 at 200%, the median staying within 11.5 cents; a ramp to +3 semitones over the phrase put every syllable within 1 to 5 cents of its expected shift; a span left every syllable outside it unchanged; the neutral setting returned the input exactly; with formants kept, a 3-semitone rise moved the spectral centroid 9% where moving formants would move it 19%. Stated: a ramp and a range, not a drawn curve; steep ramps lead by about 60 ms (14 to 17 cents on 3 semitones over 1.15 s).

### app/routers/terminal.py, app/main.py · a real shell over a WebSocket for the embedded terminal (owner decision, Sprint D)
- refers-to: app/routers/terminal.py :: `terminal` (`/api/terminal`), `_allowed`; app/main.py :: the router mounted under /api
- kind: warning-context
- logged: v1.20.0 (in progress) · 2026-10-01

The owner asked for an embedded terminal that is real. The socket starts the user's own shell ($SHELL, else bash) as a login shell in a pseudo-terminal in the home directory, TERM set for xterm.js; browser bytes go to the PTY untouched, its output comes back as binary frames, and a JSON frame sets the window size; when the shell exits the socket closes, and when the socket closes the shell is hung up, waited for without blocking the engine and killed after a second if it ignores the hangup. A browser lets any page open a WebSocket to 127.0.0.1, which would hand a shell to any website, so the socket is accepted only from the app's own origins (the CORS list) and refused before a shell exists otherwise; FORMWAV_TERMINAL=0 turns it off. Verified with a WebSocket client: from the app's origin a resize to 100 by 30 read back as "30 100" from stty, tty answered /dev/pts/0, `echo formwav-$((6*7))` printed formwav-42, TERM was xterm-256color, `exit` closed the socket with 1000 and left no shell running; a foreign origin and a missing origin were both refused with 403. Stated: POSIX only (macOS and Linux); Windows needs ConPTY, not built yet; the shell runs as the user the engine runs as, with that user's rights.

### formwav_mcp/, app/services/media.py, app/routers/media.py, oc_install · formwav's MCP server (owner decision, Sprint D)
- refers-to: formwav_mcp/server.py :: the MCPServer, its 12 `formwav_*` tools and the `formwav_repair_workflow` prompt, `main` (stdio, or --http as stateless Streamable HTTP with JSON responses on 127.0.0.1:8061/mcp); formwav_mcp/requirements.txt (mcp 2.2.0, httpx); app/services/media.py :: `list_media`; app/routers/media.py :: `GET /api/media`; oc_install :: the MCP venv
- kind: warning-context
- logged: v1.21.0 (in progress) · 2026-10-01

The owner asked for an MCP server. Built to the mcp-dev-oracle pack's guidance for the protocol as it stands after the 2026-07-28 revision: stateless, media ids and session names as handles, every edit making new media so nothing is destructive, annotations on every tool (6 read-only), typed structured output (all 12 tools carry an output schema), no root-level schema combinators (the Claude API rejects them), errors returned in the result as what to do next, a strategy prompt, nothing on stdout but the protocol. It is a thin client over the running engine's HTTP API, so it shares the engine's media and saved sessions and keeps no state; the engine gained the one route an agent needed and the app never did, GET /api/media (stored media, newest first, a page at a time). Tools: status, list_media, analyze_media, list_effects, apply_effect, debleed, import_audio, export_media, list_sessions, get_session, render_session, transcribe_media. The MCP SDK 2.2.0 (MIT) needs Starlette 1.x and the engine's FastAPI 0.115 pins below 0.47, so installing it into the engine's venv broke that pin (caught by pip's check and undone: the engine's venv is back to its own pins with pip check clean); the server has its own venv, which oc_install now builds, and .gitignore already keeps every venv out of the repository. Verified with the SDK's own client over stdio and over Streamable HTTP: 12 tools, 6 read-only, 12 output schemas, no root combinators, the one prompt; status read engine 1.20.0 with 285 media and 5 sessions; a repair loop imported a reverberant file, measured it (peak -6.02 dB, RMS -20.02), found dereverb by searching "reverb", applied it (a new media, the source kept), measured the result (-8.55, -22.64) and exported 6 s of WAV; a saved session was read and rendered to MP3; a bad media id and a missing file came back as in-result errors naming the fix; over HTTP a request with a foreign Origin was refused with 403 (the SDK's protection on loopback) and one with no Origin, as local clients send, was served.

### formwav_mcp/serve, README.md · launching the MCP server from any directory, and how to connect an agent
- refers-to: formwav_mcp/serve; README.md :: the "Connect an agent (MCP)" section and FORMWAV_TERMINAL in Configuration
- kind: explainer
- logged: v1.21.0 (in progress) · 2026-10-01

`-m formwav_mcp.server` only imports with backend/ as the working directory, and MCP clients launch stdio servers from their own (Claude Code has no working-directory setting), so the README's first snippet would have failed; the launcher changes into backend/ and runs the server's venv, passing --http through. The README gives Claude Desktop's config and Claude Code's `claude mcp add` against it, and the HTTP endpoint. Verified: launched from / by the SDK's stdio client, 12 tools listed; with the engine stopped, formwav_status and formwav_get_session came back as in-result errors saying to start the engine; `serve --http` answered a raw tools/list with 12 tools.

### app/routers/agent.py, app/main.py · the in-app agent's model turn (owner decision, Sprint D: agent actions and controls)
- refers-to: app/routers/agent.py :: `agent_step` (`POST /api/agent/step`), `_post`; app/main.py :: the router under /api
- kind: warning-context
- logged: v1.22.0 (in progress) · 2026-10-01

The open session lives in the browser, so the browser runs the agent's loop; this route forwards one turn (system, messages, tools) to the Anthropic Messages API and returns the reply, so the API key stays in the engine (ANTHROPIC_API_KEY in backend/.env, which boot_backend sources) and never reaches the page. FORMWAV_AGENT_MODEL picks the model (claude-sonnet-5-5 by default), ANTHROPIC_BASE_URL points elsewhere; standard library in a worker thread, so no dependency. Verified: with no key the route answered 503 saying to put ANTHROPIC_API_KEY in backend/.env and restart; pointed at a recording stand-in of the Messages API (sidecar verification/anthropic_standin.py) with a dummy key, a run from the app sent three requests to /v1/messages carrying the engine's key, anthropic-version 2023-06-01, the model claude-sonnet-5-5 and the 16 tool definitions, the conversation growing 1, 3 and 5 messages. Stated: no real model was called (no key here); the first real run is the owner's.

### app/services/providers.py, app/routers/providers.py, app/main.py, local_models.example.json · the model-provider layer (owner decision, v1.20.0)
- refers-to: app/services/providers.py :: `providers`, `elevenlabs_voices`, `elevenlabs_speech`, `elevenlabs_sound`, `elevenlabs_dub_start`, `elevenlabs_dub_status`, `fal_generate`, `_audio_url`, `local_generate`, `local_models`, `ProviderError`; app/routers/providers.py :: `/api/providers*`; local_models.example.json
- kind: warning-context
- logged: v1.23.0 (in progress) · 2026-10-01

The owner asked for models both local (open weights such as ACE-Step) and in the cloud (ElevenLabs, fal). One registry: ElevenLabs (ELEVENLABS_API_KEY) for speech in a chosen voice, sound effects and dubbing, on the endpoints its documentation gives (checked on 2026-10-01: /v1/text-to-speech/{voice_id} with xi-api-key, /v1/voices, /v1/sound-generation, POST /v1/dubbing as multipart then GET /v1/dubbing/{id} and /audio/{lang}); fal (FAL_KEY) for any model through its queue (POST queue.fal.run/{model} with Authorization: Key, poll status_url to COMPLETED, read response_url), with ACE-Step 1.5 and two older ACE-Step endpoints as presets, the output's first audio URL downloaded; local models as command templates in backend/models/local_models.json (git-ignored, like the weights), {prompt}, {lyrics}, {duration} and {out} filled in, run with a time limit, the written file imported. Everything lands as media through the media service; keys stay in the engine; dubbing is a job (start, then poll until the media comes back); ELEVENLABS_BASE_URL and FAL_QUEUE_URL point the clients elsewhere. Standard library only. Verified through the engine against a recording stand-in (sidecar verification/provider_standin.py, a tone per endpoint) and a test command: voices listed; speech, a sound effect, a dub (two polls), an ACE-Step 1.5 song through fal's queue (two status reads) and a local model's output each imported with the stand-in's pitch for that endpoint (220, 330, 440, 550 and 660 Hz) and its length; the stand-in recorded the documented shapes (xi-api-key on every ElevenLabs call, the TTS body's text and model_id, the dub's multipart fields file, target_lang, source_lang and name, fal's Key header on submit and status but none on the public file URL); an unknown local model, a malformed fal id and empty speech text were refused with messages saying what to do. Stated: no provider was really called (no keys or weights here); the stand-in had a bug of its own (it parsed multipart field names wrongly and dropped the connection), fixed in the stand-in before the dub was measured; the ACE-Step entry in the example file is a template whose script and flags come from ACE-Step's own README.

### app/services/providers.py, app/routers/providers.py · regenerating words in their speaker's voice (DS-09)
- refers-to: app/services/providers.py :: `elevenlabs_clone`, `elevenlabs_regenerate`, `elevenlabs_speech` (its rate); app/routers/providers.py :: `POST /api/providers/elevenlabs/regenerate`
- kind: warning-context
- logged: v1.24.0 (in progress) · 2026-10-01

A range of a media, in its own seconds, is spoken again as new text in the speaker's voice: the voice is cloned once per media from its first 90 s (16-bit mono WAV, under ElevenLabs' 10 MB per file; POST /v1/voices/add as multipart name and files, checked against ElevenLabs' reference on 2026-10-01) and remembered in the media store's voices.json; the speech is imported at the source's rate; the splice keeps the source before and after exactly and joins with 10 ms equal-power crossfades; the answer gives the new media and how many frames longer it is, for the caller to ripple. _wav_view reads 16-bit sources through a wrapper that already scales to float, which the first version wrongly tested for a dtype (an AttributeError on the first try, from the engine's log). Verified against the recording stand-in on a 3.0 s phrase, 0.6 to 1.2 s replaced by 2.0 s of speech: the new media 4.38 s exactly, 1.38 s longer; the audio before and after the range identical to the original; the middle at the stand-in's 219.8 Hz; the largest sample step at the joins 0.113 and 0.111 against the source's own 0.117; the voice cloned once (fields files, name, remove_background_noise) and reused; under 50 ms and empty text refused. Stated: no real voice was cloned (no key); a real clone's likeness is the owner's to judge.

### app/core/security.py, app/main.py, app/routers/terminal.py, formwav_mcp/server.py · the loopback lockdown, and the interface served from the engine (desktop groundwork)
- refers-to: app/core/security.py :: `LocalOnly`, `LOCAL_HEADER`; app/main.py :: the middleware and the FORMWAV_DIST static mount; app/routers/terminal.py :: `_allowed` (the engine's own origin); formwav_mcp/server.py :: `_call` (the header)
- kind: warning-context
- logged: v1.25.0 (in progress) · 2026-10-01

Following the tauri-compiler skill's local API security, before the engine ships inside a desktop app (where it runs whenever the app is open): CORS stops a foreign page reading answers but not sending simple requests, so any site the user opened could have posted edits and renders to the engine. One ASGI middleware now refuses, with a 403 and a reason, a non-loopback client, a Host that is not loopback (DNS rebinding), and any POST, PUT, PATCH or DELETE under /api without `x-formwav-local: 1` (a header a foreign page cannot send without a preflight the engine never grants), and adds nosniff to every answer; the app adds the header through one fetch wrapper, the MCP server in its one request function, and the sidecar's direct-HTTP harnesses through a sitecustomize. With FORMWAV_DIST set (the desktop entry sets it) the engine also serves the built interface at /, after every API route, so page and API are one origin; the terminal therefore also accepts the engine's own origin, which no other site can present once the Host is held to loopback. Verified on a fresh engine: health 200 with nosniff; Host evil.example 403; a POST without the header 403, with it 201, and a cross-site text/plain POST (what a form can send) 403; a second engine with FORMWAV_DIST served index.html (title formwav) at / and the API beside it; the terminal answered the dev origin and the engine's own and refused a foreign one with 403; the MCP server applied an effect through it; a direct-HTTP harness was refused without the header and ran its 97-effect catalogue with it; the record and play browser harnesses passed.

### desktop_entry.py, requirements_desktop.txt · the engine as the desktop app's sidecar
- refers-to: desktop_entry.py :: `main`, `selfcheck`, `user_data_dir`, `load_env`, `resource_dir`; requirements_desktop.txt; ../build_macos_app
- kind: warning-context
- logged: v1.25.0 (in progress) · 2026-10-01

From the tauri-compiler skill's engine entry: `--selfcheck` prints one JSON line (Python, FastAPI, uvicorn, numpy, the native core, formwav's version, whether the interface is embedded, the data folder, whether ffmpeg is on PATH) and exits; otherwise uvicorn on 127.0.0.1 at FORMWAV_PORT (0 by default, so the OS picks and the bind line tells the shell). Added for formwav: a onefile binary unpacks into a temporary folder that is deleted on exit, and the engine's data folder defaulted to one beside its code, so media, sessions and transcripts would have vanished on quit; the entry now sets FORMWAV_DATA_DIR to the per-user folder (~/Library/Application Support/ai.nodemode.formwav on macOS, %APPDATA% on Windows, XDG data on Linux) and reads keys from a .env there. The desktop engine is the core (FastAPI, uvicorn, numpy, the native core): torch and the optional models are imported lazily by their features and stay out, which keeps the binary at 38.9 MB here. Verified by freezing it in a throwaway venv here (PyInstaller 6.22.3, 29 s, a Linux binary; macOS binaries come from macOS): the selfcheck read every core part and the embedded interface; started with FORMWAV_PORT=0 it printed its bind line with port 44299; the interface answered at / and the API beside it; the lockdown held inside it (a hostile Host and a header-less change both 403); a tone generated and normalized through the native core inside the binary, both files written to the user data folder, not the unpack folder.

### app/services/projects.py, app/routers/projects.py · opening a .fmw from anywhere on the machine (the desktop app's file association)
- refers-to: app/services/projects.py :: `open_file`; app/routers/projects.py :: `POST /api/projects/open-file`
- kind: explainer
- logged: v1.25.0 (in progress) · 2026-10-01

A session file the user opens with the desktop app reaches the page as ?open=<path>; the engine checks it is a readable formwav session, copies it into the sessions under its own name (or "name (2)" and on when a different session already has it; the same file again reuses its copy), and opens it like any saved session. Verified: an exported session opened from /tmp/outside as "My Take" with its 2 tracks, again without a duplicate, a different file of the same name as "My Take (2)"; a .wav, a missing path and a damaged file refused with what to do.

### desktop_entry.py · the engine ends with its shell, however the shell ends
- refers-to: desktop_entry.py :: `exit_with_shell` in `main` (FORMWAV_EXIT_WITH_STDIN)
- kind: warning-context
- logged: v1.25.0 (in progress) · 2026-10-01

Running the real shell under a virtual display found the engine orphaned when the window closed: both onefile processes lived on. Two causes compound: the shell's exit handler may not run when the window is destroyed or the shell crashes, and its kill is SIGKILL, which a PyInstaller onefile bootloader cannot pass to its Python child, so even a clean quit would orphan the server. The shell now sets FORMWAV_EXIT_WITH_STDIN=1 and the engine ends when its stdin, a pipe whose write end only the shell holds, reaches end-of-file, which happens however the shell ends. Opt-in, so the engine run on its own (the build script's selfcheck, the tests) is unaffected. Verified under Xvfb with the real shell: closing the window left no engine process; SIGKILL of the shell (no exit handler can run) left none within 4 s; the frozen engine without the flag and with stdin at /dev/null stayed up and healthy.

### spikes/host · spike B, plugin hosting: the CLAP half (owner decision, Sprint D)
- refers-to: spikes/host/src/main.rs :: `run_clap`, `report`; spikes/host/fixtures/clap-gain (a test plugin)
- kind: explainer
- logged: v1.26.0 (in progress) · 2026-10-02

Spike B asks whether formwav's native side can host plugins: load one CLAP and one VST3, process a buffer, open an editor. `fwhost` is a Rust host on clap-sys 0.5 (MIT or Apache-2.0) and, for the VST3 half, vst3 0.3 (MIT or Apache-2.0, bindings generated from the VST3 SDK 3.8 now that it is MIT, so no SDK download). Its CLAP path loads the binary, takes clap_entry and the plugin factory, creates the first plugin with a host it can call back, reads its audio ports, activates it at 48 kHz, starts processing, runs 100 ms of a 1 kHz sine at -12 dBFS through it on both channels, stops, deactivates, destroys and deinitialises in CLAP's order, and prints what it measured. The fixture is a minimal CLAP plugin of known behaviour (stereo in and out, x0.5). Verified: the fixture loaded as "formwav test gain", one plugin in the file, one port in and one out, processed, input -15.01 dB RMS, output -21.03, gain -6.02 dB, exactly x0.5; a file that is not a plugin was refused ("invalid ELF header").

### spikes/host/src/main.rs · ten blocks, and a real third-party CLAP plugin hosted
- refers-to: spikes/host/src/main.rs :: `run_clap` (the block loop), `BLOCKS`
- kind: explainer
- logged: v1.26.0 (in progress) · 2026-10-02

A real plugin was hosted next: Airwindows Consolidated, the 2026-09-19 Linux build of its DAWPlugin release, a 22 MB JUCE CLAP, downloaded to /tmp only and checked against the release's published SHA-256 (ca6ad0e4...). Its code is MIT but the binary, combined with JUCE and the VST3 SDK, is GPL-3.0, so it is a test subject that never enters the repository or the bundle. One 100 ms block read -42.11 dB, which looked like a fault and was the plugin ramping its parameters in from zero; the host now runs ten consecutive blocks with the clock advancing, as a DAW would, and reports the first beside the settled last. Verified: the fixture -6.02 dB on the first block and the last; Airwindows Consolidated loaded (com.airwindows.consolidated, one plugin, a stereo port in and out), -57.12 dB in the first block and a settled -11.02 dB by the tenth, its default effect's gain on this tone.

### spikes/host/src/main.rs · the VST3 half: a real VST3 plugin hosted
- refers-to: spikes/host/src/main.rs :: `run_vst3`, `vst3_binary`, `HostApplication`, `blocks` (FWHOST_BLOCKS)
- kind: explainer
- logged: v1.26.0 (in progress) · 2026-10-02

The VST3 path on vst3 0.3 (bindings generated from the MIT VST3 SDK 3.8, nothing to download): the bundle's Linux binary is found (Contents/<arch>-linux/*.so), opened, entered through ModuleEntry with its library handle as Linux VST3 requires, its factory taken from GetPluginFactory, the first "Audio Module Class" chosen, the component created and initialised with a host context (a minimal IHostApplication written in Rust through ComWrapper), cast to IAudioProcessor, set to stereo in and out with both main buses active, set up for 48 kHz 32-bit realtime, activated, run for the same consecutive blocks as the CLAP path, then stopped, deactivated, terminated, released and the module exited. Verified on Airwindows Consolidated's VST3 build (the same checked download): three classes in the factory, the audio effect found, one bus in and one out, processed, the same first-block ramp from -57.12 dB as its CLAP build. Its settled level is not a fixed number in either format (VST3 -8.83, -5.60 and -8.12 dB after 1, 3 and 10 s; CLAP -11.02, -6.58 and -10.74; and a repeat of the 1 s VST3 run read -9.61): the default effect varies over time and Airwindows seeds its dither at random, so the formats are not compared on it; the deterministic fixture held -6.02 dB over 100 blocks. FWHOST_BLOCKS sets the number of blocks (10 by default).

### spikes/host · the CLAP editor: a real plugin's editor embedded and driven by the host's run loop
- refers-to: spikes/host/src/main.rs :: `run_clap_gui`, `host_get_extension` (timer-support, posix-fd-support, gui), `TIMERS`, `FDS`; Cargo.toml :: x11rb 0.13 and libc 0.2 (MIT or Apache-2.0)
- kind: warning-context
- logged: v1.26.0 (in progress) · 2026-10-02

On Linux a plugin editor draws from timers and from its X11 connection's descriptor, which the host must drive, so the host now offers CLAP's timer-support and posix-fd-support extensions (and host-gui callbacks), creates the parent X11 window itself (x11rb), and `fwhost clap-gui` creates, sizes, parents and shows the editor, then runs a real loop: poll() on the plugin's descriptors with on_fd for each ready one, due timers fired with on_timer, the window's own events drained; then hide, destroy and the usual teardown. Verified under Xvfb: the fixture, which has no editor, refused cleanly; Airwindows Consolidated's editor first killed the process with an X error (BadAtom, ChangeProperty, atom 0): JUCE looks up window-manager atoms only if they exist, and a bare Xvfb has no window manager to create them, so with Openbox running as any desktop would, the editor opened at 600 by 600 in the host's window, shown, registering one timer and two descriptors, and the loop made 362 timer calls and 1324 descriptor calls in 8 s before a clean teardown; the screenshot shows the live editor with its default effect, Galactic, a feedback reverb whose detune pitch-shifts both channels, which explains the level that moved from run to run in the VST3 entry above.

### spikes/host · the VST3 editor: a real plugin's view attached to the host's window, its run loop driven
- refers-to: spikes/host/src/main.rs :: `run_vst3_gui`, `EditorFrame` (IPlugFrame and Linux IRunLoop)
- kind: warning-context
- logged: v1.26.0 (in progress) · 2026-10-02

The VST3 editor needs more host than processing: the edit controller (Airwindows Consolidated, like any JUCE plugin, has a separate controller class, created from getControllerClassId, initialised with the host context, and connected to the component through IConnectionPoint, without which a JUCE controller has no processor and makes no view); createView("editor"), X11EmbedWindowID checked; an IPlugFrame, here a Rust COM class that is also Steinberg::Linux::IRunLoop, which the view queries to register its descriptors and timers; attached to an X11 window the host made from getSize; a loop calling onFDIsSet for ready descriptors and onTimer for due timers; then removed, the frame cleared, disconnected, terminated and the module exited. Verified under Xvfb with Openbox: the view attached at 600 by 600 with a separate controller, registered two descriptors (no timers at the end of the run: JUCE's VST3 wrapper on Linux runs off its descriptors), and the loop made 1314 descriptor calls in 8 s before a clean teardown; the screenshot shows the live editor, the same Galactic interface as through CLAP. Spike B's question is answered on Linux: formwav's native side can load, set up, process and show the editor of a real third-party plugin in both formats.

### spikes/audio · native audio output through cpal, formwav's own mixer in the callback (owner decision v1.19.0)
- refers-to: spikes/audio/src/main.rs :: `list`, `play`; spikes/audio/Cargo.toml (cpal 0.18, formwav-dsp by path, the opt-in `asio` feature)
- kind: warning-context
- logged: v1.27.0 (in progress) · 2026-10-02

The owner chose native I/O through a permissive library with ASIO opt-in. cpal 0.18.2 (Apache-2.0, checked on crates.io: hosts for ALSA, PipeWire, PulseAudio, JACK, CoreAudio, WASAPI, ASIO and a null host; ASIO only through its `asio` feature and asio-sys on Windows) opens the device, and formwav-dsp's Player, the mixer the browser runs as WebAssembly, renders into its callback: `fwaudio list` names hosts and output devices, `fwaudio play` plays a looped 1 kHz clip through the Player and reports callbacks, frames per callback, the gaps between them, the render time against its budget and stream errors. The `asio` feature maps to cpal/asio, needs Steinberg's SDK at build time, and is not built here (Windows only). Verified in the container (ALSA, no sound card): the only device is ALSA's null device (48 kHz, stereo, f32); 3 s through it gave 83130 callbacks of 240 frames (a 5 ms budget each), the Player's render 0.035 ms on average and 0.44 ms at most in a debug build, no stream errors, and the stream's peak 0.2500, the tone's -12 dBFS exactly; the default device was refused as unavailable. The null device takes samples as fast as they come (about 139 times real time), so the gaps say nothing about real-time behaviour: callback regularity, underruns and the latency on real interfaces are the owner's to run (`fwaudio play 10` on each machine).

### native/formwav-host, app/services/plugins.py, effects.py, routers/media.py · third-party plugins as effects (PT-23, AU-27, RX-35)
- refers-to: native/formwav-host (spike B's host, moved from spikes/host) :: src/offline.rs `scan`, `process`, `default_dirs`, `clap_binary`; src/wav.rs `read`, `write`; src/main.rs `scan` and `process` subcommands; app/services/plugins.py :: `host_binary`, `scan`, `catalogue_group`, `apply`; app/services/effects.py :: `catalogue`, `apply` (the plugin branch); app/routers/media.py :: `GET /api/plugins`
- kind: warning-context
- logged: v1.28.0 (in progress) · 2026-10-02

Plugins run in their own process, never inside the engine or the native core: third-party plugins crash, and a crash must cost one job, not the session; and the desktop's playback is still the webview, so the first use is offline, a plugin applied to a clip or a range into new media, as Audacity applies its effects. Spike B's host became native/formwav-host (a git move) and gained `scan` (the system's plugin folders: ~/.clap, /usr/lib/clap, ~/.vst3 and the like on Linux; ~/Library and /Library/Audio/Plug-Ins/CLAP and VST3 on macOS; the Common Files folders on Windows; then FORMWAV_PLUGIN_PATH; bundles resolved to their binary) and `process` (a WAV through the first audio effect of a CLAP or VST3, 512-frame blocks with the clock advancing, VST3 in offline mode, an optional silent tail, written as float WAV). The engine lists the scan as the catalogue's "Plugins" group, `plugin:<format>:<path>` with one control (Tail, seconds), so the Inspector, ranges, the agent and the MCP server reach plugins as they reach any effect; it loads only a plugin the scan found, since loading a library runs its code. Verified: the host scanned a test folder (the fixture CLAP, Airwindows Consolidated as CLAP and VST3); processed a real 3 s phrase through the fixture bit-exactly x0.5 on both sides, and through Airwindows in both formats with a 2 s tail (the reverb ringing out, every sample finite, the formats within 0.1 dB); through the engine, GET /api/plugins and the catalogue listed the three, the fixture applied as an effect gave exactly 0.5 times the source, Airwindows' VST3 with a 2 s tail gave the source's length plus 2 s, and libc.so.6, not found by the scan, was refused with a 422. A first check read the output wrongly (a quick reader mistook the source's extensible float format for 16-bit PCM); the host's reader was right, and the check was corrected. Stated: plugin latency is not compensated yet (a lookahead plugin would shift its output), no parameters beyond the tail (AU-29's generated controls are next), and the desktop app does not yet bundle the host.

### requirements.txt, requirements_macos.txt · numpy, missing since it became a core dependency (owner's crash report)
- refers-to: requirements.txt, requirements_macos.txt
- kind: warning-context
- logged: v1.28.0 (in progress) · 2026-10-02

The owner's engine died at start on macOS with ModuleNotFoundError: numpy. Six core services import numpy at load (audacity, eqmatch, key, library, samaudio, tempo), and neither requirement file listed it; the build container's venv had numpy from other installs, so no test here could see it. Both files now list it (pinned 2.5.2 in requirements.txt, unpinned in requirements_macos.txt). soundfile is imported at load only by the optional voice runtime, which main.py guards. Verified from scratch: a new venv from the previous requirements.txt reproduced the owner's error exactly; new venvs from both corrected files import the engine; and the engine run from the macOS file's unpinned install (FastAPI 0.142.2, Starlette 1.7.0, uvicorn 0.54.0, newer than the pinned set by a Starlette major version) answered /api/health, /api/effects, /api/projects, /api/media, /api/plugins and /api/providers with 200 and held the lockdown (a change without the header 403). The release gate now builds these venvs fresh rather than trusting the dev venv.

### native/formwav-host/src/offline.rs, fixtures/clap-gain · plugin latency compensation
- refers-to: native/formwav-host/src/offline.rs :: `clap_process`, `vst3_process` (the latency read, the padded input, the scratch output); fixtures/clap-gain/src/lib.rs :: FORMWAV_TEST_LATENCY, the delay lines, the latency extension
- kind: warning-context
- logged: v1.28.0 (in progress) · 2026-10-02

A plugin that reports latency (lookahead limiters, linear-phase filters) outputs that much later, so an applied plugin shifted the audio out of line with the rest of the session. The host now reads the latency after the plugin starts (CLAP's latency extension; VST3's getLatencySamples once processing is on), runs that many frames of silence past the end, and takes the output from that point. The test fixture gained an opt-in declared latency (FORMWAV_TEST_LATENCY=n delays its output by n and reports n; unset it has none, so every earlier check of it still holds). Verified: the fixture really delays (the uncompensated diagnostic's first 4800-frame block read -21.09 dB RMS with 64 samples of latency against -21.03 without, the predicted difference of 64 silent samples); the compensated output with latency 64 and with none was, both times, exactly 0.5 times the input, sample for sample at full length. A first run passed falsely: the fixture had failed to compile, so the old fixture (no latency) was tested; the build is now checked before any result is read, and the delay itself was measured before the alignment was trusted.

### oc_install, build_macos_app, src-tauri, native/formwav-host · the plugin host shipped: dev mode and the desktop app
- refers-to: backend/oc_install (cargo build --release of native/formwav-host); build_macos_app (builds fwhost, places binaries/fwhost-<triple>); src-tauri/tauri.conf.json (externalBin gains binaries/fwhost); src-tauri/src/main.rs (FORMWAV_HOST_BIN, beside the executable, given to the engine); native/formwav-host/src/main.rs :: `vst3_binary` (macOS's Contents/MacOS)
- kind: warning-context
- logged: v1.28.0 (in progress) · 2026-10-02

The engine finds the plugin host through FORMWAV_HOST_BIN or the repository's build; neither existed on the owner's machine. oc_install now builds it after the native core (Rust is already required there), and the desktop app bundles it as a second sidecar: Tauri places bundled binaries beside the app's executable (Contents/MacOS on macOS), so the shell passes that path to the engine. Verified: the host's release build; the shell's locked cargo check with both sidecars declared; both scripts parse; with the repository's build moved aside, an engine given only FORMWAV_HOST_BIN (a copy in a directory of its own) listed the three test plugins and applied the fixture. Stated, not done: VST3 on macOS. vst3_binary now finds the binary in Contents/MacOS so a scan lists such plugins, but macOS VST3 modules expect bundleEntry with a CFBundleRef before their factory, which fwhost does not yet call; CLAP plugins on macOS need nothing more (clap_binary already resolves the bundle). fwhost uses libloading's unix module, so it does not build on Windows yet. During the test a pgrep in the same command as an engine start matched that command's own shell and killed it, leaving the host's build moved aside; it was restored, and engine starts and process matches now run in separate commands.

### native/formwav-host/src/params.rs, offline.rs, main.rs · plugin parameters listed and carried into processing (AU-29, host side); a plugin on a range (RX-35)
- refers-to: native/formwav-host/src/params.rs :: `list`, `to_json`, `parse_values`, `ClapEvents`, `Vst3Changes`, `Vst3Queue`; offline.rs :: `process(.., values)`, the CLAP input events and the VST3 inputParameterChanges, both in the first block only; main.rs :: `fwhost params <format> <plugin>`, `fwhost process .. [tail] [values]`
- kind: warning-context
- logged: v1.29.0 (in progress) · 2026-10-02

For generated controls (a plugin with no interface of its own gets formwav's), the host lists a plugin's parameters (CLAP's params extension; VST3's edit controller, which for JUCE plugins must first be connected to the component through IConnectionPoint or it reports none) leaving out hidden, read-only and VST3 bypass parameters, VST3 values normalized 0 to 1 as VST3 defines them; and `process` takes chosen values as a flat {"id": value} object, delivered at sample 0 of the first block (CLAP param-value events; VST3 IParameterChanges with one single-point queue per value, two small COM classes). Verified on Airwindows Consolidated: CLAP listed 14 parameters (Replace, Brightness, Detune, Bigness, Dry/Wet, then unused slots), VST3 13 once connected (none before); its default effect differed from the dry input by +0.6 dB relative (a different signal, the reverb), and with Dry/Wet sent as 0 by -143.7 dB relative (the input exactly, but for Airwindows' floating-point dither), identically in both formats. The fixture, which has no parameters, lists none. Also verified this turn (RX-35): a plugin applied to a 1 s range inside a 3 s clip from the Inspector split the clip into the original before, the plugin's output from 1 s to 2 s (sourceIn 48000, so aligned), and the original after.

### app/services/plugins.py, routers/media.py · a plugin's parameters as controls, and its chosen values applied (AU-29, engine side)
- refers-to: app/services/plugins.py :: `_installed`, `params`, `apply` (values); app/routers/media.py :: `GET /api/plugins/params?name=`
- kind: warning-context
- logged: v1.29.0 (in progress) · 2026-10-02

A plugin's parameters become effect controls (ids p<id>, beside Tail, at most 64, stepped parameters given a step), listed by the host the first time they are asked for and kept, never during a scan (that would instantiate every installed plugin before the catalogue could load); applying passes the chosen p<id> values to the host. The guard that only a scanned plugin is ever loaded is one function now, used by both. Verified through the engine on Airwindows Consolidated: CLAP 14 controls and VST3 13, named as the plugin names them; applied at the default the output differed from the source by +0.6 and +0.7 dB relative (the reverb), and with its Dry/Wet control at 0 by -143.7 dB (the source, but for the plugin's dither), in both formats; an unscanned library refused with 404. Found on the way: the engine prefers the host's release build, which was stale (built before `params` existed) and answered with an error, which the first version cached as an empty list, so a plugin's controls would have stayed missing until a restart; a failed listing is no longer kept, and the release build was rebuilt.

### native/formwav-host/src/mac.rs, offline.rs · VST3 on macOS: the module loaded as a bundle (bundleEntry)
- refers-to: native/formwav-host/src/mac.rs :: `Bundle` (CFBundleCreate, CFBundleLoadExecutable, CFBundleGetFunctionPointerForName, CFRelease); offline.rs :: `Vst3Module`, the macOS `vst3_open` and `vst3_close`; main.rs :: `mod mac` (macOS only)
- kind: warning-context
- logged: v1.29.0 (in progress) · 2026-10-02

macOS VST3 modules are bundles that expect bundleEntry with their CFBundleRef before GetPluginFactory, which fwhost did not call, so VST3 plugins listed on the owner's Mac but could not load. On macOS the module is now loaded the way the VST3 SDK's Mac module loads it: the CFBundle created from the .vst3 path and its executable loaded, bundleEntry called with the bundle, the factory taken, and bundleExit called and the bundle released on the way out; CoreFoundation's few functions are declared in mac.rs (a system framework, no new crate). A per-system Vst3Module type keeps the Linux path exactly as tested and leaves the parameter and processing code unchanged. Verified as far as this container allows: Rust's macOS target installed and `cargo check --target x86_64-apple-darwin` passes with no warnings (the macOS code type-checks against its own declarations); the Linux build is unchanged in behaviour (Airwindows Consolidated's VST3 still lists 13 parameters and still renders dry within -143.7 dB with Dry/Wet at 0). Not verified: running it. Type-checking proves the code compiles for macOS, not that a real plugin loads; the first run on the owner's Mac is the test (a VST3 in ~/Library/Audio/Plug-Ins/VST3 appearing under Plugins and applying to a clip).

### native/formwav-dsp/src/native.rs, python.rs · native audio output in the core (feature "native"), driven by the worklet's messages
- refers-to: native/formwav-dsp/src/native.rs :: `NativeOutput` (open, load_source, set_mix, seek, set_loop, play, stop, report), `devices`; src/python.rs :: the `NativeOutput` class (load_wav, set_mix, transport, report, close, devices); Cargo.toml :: the `native` feature (cpal 0.18, serde, serde_json, all optional); pyproject.toml :: maturin builds with python and native
- kind: warning-context
- logged: v1.30.0 (in progress) · 2026-10-02

Native output lives in the engine's native module, not in the Tauri shell: one implementation then serves dev mode (browser and engine) and the desktop app (the frozen engine), and the interface reaches it the way it reaches the engine. It runs formwav's own Player, the mixer the browser runs as WebAssembly, configured by the worklet's "clips" message (parsed in Rust with serde, one mapping from message to mixer) and reporting the worklet's "position" message with the same keys, so the interface can drive either alike. The cpal stream lives on its own thread (it may not move between threads on CoreAudio); the Python object holds the shared mixer state and a stop channel; the audio callback never waits (try_lock, a block of silence if the state is being changed) and stops at the mix's end. Sources load from WAV bytes through the core's own decoder, the engine's media being WAV. The wasm build carries none of it (the feature is off there). Verified: the core type-checks with python and native and still builds for wasm32 without features; the default maturin build now carries NativeOutput (the first attempt passed --features native, which maturin used instead of the pyproject's features, not in addition); from Python on ALSA's null device it listed the device, opened at 48 kHz, loaded the phrase from its WAV bytes, took a one-clip mix in the worklet's format, sat at 0 before play, ran to the end and stopped itself, and reported a peak of 0.6286, the phrase file's own peak exactly; a malformed mix, a closed output and an unknown device were refused with messages; the core's tests pass locked. Not yet: the engine's service and WebSocket, the interface's native mode, speed and the time track (the worklet's), and pacing, which the null device cannot show. Linux builds now need ALSA's development files (libasound2-dev) for the engine's module; macOS and Windows need nothing extra.

### app/routers/native_audio.py, core/security.py, routers/terminal.py · native output over a WebSocket speaking the worklet's protocol
- refers-to: app/routers/native_audio.py :: `GET /api/audio/devices`, `WS /api/audio/native`; app/core/security.py :: `ws_allowed` (moved from the terminal router); app/routers/terminal.py :: `_allowed` now delegates to it; app/main.py :: the router included
- kind: warning-context
- logged: v1.30.0 (in progress) · 2026-10-02

The engine serves the core's NativeOutput over a WebSocket that speaks the worklet's protocol, so the interface can drive native output with the messages it already sends the worklet and read back the worklet's own position report (about 30 a second). "open" picks the device and rate (one output per connection, stopped and closed when the connection ends, so a closed tab never holds the device); "source" names a media id and the engine reads its own store (skipping a source number already holding that media; decoded off the event loop). Speed other than 1x is refused with a reason (it stays the worklet's). The WebSocket origin check, which guards the terminal too, is now one function in the security module rather than a private copy per router. Verified with a websockets client: a hostile origin refused at the handshake; play before open refused; the null device opened at 48 kHz and reported ready; the phrase loaded by media id; an invalid media id refused with its reason; the worklet-format mix played to the end in reports carrying the worklet's keys, peak 0.6286 (the file's own); speed 2x refused with a reason; the terminal still accepted the dev origin after the refactor. Asking for the default device failed here, as this container has no default output; that is the case on the owner's machine that should simply work.

### native/formwav-dsp/src/synth.rs, app/services/midi.py, app/routers/midi.py · note tracks' foundation: the built-in instrument and MIDI files (AU-37, PT-14)
- refers-to: native/formwav-dsp/src/synth.rs :: `render`, `Patch`, `Note`, `Wave`, `hz`, its three tests; src/python.rs :: `render_notes`; app/services/midi.py :: `read` (SMF formats 0 and 1); app/routers/midi.py :: `POST /api/midi/import`, `POST /api/midi/render`; app/main.py
- kind: warning-context
- logged: v1.31.0 (in progress) · 2026-10-02

Phase 8 begins with note tracks that play through the mixer unchanged: a note clip's notes stay the truth in the document, and the built-in instrument renders them into media the mixer plays like any audio (browser and native output alike), rendered again after an edit; realtime synthesis in the mixer, needed for live input and instrument plugins, comes later. The instrument is a polyphonic synthesizer in the core: per note an oscillator (sine, triangle, or saw and square band-limited with polyBLEP) under an ADSR envelope, scaled by velocity, equal temperament with A4 at 440 Hz, the release running past each note. The engine reads Standard MIDI Files (formats 0 and 1) written from the format itself: running status, fixed channel message lengths, meta and SysEx skipped by length, the tempo map turning ticks into seconds, note-on at velocity 0 as note-off, overlapping repeats of a pitch closed first in, first out, SMPTE division refused with its reason. Verified: the core's 11 tests pass (the synth's: A4 measures 440 Hz, the release sounds past the note and ends silent, velocity 64 is 64/127 of full level) and the wasm build is unaffected; from Python a saw A4's strongest partial is 440.0 Hz and an unknown waveform is refused; a MIDI file built by hand (a tempo change from 120 to 60 BPM, running status, a velocity-0 note-off, a text meta event and a SysEx) imported through the engine as A4 at 0 s for 0.5 s, C5 at 0.5 s for 0.5 s and E5 at 3.0 s for 1.0 s with their velocities, rendered to 4.2 s of stereo media whose strongest partials at those times are 440.0, 523.3 and 660.0 Hz; a non-MIDI file refused (422). Next: note tracks in the interface (import, drawing the notes, playing), then the piano-roll editor.

### app/services/tools.py, effects.py, routers/media.py · tone waveforms and amplitude (AU-B05); Normalize's DC and per-channel options (AU-B11)
- refers-to: app/services/tools.py :: `_tone`, `WAVEFORMS`, `generate` (waveform, amplitude); app/routers/media.py :: `POST /api/generate` (waveform, amplitude); app/services/effects.py :: `_peak_normalize` (a numpy effect now), the peak-normalize controls (dc, independent), `_values` and `_controls` accepting a step after the unit; frontend src/ui/media-pane.ts :: Wave and Level for a tone
- kind: explainer
- logged: v1.34.0 (in progress) · 2026-10-02

AU-B05's gap: the tone was ffmpeg's sine at a fixed level. It is now sine, square, sawtooth or triangle at an amplitude from 0 to 1, the non-sine waves band-limited: one cycle summed from the harmonics below Nyquist (square odd at 1/n, sawtooth all at 1/n, triangle odd at 1/n squared alternating), scaled to its peak and read by phase, so a high tone has no aliases at any length. AU-B11's gap: Audacity's Normalize removes DC offset and can normalize stereo channels independently; Peak normalize is now a numpy effect doing both on request (each channel's mean subtracted; the peak to the target together, balance kept, or each channel on its own), the old ffmpeg special case removed as unreachable, and its two options 0-or-1 controls with a whole step. Verified through the engine: at 1 kHz the square's harmonics 1 to 5 read 1, 0, 0.333, 0, 0.2, the sawtooth's 1, 0.5, 0.333, 0.25, 0.2, the triangle's 1, 0, 0.111, 0, 0.04, each peak exactly the amplitude asked (0.5; a sine at 0.25 peaked at 0.25); a 7 kHz square held its 7 and 21 kHz harmonics with no other energy above -143.4 dB (no aliasing); an unknown waveform refused; on a stereo clip with +0.2 DC on the left and the right at half level, normalizing to -1 dBFS together kept the balance (-1.00 and -11.46) and the DC, Remove DC brought both means to 0.0000 (-1.00 and -7.02), and Remove DC with Each channel gave -1.00 on both; the catalogue gives dc and independent a step of 1; the audits clean before committing.

### app/routers/render.py, frontend src/ui/export.ts · each platform's loudness normalization in the streaming preview (RX-44)
- refers-to: app/routers/render.py :: `PLATFORMS`, `_platform_gain`, the preview branch (platform); frontend src/ui/export.ts :: the Platform loudness menu and its notice
- kind: warning-context
- logged: v1.34.0 (in progress) · 2026-10-02

The streaming preview encoded and decoded the mix but did not play it at the level a platform would. A chosen platform now measures the decoded preview (ffmpeg's ebur128 with true peak) and applies that platform's gain: Spotify (Normal), from its own support article, -14 LUFS (ITU-R BS.1770), louder masters turned down and softer ones lifted only until their true peak reaches -1 dBTP (its example: -20 LUFS at -5 dBTP lifted to -16); YouTube, -14 LUFS, turned down only, never lifted (several independent sources agree); Apple Music (Sound Check), -16 LUFS, which sources disagree on lifting, so it is modelled as turning down only and the menu says so. The response and notice report the measured loudness, true peak and gain. Verified through the render route with MP3 previews, each result re-measured independently with ebur128: a -6 LUFS mix played at -14.0 LUFS for Spotify and YouTube (-8.00 dB) and -16.0 for Apple Music (-10.00 dB); a -29.5 LUFS mix with clicks at -1.7 dBTP (the codec had lifted them from -2) was lifted by Spotify only +0.70 dB, its true peak landing at -1.0 dBTP exactly, and left alone by YouTube and Apple Music; the audits clean before committing.

### app/services/effects.py · Paulstretch at any factor with a time resolution (AU-B13); Center extract and remove with an amount (RX-04)
- refers-to: app/services/effects.py :: `_paulstretch` (a numpy effect), its PARAMS (factor, resolution), its chain entry, RETIMING, the catalogue; PARAMS for center-extract and center-remove (amount)
- kind: explainer
- logged: v1.37.0 (in progress) · 2026-10-02

Extreme stretch ran rubberband at 1.5 to 10 times, which keeps transients and has no time resolution; Paulstretch is now its own effect, written from the published algorithm (Nasca's; no code taken): windows of `resolution` seconds read at 1/factor of the output's pace, magnitudes kept and phases randomised with one set shared by all channels, overlap-added at a quarter window with Hann windows, normalised for the overlap and to the source's level, seeded so the same input gives the same output, output kept under ten minutes; factors run from 1 to 100 and the resolution from 0.02 to 2 s. Center extract and remove gained an amount, the processed channels blended with the untouched ones, 100% being the fixed chain each replaced. Verified through the engine: a 2 s 440 Hz sine stretched 8 times stored exactly 768000 frames whose strongest partial is 440.2 Hz and whose RMS equals the source's (0.2121); two runs identical; 1 time kept the length; a 50 ms burst stretched 4 times kept 100% of its energy within 0.25 s of its centre at a 0.05 s resolution and 21% at 1 s (the smearing the row names); a left-only source stayed left-only (the right exactly 0); 10 s at 100 times refused with its reason; on a centre 300 Hz and side 700 Hz test, Center remove at 0, 50 and 100% left the left channel's centre at 1.0, 0.5 and 0.0 and the side at 1.0, 1.5 and 2.0 (100% the old chain), and Center extract at 50 and 100% left the side at 0.5 and 0.0 with the centre at 1.0. The first length reading said 480000 frames: the PCM endpoint previews at most 10 s; the stored media and the full WAV were read instead. The first run also failed outright: a numpy effect needs an entry in the chain table, as Peak normalize has.

### native/formwav-dsp/src/render.rs, fx.rs · effect parameter automation in the core (PT-19, first part)
- refers-to: native/formwav-dsp/src/fx.rs :: `Biquad::retune`; src/render.rs :: `clip_fx_spec`, `clip_fx_auto`, `add_clip_fx_auto`, `mix_one` (the retune every 32 samples), the test `an_automated_cutoff_opens_the_filter_over_time`
- kind: warning-context
- logged: v1.38.0 (in progress) · 2026-10-02

A track's realtime effects play as each clip's chain of biquads, each designed once with fixed parameters, so automating one has to happen in the core both players share: each clip stage's design (kind, frequency, gain, Q) is now kept beside its filter, `add_clip_fx_auto(stage, param, envelope)` attaches an envelope (natural units: Hz, dB, Q) to one parameter of a stage of the latest clip, and every 32 samples (0.67 ms at 48 kHz) `mix_one` redesigns each automated stage at its parameters' current values and retunes the filter, keeping its state so the change does not click. The bindings (wasm, native output, the Python render), the document, both mix builders and an automation row for effect parameters follow. Verified in the core's tests (12 pass): a 4 kHz tone through a low-pass whose cutoff runs from 200 Hz to 12 kHz over a second passes almost whole late in the sweep (RMS 0.352 of an unfiltered 0.354) and, early (0.05 to 0.15 s, the cutoff about 790 to 1970 Hz), at the level of a fixed filter at the envelope's mean there (1385 Hz), so the filter follows the envelope; the same filter without automation keeps the tone cut throughout; automation of a missing stage, an unknown parameter or envelope is refused; the python, native and wasm builds compile. The test's first threshold (10 times quieter early) was wrong, not the code: by 0.05 s the cutoff has passed 790 Hz, where a two-pole low-pass passes a 4 kHz tone at about an eighth.

### effect parameter automation through every path (PT-19, second part)
- refers-to: native/formwav-dsp/src/wasm.rs :: `fw_add_clip_fx_auto`; src/native.rs :: `MixClip.fx_auto`, `FxAuto`; src/python.rs :: `render` (fx_auto); backend app/services/render.py :: `plan` (auto_envs, fx_auto), `render`; frontend src/engine/document.ts :: `FilterFx.automation`, `cleanFx` (keeps it), `set-fx-automation`; src/audio/player.ts :: `flatFxAuto`, the clip message's `fxAuto`; src/audio/player-worklet.ts :: `fxAuto`, the attachment
- kind: warning-context
- logged: v1.38.0 (in progress) · 2026-10-02

A filter's automation lives on the effect (`automation.freq`, `.gain`, `.q`, session frames to Hz, dB or Q) and reaches the core along every path the clip's stages take: the browser worklet and the native output both read the clip message's `fxAuto` (stage, parameter, points) and attach an envelope after the clip's stages, and the export's plan numbers the stages the same way (bypassed, unknown and compressor entries skipped, as flatFxAuto does), registers each automation once per track and passes (clip, stage, parameter, envelope) to the core's render. Two things found on the way: `cleanFx` rebuilt each filter from known fields and would have dropped the automation at the next effect edit, so it now keeps it (sorted, each value clamped like its static one); and a track whose chain moves onto its own bus for a compressor leaves its automation unplayed, since bus chains are not automated yet (noted in the builder). Verified with a 2 s 4 kHz tone on a track with a low-pass: at a fixed 200 Hz the export and the browser's bounce both read 0.0008 early and late, identical to the sample over 96000 samples; with the cutoff automated from 200 Hz to 12 kHz both read 0.0149 early and 0.3521 late (the unfiltered tone 0.354), again identical to the sample; the automation survived an edit of the effect's Q; two undos removed it; the core's 12 tests pass; no page errors.

### app/services/tools.py, effects.py, routers/media.py, frontend src/ui/media-pane.ts · crest and dynamic range (RX-50), downmix to mono (RX-30), dither to any depth (RX-18), sweeps with level (RX-39)
- refers-to: app/services/tools.py :: `stats` (crestFactor, dynamicRangeDb), `generate` (the chirp branch: freq_end, curve, amplitude); app/services/effects.py :: `_downmix_mono`, the dither PARAMS and chain builder; app/routers/media.py :: `POST /api/generate`; frontend src/ui/media-pane.ts :: the sweep's fields
- kind: warning-context
- logged: v1.39.0 (in progress) · 2026-10-02

RX-50: the Inspector already had Crest factor and Dynamic range rows, but they were always empty: ffmpeg's astats gives those per channel only, never in the overall block the parser reads; both are now measured from the samples (peak over RMS across every channel; the loudest less the quietest non-silent 50 ms RMS window, Audition's definition). RX-30: Downmix to mono makes a one-channel clip, the mean of the channels. RX-18: dither takes a bit depth from 8 to 24 and noise shaping on or off; ffmpeg dithers with shaping only to its integer formats, so the signal is scaled by an exact power of two around it (2^(N - 16) at 16 bits, 2^(N - 32) at 32), landing the grid on 2^-(N - 1), 16 bits shaped being the old chain. RX-39: the sweep generator takes a start and end frequency, a linear or logarithmic curve and a level, its phase in closed form. Verified through the engine: a 0.5 sine's crest factor 1.414 and dynamic range 0.0, a second at 0.5 then at 0.05 20.0 dB, and the Inspector shows Crest factor 1.41 and Dynamic range 0.0 dB beside Peak -6.02 and RMS -9.03; a 0.4 and 0.2 stereo pair downmixed to one channel peaking at 0.3000; dither at 8, 16 and 24 bits left every sample exactly on that grid, and at 12 bits shaped noise read 45.2 dB higher at 16 to 20 kHz than at 2 to 6 kHz against 0.2 dB unshaped; log and linear sweeps from 100 Hz to 10 kHz read 1000 and 5050 Hz at their midpoint, peaking at the 0.400 asked; the audits clean before committing.

### app/services/effects.py, tools.py, frontend src/ui/inspector-pane.ts · phase rotation by any angle with Find the angle (RX-34); maximum and minimum RMS and an RMS histogram (AA-04)
- refers-to: app/services/effects.py :: `_phase_rotate` (a numpy effect; the chain entry now empty), its PARAMS (angle, auto); app/services/tools.py :: `stats` (maxRmsDb, minRmsDb, rmsHistogram); frontend src/ui/inspector-pane.ts :: the two RMS rows and the histogram; src/styles/frame.css :: `.fw-rms-hist`
- kind: explainer
- logged: v1.40.0 (in progress) · 2026-10-02

Phase rotation was ffmpeg's all-pass approximation fixed at a quarter-turn. It now turns every frequency by any angle exactly, x cos(a) - H(x) sin(a) with the Hilbert transform taken through the FFT, so the magnitude spectrum is unchanged; Find the angle measures the lowest-peak rotation from -90 to 90 degrees (a and a + 180 differ only in polarity), checking only the samples whose analytic magnitude could hold the peak and falling back to all of them when that bound fails, and names it in the result. The statistics add Audition's maximum and minimum RMS (50 ms windows) and an RMS histogram in 3 dB bins from -60 to 0 dBFS, drawn in the Inspector. Verified: 90 degrees turned a 1 kHz sine into the cosine within 1.76e-08; Find the angle took a waveform peaking +0.330 and -0.650 to +0.564 and -0.564 at -90 degrees (1.2 dB of headroom), its magnitude spectrum unchanged within 1.1e-08; a second at 0.5 then at 0.05 read maximum RMS -9.03 and minimum -29.03 dBFS with 20 windows in each of the -12 and -30 dBFS bins, and the Inspector showed those rows and two full bars; the audits clean before committing.

### app/services/effects.py · De-plosive and De-wind with detection (RX-11, RX-14)
- refers-to: app/services/effects.py :: `_chain_array`, `_low_burst_gate`, `_de_plosive`, `_de_wind` (numpy effects now; their chain entries kept, so De-wind stays in the noise-learning set), the Detect controls
- kind: explainer
- logged: v1.41.0 (in progress) · 2026-10-02

Both were fixed filters over the whole clip, so clean low end between plosives or gusts was cut as hard as the bursts. Each now runs its own chain over the clip as the wet signal (the old effect exactly) and, with Detect on, blends it in only where a gate opens: the band below the cutoff (through the FFT, since there is no filter library) in 10 ms frames against its running one-second median, open 15 dB above it for plosives (held 30 ms) and 10 dB for gusts (held 150 ms), above -60 dBFS, with 10 ms ramps. Detect is off by default, the old behaviour. Verified through the engine: De-plosive at 300 Hz with Detect off cut a 100 Hz tone 19.1 dB, as recorded before; on a clip of a 1 kHz tone, a steady 80 Hz tone and two low bursts, De-plosive cut a 40 ms burst's low band from -9.8 to -21.9 dB with Detect on while the 80 Hz tone between bursts stayed 0.0800 (Detect off took it to 0.0431), and De-wind cut a 300 ms gust from -12.6 to -34.3 dB with the 80 Hz tone left at 0.0800 (0.0212 with Detect off); the 1 kHz tone untouched throughout. The first run of the helper would have failed: this module imports os and tempfile locally, so the helper imports them itself.

### app/routers/presets.py, frontend src/ui/inspector-pane.ts, src/io/presets-client.ts · module chains saved as presets (RX-55; interface not yet verified)
- refers-to: app/routers/presets.py :: `_clean` (a chain preset's validated steps); frontend src/io/presets-client.ts :: `Preset.steps`; src/ui/inspector-pane.ts :: Save chain, the Saved chains menu (filled through the DOM when opened), loading a chain
- kind: warning-context
- logged: v1.41.0 (in progress) · 2026-10-02

A module chain is saved as a preset with effect "chain" and its steps in order, each an effect, a label and named numbers (1 to 16 steps, the same rules as a preset's settings); Save chain asks for a name as an effect preset does, and the Saved chains menu loads one into the chain, replacing it. Verified through the engine: a two-step chain preset (Amplify at 6 dB, Invert) stored and read back with its steps; steps on an ordinary effect refused with 422. Not yet verified: the interface's save, clear and load in the browser (the dev server had stopped when the test ran); RX-55 stays partial until that passes. The interface builds and type-checks.

### module chains saved as presets, the interface verified (RX-55)
- refers-to: frontend src/ui/inspector-pane.ts :: Save chain, the Saved chains menu, loading; app/routers/presets.py :: `_clean`
- kind: explainer
- logged: v1.41.0 (in progress) · 2026-10-02

The browser test the previous entry left pending, run with the dev server up: in Chromium at 1288 by 683 a chain of Amplify (6 dB) and Invert was saved as "Voice cleanup" through the name prompt, cleared (no steps), found in the Saved chains menu and loaded back with both steps; applied, the loaded chain gave output over input of -1.9953 (+6.00 dB, inverted) with a residual of 2.77e-08, so the steps kept their settings; no page errors.

### app/services/effects.py, tools.py, routers/render.py, media.py · a batch of repair rows (RX-02, AU-B14, RX-03, RX-10, RX-09, RX-41, RX-29; RX-22's engine side)
- refers-to: app/services/effects.py :: `_stft_map` (exact overlap-add), `_azimuth_measured`, `_dc_measured`, `_breath_control`, `_de_hum_adaptive`, `_de_ess_spectral`, `_spectral_recovery` (new effect ids, so the existing ones keep their measurements), their PARAMS, chain entries and catalogue; app/services/tools.py :: `find_similar`; app/routers/media.py :: `GET /api/media/{id}/similar`; app/routers/render.py :: `_with_cues` (a WAV mix's cue points)
- kind: explainer
- logged: v1.42.0 (in progress) · 2026-10-02

Seven gaps closed in one batch and an eighth's engine side, each measured on a signal with a known answer: Azimuth (measured) found a right channel 0.7 times as loud and 63 samples late and lined it up (|L - R| 1.8e-04 on noise); DC offset (measured) left a mean of 2.4e-09 with a 20 Hz component intact to 2e-08; Breath control took noise-like breaths between phrases from -33.9 to -53.9 dB (the 20 dB asked) with the phrases at -17.30 unchanged; De-hum (adaptive) followed hum drifting from 49 to 51 Hz with four harmonics, 24 dB down with a 62 Hz tone 12 Hz away kept within 0.45 dB (its first notches, 0.8 of a bin, took only 14 dB, being narrower than the window's leakage); De-ess (spectral) lowered 5 to 8 kHz bursts by the 12 dB maximum while a quiet steady 6 kHz tone between them and a 300 Hz vowel stayed exactly as they were; Spectral recovery rebuilt an absent 8 to 16 kHz band to -38 dB from the octave below with nothing under 7.8 kHz changed (4e-06); a WAV mix carries the session's markers and regions as cue points (Intro at 48000, Chorus at 96000 with its 48000-frame length, the RIFF size right); and Find similar located a chirp's other two occurrences (0.491, 1.696 and 3.093 s against 0.5, 1.7 and 3.1) and neither decoy, with RX-22 left partial until the interface can select what it finds. Two of the test's own faults, not the effects': a breath placed with an off-by-one slice, and a hum measurement that subtracted a tone outside its band.

### spectral repair's replace and fill gaps (RX-42); multichannel channel order (AU-50); built-in multi-step commands (PT-21); a batch queue of files (AP-03, RX-52)
- refers-to: app/services/effects.py :: `_spectral_repair`; app/routers/render.py :: the channels parameter; app/routers/media.py :: `POST /api/batch`; frontend src/io/render-client.ts, src/ui/export.ts :: Channel order; src/ui/inspector-pane.ts :: BUILT_IN_CHAINS in the Saved chains menu, Run chain on files, syncBand and ownBand for spectral repair
- kind: warning-context
- logged: v1.43.0 (in progress) · 2026-10-02

Spectral repair rebuilds a drawn time and frequency region (Replace), or a dropout across the whole band (Fill gaps), from the clean frames either side, magnitudes interpolated and each bin's phase advanced at its own measured rate, at one FFT size or three averaged (multi-resolution); a multichannel export takes its channels by track number; four built-in chains of formwav's own effects sit above the user's in the Saved chains menu; and a chain runs over files from the computer outside the session, the results a zip. Verified: Replace over a click on a 1 kHz tone took the region's error from -7.1 dB to -95.7 (multi), -86.2 (512), -129.6 (2048) and -164.8 dB (8192), with nothing changed before it (1.2e-08), and Fill gaps bridged a 20 ms dropout to -149.6 dB; the first version barely improved on attenuation (-12.6 dB) because its reference frames overlapped the click and its phases assumed bin-centred tones, both fixed. A multichannel export ordered 3,1,1 carried 800, 200 and 200 Hz and track 4 of 3 was refused; two files through Amplify -6 dB and Invert came back at -0.5012 each (residuals under 1e-08), and in Chromium Run chain on files downloaded batch.zip with both; the built-in Tidy a master took a clip with a DC offset to a mean of -5.7e-09 and a -1.00 dBFS peak; the Channel order field shows only for multichannel; no page errors; the audits clean before committing.

### a dialogue leveler holding breaths and sibilance (RX-26); Detect silences as regions (PT-36); three gaps found already closed (AU-11, RX-58, RX-60)
- refers-to: app/services/effects.py :: `_dialogue_leveler`; frontend src/ui/inspector-pane.ts :: Detect silences
- kind: explainer
- logged: v1.44.0 (in progress) · 2026-10-02

Leveler (dialogue) brings each 50 ms of speech toward a target RMS while breaths (noise-like, 10 to 45 dB under the speech) and sibilance (energy mostly above 4 kHz) take the surrounding gain only when it lowers them. Detect silences marks the track's silences over 0.3 s as regions, drawn on the ruler, before anything is stripped or split. Verified: through the engine, a phrase at -30 dB came to -20.0, one at -14 to -20.0 and one at -22 to -20.0 (target -20), while a breath at -40 stayed at -40.2 and a sibilant burst at -25 went to -27.0, neither raised; in Chromium, Detect silences on a tone, a silent second and a tone made one region, Silence 1 from 1.0 to 2.0 s, drawn on the ruler over the silence, and undo took it back. Three COVERAGE gaps were found already closed, with evidence gathered now: a 4-channel file came through Amplify, DC offset (measured), De-ess (spectral), De-hum (adaptive) and Voice de-noise with four channels, each keeping its own tone (RX-58); the home screen's recent sessions show their thumbnails, 320 by 64, on the five saved since thumbnails began (AU-11, done by AU-32's work); and input monitoring through the speakers is AU-21's, measured before and during takes (RX-60).

### a curve editor with a dynamics transfer curve (AU-B06), a filter curve EQ and a 10-band graphic EQ (AU-B07): engine verified in part, the editor not yet
- refers-to: app/services/effects.py :: `GRAPHIC_BANDS`, `_graphic_eq_chain`, `_filter_curve_chain` (above PARAMS), `_dynamics_curve`, their PARAMS, chains and catalogue; frontend src/ui/curve-editor.ts (new), src/ui/inspector-pane.ts :: showControls mounts it; src/styles/frame.css :: `.fw-curve`
- kind: warning-context
- logged: v1.45.0 (in progress) · 2026-10-02

Dynamics curve maps 5 ms RMS levels through five drawn points (unity slope below the first, the last segment's slope above); Filter curve EQ joins six frequency and gain points; Graphic EQ, 10 bands, sets ten octave bands; a canvas curve editor draws the two curve effects over their own point fields and writes dragged points back into them. Verified through the engine: the dynamics curve took a tone at -13 dB RMS to -22.86 (the curve asks -23) and left one at -40 at -40.00; the graphic EQ's 1 kHz band at +12 gave +11.48 dB at 1 kHz with 100 Hz and 8 kHz unchanged. Two faults found on the way, both fixed: the chain builders, wrapped in lambdas, were still called while the module loaded (before they were defined), so the module failed to import and the engine went down on reload, until they were moved above PARAMS; and firequalizer with scale=loglog applied no gain at all (0.00 dB on every band, checked against ffmpeg directly), so the option is dropped. Not verified: the filter curve's result, and the curve editor in the browser (the dev server was down when its test ran), so AU-B06 and AU-B07 stay partial.
