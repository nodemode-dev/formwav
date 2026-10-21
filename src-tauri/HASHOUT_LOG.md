# HASHOUT_LOG · src-tauri

Context for the desktop shell lives here rather than in code comments.

### icons/, ../assets/formwav_folder_icon.png, ../assets/formwav_icon.svg, ../frontend/public/ icons · the family icon (owner decision)
- refers-to: icons/icon.icns, icon.ico, icon.png, 32x32.png, 128x128.png, 128x128@2x.png; ../frontend/public/favicon-32.png, apple-touch-icon.png, icon-192.png; ../assets/formwav_folder_icon.png, formwav_icon.svg
- kind: rationale
- logged: v2.17.2 · 2026-10-20

The yellow f-note moves to the form family construction: the dark tile with bloom, rim and drop shadow, and one diagonal spectrum gradient (#3A7BFF, #9A5CFF, #FF4F7A, #FFAE2B) with an extruded side, gloss, a soft blurred highlight and an inset light rim. The f-note outline is traced from the previous 1024 px icon, so the shape is the owner's own. A waveform in the rounded stroke style of the audio-waveform glyph runs into the f at its crossbar nub from the left, and a second one leaves the stem lower down on the right with one deep swing and one tall peak; the three are one shape, nudged left of centre for optical balance. The macOS .icns uses the 824 px tile inside a 1024 canvas with a 100 px margin; everything else is full bleed at its previous size, and icon.png is now a native 1024 px master, which retires the upscaled 512 px master noted under the desktop shell entry below. assets/formwav_icon.svg is the vector source. The in-app `.fw-logo` stays the currentColor waveform glyph. File names are unchanged, so tauri.conf.json's icon list and index.html's links need no edit. Landed from the owner's icon files by hand; the feat/app-icon-redesign bundle was read as the change description and not applied.

### src/main.rs, tauri.conf.json, capabilities/default.json, Cargo.toml, build.rs, icons/ · the desktop shell (owner decision, Sprint D)
- refers-to: src/main.rs :: `main`, `kill_backend`, `with_open`, `open_session`, `Backend`, `Session`; tauri.conf.json; capabilities/default.json; ../build_macos_app; ../backend/desktop_entry.py
- kind: warning-context
- logged: v1.25.0 (in progress) · 2026-10-01

The owner asked for a Tauri desktop app like the other form editors. Built to the tauri-compiler skill's shell-and-engine shape (its sidecar template and port-handshake reference): the shell starts the frozen engine (`binaries/formwav-engine`, placed by the build script with the target triple) with FORMWAV_PORT=0, reads the port the OS gave it from uvicorn's bind line on either stream, then opens one window at that loopback address, 90% of the primary monitor, centred, with a floor; if the engine ends without a port, a native message says so and the app exits instead of showing a blank window; quitting kills the engine. The page gets no Tauri API (capabilities: core defaults, the dialog, and running that one sidecar), so it is the same web app as in the browser, served by the engine from its own origin. A `.fmw` opened with the app (macOS's Opened event, or the first argument elsewhere) reaches the page as an `?open=` query on its address, held until the window exists or applied by navigating it. Icons are generated from the owner's 512 px logomark upscaled to the 1024 px master Tauri expects (the build script regenerates the set with `cargo tauri icon`); a native 1024 px master would be sharper.

### src/main.rs · FORMWAV_EXIT_WITH_STDIN, and the shell run for real
- refers-to: src/main.rs :: the sidecar's environment
- kind: warning-context
- logged: v1.25.0 (in progress) · 2026-10-01

The shell asks the engine to end when its stdin pipe closes (backend desktop_entry.py has the reason: SIGKILL reaches only the onefile bootloader, and the exit handler does not run on every ending). Verified on Linux under Xvfb at 1600 by 1000, the shell built here (cargo build, 3 min 33 s) with the frozen engine beside it: launched with a .fmw as its argument, a window titled formwav opened at 1440 by 900 at (80, 50), 90% of the screen and centred, showing formwav served by the engine with that session open ("My Take", its Music and Voice tracks and markers); closing the window and SIGKILL of the shell each left no engine process.

### src/main.rs · ending the engine by closing its stdin, not SIGKILL
- refers-to: src/main.rs :: `kill_backend`
- kind: warning-context
- logged: v1.27.0 (in progress) · 2026-10-02

Freeing a full disk turned up a 93 MB /tmp/_MEI folder: the onefile engine's unpacked self, left because its bootloader was SIGKILLed before it could remove it. The shell's quit did exactly that (CommandChild::kill is SIGKILL), so even with the engine ending on its stdin, every quit of the desktop app would have left about 90 MB in the temp folder. The shell now drops the child, which closes the stdin pipe the engine ends on (tauri-plugin-shell 2.4: CommandChild holds the stdin writer; kill sends SIGKILL), and the bootloader, still alive, removes its folder and exits. Verified on the frozen engine directly: SIGKILL of the bootloader left its unpack folder behind; closing its stdin ended both processes and removed it; afterwards no engine process and no unpack folder remained; the shell's cargo check passes with the change. Not re-run: the full shell under Xvfb with this quit path (the disk could not hold another debug build at the time); the owner's on-hardware check (after Quit, no formwav-engine process and no new _MEI folder in $TMPDIR) covers it.
