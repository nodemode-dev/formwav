# HASHOUT_LOG · backend · formwav

Living log of all comment content, explainers, rationale, TODOs and removed code for the backend. Source files stay comment-free per dev-rules `sub-skills/hashout-log/SUB-SKILL.md`; everything they would have said lives here, indexed. Read this first, then edit code surgically.

Current build version: v0.6.0
Last updated: 2026-09-28 · .fmw save, open, list and download (header was left at v0.2.0 through v0.5.0 and is corrected here)

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
    │   └── projects.py          GET /api/projects, PUT and GET /api/projects/{name}, GET /api/projects/{name}/file
    └── services/
        ├── media.py             import, probe, atomic storage, peak levels through formwav_dsp
        └── projects.py          .fmw packages in data/projects: atomic save, verified open, list
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
