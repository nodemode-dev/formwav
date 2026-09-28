<p align="center"><img src="assets/formwav_folder_icon.png" width="112" alt="formwav"></p>
<h1 align="center">formwav</h1>
<p align="center"><b>Local-first audio editing, the audio member of the form family.</b></p>
<p align="center">
<img src="https://img.shields.io/badge/version-0.0.0-f97316" alt="version 0.0.0">
<img src="https://img.shields.io/badge/node-20.19%2B-339933" alt="node 20.19+">
<img src="https://img.shields.io/badge/python-3.12-3776AB" alt="python 3.12">
<img src="https://img.shields.io/badge/rust-stable-B7410E" alt="rust stable">
<img src="https://img.shields.io/badge/license-Apache--2.0-lightgrey" alt="Apache 2.0 license">
</p>

## What it is

formwav is an open-source audio editor that runs on your own machine: record, edit, repair, mix & export w/o an account, an upload or a usage meter. It is built to sit beside formcut (video, `.fmc`) & formvis (image, `.fmv`) w/ the same architecture & design system, & it saves `.fmw` projects. Its target is a measured 90% on a sourced parity scoreboard against the leading audio editors. This is v0.1.0: the scaffold. It boots, links the interface to the engine & carries the audio graph's port model; editing arrives from v0.2.0.

**Stack.** Vanilla TypeScript 7 & Vite 8 · Python 3.12 & FastAPI · Rust (`formwav-dsp`) · about 610 lines of formwav's own TypeScript, CSS, Python & Rust in v0.1.0, vendored design-system files excluded.

## Highlights

- **Engine link, verified.** The interface asks the engine for its health through the dev proxy & shows the answer in place; an engine that is down reads as offline, not as a spinner.
- **Zero-flash shell.** Mounted once & patched in place. Under 4x CPU throttling & a Fast 3G profile: layout shift 0, only the status chip's text & state change after mount, & the first frames are already the theme's background in dark & light profiles.
- **NodeMode design system.** Tokens, the 14 theme profiles & the pre-paint theme boot, vendored verbatim, so formwav matches formvis & NodeMode surface for surface.
- **Audio graph built for the whole plan.** Ports are N-channel audio or events from the first build, so MIDI, surround & ambisonics add nodes rather than reshape the graph. Kind mismatches, cycles & duplicate edges are refused.
- **Loopback only.** The interface & the engine bind 127.0.0.1; nothing listens on the network unless `HOST` says so.

## Quick Start

Requirements: Node 20.19 or newer, Python 3.12 (the tested version), git. Rust stable is needed only to work on `native/`; the app does not build it yet.

### macOS & Linux

```bash
git clone https://github.com/nodemode-ai/formwav.git
cd formwav
./formwav_oc_install
./formwav
```

### Windows

```bat
git clone https://github.com/nodemode-ai/formwav.git
cd formwav
formwav_oc_install.bat
formwav.bat
```

| Service | URL | Notes |
| --- | --- | --- |
| Interface (dev) | http://localhost:3060 | Vite, loopback only, strict port, proxies `/api` to the engine |
| Interface (preview) | http://localhost:3061 | `npm run preview` of the built interface, same proxy |
| Engine | http://127.0.0.1:8060 | FastAPI; health at `/api/health` |

## Configuration

The engine reads `backend/.env`, which is never committed; `backend/.env.example` is the template.

| Variable | Purpose |
| --- | --- |
| `HOST` | Engine bind address; loopback when unset |
| `FORMWAV_PORT` | Engine port |
| `FORMWAV_CORS_ORIGINS` | Browser origins allowed to call the engine directly |

## Architecture

```text
formwav/
├── formwav, formwav.bat               boot both sides; stops both on exit
├── formwav_oc_install(.bat)           install both sides
├── assets/                            repo art (README logo), not app runtime files
├── backend/                           FastAPI engine, app.main:app, routes under /api
├── frontend/                          vanilla TypeScript & Vite interface
│   ├── src/engine/                    headless state w/ granular events, no DOM
│   ├── src/extensions/                registry & one folder per feature (engine-link)
│   ├── src/io/                        engine client
│   ├── src/ui/                        shell & icons
│   ├── src/styles/                    formwav's own styles, tokens only
│   └── src/vendor/nodemode/           verbatim NodeMode tokens, themes, DOM helpers (MIT)
└── native/formwav-dsp/                Rust audio core: graph & port model
```

Each side keeps a `HASHOUT_LOG.md` at its root: a map of its files & the reasoning the code would otherwise carry as comments. Read it before editing.

## Not built or not verified yet

- **Editing.** No import, playback, recording or editing in v0.1.0; the transport is shown disabled so its layout is fixed from the start.
- **Windows scripts.** Written, not run on Windows yet.
- **Desktop app.** The Tauri shell arrives w/ packaging; v0.1.0 runs in the browser only.
- **Native core in the app.** `formwav-dsp` compiles (`cargo check`) but is not yet built into the engine or the interface.

## Development

`main` plus short-lived work branches. Contributions follow the dev-rules laws: single-region hand edits, zero DOM flash or re-render, no emoji, no em dash, no icon-library dependencies, `v*.*.*` versions, Conventional Commits w/ the version in parentheses.

## Status

v0.1.0 closes Phase 1 of 10, the scaffold. Phase 2 builds the session document, the command history & the Rust core's playback & recording, w/ the core compiled native, as a Python module & to WebAssembly.

## Contributors

- **nodemode-ai** · owner & build

## Licensing

Apache License 2.0, in [`LICENSE`](LICENSE). Third-party pieces & their licences are in [`NOTICE`](NOTICE); responsible use is in [`USE_POLICY.md`](USE_POLICY.md).
