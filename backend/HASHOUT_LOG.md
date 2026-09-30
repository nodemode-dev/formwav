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
