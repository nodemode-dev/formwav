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
| VocalSet (two recordings, trimmed and resampled, with metadata) | 1.2 | CC BY 4.0 (attribution and the changes in NOTICE) | the engine sidecar: backend/app/services/singers, the stock singers |
| The CMU Pronouncing Dictionary | commit 74790861 (2025-10-24) | BSD-style (Carnegie Mellon University; its LICENSE kept beside it) | the engine sidecar: backend/app/services/cmudict, the phonemes of sung lyrics |
| pyaaf2, httpx (with httpcore, certifi), onnxruntime | 1.7.1, 0.28.1, 1.30.0 | MIT; BSD-3-Clause (certifi MPL-2.0, its cacert.pem unedited); MIT | the engine sidecar: AAF interchange, provider and catalogue requests, the speech-detection and quality models |
| fwhost (native/formwav-host): clap-sys, vst3 (bindings from the VST 3 SDK headers, MIT since SDK 3.8), com-scrape-types, libloading, x11rb | 0.5.0, 0.3.0, 0.1.1, 0.8.9, 0.13.2 | MIT or Apache-2.0; ISC (libloading) | the plug-in host helper beside the engine |
| fwnyq (native/formwav-nyquist): libnyquist and XLISP, vendored, and its runtime `.lsp` files | Nyquist 3.15 as vendored in the 2.4.2 libnyquist | BSD-style (Roger Dannenberg, Dominic Mazzoni; `libnyquist/nyquist/license.txt`) | the Nyquist helper and `nyquist_runtime` in the engine. `aud-do-support.lsp` (GPL-2.0) was removed from the runtime and is not loaded |
| portaudio | as the build machine has it | MIT | linked into fwnyq (statically on Windows; on macOS a shared library in formwav.app/Contents/Frameworks) |
| fwvamp (native/formwav-vamp): the Vamp host SDK, vendored | 2.10 | BSD-style (Chris Cannam, Queen Mary, University of London; `sdk/COPYING`) | the Vamp host helper |
| fwlv2 (native/formwav-lv2): lilv, serd, sord, sratom, zix | as the build machine has them | ISC | the LV2 host helper; DLLs beside it on Windows, shared libraries in formwav.app/Contents/Frameworks on macOS |
| libsndfile, with FLAC, Ogg, Vorbis and Opus (BSD-3-Clause) and mpg123 and LAME (LGPL) as its build has them | as the build machine has it | LGPL-2.1-or-later | read and write audio in fwnyq, fwvamp and fwlv2; always a separate shared library (on Windows a DLL beside the helpers, copied by each build script, so it can be replaced; on macOS the build machine's Homebrew copies, with the libraries they load, as separate shared libraries in formwav.app/Contents/Frameworks, copied by src-tauri/gather_macos_libs, which can be replaced likewise; on Linux the system's, see below) |
| Tauri crates under other licences: cssparser, selectors, dtoa-short, option-ext; r-efi | as locked | MPL-2.0, used unmodified (source at crates.io); MIT OR Apache-2.0 OR LGPL-2.1-or-later, used under MIT | the shell |
| WebKitGTK, GTK, GLib | the build machine's | LGPL-2.1-or-later | the Linux AppImage, as separate shared libraries |

## On the user's machine, never bundled (tier 1)

