# HASHOUT_LOG · src-tauri

Context for the desktop shell lives here rather than in code comments.

### src/main.rs, tauri.conf.json, capabilities/default.json, Cargo.toml, build.rs, icons/ · the desktop shell (owner decision, Sprint D)
- refers-to: src/main.rs :: `main`, `kill_backend`, `with_open`, `open_session`, `Backend`, `Session`; tauri.conf.json; capabilities/default.json; ../build_macos_app; ../backend/desktop_entry.py
- kind: warning-context
- logged: v1.25.0 (in progress) · 2026-10-01

The owner asked for a Tauri desktop app like the other form editors. Built to the tauri-compiler skill's shell-and-engine shape (its sidecar template and port-handshake reference): the shell starts the frozen engine (`binaries/formwav-engine`, placed by the build script with the target triple) with FORMWAV_PORT=0, reads the port the OS gave it from uvicorn's bind line on either stream, then opens one window at that loopback address, 90% of the primary monitor, centred, with a floor; if the engine ends without a port, a native message says so and the app exits instead of showing a blank window; quitting kills the engine. The page gets no Tauri API (capabilities: core defaults, the dialog, and running that one sidecar), so it is the same web app as in the browser, served by the engine from its own origin. A `.fmw` opened with the app (macOS's Opened event, or the first argument elsewhere) reaches the page as an `?open=` query on its address, held until the window exists or applied by navigating it. Icons are generated from the owner's 512 px logomark upscaled to the 1024 px master Tauri expects (the build script regenerates the set with `cargo tauri icon`); a native 1024 px master would be sharper.
