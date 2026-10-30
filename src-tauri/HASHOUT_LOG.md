# HASHOUT_LOG · src-tauri

Context for the desktop shell lives here rather than in code comments.

### ../build_windows_app.ps1, ../README.md · FORMWAV_WINDOWS_SIGN_COMMAND removed; formcompiler signs Windows
- refers-to: ../build_windows_app.ps1 (the S18 `$SignArgs` block, removed); ../README.md (Desktop app)
- kind: removed-code
- logged: v2.21.8 · 2026-10-30

S18's hook read FORMWAV_WINDOWS_SIGN_COMMAND and passed it to Tauri as an inline `--config` with `bundle.windows.signCommand`. formcompiler never sets that variable: it merges `bundle.windows.signCommand` into `tauri.windows.conf.json` itself (scripts/windows_signing.py, keeping the file's `resources`, the helpers' DLLs) or puts a certificate's thumbprint in its `--config` file, and the family rule is that an app adds no Windows signing of its own (a second signCommand from the app would override formcompiler's). The block is gone and README's Desktop app section says where Windows signing comes from. Removed code, for the record:

```powershell
$SignArgs = @()
if ($env:FORMWAV_WINDOWS_SIGN_COMMAND) {
  Write-Host "Signing with: $env:FORMWAV_WINDOWS_SIGN_COMMAND"
  $Override = @{ bundle = @{ windows = @{ signCommand = $env:FORMWAV_WINDOWS_SIGN_COMMAND } } } | ConvertTo-Json -Depth 4 -Compress
  $SignArgs = @("--config", $Override)
}
```

### ../build_macos_app, ../build_linux_app, ../build_windows_app.ps1 · formcompiler's --config reaches every desktop build
- refers-to: ../build_macos_app, ../build_linux_app (the positional `--config FILE` before `tauri build`); ../build_windows_app.ps1 :: `$ConfigArgs`
- kind: warning-context
- logged: v2.21.8 · 2026-10-30

formcompiler writes its Tauri settings to a file (the updater's artifacts, public key and feed when it holds the updater key; on macOS with no Apple identity, `bundle.macOS.signingIdentity "-"`, the ad hoc seal) and hands every build `FORMCOMPILER_CONFIG_ARG`, `--config FILE` or empty (scripts/run_build.py). The macOS script ran `cargo tauri build` without it, and Linux and Windows did not pass it either, so none of those settings reached a formwav build. Each script now takes the path after `--config ` whole (spaces kept, rather than splitting the variable on words), refuses any other shape, and passes `--config FILE` to `tauri build`; empty passes nothing, as before. Not run here: no build was run.

### ../build_macos_app, ../build_linux_app, ../build_windows_app.ps1 · the Tauri CLI pinned to 2.12.1
- refers-to: ../build_macos_app (TAURI_CLI_VERSION); ../build_linux_app :: `tauri`; ../build_windows_app.ps1 :: `$Tauri`
- kind: rationale
- logged: v2.21.8 · 2026-10-30

The macOS build installed `tauri-cli --version '^2'` whenever `cargo tauri` was missing, which on a fresh runner is every build, and any 2.x the registry had that day. The CLI is now pinned to 2.12.1, the version of the tauri crate in Cargo.lock (the form family pairs tauri 2.12.1 with CLI 2.12.1), and installed (with --force, over a cached other version) only when `cargo tauri --version` does not print `tauri-cli 2.12.1`. Linux and Windows keep cargo's CLI when one is installed and otherwise run the npm package at the same exact version instead of `@^2`. Not run here: no build was run.

Last updated: 2026-10-22 · splash, boot reveal, overlay title bar, caption buttons and native macOS menu (UI_GAP_PLAN phases 8 and 9), ported from formvis's shell. Decisions and reasons. (1) reveal.rs is formvis's unchanged except the done hook, `window.formwavSplashDone`, which splash.html defines; SPLASH_MIN 2600 ms, BAR_FINISH 220 ms, FALLBACK 20 s, background #0a0a0a so no white frame shows. `mark_launch` is first in main so the minimum counts from launch; `round_splash` is first in setup; the main window is built with `.visible(reveal::BUILD_VISIBLE)` and `.background_color(reveal::BACKGROUND)`, `conceal` runs right after build, and the splash is closed only in `show_main` and when the engine fails (before its dialog) or the window fails to build. (2) The splash window is declared in tauri.conf.json exactly as formvis (360x200, no decorations, centred, transparent, no shadow, hidden) with `macOSPrivateApi` true and the `macos-private-api` Tauri feature, which transparency on macOS needs; its url `splash.html` is served from frontend/dist because Vite copies frontend/public. The splash page uses formwav's own waveform logo in the accent green (#50e2a5) and a bar from #50e2a5 to #f97316, formwav's audio colour to its accent, literals being allowed in that standalone page. (3) macOS code (objc2, objc2-app-kit: round_splash, set_seen, traffic lights, text_edit's first-responder send) is behind cfg(target_os = "macos") as in formvis and was not compiled on the Linux machine this was written on. (4) traffic_lights.rs ROW is 40, not formvis's 38, because formwav's title bar row is 40 px; LEFT stays 14 and the page leaves 78 px (desktop.css) for the three buttons. They are re-placed on resize, focus, theme and scale changes, on page load, after reveal and after each `set_window_title`. (5) The page may call exactly `app_ready`, `set_window_title` and `text_edit` (build.rs lists them so Tauri generates their allow permissions) plus the window calls the caption buttons need and event listening. `core:default` is deliberately not granted: it would also open the app, path and window getters to a page served from a loopback port, which the owner did not approve; the event listen and unlisten permissions alone let the page hear the menu. remote.urls is http://127.0.0.1:* and the capability description and CLAUDE.md say so. The dialog and sidecar permissions are unchanged and are used from Rust. (6) Files dropped on the window reach the page as DOM drops: `.disable_drag_drop_handler()`, as formvis. (7) Windows and Linux windows are built with `.decorations(false)` so the page's caption buttons replace the system frame; formvis flips it at run time with set-decorations, which would need one more page permission, and building without a frame needs none. A double click on the title bar maximizes through Tauri's own drag-region script (it handles detail 2), so the page adds no second handler that would toggle twice. (8) The native macOS menu is built in Rust (menu.rs) instead of formvis's JavaScript menu API, so no menu permission is needed: formwav (About, Preferences with Cmd+, , Hide, Quit) and Edit (Undo, Redo, Cut, Copy, Paste, Select All). Custom items emit the Tauri event `fw-menu` with the item id; desktop.ts re-dispatches it as the DOM CustomEvent `fw-desktop-menu` (detail is the id, cancelable). With a text field focused an Edit id goes to `text_edit`, so Cmd+Z/X/C/V/A edit the field; otherwise the page may handle it and call preventDefault, and an unclaimed edit id goes to `text_edit` too. menu.rs compiles on every platform but only macOS installs it. Verified: cargo check on Linux; not verified: any window on screen, any macOS behaviour.

### icons/, ../assets/, ../frontend/public/ icons · the owner's logo everywhere (owner decision, v2.20.1)
- refers-to: icons/icon.icns, icon.ico, icon.png, 32x32.png, 128x128.png, 128x128@2x.png; ../assets/formwav_icon.png, formwav_folder_icon.png; ../frontend/public/favicon-32.png, apple-touch-icon.png, icon-192.png, logo-64.png, logo-256.png
- kind: rationale
- logged: v2.20.1 · 2026-10-22

The owner sent the real logo (a 1024 px PNG: the f with a waveform running from it and a note head, pink to violet, on a rounded dark tile with transparent margins) and asked for it everywhere. Every icon is now made from it by the sidecar's verification/logo/make_icons.py: the app icons (icns 16 to 1024, ico 16 to 256, the PNGs) keep the tile's margin as given, as the platforms' icon grids expect; the page's marks and the browser icons are the tile cropped to its edges so it fills its box (title bar 22 px and Home 24 px from logo-64.png, the empty stage and the splash from logo-256.png, the favicon, the touch icon and icon-192). assets/formwav_icon.png is the master; the earlier vector icon (assets/formwav_icon.svg, v2.17.2's redraw below) is removed, as it was another drawing. The splash's bar now runs in the logo's colours (#6d6af0, #a86ef0, #f0607e, #f58a5e).

### icons/, ../assets/formwav_folder_icon.png, ../assets/formwav_icon.svg, ../frontend/public/ icons · the family icon (owner decision, superseded at v2.20.1)
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