| Component | Licence | Why it stays outside |
| --- | --- | --- |
| ffmpeg 7.1.5, ffprobe | LGPL-2.1-or-later for the downloaded build; an installed one keeps its own licence | an ffmpeg on PATH is used as before; when none is found, the engine downloads the LGPL build (`--disable-gpl --disable-nonfree`; libopus and libvpx BSD-3-Clause) from the nodemode-dev/formcut-binaries release on first run, checks every file's SHA-256 against `backend/app/ffmpeg_record.py` and runs it as a separate program, so nothing is bundled and the program stays replaceable; its source is attached to that release. That build has no librubberband, so the tempo and pitch effects still need an ffmpeg built with it |
| rubberband (command line) | GPL-2.0-or-later (or Breakfast Quay's commercial licence) | found on PATH at run time (`brew install rubberband`); GPL cannot go inside an Apache-2.0 bundle |
| The system web view (WKWebView on macOS, WebView2 on Windows, WebKitGTK on Linux) | the operating system's | the platform's own, never shipped |
| The 30 Nyquist plug-ins (`*.ny`) from the 2.4.2 release of their publisher's repository, each pinned to its SHA-256 (`services/nyquist.py`, `PLUGIN_PINS`) | GPL-2.0 (each file's own header) | downloaded on the person's request (the Nyquist list's "Get the Nyquist plug-ins", `POST /api/nyquist/plugins/install`) into the data folder; never in the bundle. A checkout keeps its copy in `native/formwav-nyquist/plug-ins` for development |
| libsndfile, portaudio and lilv on Linux | LGPL-2.1-or-later; MIT; ISC | the helpers link the copies the system installs (the .deb and .rpm depend on them), which the app finds there and does not bundle; on macOS, since 2.21.8, they are in the app (above) |
| Downloaded on request, pinned: Silero VAD v6.2.3 (MIT), the RNNoise model `bd.rnnn` from GregorR/rnnoise-models at 3eee541a (its author states it is not subject to copyright), DNSMOS `sig_bak_ovr.onnx` (Microsoft's DNS Challenge, CC BY 4.0), DeepFilterNet 0.5.6 (MIT or Apache-2.0), TIGER (MIT code, Apache-2.0 weights), Kokoro v1.0 (Apache-2.0), and the English to Spanish, French, Italian and Portuguese translation models from argos-net.com (French and Portuguese: OPUS-MT, CC BY 4.0, by Jörg Tiedemann and Santhosh Thottingal; Spanish and Italian: licence to confirm, their packages state none) | as listed | fetched into the models folder when first used, each checked against its SHA-256; never in the bundle |
| Local models installed on request: DeepFilterNet3 (deep-filter 0.5.6), Kokoro (kokoro-onnx 0.6.1), Pocket TTS, Chatterbox, TIGER, EzAudio with FLAN-T5 large, SoulX-Singer, ACE-Step 1.5 (acestep.cpp) | MIT or Apache-2.0; Apache-2.0; MIT code with CC BY 4.0 weights; MIT (outputs watermarked); MIT code with Apache-2.0 weights; MIT with Apache-2.0; Apache-2.0; MIT (as each install descriptor records; the NOTICE lists them) | installed into their own runtimes on the user's machine at the user's request, never in the bundle |
| Optional models: PyTorch, faster-whisper, Demucs, SAM-Audio, the voice runtime, open-weight models | their own | not in the desktop engine (it ships the core); they run with the engine from source, or as local models (backend/models/local_models.json) the user installs |
| Browser demo recordings (LibriVox readings, a Musopen piano performance, NASA clips) | public domain, as stated on each source page | demo/assets/media only, not in the desktop bundle; sources, licences and changes in demo/CREDITS.md |
| Repair demo recordings (a 1917 jazz record and a 1907 Caruso shellac disc) | public domain, as stated on each Wikimedia Commons file | demos/repair/assets/media only, not in the desktop bundle; sources, licences and changes in demos/repair/CREDITS.md |
| Produce demo audio (stems and drum loops from two Internet Archive items, a Musopen piano performance, NASA clips) | CC0 1.0 for the Internet Archive items; public domain for the rest, as stated on each source page | demos/produce/assets/media only, not in the desktop bundle; sources, licences and changes in demos/produce/CREDITS.md |

Rule kept from the tauri-compiler skill: nothing GPL enters the distributed bundle, and every new dependency or binary is entered here before it is used. Since 2.20.4 the Nyquist plug-ins and `aud-do-support.lsp` are out of the bundle and libsndfile is never linked statically; the installers carry LICENSE, NOTICE and this file.
