# Licences · the desktop app

formwav is Apache-2.0 (LICENSE, NOTICE). This ledger covers what the desktop app (`src-tauri`, `build_macos_app`) puts in or beside the bundle, by tier: what ships inside it, and what it finds on the user's machine and never bundles. NOTICE keeps the interface's vendored sources (the formvis design language, NodeMode helpers, fonts, xterm.js).

## Inside the bundle

| Component | Version | Licence | Where |
| --- | --- | --- | --- |
| Tauri (tauri, tauri-build) | 2 | MIT or Apache-2.0 | the shell |
| tauri-plugin-shell | 2 | MIT or Apache-2.0 | the shell: starts the engine sidecar |
| tauri-plugin-dialog | 2 | MIT or Apache-2.0 | the shell: the engine-failure message |
| regex | 1 | MIT or Apache-2.0 | the shell: reads the engine's port |
| PyInstaller bootloader | 6.22.3 | GPL-2.0-or-later with the bootloader exception, which allows distributing the frozen program under any licence | the engine sidecar |
| CPython | 3.12 | PSF-2.0 | the engine sidecar |
| FastAPI, pydantic | 0.115.14, 2 | MIT | the engine sidecar |
| Starlette, uvicorn, numpy, websockets, python-dotenv | as pinned | BSD-3-Clause | the engine sidecar |
| uvloop | as pinned | MIT or Apache-2.0 | the engine sidecar |
| httptools, watchfiles, PyYAML | as pinned | MIT | the engine sidecar |
| pywinpty | 3.0.5 | MIT | the engine sidecar on Windows only: the embedded terminal's ConPTY |
| formwav-dsp (the native audio core) | formwav's version | Apache-2.0 (formwav's own) | the engine sidecar |
| formwav-studio (the studio processors, native/formwav-studio) | 0.1.0 | Apache-2.0 (formwav's own) | inside the audio core, in the engine sidecar and the interface |
| The CMU Pronouncing Dictionary | commit 74790861 (2025-10-24) | BSD-style (Carnegie Mellon University; its LICENSE kept beside it) | the engine sidecar: backend/app/services/cmudict, the phonemes of sung lyrics |

## On the user's machine, never bundled (tier 1)

| Component | Licence | Why it stays outside |
| --- | --- | --- |
| ffmpeg | LGPL-2.1-or-later, or GPL depending on its build | found on PATH at run time (`brew install ffmpeg`); bundling a GPL build would bind the app, and even an LGPL build carries relinking duties |
| rubberband (command line) | GPL-2.0-or-later (or Breakfast Quay's commercial licence) | found on PATH at run time (`brew install rubberband`); GPL cannot go inside an Apache-2.0 bundle |
| The system web view (WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux) | the operating system's | the platform's own, never shipped |
| Optional models: PyTorch, faster-whisper, Demucs, SAM-Audio, the voice runtime, open-weight models | their own | not in the desktop engine (it ships the core); they run with the engine from source, or as local models (backend/models/local_models.json) the user installs |

Rule kept from the tauri-compiler skill: nothing GPL enters the distributed bundle, and every new dependency or binary is entered here before it is used.
