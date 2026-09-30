# HASHOUT_LOG · frontend · formwav

Living log of all comment content, explainers, rationale, TODOs and removed code for the frontend. formwav's own source files stay comment-free per dev-rules `sub-skills/hashout-log/SUB-SKILL.md`; everything they would have said lives here. Files under `src/vendor/` are third-party copies kept verbatim, upstream comments included, so they can be resynced. Read this first, then edit code surgically.

Current build version: v0.40.0
Last updated: 2026-09-29 · formwave's voice in a Voice tab: load a Qwen3-TTS checkpoint, generate speech onto the timeline, transcribe a clip

---

## Org-navi-map

```
frontend/
├── index.html                   critical inline style, verbatim NodeMode theme boot, three body roots
├── package.json                 exact pins; scripts dev, build, preview, typecheck
├── package-lock.json            lockfile, two version fields
├── tsconfig.json                strict, bundler resolution, noEmit
├── vite.config.ts               3060 and 3061 on loopback, strictPort, /api proxy to 127.0.0.1:8060
├── oc_install / .bat            npm install
├── boot_frontend / .bat         npm run dev
├── public/                      favicons (project artwork)
└── src/
    ├── main.ts                  entry: fonts, styles, theme, engine, extensions, shell, reveal
    ├── engine/
    │   ├── index.ts             headless state with granular events; dispatch, undo, redo, setSelection
    │   ├── document.ts          session model and the pure command reducer
    │   └── history.ts           snapshot undo and redo, 200 steps
    ├── extensions/
    │   ├── registry.ts          register, activateAll, disposeAll
    │   └── engine-link/
    │       └── index.ts         asks the engine for health, sets link state
    ├── io/
    │   ├── engine-client.ts     fetchHealth with timeout
    │   ├── media-client.ts      importFile, fetchPeaks
    │   ├── projects-client.ts   listProjects, saveProject, openProject
    │   └── render-client.ts     renderMix: POST /api/render, the WAV with its frames, peaks and loudness
    ├── ui/
    │   ├── icons.ts             fifteen NodeMode icons plus the icon() helper
    │   ├── shell.ts             mounts the shell once, patches status and clock in place
    │   ├── session.ts           wires lanes, import, undo and redo buttons, shortcuts
    │   ├── lanes.ts             keyed track lanes, clip boxes, canvas waveforms
    │   ├── import.ts            Import button, file picker, drop on the stage, notice line
    │   ├── shortcuts.ts         Cmd or Ctrl with Z, Shift Z and Y
    │   ├── transport.ts         transport buttons, playhead, click to seek, Space and Home
    │   ├── loop.ts              Loop button, L key, loop band over the lanes
    │   ├── export.ts            Export button and Cmd or Ctrl Shift E: the engine's mix as a WAV download
    │   ├── ruler.ts             timeline ruler on one canvas: time labels, loop range, regions; click to seek
    │   ├── grid.ts              the ruler's step, Grid mode (button and G) and snapping to its ticks
    │   ├── meter.ts             stereo output meter in the transport bar, 20 dB/s fall-back, latching clip indicator
    │   ├── normalize.ts         Loudness button and popover: BS.1770 normalization of the selected or all clips to a target
    │   ├── arm.ts               record arming: the armed track (interface state) and the track being recorded
    │   ├── mixer.ts             console-style mixer: a strip per track and bus (meter, fader, pan, mute, solo, output)
    │   ├── record.ts            Record button and R key, input meter, takes into the session
    │   └── projects.ts          session name, Save, Open popover, Cmd or Ctrl S and O
    ├── audio/
    │   ├── player.ts            AudioContext at the session rate, media into the worklet, bounce()
    │   ├── player-worklet.ts    AudioWorklet hosting the wasm player (public/core, built at install)
    │   ├── recorder.ts          microphone into the player's context, take assembly, float32 WAV encoder
    │   └── recorder-worklet.ts  AudioWorklet capturing input chunks and peak levels
    ├── styles/
    │   └── shell.css            formwav shell, tokens only, no z-index
    └── vendor/
        └── nodemode/            verbatim MIT copies (see NOTICE)
            ├── tokens.css       tokens, 14-profile base, declared z scale
            ├── themes.ts        profiles, readChoice, applyTheme, setTheme
            └── dom-stable.ts    delayedIndicator, patchList, setText, reserve, revealApp, mountOnce
```

---

## Table of contents

- [index.html](#index-html)
- [vite.config.ts](#vite-config)
- [src/main.ts](#src-main)
- [src/engine/index.ts](#src-engine-index)
- [src/extensions/registry.ts](#src-extensions-registry)
- [src/extensions/engine-link/index.ts](#src-extensions-engine-link)
- [src/io/engine-client.ts](#src-io-engine-client)
- [src/ui/icons.ts](#src-ui-icons)
- [src/ui/shell.ts](#src-ui-shell)
- [src/styles/shell.css](#src-styles-shell)
- [src/engine/document.ts](#src-engine-document)
- [src/engine/history.ts](#src-engine-history)
- [src/io/media-client.ts](#src-io-media-client)
- [src/ui/session.ts](#src-ui-session)
- [src/ui/lanes.ts](#src-ui-lanes)
- [src/ui/import.ts](#src-ui-import)
- [src/ui/shortcuts.ts](#src-ui-shortcuts)
- [src/ui/transport.ts](#src-ui-transport)
- [src/audio/player.ts](#src-audio-player)
- [src/audio/player-worklet.ts](#src-audio-player-worklet)
- [src/ui/record.ts](#src-ui-record)
- [src/audio/recorder.ts](#src-audio-recorder)
- [src/audio/recorder-worklet.ts](#src-audio-recorder-worklet)
- [src/ui/projects.ts](#src-ui-projects)
- [src/io/projects-client.ts](#src-io-projects-client)
- [src/ui/loop.ts](#src-ui-loop)
- [src/ui/export.ts and src/io/render-client.ts](#src-ui-export)
- [src/ui/ruler.ts and the v0.13.0 timeline](#src-ui-ruler)
- [src/ui/grid.ts, the clip gain line and the transport row (v0.15.0)](#src-ui-grid)
- [src/ui/meter.ts and the output level path (v0.17.0)](#src-ui-meter)
- [src/ui/normalize.ts and group trims (v0.24.0)](#src-ui-normalize)
- [src/ui/arm.ts and recording into a track (v0.25.0)](#src-ui-arm)
- [src/ui/mixer.ts and the mute and solo commands (v0.33.0)](#src-ui-mixer)
- [src/vendor/nodemode/](#src-vendor-nodemode)

---

## index.html {#index-html}

### index.html · critical style and theme boot
- refers-to: index.html :: head `style` and inline `script`
- kind: rationale
- logged: v0.1.0 · 2026-09-28

`html` paints the deepest surface before any stylesheet arrives, and `#app` stays hidden until `body.app-ready`. The inline script is `theme-boot.js` from stylized-nodemode, pasted verbatim: it reads `nodemode_ui_settings` from localStorage and writes the profile and accent onto `documentElement` before first paint, adding `body.theme-light` for the two light profiles through a MutationObserver the moment `body` exists. The storage key is NodeMode's own, as formvis keeps it, so the family reads one choice where origins are shared.

### index.html · body roots
- refers-to: index.html :: `#app`, `#overlay-root`, `#toast-root`
- kind: rationale
- logged: v0.1.0 · 2026-09-28

The overlay and toast roots are direct children of `body` so nothing they render can be trapped by an ancestor stacking context. Unused in v0.1.0; menus and dialogs mount there when they arrive.

---

## vite.config.ts {#vite-config}

### vite.config.ts · server and preview
- refers-to: vite.config.ts :: `server`, `preview`
- kind: rationale
- logged: v0.1.0 · 2026-09-28

`host: false` with pinned ports and `strictPort` on both the dev server and the preview server, per dev-rules vite-server-guard. `/api` proxies to the engine on 127.0.0.1:8060 in both. Verified v0.1.0: `/proc/net/tcp` showed 3060 bound to 127.0.0.1 only.

---

## src/main.ts {#src-main}

### src/main.ts · boot order
- refers-to: src/main.ts :: module body
- kind: warning-context
- logged: v0.1.0 · 2026-09-28

Order matters: fonts and styles, then `applyTheme()` (idempotent re-apply of what the head boot already wrote, and the owner of every later change), then the engine, the shell mount, extension activation, and the single reveal once `document.fonts.ready` settles so text never reflows after the app becomes visible. Extensions activate after the shell mounts so their first state change reaches a subscribed shell.

---

## src/engine/index.ts {#src-engine-index}

### src/engine/index.ts · granular events
- refers-to: src/engine/index.ts :: `Engine.subscribe`, `Engine.update`
- kind: rationale
- logged: v0.1.0 · 2026-09-28

Each slice of state (`link`, `transport`) has its own event and listener set, so a subscriber patches only the nodes bound to that slice. formcut's lesson carried over: subscribers name the event they want, and the event names are the state keys, so a typo is a type error rather than a listener that silently never runs. The engine has no DOM dependency.

### src/engine/index.ts · DEFAULT_SESSION_RATE
- refers-to: src/engine/index.ts :: `DEFAULT_SESSION_RATE`
- kind: todo
- logged: v0.1.0 · 2026-09-28

48 kHz until Phase 2 gives the session document its own rate. The clock formats against the transport's `sampleRate`, so nothing else changes when that lands.

---

## src/extensions/registry.ts {#src-extensions-registry}

### src/extensions/registry.ts · contract
- refers-to: src/extensions/registry.ts :: `register`, `activateAll`
- kind: explainer
- logged: v0.1.0 · 2026-09-28

From the dev-rules template. A feature is a folder under `extensions/` that calls `register` on import; `main.ts` imports it. Duplicate ids throw.

---

## src/extensions/engine-link/index.ts {#src-extensions-engine-link}

### src/extensions/engine-link/index.ts · setup
- refers-to: src/extensions/engine-link/index.ts :: `setup`
- kind: explainer
- logged: v0.1.0 · 2026-09-28

One health request at activation; success sets link `ready` with the engine version, any failure sets `offline`. No retry loop yet: a reconnect policy arrives with the jobs surface in Phase 2.

---

## src/io/engine-client.ts {#src-io-engine-client}

### src/io/engine-client.ts · fetchHealth
- refers-to: src/io/engine-client.ts :: `fetchHealth`
- kind: explainer
- logged: v0.1.0 · 2026-09-28

Same-origin `/api/health` through the Vite proxy, aborted after 5 s, and rejected unless the reply names formwav with status ok, so another service on 8060 is not mistaken for the engine.

---

## src/ui/icons.ts {#src-ui-icons}

### src/ui/icons.ts · subset and sizes
- refers-to: src/ui/icons.ts :: `ICONS`, `ICON_SIZE`, `icon`
- kind: explainer
- logged: v0.1.0 · 2026-09-28

Twelve icons copied byte for byte from the stylized-nodemode mirror of the NodeMode icon module: play, pause, stop, record, skipBack, skipFwd, loop, waveform, settings, info, folderOpen, upload. Add more by copying the exact line from the mirror, never by redrawing. `icon()` wraps the SVG in the `.icon` box from tokens.css with an explicit size so every icon in a row shares one box. Sizes: 16 for controls, 20 for the transport, 48 for the empty-session mark.

---

## src/ui/shell.ts {#src-ui-shell}

### src/ui/shell.ts · mount once, patch in place
- refers-to: src/ui/shell.ts :: `mountShell`
- kind: rationale
- logged: v0.1.0 · 2026-09-28

The whole shell is written once into the empty, hidden `#app` through `mountOnce`, which refuses to overwrite a rendered host. After that only three things change: the engine chip's `data-state`, its text node, and the clock's text, each through `setText` so unchanged values write nothing. The chip reserves 18ch and sits at the trailing edge, so no text change moves anything.

### src/ui/shell.ts · Connecting indicator
- refers-to: src/ui/shell.ts :: `dismissConnecting`, `writeFinal`, `renderLink`
- kind: warning-context
- logged: v0.1.0 · 2026-09-28

"Connecting" appears only if the engine has not answered after 300 ms, and once shown it holds for 250 ms: the final status is written from the indicator's hide callback. Writing the final status directly after dismissal would cut a shown indicator short and blink. When the indicator never showed, the final status is written immediately. Measured v0.1.0 under 4x CPU and Fast 3G: shown at 2444 ms, replaced at 2690 ms (246 ms by the observer's clock, within its resolution), both before the reveal.

### src/ui/shell.ts · removed first draft
- refers-to: src/ui/shell.ts :: `renderLink` (first draft, never committed)
- kind: removed-code
- logged: v0.1.0 · 2026-09-28

```ts
const dismissConnecting = delayedIndicator(
  () => setText(chipText, "Connecting"),
  () => undefined,
);
```

Its `renderLink` wrote the final status right after calling `dismissConnecting()`, which overwrote a shown indicator before its minimum time. Replaced by the hide-callback version above before the first commit.

### src/ui/shell.ts · transport buttons
- refers-to: src/ui/shell.ts :: `TRANSPORT`, `transportButtons`
- kind: todo
- logged: v0.1.0 · 2026-09-28

Rendered disabled so the transport bar's layout exists from the first build; they enable in Phase 2 when the Rust core plays and records. Each has an `aria-label` because the icon is its only label.

---

## src/styles/shell.css {#src-styles-shell}

### src/styles/shell.css · layout and stacking
- refers-to: src/styles/shell.css :: `.fw-shell`, `.fw-topbar`, `.fw-transport`
- kind: rationale
- logged: v0.1.0 · 2026-09-28

Three fixed grid rows (top bar, stage, transport) so no region can resize another. The top bar is `auto 1fr auto`: identity leading, actions trailing. Every colour, spacing, radius, size and font comes from a token in `vendor/nodemode/tokens.css`; the only literals are glyph boxes (20px logo, 8px dot) and 1px borders. No `z-index` anywhere; the declared scale is NodeMode's, in tokens.css (`--z-base` to `--z-debug`), and the first overlapping surface will take its layer from there. The accent colour is used in one place, the empty-session mark.

---

## src/vendor/nodemode/ {#src-vendor-nodemode}

### src/vendor/nodemode · provenance and resync
- refers-to: src/vendor/nodemode/tokens.css, themes.ts, dom-stable.ts
- kind: warning-context
- logged: v0.1.0 · 2026-09-28

Verbatim copies of `assets/site/` from the stylized-nodemode pack v1.0.0 (NodeMode v7.1.0), MIT, confirmed byte-identical with `cmp` when copied. Do not edit them here; resync from the pack and re-run the comparison. Not copied, deliberately: the mirror's `light-mode.css` and `scrollbars.css` style NodeMode app selectors the shell does not use, and light profiles already switch through the token values and the `body.theme-light` block in tokens.css (verified in the `sand` profile, v0.1.0).

---

## src/engine/document.ts {#src-engine-document}

### src/engine/document.ts · units and identity
- refers-to: src/engine/document.ts :: `Clip`, `SessionDoc`, `sessionLength`
- kind: rationale
- logged: v0.3.0 · 2026-09-28

`start` and `length` of a clip are integer samples at the session rate; `sourceIn` is in the source file's own frames. The first import sets the session rate to that file's rate, so a single-rate project never resamples; a later file at another rate gets a length converted to session samples (playback resampling arrives with the Rust playback path). The document is immutable: every command returns a new object or the same object when nothing changed, which is what makes snapshot undo cheap and lets subscribers compare by identity.

### src/engine/document.ts · Selection
- refers-to: src/engine/document.ts :: `Selection`, `FrequencyBand`
- kind: rationale
- logged: v0.3.0 · 2026-09-28

Every selection carries a time range and an optional frequency band from the start, per the plan's Audacity finding, so spectral editing in Phase 6 reuses the same selection. Selection is engine state but not part of the document, so undo does not move it.

---

## src/engine/history.ts {#src-engine-history}

### src/engine/history.ts · History
- refers-to: src/engine/history.ts :: `History`
- kind: explainer
- logged: v0.3.0 · 2026-09-28

Stores whole document snapshots, which share every unchanged track and clip with their neighbours. 200 steps (`HISTORY_LIMIT` in index.ts); a new command clears the redo stack. `Engine.dispatch` records only when the reducer returned a different object, so no-op commands never create an undo step.

---

## src/io/media-client.ts {#src-io-media-client}

### src/io/media-client.ts · importFile and fetchPeaks
- refers-to: src/io/media-client.ts :: `importFile`, `fetchPeaks`
- kind: explainer
- logged: v0.3.0 · 2026-09-28

The file goes as the raw body with its name URL-encoded in `X-Filename`, matching the engine route; an error reply's `detail` becomes the error message. Peaks arrive as little-endian f32 read straight into a `Float32Array` (every target platform is little-endian).

---

## src/ui/session.ts {#src-ui-session}

### src/ui/session.ts · mountSession
- refers-to: src/ui/session.ts :: `mountSession`
- kind: explainer
- logged: v0.3.0 · 2026-09-28

Called once from main.ts after the shell mounts. The undo and redo buttons change only their `disabled` property, and only when it differs.

---

## src/ui/lanes.ts {#src-ui-lanes}

### src/ui/lanes.ts · rendering without rebuilds
- refers-to: src/ui/lanes.ts :: `mountLanes`, `updateLane`, `updateClip`
- kind: rationale
- logged: v0.3.0 · 2026-09-28

Lanes and clips are reconciled by key with the vendored `patchList`: an existing lane or clip is updated in place, only new ones are created and only gone ones removed. The empty state and the lanes both exist from first paint; `data-view` on the stage chooses which shows. Clip position and width are written only when their values change (tracked in `data-left` and `data-width`). Verified v0.3.0 under 4x CPU and Fast 3G: an import mutated only the notice text, `data-view`, the lanes container's width variable, one new lane, the undo button's `disabled` and the canvas size, with layout shift 0 in dark and `sand`.

### src/ui/lanes.ts · zoom and canvas limits
- refers-to: src/ui/lanes.ts :: `samplesPerPixel`, `MAX_TIMELINE_PX`
- kind: todo
- logged: v0.3.0 · 2026-09-28

100 pixels per second, coarsened only when the session would exceed 16,000 pixels (browsers cap canvas size). Zoom controls come with editing. Each clip has one canvas as wide as the clip, so very long clips at close zoom will need tiling.

### src/ui/lanes.ts · peaks and painting
- refers-to: src/ui/lanes.ts :: `peaksFor`, `paint`, `schedulePaint`
- kind: explainer
- logged: v0.3.0 · 2026-09-28

The finest level (256 samples per peak) is fetched once per media id and shared; each canvas column folds the blocks under it into one min and max per channel, one row per channel. The colour is the canvas's computed `color`, which CSS sets to `--accent-color`, so theme and accent changes repaint through the `nm:ui-settings-changed` listener without reading tokens in script. A canvas paints once, when its peaks are ready, into a box whose size was set before the fetch, so nothing moves.

---

## src/ui/import.ts {#src-ui-import}

### src/ui/import.ts · queue and notice
- refers-to: src/ui/import.ts :: `importOne`, `importAll`
- kind: explainer
- logged: v0.3.0 · 2026-09-28

Files import one after another through a promise queue, each as its own undo step. The notice shows "Importing" only after 300 ms and holds it for 250 ms before the result, the same pattern as the engine chip. The input's value is cleared after reading so choosing the same file again still fires `change`.

---

## src/ui/shortcuts.ts {#src-ui-shortcuts}

### src/ui/shortcuts.ts · scope
- refers-to: src/ui/shortcuts.ts :: `bindShortcuts`
- kind: warning-context
- logged: v0.3.0 · 2026-09-28

Ignored while focus is in an input, textarea, select or editable element, so typing a name never undoes the session.

---

## src/styles/shell.css · v0.3.0

### src/styles/shell.css · #app height, defect fixed
- refers-to: src/styles/shell.css :: first rule, `html, body, #app`
- kind: warning-context
- logged: v0.3.0 · 2026-09-28

From v0.1.0 to v0.3.0's first pass, `#app` had no height, so the shell was only as tall as its content and the transport bar sat mid-window. v0.1.0 measured no layout shift because nothing changed size; its screenshots, which were not looked at, would have shown it. v0.3.0's import swapped a tall empty state for a short lane and the transport jumped 107 px (layout shift 0.0116, traced through the entry's sources). Adding `#app` to the full-height rule pins the transport to the window bottom: y=744 of 800 before and after an import, layout shift 0.

### src/styles/shell.css · lane head stacking
- refers-to: src/styles/shell.css :: `.fw-lane-head`
- kind: rationale
- logged: v0.3.0 · 2026-09-28

The head is sticky on the left so names stay visible when the timeline scrolls; clips are absolutely positioned later in the DOM and would paint over it, so the head takes `--z-raised` from the declared scale. No raw z-index.

---

## src/ui/transport.ts {#src-ui-transport}

### src/ui/transport.ts · what changes during playback
- refers-to: src/ui/transport.ts :: `placePlayhead`, `renderTransport`
- kind: rationale
- logged: v0.4.0 · 2026-09-28

The playhead moves by `transform` only, written when the value changes, so playback never touches layout; the clock changes its text; Play reflects state through `aria-pressed`. Verified v0.4.0 under 4x CPU and Fast 3G: layout shift 0 during playback, and the only mutations were the clock text, the playhead's style and `aria-pressed` (plus a `style` write on the hidden file input made by Playwright's file chooser, not by formwav). Buttons are found by their `aria-label`, which ties them to the English labels until the interface is translated; a `data-action` on the transport buttons replaces that when the shell next changes.

### src/ui/transport.ts · keys and seeking
- refers-to: src/ui/transport.ts :: keydown listener, lanes click listener
- kind: explainer
- logged: v0.4.0 · 2026-09-28

Space toggles play and Home goes to the start, both ignored in form fields and on focused buttons (where Space already activates the button). A click in a lane body seeks to that point: 150 px at 100 px per second landed on 72,000 samples, 1.500 s, in v0.4.0.

---

## src/audio/player.ts {#src-audio-player}

### src/audio/player.ts · contexts and loading
- refers-to: src/audio/player.ts :: `Player.ensure`, `loadInto`, `planClips`
- kind: rationale
- logged: v0.4.0 · 2026-09-28

The AudioContext runs at the session rate, so the core never resamples and the browser converts to the device rate. Media bytes come from `/api/media/{id}/audio` and are transferred, not copied, into the worklet, which decodes them with the Rust decoder. `planClips` turns the document into worklet clips: mute and solo honoured, gains in dB made linear, clips at another sample rate left out and counted (the notice says so). A document change while a context exists re-sends the plan, so gain changes are heard live.

### src/audio/player.ts · first play waits for the transfer
- refers-to: src/audio/player.ts :: `Player.play`
- kind: todo
- logged: v0.4.0 · 2026-09-28

The first play of a file waits for its bytes to reach the worklet: under the Fast 3G profile the 576 KB test file took about 3 s. Prefetching into the worklet on import, and a delayed "Loading audio" indicator, come next.

### src/audio/player.ts · bounce and the offline race
- refers-to: src/audio/player.ts :: `Player.bounce`
- kind: warning-context
- logged: v0.4.0 · 2026-09-28

Renders the session through the same worklet and core in an OfflineAudioContext. The first version posted `clips`, `seek` and `play` and started rendering at once; offline rendering finished before those messages were handled and the result was silent (null-test error equal to the signal peak). Messages are handled in order, so it now posts `clips` and `play`, then waits for the worklet's reply to a final `seek` before rendering. Verified: bit-identical to the source at unity gain, within 3.7e-8 at -6 dB.

---

## src/audio/player-worklet.ts {#src-audio-player-worklet}

### src/audio/player-worklet.ts · starting the core
- refers-to: src/audio/player-worklet.ts :: `PlayerProcessor` constructor, the `init` branch
- kind: warning-context
- logged: v0.4.0 · 2026-09-28

The first version posted a compiled `WebAssembly.Module` to the worklet; Chromium delivered no `init` and gave no error on the page, so playback stalled silently. The worklet now receives the wasm bytes (an ArrayBuffer always clones) and compiles them itself, and every message is handled inside a try that sends any failure back as an `error` reply, which `makeNode` turns into a thrown error.

### src/audio/player-worklet.ts · render loop
- refers-to: src/audio/player-worklet.ts :: `process`
- kind: todo
- logged: v0.4.0 · 2026-09-28

Renders into two wasm-side buffers sized for 4,096 frames and copies them out; posts the position every 8 render quanta and `ended` at the session end. It creates two small typed-array views per quantum, which allocates on the audio thread; caching the views (rebuilt only when memory grows) is the next refinement.

---

## v0.4.1 · playback polish

### src/audio/player.ts · prefetch and one load per file (resolves the v0.4.0 first-play todo)
- refers-to: src/audio/player.ts :: `prefetch`, `load`, `ensure`, `start`
- kind: rationale
- logged: v0.4.1 · 2026-09-28

Every document change checks for media not yet loading and, when the session has tracks, starts the context (suspended until Play, which satisfies autoplay rules) and transfers those files into the worklet. `load` keeps one promise per media id, so prefetch and Play share a transfer; `ensure` shares one in-flight `start`, so two callers never open two contexts; `start` clears the pending loads when it replaces a context. Verified v0.4.1 under 4x CPU and Fast 3G: with the prefetch finished, Play reached playing in 72 ms (about 3,000 ms in v0.4.0); pressed straight after import it took 3,277 ms, and in both cases the file was requested once.

### src/ui/transport.ts · loading notice
- refers-to: src/ui/transport.ts :: `togglePlay`
- kind: explainer
- logged: v0.4.1 · 2026-09-28

The same delayed-indicator pattern as import: "Loading audio" appears only if Play has not resolved after 300 ms, holds at least 250 ms, then gives way to the outcome (empty, the skipped-clip count, or the error). When Play is fast the notice is not touched at all: verified, no notice change after a prefetched Play.

### src/ui/transport.ts and src/ui/shell.ts · data-action (resolves the aria-label todo)
- refers-to: src/ui/shell.ts :: `TRANSPORT`, `transportButtons`; src/ui/transport.ts :: `button`
- kind: explainer
- logged: v0.4.1 · 2026-09-28

Each transport button carries `data-action` (to-start, play, stop, record, loop) and the wiring selects by it, so labels can change or be translated freely. Record and Loop's tooltips say they are not built yet, replacing the stale "arrives in v0.2.0".

### src/audio/player-worklet.ts · cached views (resolves the render-loop todo)
- refers-to: src/audio/player-worklet.ts :: `process`, `views`
- kind: explainer
- logged: v0.4.1 · 2026-09-28

The two output views are kept and rebuilt only when wasm memory grows (its buffer changes) or the block size changes, so the steady-state render loop allocates nothing. The offline null test runs through this loop and stayed bit-identical.

---

## src/ui/record.ts {#src-ui-record}

### src/ui/record.ts · flow
- refers-to: src/ui/record.ts :: `begin`, `finish`, `toggle`
- kind: explainer
- logged: v0.5.0 · 2026-09-28

Record, or R, asks for the microphone, starts the session playing open-ended (so the clock runs and existing tracks are heard) and arms the recorder at the current position. Record again, R, or Stop ends it: the take is assembled, encoded as a float32 WAV named "Take N", stored through the ordinary import route and dispatched as `import-media` at the position recording began, so it is one undo step like any import. Refused access and other failures are named in the notice. Verified v0.5.0 with Chromium's fake capture device playing a 440 Hz sine at 0.5: the take bounced back at peak 0.5000 and 440 Hz, a take started after seeking to 0.5 s landed at 24,000 samples, and undo removed it.

### src/ui/record.ts · meter and button states
- refers-to: src/ui/record.ts :: `showLevel`, `renderRecording`
- kind: rationale
- logged: v0.5.0 · 2026-09-28

The meter is created once at mount; its bar moves by `scaleX` on a -60 to 0 dBFS scale, written only when the value changes, and `aria-valuenow` changes only in tenths. A 0.5 input (about -6 dBFS) read `scaleX(0.9)`. Record's `aria-pressed` is rendered at mount, not on the first transport event: the lazy version wrote the attribute after reveal. Stop is enabled while recording even in an empty session, where `transport.ts` alone would keep it disabled until the first take lands; both screenshots of the first take found this.

### src/ui/record.ts · not yet
- refers-to: src/ui/record.ts :: module
- kind: todo
- logged: v0.5.0 · 2026-09-28

No latency compensation: a take is placed where recording started, not shifted by input and output latency, so overdubs sit late by the round trip until spike A measures it. No live lane while recording (the empty state stays until the first take lands). Take numbers restart with each page load.

---

## src/audio/recorder.ts {#src-audio-recorder}

### src/audio/recorder.ts · capture in the player's context
- refers-to: src/audio/recorder.ts :: `startRecording`
- kind: rationale
- logged: v0.5.0 · 2026-09-28

The microphone joins the player's AudioContext, so capture and playback share one clock and one sample rate (the session's); the browser converts the device's rate. Echo cancellation, noise suppression and automatic gain are off, because a recording tool must take the signal as it is. The recorder node has one silent output connected to the destination so it is always processed. `encodeWav` writes IEEE float 32 (format tag 3), which the Rust decoder reads, so a take loses no resolution.

---

## src/audio/recorder-worklet.ts {#src-audio-recorder-worklet}

### src/audio/recorder-worklet.ts · chunks and levels
- refers-to: src/audio/recorder-worklet.ts :: `process`, `flush`
- kind: explainer
- logged: v0.5.0 · 2026-09-28

Input is copied into 8,192-frame chunks per channel and transferred, not copied, to the main thread when a chunk fills and when recording stops; `stopped` follows the last chunk, so the take is complete when the main thread resolves. The peak is reported every 8 render quanta. One chunk buffer is allocated per 8,192 frames, not per quantum.

---

## src/audio/player.ts · v0.5.0

### src/audio/player.ts · playing is owned by the main thread (defect fixed)
- refers-to: src/audio/player.ts :: `onReply`
- kind: warning-context
- logged: v0.5.0 · 2026-09-28

Since v0.4.0, `play()` set playing true and then the worklet's reply to the preceding `seek` arrived saying `playing: false`, so the Play button un-pressed for one report interval (about 20 ms) before the next report pressed it again. v0.4.0's verification logged 3 `aria-pressed` changes on starting playback and it was not questioned; v0.5.0's recording run logged 5 where 2 were expected and the cause was traced. Position reports now update the position only; playing changes only through `play`, `stop` and the worklet's `ended`. Verified: 1 change on starting playback, 2 on starting a recording.

### src/audio/player.ts · open-ended play and context()
- refers-to: src/audio/player.ts :: `play(open)`, `sendPlan`, `context`
- kind: explainer
- logged: v0.5.0 · 2026-09-28

`play(true)` sends no end position, so the clock keeps running past the last clip while recording; `stop` clears it. `context()` gives the recorder the running context.

---

## src/ui/projects.ts {#src-ui-projects}

### src/ui/projects.ts · save and open
- refers-to: src/ui/projects.ts :: `save`, `open`, `withNotice`
- kind: explainer
- logged: v0.6.0 · 2026-09-28

Save (button, Enter in the name field, Cmd or Ctrl S) sends the current document under the field's name, "Untitled session" when empty. Open loads a session through `engine.loadDocument`, which replaces the document, clears undo history and resets the transport; the player then prefetches its media as for any document change. Opening over unsaved changes asks first with the browser's confirm dialog (unsaved means the document differs from the one last saved or opened and has tracks). Both show their pending text only after 300 ms, like import.

### src/ui/projects.ts · the Open popover, the first overlay
- refers-to: src/ui/projects.ts :: `show`, `close`, `popover`
- kind: rationale
- logged: v0.6.0 · 2026-09-28

Created once at mount inside `#overlay-root`, so no ancestor can clip or trap it, on the declared `--z-menu` layer (200). The list is filled by `patchList` while the popover is still hidden, then it is placed under the Open button and shown in one step, and focus moves to the first row. Escape, a pointer down outside it, or opening a session closes it; `aria-expanded` on Open follows. Verified v0.6.0 under 4x CPU and Fast 3G: opening a session after a reload gave layout shift 0, and every mutation was the popover's own position, visibility and list, `aria-expanded`, the lanes, the enabled transport buttons, the notice and the canvases. The same run recorded one `style` write on each of the two form inputs, which no formwav code path makes; its origin was not identified.

### src/ui/shell.ts · name-field class collision, defect fixed
- refers-to: src/ui/shell.ts :: the session-name input; src/styles/shell.css :: `.fw-session-name`
- kind: warning-context
- logged: v0.6.0 · 2026-09-28

The field was first given the class `fw-name`, which the brand label in the top bar already uses. `querySelector('.fw-name')` returned the brand span, so Save would have thrown reading `.value` of a span, and the new CSS restyled the brand label as an input. The harness failed to type into the field and a measurement of its box exposed the collision. The field is now `input.fw-session-name`, selected with its tag. Before naming a class, search the shell for it.

---

## src/io/projects-client.ts {#src-io-projects-client}

### src/io/projects-client.ts · calls
- refers-to: src/io/projects-client.ts :: `listProjects`, `saveProject`, `openProject`
- kind: explainer
- logged: v0.6.0 · 2026-09-28

Names are URL-encoded into the path; the document travels as JSON; an error reply's `detail` becomes the thrown message, which the notice shows.

### src/engine · loadDocument and History.clear
- refers-to: src/engine/index.ts :: `loadDocument`; src/engine/history.ts :: `clear`
- kind: explainer
- logged: v0.6.0 · 2026-09-28

Opening a session is not an undoable edit: history is cleared, so Ctrl Z cannot step back into the previous session. Verified: undo disabled after opening.

---

## v0.7.0 · track pan

### src/engine/document.ts · pan and set-track-pan
- refers-to: src/engine/document.ts :: `Track.pan`, `set-track-pan`
- kind: rationale
- logged: v0.7.0 · 2026-09-28

Pan runs from -1 (left) to 1 (right) and is optional on `Track`, so sessions saved before v0.7.0 open unchanged and read as centred. The command clamps to the range and is a no-op when the value is unchanged, so it never creates an empty undo step; it is undoable like every edit (verified). There is no pan control in the interface yet: the mixer arrives in Phase 3.

### src/audio/player.ts and player-worklet.ts · pan to the core
- refers-to: src/audio/player.ts :: `planClips`; src/audio/player-worklet.ts :: `WorkletClip`, `fw_add_clip`
- kind: warning-context
- logged: v0.7.0 · 2026-09-28

Each clip carries its track's pan (`?? 0`) to `fw_add_clip`; the pan law itself lives only in `render.rs`. `planClips` has a twin in `backend/app/services/render.py`: change both together, and rerun `verify_render.py`, whose null test between the browser's render and the engine's caught nothing in v0.7.0 (0.0 on both channels).

---

## v0.8.0 · fades, crossfades, clips

### src/engine/document.ts · clip commands
- refers-to: src/engine/document.ts :: `add-clip`, `remove-clip`, `set-clip-fades`, `crossfade`, `FadeShape`
- kind: rationale
- logged: v0.8.0 · 2026-09-28

`add-clip` places media already in the session onto a track (kept sorted by start) and `remove-clip` takes a clip off; together they let two clips overlap on one track, which import alone never produced. `set-clip-fades` clamps the fade-in to the clip and the fade-out to what remains, and is a no-op when nothing changes (verified: no undo step). `crossfade` finds the overlap of a left and a right clip on the same track and sets the left clip's fade-out and the right clip's fade-in to it, equal power unless told otherwise; a clip has one shape for both its fades, so a crossfade sets the shape of both clips. Fade fields are optional, so older sessions open without them. All four are undoable (verified for crossfade). No fade handles in the interface yet: fades are drawn and dragged with the editing surface in Phase 3, and the lanes do not show them.

### src/audio/player.ts and player-worklet.ts · fades to the core
- refers-to: src/audio/player.ts :: `planClips`; src/audio/player-worklet.ts :: `WorkletClip`, `fw_add_clip`
- kind: warning-context
- logged: v0.8.0 · 2026-09-28

Each clip carries `fadeIn`, `fadeOut` (0 when absent) and a shape code (1 equal power, 0 linear) to `fw_add_clip`; the curves live only in `render.rs`. The twin in `backend/app/services/render.py` changed in the same commit series; `verify_fades.py` compares the two renders.

---

## src/ui/loop.ts {#src-ui-loop}

### src/ui/loop.ts · Loop button, L key, band
- refers-to: src/ui/loop.ts :: `mountLoop`, `toggle`, `render`
- kind: explainer
- logged: v0.9.0 · 2026-09-28

Loop (button or L) toggles the saved loop range, or the first time loops the whole session. The button is disabled without tracks and pressed while the loop is on. The band is created once at mount inside the lanes, after the playhead, with no z-index: it paints over clips and under the sticky lane heads, lets clicks through, moves by `transform`, and writes its width only when it changes. Verified v0.9.0: after L the band was 300 px wide at 0 over a 3 s session; 4.5 s of playback kept playing, wrapped backwards and never passed the end; layout shift 0; mutations only the clock, playhead and Play's `aria-pressed` (plus the unexplained `style` writes on the two form inputs noted in v0.6.0).

### src/ui/loop.ts · band hard to see
- refers-to: src/ui/loop.ts :: band; src/styles/shell.css :: `.fw-loop-band`
- kind: todo
- logged: v0.9.0 · 2026-09-28

When the loop covers exactly a clip, as in the first-loop default, the band's tint and edges coincide with the clip's and it is barely visible (seen in the v0.9.0 screenshot). Loop markers belong in a timeline ruler, which arrives with the editing surface; there is also no way yet to set a custom range except the `set-loop` command.

### src/engine/document.ts · loop and regions
- refers-to: src/engine/document.ts :: `LoopRange`, `Region`, `set-loop`, `add-region`, `remove-region`
- kind: rationale
- logged: v0.9.0 · 2026-09-28

Both are optional on the document, so older sessions open without them, and both are saved in `.fmw` with the rest of the document. Commands normalise reversed bounds, refuse empty ranges, trim labels ("Region" when empty) and are no-ops when nothing changes. Loop changes are undo steps because the loop range is part of the saved session (verified: undo re-armed a disarmed loop, a second undo removed it). Regions have no interface yet. `sendPlan` sends the loop to the worklet and drops the end-stop while it is on, so a loop reaching past the last clip keeps playing.

---

## src/ui/export.ts and src/io/render-client.ts {#src-ui-export}

### src/ui/export.ts · Export
- refers-to: src/ui/export.ts :: `mountExport`, `run`; src/io/render-client.ts :: `renderMix`
- kind: explainer
- logged: v0.10.0 · 2026-09-28

Export (button or Cmd or Ctrl Shift E, disabled without tracks) posts the document to `/api/render` and downloads the returned WAV under the session name, with characters that file systems refuse replaced by hyphens. The download goes through a detached anchor, so nothing is inserted into the page, and the object URL is released after ten seconds. The notice reports the loudest peak in dBFS and the integrated loudness in LUFS ("silent" when there is none), and counts clips left out for being at another sample rate; "Exporting" appears only after 300 ms. Verified v0.10.0: the file saved by the browser was byte-identical to `/api/render` for the same document, the notice matched the response headers, layout shift 0. `render-client.ts` sits in `io/` beside the other clients; the io lines of the map above were not updated for it in this series.

---

## v0.11.0 · buses

### src/engine/document.ts · buses and routing
- refers-to: src/engine/document.ts :: `Bus`, `Track.busId`, `add-bus`, `remove-bus`, `route-track`, `set-bus-gain`, `set-bus-pan`
- kind: rationale
- logged: v0.11.0 · 2026-09-28

Buses are optional on the document and a track without `busId` feeds master, so older sessions open unchanged. `add-bus` trims the name ("Bus" when empty); `remove-bus` routes its tracks back to master in the same undo step; `route-track` refuses a bus that does not exist (verified: no undo step) and takes `null` for master; gain and pan setters are no-ops when unchanged. Verified: undoing a bus removal restored the bus and its routing. There is no bus strip in the interface yet: the mixer is Phase 3.

### src/audio/player.ts · bus resolution twin
- refers-to: src/audio/player.ts :: `planClips`, `ClipPlan.buses`; src/audio/player-worklet.ts :: `WorkletBus`, the clips handler
- kind: warning-context
- logged: v0.11.0 · 2026-09-28

`planClips` numbers unmuted buses from 1 in document order, drops tracks on muted buses, and gives each clip its bus index (0 for master or an unknown bus), exactly as `plan` in `backend/app/services/render.py`; the clips message carries the bus list and the worklet rebuilds the core's buses on every plan. Change both twins together and rerun `verify_buses.py`. The map gap noted for `render-client.ts` in v0.10.0 is closed above.

---

## v0.12.0 · save conflicts

### src/ui/projects.ts · known revision and the conflict prompt
- refers-to: src/ui/projects.ts :: `known`, `save`, `open`; src/io/projects-client.ts :: `saveProject`, `RevisionConflict`
- kind: rationale
- logged: v0.12.0 · 2026-09-28

Each window remembers the name and revision of the session it last saved or opened. Saving under that name sends its revision as `base`; saving under any other name sends 0, meaning "new". A 409 becomes `RevisionConflict` carrying the server's revision, and the window asks with the browser's confirm dialog: "already exists" for a new name, "saved from another window" otherwise. Declining leaves the saved file untouched and says so; accepting retries once against the server's revision. Verified v0.12.0 with three windows: A saved, B opened and saved over it, A was asked, declined (B's version kept), then accepted on the next save (revision 3, A's content); a fresh window saving under the same name was told it exists and declined. The v0.6.0 round-trip harness also crossed an "already exists" prompt and still null-tested at 0.

---

## src/ui/ruler.ts and the v0.13.0 timeline {#src-ui-ruler}

### src/ui/ruler.ts · one canvas
- refers-to: src/ui/ruler.ts :: `mountRuler`, `draw`, `label`
- kind: rationale
- logged: v0.13.0 · 2026-09-28

Created once at mount and inserted before the lanes, so it scrolls with them, sticky at the top on `--z-selected` with a sticky corner over the lane heads on `--z-raised`. Everything is drawn on one canvas, so zooming or editing never adds or removes DOM: labels at the first step in the list that leaves 80 px between labels, minor ticks at a fifth of that when they are at least 6 px apart, the loop range as a bar across the top (faded when off), regions as bars with labels along the bottom. Colours come from computed CSS on the canvas (`color`, `border-top-color`, `outline-color`), not tokens read in script. Redraws on document changes, zoom, theme changes and resize. A pointer down seeks. The region label touches the minor ticks (seen in the v0.13.0 screenshot); cosmetic, left for the ruler's next pass.

### src/styles/shell.css · ruler canvas overflow, defect fixed
- refers-to: src/styles/shell.css :: `.fw-ruler` `grid-template-rows`
- kind: warning-context
- logged: v0.13.0 · 2026-09-28

A canvas has an intrinsic height of 150 px. In the ruler's grid the row sized to that content, so the canvas overflowed its 32 px ruler and lay over the first lane, where it swallowed every pointer event: drags never reached the clip. The first timeline harness run surfaced it as a confusing failure (its Ctrl+Z then undid an import instead of a move); a step-by-step replay showed the drag had not committed, and `elementFromPoint` at the clip's centre returned the ruler canvas. `grid-template-rows: minmax(0, 1fr)` pins the row to the ruler's own height (31 px measured after); `overflow: hidden` was avoided because it would stop the sticky corner staying put in horizontal scroll.

### src/ui/lanes.ts · zoom
- refers-to: src/ui/lanes.ts :: `zoom`, `setZoom`, `onZoom`, `samplesPerPixel`
- kind: explainer
- logged: v0.13.0 · 2026-09-28

Zoom is view state, not document state, so it is not saved or undone. It multiplies the base 100 px per second, from 0.25 to 16, and is still capped by the 16,000-pixel timeline limit. `=` doubles, `-` halves, `0` resets; lanes, playhead, loop band and ruler all re-render through `onZoom`. Verified: at 2x clip widths doubled (300 to 600 px, 1000 to 2000 px) and the playhead moved from 100 to 200 px; halving twice gave 150 px; reset gave 300 px. There is no zoom control on screen yet, and zoom does not keep the playhead in view.

### src/ui/lanes.ts · select, slip, delete
- refers-to: src/ui/lanes.ts :: pointer handlers, `markSelected`, keydown handler; src/ui/transport.ts :: lanes click guard
- kind: rationale
- logged: v0.13.0 · 2026-09-28

A pointer down on a clip selects it and captures the pointer; moving more than 3 px starts a slip drag that moves the clip by `transform` only, clamped so it cannot pass time zero; release clears the transform and dispatches one `move-clip`, so a drag is one undo step and the committed position lands in the same frame. Delete or Backspace removes the selected clip (one undo step); Escape or a pointer down on empty lane space deselects. Clicks on clips no longer seek; empty lane space and the ruler do. Verified: a 100 px drag committed exactly 48,000 samples with only transform writes during the drag; undo, delete, undo delete, Escape and empty-lane deselect behaved; layout shift 0. Grid and shuffle modes, the smart tool, split and trim are the next Phase 3 steps.

---

## v0.14.0 · split, trim, fades on the timeline

### src/engine/document.ts · split-clip and set-clip-bounds
- refers-to: src/engine/document.ts :: `split-clip`, `set-clip-bounds`
- kind: rationale
- logged: v0.14.0 · 2026-09-28

`split-clip` cuts a clip at a session position strictly inside it: the left part keeps the clip's id and fade-in, the right part gets a new id, its source offset advanced by the cut (converted to source frames), and the fade-out; either part's fades are clamped to its new length. `set-clip-bounds` sets start, source offset and length together, refusing a negative start or offset, an empty clip, or one running past the end of its media, and clamps the fades. Both are no-ops when nothing changes. Verified: a split at 2.5 s rendered bit-identical to the unsplit clip (difference 0 over 480,000 frames); undo and redo.

### src/ui/lanes.ts · one gesture model
- refers-to: src/ui/lanes.ts :: `GestureKind`, `limits`, `preview`, `restore`, `commit`, pointer handlers
- kind: rationale
- logged: v0.14.0 · 2026-09-28

The pointer-down target decides the gesture: a fade handle is a fade, within 6 px of a side edge is a trim, anything else is a move. Each gesture's limits are worked out first, in pixels, so the preview can never show what the document would refuse (before time zero, before the source's start or past its end, fades crossing). The preview uses `transform`, and for trims the clip's own width; release restores the committed look and dispatches one command, so a gesture is one undo step. Trimming the left edge moves the start and the source offset together, so the audio stays where it was in time. Source offsets are taken as session samples, which holds while clips play at the session rate (other-rate clips are silent until resampling). Verified: a left-edge trim of 50 px gave 144,000 / 336,000 / source 144,000, silence in the gap and the source unchanged elsewhere; a right-edge trim gave 96,000; a trim past the source's start was clamped and recorded nothing; only clip `style` and selection changed during a drag.

### src/ui/lanes.ts and shell.css · handles, trim zones, drawn fades
- refers-to: src/ui/lanes.ts :: `clipNode`, `updateClip`, `paint`; src/styles/shell.css :: `.fw-clip::before`, `.fw-clip::after`, `.fw-fade-handle`, `.fw-wave`
- kind: explainer
- logged: v0.14.0 · 2026-09-28

Each clip is created with two fade handles in its top corners, placed by `transform` at the fade's length and shown on hover or selection. The trim zones are pseudo-elements down the clip's sides below a top band, so their `ew-resize` cursor shows without script and the corners stay with the handles. `paint` shades the cut-away area above each fade curve with the canvas's computed `outline-color` and follows the fade's shape. S splits the selected clip at the playhead. Verified: the fade-in handle dragged 50 px set 24,000 samples and the render ramped k / 24,000 within 2.7e-8; the fade-out handle dragged 100 px set 48,000; the screenshot showed both fades drawn and the handles in place. Grid snapping and shuffle mode are still to come.

---

## src/ui/grid.ts, the clip gain line and the transport row (v0.15.0) {#src-ui-grid}

### src/ui/grid.ts · one step for the ruler and the grid
- refers-to: src/ui/grid.ts :: `labelStep`, `snapSamples`, `mountGrid`; src/ui/ruler.ts :: `draw`
- kind: rationale
- logged: v0.15.0 · 2026-09-28

The step list the ruler used moved here so the ruler's labels and the grid's snap points cannot drift apart. Grid mode (the Grid button in the transport bar, or G) snaps the anchor edge of a move or a trim to the ruler's minor ticks, a fifth of the labelled step at the current zoom, so the grid tightens as you zoom in. Fades and gain are not snapped; seeks are not snapped yet. Verified at 100 px per second (0.2 s grid): a 37 px move landed on 17,760 without the grid and on 19,200 with it; a right-edge trim of -130 px put the end on 441,600.

### src/ui/lanes.ts · the clip gain line
- refers-to: src/ui/lanes.ts :: `gainFraction`, `gainLabel`, `dragGain`, `clipNode`, `updateClip`, the `gain` gesture; src/engine/document.ts :: `set-clip-gain`
- kind: rationale
- logged: v0.15.0 · 2026-09-28

Each clip has a line whose height maps +12 dB at the top to -36 dB at the bottom (0 dB a quarter of the way down), measured against the clip's client height, the same box its `top` percentage uses. Dragging it vertically previews by `transform` with a live dB label and commits one `set-clip-gain` (clamped to -60 to +12 dB, tenths, no-op when unchanged). The waveform is drawn scaled by the clip gain. Verified: a 22 px drag on an 86 px clip gave -12.3 dB (22 / 86 x 48); the render equalled the source times 10^(-12.3 / 20) within 6e-9; undo returned 0 dB. The first expectation of -12.0 dB used the clip's bounding height, borders included; the app's mapping was right.

### src/styles/shell.css · transport bar as a flex row, defect fixed
- refers-to: src/styles/shell.css :: `.fw-transport`
- kind: warning-context
- logged: v0.15.0 · 2026-09-28

The bar was a grid of three columns (`auto auto 1fr`) made for the controls and the clock; the meter appended in v0.5.0 took the third, and the Grid button, a fourth child, fell onto an implicit second row that overflowed the bar and pushed the meter out of it. Only the screenshot showed it. The bar is now a flex row: controls, clock, Grid and meter measured in one row inside the bar after the fix, and the recording regression's meter reading was unchanged.

---

## v0.16.0 · selections of several clips

### src/engine/document.ts · batch
- refers-to: src/engine/document.ts :: `batch`
- kind: rationale
- logged: v0.16.0 · 2026-09-28

`batch` applies a list of commands in order to the running document, so any group edit is one undo step and reuses the single-clip rules exactly; if nothing changes, nothing is recorded (verified: a clamped group move added no step).

### src/ui/lanes.ts · selection as a set, group gestures
- refers-to: src/ui/lanes.ts :: `selectedClipIds`, `Member`, `Gesture.group`, pointer-down, `preview`, `restore`, `commit`, keydown
- kind: rationale
- logged: v0.16.0 · 2026-09-28

Shift-click on a clip's body toggles it in the selection without dragging; a plain press on an unselected clip selects only that clip, on a selected clip keeps the group. Moving any selected clip moves the whole selection by the same amount, previewed by `transform` on every member; the left limit is the tightest across the group, so no member can pass time zero; in Grid mode the grabbed clip's edge snaps and the rest follow. Trims, fades and gain still act on the clip under the pointer. Cmd or Ctrl A selects all; S splits every selected clip the playhead is inside; Delete removes the selection; each is one `batch`. Escape or a plain press on empty lane space clears the selection; with Shift held it is kept. Verified with two clips on two tracks: a group move of 50 px moved both by 24,000 in one step and undo returned both; a -200 px group move held at the earlier clip's zero and recorded nothing; Shift-toggle, select all, Escape and the empty-space rules behaved; a group split made 2 + 2 clips and a group delete removed all, each one step.

### src/ui/transport.ts and ruler.ts · snapped seeks
- refers-to: src/ui/transport.ts :: lanes click; src/ui/ruler.ts :: pointerdown
- kind: explainer
- logged: v0.16.0 · 2026-09-28

In Grid mode a click on empty lane space or on the ruler moves the playhead to the nearest grid tick. Verified at 37 px: 19,200 with the grid, 17,760 without, on both. The first harness run clicked the lane where a clip lay (clicks on clips deliberately do not seek) and read stale positions; the saved harness clicks an empty lane. Each selected clip shows its gain label, and on a long clip it can be cut off at the window's edge (seen in the screenshot); cosmetic.

---

## src/ui/meter.ts and the output level path (v0.17.0) {#src-ui-meter}

### src/audio/player-worklet.ts and player.ts · peaks to listeners
- refers-to: src/audio/player-worklet.ts :: `report`, `peaks`; src/audio/player.ts :: `onOutputLevel`, `emitLevel`, `onReply`, `stop`
- kind: warning-context
- logged: v0.17.0 · 2026-09-28

Every position report (about every 21 ms while playing) takes the master peaks from the core into a two-float buffer allocated once at init and carries them to the main thread, where the player publishes them to its level listeners. Stop publishes silence. The first version froze the meter after stop: the worklet answers the stop message with a position report whose leftover peaks arrived after the silence, and no further report ever lowered them. Levels are now published only while the transport is playing, so that late report, and reports from seeking while stopped, are ignored (verified: both bars at 0 after stop).

### src/ui/meter.ts · the meter
- refers-to: src/ui/meter.ts :: `mountOutputMeter`
- kind: explainer
- logged: v0.17.0 · 2026-09-28

Created once at mount in the transport bar: two bars (left, right) on the input meter's -60 to 0 dBFS scale, moved by `scaleX` only and written only when the value changes; each bar shows the new peak or falls back at 20 dB per second, whichever is higher, and a report of two zeros empties both. A peak at or above 1.0 latches the clip indicator (the danger token) until it is clicked. Verified on the stereo test file: the right bar held exactly scaleX(0.867), which is -7.96 dBFS for its 0.4 sine, while the left bar climbed with its ramp; at +12 dB the clip indicator latched and a click reset it; during playback only the meter, clock, playhead and Play's pressed state changed; layout shift 0. The output and input meters sit side by side without labels (seen in the screenshot); "IN" and "OUT" labels are the next small fix. Loudness is not metered live yet.

---

## v0.18.0 · marquee selection, zoom anchor, meter labels

### src/ui/lanes.ts · marquee selection
- refers-to: src/ui/lanes.ts :: `marquee`, `box`, `updateMarquee`, `endMarquee`, `swallowClick`, pointer handlers
- kind: warning-context
- logged: v0.18.0 · 2026-09-28

A press on empty lane space starts a marquee; once the pointer has moved 4 px, one overlay created at mount is shown and moved by `transform` and its own size, and every clip whose box it touches is selected, live. Shift keeps the existing selection as the base. A marquee press prevents the browser's text selection; the click that follows a marquee release is swallowed so it cannot also move the playhead, and a plain click still seeks and clears. Four defects were caught before release, each by the harness or the screenshot. First, a local `box` in the pointer-down handler shadowed the marquee state; `tsc` failed, while the dev server, which does not type-check, threw at runtime, so the local is now `rect`. Second, capturing the pointer on every empty-space press retargeted the following `click` to the lanes element, where the seek handler found no lane body and did not seek; the pointer is now captured only once a marquee moves. Third, the swallow flag could outlive a release that produced no click and eat the next real one; it now clears once the event sequence finishes. Fourth, the screenshot showed lane-head text highlighted by the drag; the press now prevents default. Verified: a marquee across two lanes selected both clips during and after the drag without moving the playhead; an empty marquee cleared the selection; a Shift-marquee added a clip; no text was selected; a plain empty-space click still sought to 240,000 and cleared; only the overlay and `aria-selected` changed.

### src/ui/lanes.ts · zoom keeps the playhead in place
- refers-to: src/ui/lanes.ts :: `lastSpp`, the `onZoom` listener, `render`
- kind: explainer
- logged: v0.18.0 · 2026-09-28

`render` records the samples per pixel it drew with; on a zoom the playhead's on-screen offset is taken with the old value, and after the new render the stage's scroll is set so the playhead sits at the same offset (scrolling is not a layout shift). Verified: with the playhead at 500 px, zooming in 2x scrolled the stage to 500 and the playhead stayed at x = 692.

### src/ui/meter.ts and record.ts · IN and OUT labels
- refers-to: src/ui/meter.ts :: `mountOutputMeter`; src/ui/record.ts :: meter mount; src/styles/shell.css :: `.fw-meter-label`, `.fw-out-meter`
- kind: explainer
- logged: v0.18.0 · 2026-09-28

The output meter has an OUT label as its first grid column and the input meter an IN label before it, both in the muted mono token. Verified: both inside the transport bar (OUT at 406 px, IN at 563 px). The two-file harnesses report a layout shift of 0.0072 whose single source is the harness's scripted `move-clip` of a clip (no user input), not the app; single-file harnesses report 0.

---

## v0.19.0 · Shuffle mode

### src/ui/grid.ts and lanes.ts · gap-closing delete, rippling trims
- refers-to: src/ui/grid.ts :: `shuffleEnabled`, `mountGrid`; src/ui/lanes.ts :: `Gesture.ripple`, `Gesture.followers`, pointer-down, `preview`, `restore`, `commit`, keydown Delete
- kind: rationale
- logged: v0.19.0 · 2026-09-28

Shuffle mode (a button beside Grid, or H) makes edits keep a track's clips closed up. Delete removes the selection and moves each remaining clip left by the lengths of the removed clips before it on the same track, all in one `batch`. A trim ripples: trimming a clip's end moves every later clip on the track by the same amount; trimming its start keeps the clip where it is, advances the source and moves the later clips by the opposite amount. The followers are gathered at pointer-down and previewed by `transform`, so the drag shows exactly where the commit will put them; the bounds and every move go in one `batch`, one undo step. Moving a clip in Shuffle mode is still a slip move; reordering clips by dragging is not built yet, and neither is rippling across tracks. Verified on a 10 s sine split into three contiguous clips, each render compared with the source's surviving pieces joined end to end: deleting the middle clip gave 0.0 over 336,000 frames with the last clip at 96,000; trimming the first clip's end by 50 px previewed the later two at -50 px during the drag and rendered 0.0 over 456,000 frames; trimming the middle clip's start by 50 px kept it in place, previewed the last at -50 px and rendered 0.0; each was one undo step and undo restored the layout; with Shuffle off, Delete kept the gap; layout shift 0.

---

## v0.19.1 · gain label placement

### src/styles/shell.css · the gain label at the clip's start
- refers-to: src/styles/shell.css :: `.fw-gain-line::after`
- kind: explainer
- logged: v0.19.1 · 2026-09-28

The dB label was anchored to the gain line's right end, so a clip running past the window's right edge had its label cut off (recorded in v0.16.0). It now sits 12 px inside the line's start, clear of the fade-in handle in the top corner. Verified: with a short and a long clip selected, both labels started at x = 213 and x = 313 in a 1,280 px window, the long clip's line running on to x = 1,283; the screenshot showed both fully.

---

## v0.20.0 · clipboard, selection-wide fades and gain

### src/engine/document.ts and src/ui/lanes.ts · cut, copy, paste
- refers-to: src/engine/document.ts :: `paste-clip`; src/ui/lanes.ts :: `clipboard`, `selectedClips`, `removalCommands`, `paste`, keydown
- kind: rationale
- logged: v0.20.0 · 2026-09-28

Cmd or Ctrl C copies the selected clips, keeping their tracks and their offsets from the earliest; X copies and removes them through the same removal commands as Delete, so in Shuffle mode a cut closes the gap. V pastes at the playhead onto the same tracks with `paste-clip`, which keeps gain, fades and fade shape and lets the engine give each copy a new id; the copies become the selection by comparing ids before and after. In Shuffle mode, paste first moves every clip at or after the playhead on the target tracks right by the pasted span. Each is one `batch`, one undo step. Paste skips clips whose track has since been removed. Verified on a 10 s sine split in three: pasting the first clip at 10 s rendered the source followed by that clip, 0.0 over 576,000 frames, in one step with the copy selected; cutting the middle clip in Shuffle mode rendered 0.0 against the remaining pieces joined; pasting it back at 96,000 in Shuffle mode restored the original, 0.0 over 480,000 frames.

### src/ui/lanes.ts · fades and gain across the selection
- refers-to: src/ui/lanes.ts :: pointer-down group, `shiftGain`, `preview`, `restore`, `commit`
- kind: rationale
- logged: v0.20.0 · 2026-09-28

Dragging a fade handle or the gain line of a selected clip applies the same change to every selected clip. For fades the limits are the tightest across the group, so no clip's fades can cross; for gain the grabbed clip's dB change is added to each clip's own gain, clamped to the line's range. Every member's handle or line is previewed, and the commit is one `batch`. Verified with the first and last of three clips selected: a 50 px fade-in drag gave both 24,000 in one step and both rendered the k / 24,000 ramp within 2.7e-8 with the middle clip untouched (0.0); a 22 px gain drag gave both -12.4 dB in one step, both within 5.2e-9 of the source times the gain, the middle clip untouched.

---

## v0.21.0 · fade curves

### src/engine/document.ts, src/audio/player.ts, src/ui/lanes.ts · four curves, click to cycle
- refers-to: src/engine/document.ts :: `FADE_SHAPES`, `FadeShape`, `nextFadeShape`, `fadeCurve`; src/audio/player.ts :: clip plan; src/ui/lanes.ts :: `endDrag`, `paint`, `clipNode`
- kind: rationale
- logged: v0.21.0 · 2026-09-28

`FADE_SHAPES` is the one table of fade names and the core's codes; the `FadeShape` type is derived from it and the player maps through it, so a new shape cannot be half-wired. Clicking a fade handle without dragging cycles linear, equal-power, S-curve, exponential, as one `set-clip-fades` batch across the selected group; the handles' tooltips say so. `paint` draws the envelope with `fadeCurve`, the same formulas the core applies. Verified: each click was one undo step, four clicks returned to linear and undo stepped back to exponential; for each shape the browser's render matched the engine's (0.0 for linear and exponential, within 3e-8 for the sine and cosine curves) and the formula within 8.3e-8; the screenshot showed the four curves distinct.

### src/styles/shell.css · the gain label no longer covers fade handles, defect fixed
- refers-to: src/styles/shell.css :: `.fw-gain-line::after`
- kind: warning-context
- logged: v0.21.0 · 2026-09-28

Moving the gain label to the clip's start in v0.19.1 put it over a fade handle placed roughly 20 to 70 px in; because a pseudo-element's box belongs to its element for hit-testing and the gain line comes later in the clip, a press there started a gain gesture instead. The first harness run showed clicks on the handle doing nothing; a probe found `.fw-gain-line` under the click point. The label now has `pointer-events: none`; the line keeps its own 8 px band.

---

## v0.22.0 · per-track meters

### src/audio/player-worklet.ts, player.ts, src/ui/meter.ts, lanes.ts · track peaks to the lane heads
- refers-to: src/audio/player-worklet.ts :: `report`, `MAX_METERED_TRACKS`; src/audio/player.ts :: clip plan `track`, `onOutputLevel`; src/ui/meter.ts :: `mountTrackMeters`; src/ui/lanes.ts :: lane markup; src/styles/shell.css :: `.fw-lane-meter`
- kind: warning-context
- logged: v0.22.0 · 2026-09-28

The player numbers each clip's track by the document's track order; each worklet report takes the per-track peaks after the master pair from one buffer (up to 256 tracks) and the player passes them to level listeners beside the master peaks. Each lane head is created with a two-bar meter; `mountTrackMeters` drives it on the master meter's scale and 20 dB/s fall-back, writing a bar only when its value changes, and empties every lane on stop. Defect fixed before release: the lane meter reused `.fw-out-track`, whose `grid-column: 2` (from the transport meter's label column) made an empty implicit first column in the lane meter's grid, so each bar was 48 px wide starting at x = 60; the screenshot showed it, a measurement confirmed it, and the lane meter is now a flex column. Verified with two tracks: the 0.5 sine's lane held scaleX(0.9) (-6.02 dBFS) on both bars, the stereo file's right bar held 0.867 while its left climbed with its ramp, every lane emptied on stop, bars start at x = 12 beside the track name at 86 and 83 px wide, only meter bars, clock, playhead and Play's pressed state changed during playback, layout shift 0; master meter, playback null (0.0) and browser-versus-engine (0.0) regressions unchanged.

---

## v0.23.0 · Shuffle reordering and Spot mode

### src/ui/lanes.ts · Shuffle reorder
- refers-to: src/ui/lanes.ts :: `shuffleLayout`, `Gesture.reorder`, pointer-down, `preview`, `commit`
- kind: rationale
- logged: v0.23.0 · 2026-09-28

In Shuffle mode, dragging one clip reorders it by the same rule as Shuffle cut and paste: the clip is lifted out (clips after it close its gap), then inserted at the clip boundary nearest to where it is dropped (clips at or after that boundary move right by its length). Gaps between the other clips are kept. `shuffleLayout` computes every clip's new start; the preview places every clip on the track there by `transform`, so the drag shows the result, and the commit sends only the changed starts as one `batch`. Dropping near the original place changes nothing and records nothing. Moving several selected clips in Shuffle mode is still a slip move. Verified on a 10 s sine split in three: dragging the first clip to the end previewed it at +800 px and the others at -200 px mid-drag, committed in one step, and rendered 0.0 against the pieces in the new order; moving the last clip to the front rendered 0.0; a 10 px nudge recorded nothing.

### src/ui/grid.ts and lanes.ts · Spot mode
- refers-to: src/ui/grid.ts :: `spotEnabled`, `mountGrid`; src/ui/lanes.ts :: `spot`, `openSpot`, `closeSpot`, `parseTime`, `formatTime`, pointer-down
- kind: warning-context
- logged: v0.23.0 · 2026-09-28

Spot mode (a button beside Grid and Shuffle, or T) turns a press on a clip body into a small field over the clip, prefilled with its start as m:ss.mmm and selected. Enter moves the clip to the typed time (seconds or m:ss.mmm, converted to the nearest sample) as one undo step; invalid text is flagged and changes nothing; Escape or leaving the field closes it. Keys typed into the field never reach the global shortcuts. Defect fixed before release: closing the field hid it but left it focused, so every global shortcut, which ignores keys aimed at an input, went dead until the next click; closing now releases focus. Verified: 7.5 moved a clip to exactly 360,000 in one step; 1:00.5 gave 2,904,000; "2t" was flagged, changed nothing, and its "t" did not toggle Spot mode; after Escape the field held no focus and Space started playback; the screenshot showed the field on the clip with its time selected.

---

## src/ui/normalize.ts and group trims (v0.24.0) {#src-ui-normalize}

### src/ui/normalize.ts · loudness normalization
- refers-to: src/ui/normalize.ts :: `mountNormalize`; src/io/render-client.ts :: `renderMix`; src/main.ts :: mount
- kind: warning-context
- logged: v0.24.0 · 2026-09-28

A Loudness button after Export opens a popover (created once, fixed, placed by `transform`, on the registered menu layer) with a target of -14, -16 or -23 LUFS. Apply measures the integrated loudness (BS.1770, the engine's meter) of the selected clips, or of every clip when none are selected, as they play in the session, by rendering a copy of the session holding only those clips; it then changes each chosen clip's gain by the difference in one `batch`. Integrated loudness moves one-for-one with gain, so the result lands on the target within the 0.1 dB step that clip gain is stored in; clips that would pass +12 dB stop there and the status says so; silence and an unreachable engine are reported, not guessed. Two defects were fixed before release: the stylesheet named `--z-popover`, which is not in the registry, and would have computed to `auto` (now `--z-menu`, as the Open menu uses); and Escape did not close the popover once Apply's disabled state had dropped focus to the page (Escape is now handled at the document while the popover is open). The button is text-only while its neighbours carry icons; cosmetic. Verified: one selected clip from -6.7 to -23 LUFS measured -23.0 afterwards with the other clip untouched, one undo step, undo restored; every clip from -5.85 to -16 LUFS measured -15.95 (the stored -10.15 dB rounded to -10.1); Escape and an outside click close the popover; layout shift 0.

### src/ui/lanes.ts · group trims
- refers-to: src/ui/lanes.ts :: pointer-down group, `preview`, `restore`, `commit`
- kind: explainer
- logged: v0.24.0 · 2026-09-28

Outside Shuffle mode, dragging either edge of a selected clip trims every selected clip by the same amount, with the tightest limits across the group, every member previewed, and one `batch` of bounds; in Shuffle mode a trim still ripples its own track only. The commit function's unused locals were removed. Verified on a 10 s sine split in three: trimming the starts of the first two by 50 px moved both starts and sources by 24,000 in one step and rendered 0.0 against the expected silence-and-source layout; trimming the ends of the first and last by 50 px did the same, the middle clip untouched. The first run of the second case trimmed all three clips because the selection from the first case was still active; that was correct behaviour and the harness now clears the selection first.

---

## src/ui/arm.ts and recording into a track (v0.25.0) {#src-ui-arm}

### src/ui/arm.ts, lanes.ts, record.ts, meter.ts, src/engine/document.ts · track arming
- refers-to: src/ui/arm.ts :: `armedTrack`, `setArmedTrack`, `onArm`, `recordingTrack`, `setRecordingTrack`; src/ui/lanes.ts :: lane markup, `updateLane`, arm click; src/ui/record.ts :: `showLevel`, `begin`, `finish`; src/ui/meter.ts :: `mountTrackMeters`; src/engine/document.ts :: `import-media` `trackId`
- kind: rationale
- logged: v0.25.0 · 2026-09-28

Each lane head has a record-arm button; one track can be armed at a time, and arming is interface state like the selection, so it never enters undo history or the saved session. Recording starts into the armed track if it still exists (the notice names it); while it runs, the input level that drives the transport IN meter also drives that track's header meter, and the playback meter leaves that track alone so the two never write the same bars. On stop the take is imported with `import-media` naming the track, which adds the take as a clip on it at the recording's start instead of creating a track; with nothing armed recording makes a new track as before. The recording track is cleared on every path, saved, empty or failed. Verified with Chromium's fake microphone fed a continuous 440 Hz file: arming one track then another left exactly one armed and clicking again disarmed, with no undo steps; recording from 5 s showed scaleX(0.9) on the armed track's header, equal to the IN meter (the 0.5-peak tone), and 0 on the other track, whose clip had ended; the take landed on the armed track at exactly 240,000 in one undo step and undo removed it; the header meter reset after stop; unarmed recording made a new track; layout shift 0. The first run used the default fake microphone, which beeps once a second, and read 0 between beeps on both the IN meter and the header; the harness now uses the same capture file as the v0.5.0 recording harness. The unarmed button is faint against the header; cosmetic.

---

## v0.26.0 · punch-in

### src/ui/ruler.ts · drag to set the loop range
- refers-to: src/ui/ruler.ts :: `pending`, pointer handlers, `draw`
- kind: explainer
- logged: v0.26.0 · 2026-09-28

Dragging across the ruler by more than 4 px sets the loop range (snapped to the grid in Grid mode); the band follows the drag on the canvas and the range is committed on release as one `set-loop`, keeping whether looping is on. A plain click still seeks, now on release. Before this the range could only be the whole session. Verified: a drag from 100 to 200 px at 100 px per second set 48,000 to 96,000 in one undo step; a click seeked to 24,000 and left the range alone; `pending` is declared before the ruler's first draw, and the page logged no errors.

### src/ui/record.ts and grid.ts · punch-in on the armed track
- refers-to: src/ui/record.ts :: `punchRange`, `punchCommands`, `begin`, `finish`, the punch auto-stop subscription; src/ui/grid.ts :: `punchEnabled`, `mountGrid`
- kind: rationale
- logged: v0.26.0 · 2026-09-28

With Punch on (button or P), a track armed and a loop range ahead of the playhead, recording is a punch: the take is captured from the playhead as usual, but only the part inside the range is kept; the armed track's clips are cut at the in and out points (the part before keeps its fade-in and loses its fade-out, the part after is re-created at the right source offset, anything inside is removed) and the take goes in between, all in one `batch`. Recording stops by itself at the out point, or if looping wraps the playhead back. Without an armed track, Punch records normally and the notice says a track must be armed. Recording latency is not compensated yet (the latency spike is still pending), so a punched take can sit a device latency late on real hardware; the harness's fake microphone has none. Verified with the fake microphone fed a continuous 440 Hz file, punching 1 to 2 s into the 3 s stereo file: the notice announced the punch, recording stopped by itself, the track became the original 0 to 1 s, the take at 48,000 for 48,000 samples and the original from 96,000 at source offset 96,000; the render equalled the original exactly before and after the range with the 0.5-peak take inside; one undo step, undo restored the single clip; Punch without an armed track recorded a new track with the explanation; layout shift 0.

---

## v0.27.0 · live loudness

### src/audio/player-worklet.ts, player.ts, src/ui/meter.ts · M, S and I in the transport bar
- refers-to: src/audio/player-worklet.ts :: `report`, `play`, the end-of-material branch, `sampleRate`; src/audio/player.ts :: `onOutputLevel`, `emitLevel`, `onReply`, `lastIntegrated`; src/ui/meter.ts :: `mountOutputMeter`; src/styles/shell.css :: `.fw-lufs`
- kind: warning-context
- logged: v0.27.0 · 2026-09-28

Every play resets the core's live meter at the context's rate; every report carries momentary, short-term and integrated loudness beside the peaks; a fixed-width readout after the OUT meter shows them, written at most five times a second and only on change, "--" until 400 ms (M) or 3 s (S) have been measured, M and S blanked when playback stops and I kept. Defect fixed before release: at the natural end of playback the worklet sent only `ended`, which the player turned into a stopped transport without any level update, so the readout kept its last throttled value (I read -8.6 against the engine's -8.24) and the peak bars froze on their last values (a latent fault since v0.17.0, whose harnesses stop with Space). The worklet now reports once more before `ended`, and on `ended` the player publishes silent peaks and the final integrated value, which the readout writes at once. The build also needed a `declare` for the worklet's `sampleRate` global, which the dev server had not type-checked. Verified: over the 3 s stereo file the readout ended at I -8.2 with M and S blanked, 0.04 from the engine's offline -8.24; every bar read 0 after the natural end; the readout kept its 224 px width and was written 13 times in 3 s; no page errors; layout shift 0; playback null, natural end, master meter and track meter regressions unchanged.

---

## v0.28.0 · loop recording with alternate takes

### src/engine/document.ts, src/ui/record.ts, src/ui/lanes.ts · takes as source offsets
- refers-to: src/engine/document.ts :: `Clip.takes`, `Clip.take`, `set-clip-take`, `import-media` `clip`; src/ui/record.ts :: `loopRange`, `begin`, `finish`; src/ui/lanes.ts :: `clipNode`, `updateClip`, take badge click, pointer-down; src/styles/shell.css :: `.fw-take`
- kind: rationale
- logged: v0.28.0 · 2026-09-28

With looping on and Punch off, recording from before or inside a loop range keeps capturing as the playhead wraps. On stop the whole capture is imported once, and every complete pass through the range becomes a take: from before the range pass k starts at (loop start minus recording start) plus k loop lengths; from inside it the partial first pass is skipped. Because all takes cover the same range, a take is just a source offset into the same media, so the clip on the loop range carries `takes` (offsets) and `take` (the one that plays), and switching takes changes only its `sourceIn`: the core, the player and the engine are unchanged. On an armed track the range is replaced the same way as a punch. With no complete pass the recording is kept whole, as before. A badge on the clip ("Take 2/3") plays the next take as one undo step; presses on it never start a drag. Comping between takes needs take lanes and is the next step. Verified with the fake microphone fed the 3 s stereo ramp (a steady sine would make every one-second pass identical): looping 1 to 2 s on an armed 10 s tone and recording from 0 for about 3.8 s gave one undo step, the original 0 to 1 s, a clip at 48,000 with takes [48,000, 96,000] and the second playing, and the original from 2 s; the render inside the range equalled the take media at the active offset exactly and the tone outside was untouched; the badge read Take 2/2, switched to Take 1/2 in one undo step with the render then equal to the media at 48,000 exactly, and undo returned to take 2; no page errors; layout shift 0; punch, arming, edit and clipboard regressions unchanged.

---

## v0.29.0 · takes through edits, comping

### src/engine/document.ts, src/ui/lanes.ts · take offsets follow the source offset
- refers-to: src/engine/document.ts :: `split-clip`, `set-clip-bounds`; src/ui/lanes.ts :: `paste`; src/styles/shell.css :: `.fw-take`, `.fw-gain-line::after`
- kind: warning-context
- logged: v0.29.0 · 2026-09-28

A take clip keeps `sourceIn === takes[take]`, every offset pointing at the same moment of its pass. v0.28.0 broke that under two edits, found by reading the reducers before building comping: `split-clip` gave the right piece a shifted `sourceIn` but copied `takes` unchanged, and `set-clip-bounds` shifted `sourceIn` on a start trim without the takes, so switching takes on such a piece jumped to the wrong place in the capture; and clipboard paste dropped a clip's takes. Now split and trim shift every take offset by the same amount as `sourceIn`, a trim that would put any take outside its media is refused (no change, no undo step), and paste keeps the takes and the active take. That makes comping work with existing tools: split the take clip where the take should change, then choose each piece's take with its badge. A view of all takes as lanes is not built yet. Badges and gain labels no longer wrap onto two lines on narrow pieces (seen in the screenshot). Verified with two loop-recorded takes over 1 to 2 s: a split at 1.5 s gave the right piece takes [72,000, 120,000]; switching the left piece to take 1 rendered media[48,000:72,000] then media[120,000:144,000] exactly, the tone outside untouched, in one undo step; a 10 px start trim of the right piece shifted its takes to [76,800, 124,800] and switching then played the media at 76,800 exactly; extending the right piece past take 2's media was refused with no undo step; a paste kept its takes; every badge measured 16 px (one line); no page errors; layout shift 0; loop take, edit, clipboard, group trim and punch regressions unchanged.

---

## v0.30.0 · take lanes

### src/engine/document.ts, src/ui/lanes.ts, shell.css · every take as a lane, comp by drag
- refers-to: src/engine/document.ts :: `comp-range`; src/ui/lanes.ts :: lane markup, `updateLane`, `updateTakeSegment`, `expandedTracks`, Takes toggle, `takeDrag`, `takeRange`, `startTakeDrag`, `endTakeDrag`, pointer-down; src/styles/shell.css :: `.fw-lanes`, `.fw-lane`, `.fw-take-rows`, `.fw-take-row`, `.fw-takes-toggle`
- kind: warning-context
- logged: v0.30.0 · 2026-09-28

A track with loop-recorded takes shows a Takes toggle; expanded (interface state, like the selection) it adds one row per take under its main row, in the lane grid's body column. Each take segment is the clip drawn by the existing `clipNode` and `updateClip` from that take's offset, without fades or gain and with a synthetic id so it never shows as selected, marked `aria-current` where that take plays; rows and segments are patched by key, written only on change. Dragging across a take segment previews the range with the marquee overlay and commits `comp-range`, which splits the piece at the range edges (each piece's take offsets shifted to its start) and gives the middle the dragged take, one undo step; a click without dragging chooses that take for the whole piece; Grid snaps the range. Presses in the take rows never start clip gestures or the marquee. Two layout defects were found by the harness before release: lanes were fixed at 96 px by the container's `grid-auto-rows`, so expanded rows overflowed (a second track's lane would have been drawn over); lanes may now grow, with the first row pinned so the head, main clips and meters are unchanged; and pinning the row at 96 px made every lane 97 px because the lane's bottom border now added to it, so the row is 96 px less 1 px. The head column beside the take rows has no row labels yet, and a very narrow piece's badge is clipped; cosmetic. Verified with two loop-recorded takes over 1 to 2 s: the toggle showed two rows with the playing take marked, segments aligned with the main clip at x = 292; the lane grew from 96 to 193 px, its rows ending above a second track's lane, and collapsing restored 96; dragging 1.25 to 1.75 s across take 1 gave, in one step, take 2 then take 1 from 60,000 to 84,000 then take 2, each part of the render equal to its take's media exactly and the tone outside exact, the rows' marks following; clicking the middle piece in the take 2 row switched it exactly; undo walked back; no page errors; layout shift 0; timeline, marquee, track meter and selection regressions unchanged.

---

## v0.31.0 · automation

### src/engine/document.ts, src/audio/player.ts, player-worklet.ts · volume and pan automation
- refers-to: src/engine/document.ts :: `AutoPoint`, `Track.automation`, `set-automation`; src/audio/player.ts :: `planClips`; src/audio/player-worklet.ts :: `WorkletClip.gainPoints`, `WorkletClip.panPoints`, the clips handler
- kind: rationale
- logged: v0.31.0 · 2026-09-28

A track may carry volume automation (dB) and pan automation (-1 to 1) as time-sorted points, set a parameter at a time by `set-automation` (rounded times, clamped values, one point per time, an empty list removing it; one undo step). When present, each replaces the track's static fader or pan; clip gain still applies. The player gives each of the track's clips the flattened points, and the worklet loads them as core envelopes as it loads the clips, copying each into core memory and freeing it straight after, so repeated edits do not leak. Verified: browser and engine renders identical with volume automation (0.0) and within 3e-8 with pan automation.

### src/ui/lanes.ts · the volume automation lane
- refers-to: src/ui/lanes.ts :: `autoTracks`, `drawVolumeLane`, `updateLane`, Auto toggle, `autoPointAt`, `startAuto`, `previewAuto`, `endAuto`, pointer-down; src/styles/shell.css :: `.fw-auto-rows`, `.fw-auto-row`, `.fw-auto-svg`, `.fw-auto-line`, `.fw-auto-toggle`
- kind: warning-context
- logged: v0.31.0 · 2026-09-28

The Auto toggle in each lane head shows a volume automation lane under the track, in the same growable lane row as take lanes: an SVG line through the points (held before the first and after the last) with a circle per point, written only on change; with no automation a dashed line shows the static fader level. A click on the lane adds a point and a drag moves it (kept between its neighbours, snapped to the grid), Alt-click deletes one; each gesture is one `set-automation`. Pan automation plays but has no lane yet. Defect fixed before release: the pointer was mapped against the lane container, whose 1 px top border the drawing does not include, so a point landed about 0.7 dB from the cursor (-0.7 instead of 0); it is now mapped against the drawn row. Verified with the 10 s tone at 100 px per second: clicks added (48,000, 0 dB) and (144,000, -12 dB), one step each; a drag moved the second to (168,000, -24 dB) in one step; the browser's render equalled the engine's exactly and the gain equalled f32 interpolation exactly at 355 probes; Alt-click deleted a point; undo walked back to no automation; the lane added 49 px and collapsing restored 96; no page errors; layout shift 0; take lane and browser-versus-engine regressions unchanged.

---

## v0.32.0 · pan automation lane

### src/ui/lanes.ts, shell.css · Volume and Pan rows
- refers-to: src/ui/lanes.ts :: `AutoParam`, `autoFraction`, `autoValue`, `drawAutoLane`, `updateLane`, `autoPointAt`, `startAuto`, `previewAuto`, `endAuto`, lane markup; src/styles/shell.css :: `.fw-auto-row`, `.fw-auto-heads`
- kind: warning-context
- logged: v0.32.0 · 2026-09-28

The Auto panel now holds a Volume row and a Pan row. Drawing and gestures are one implementation keyed by parameter: `autoFraction` and `autoValue` are the only mappings (volume +12 to -36 dB down the row; pan left at the top, centre in the middle, right at the bottom), so drawing and pointer input cannot disagree; each row's press finds its own row and parameter and commits one `set-automation`. With no pan automation a dashed line shows the track's static pan. The labels live in the lane grid's header column beside the rows, sticky on the left like the track head: the first version put them at each row's right end, which is the timeline's right end and off-screen on any session wider than the window (seen in the screenshot). While moving them, an edit dropped the take-rows container from the lane markup; it was restored before any build, and the take-lane harness passed afterwards. A point at an extreme value (hard pan, +12 or -36 dB) is drawn half-clipped by its row's edge; insetting it changes the coordinates the exact-value harnesses use, so it is left for a pass of its own. Verified with the 10 s tone at 100 px per second: clicks at the pan row's top and bottom edges added (48,000, -1) and (144,000, +1), one step each; a drag to mid-height gave (168,000, 0) in one step; the browser's render equalled the engine's (0.0 left, 3e-8 right), the right channel was exactly silent while hard left and the channels exactly equal while centred; Alt-click deleted and undo walked back; the volume row stayed untouched; the labels sat at x = 12 in the header column, each centred on its row; no page errors; layout shift 0; volume lane and take lane regressions unchanged.

---

## src/ui/mixer.ts and the mute and solo commands (v0.33.0) {#src-ui-mixer}

### src/engine/document.ts · mute, solo and bus mute
- refers-to: src/engine/document.ts :: `set-track-mute`, `set-track-solo`, `set-bus-mute`
- kind: rationale
- logged: v0.33.0 · 2026-09-28

Tracks had `mute` and `solo` fields and buses a `mute` field, all honoured by the player and the engine since v0.11.0, but no command could set them; found while building the mixer. Three undoable commands now do, each a no-op when nothing changes.

### src/ui/mixer.ts, meter.ts, main.ts, shell.css · the mixer
- refers-to: src/ui/mixer.ts :: `mountMixer`, `stripNode`, `updateStrip`; src/ui/meter.ts :: `mountTrackMeters`; src/styles/shell.css :: `.fw-mixer`, `.fw-strip`, `.fw-strip-fader`
- kind: warning-context
- logged: v0.33.0 · 2026-09-28

A Mixer button in the transport bar (or X) shows a panel docked over the bottom of the timeline, fixed, so the lanes never reflow. It holds a strip per track (name, stereo meter, vertical fader with a dB readout, pan, mute, solo, output to Master or a bus) and per bus (fader, pan, mute), patched by key and written only on change. A fader or pan drag updates the readout live and commits one command on release; controls that automation drives are disabled and say so. The track meter driver also feeds the strips' bars, so a strip and its lane show the same level. Found and fixed before release: the strips' single grid column sized itself to the range inputs' natural width, so their contents spilled into neighbouring strips (the column is now the strip's width); and in `writing-mode: vertical-lr` a range input's block size is its width, so the fader's intended height made it 128 px wide (its length is now set with `inline-size`, 16 by 128 px). Known gaps: buses are not metered yet, so bus strips hide their meter rather than show a meter that always reads silence; there is no master fader, and no sends or inserts; a focused mixer button handles Space itself (the browser's accessible default) rather than starting playback. Verified with two tracks and a bus: three strips in order, the bus without solo or output, the panel's bottom at the transport's top; a real fader drag was one undo step with the track's gain equal to the fader's value; pan landed exactly; muting, soloing the other track, and routing to a muted bus each left the mix exactly silent where only that track played, the browser's render equal to the engine's; automation disabled the fader and read "auto"; during playback a strip's meter equalled its lane's (0.758 and 0.867); no strip child overflowed its strip; no page errors; layout shift 0; the track meter regression unchanged. The harness first pressed Space with a Mute button still focused, so playback never started and every meter read 0; it now clears focus first.

---

## v0.34.0 · master fader

### src/engine/document.ts, src/audio/player.ts, player-worklet.ts, src/ui/mixer.ts · Master strip
- refers-to: src/engine/document.ts :: `SessionDoc.masterGainDb`, `set-master-gain`; src/audio/player.ts :: `ClipPlan.masterDb`, `planClips`, both clips sends; src/audio/player-worklet.ts :: clips message, handler; src/ui/mixer.ts :: master strip, master meter listener; src/main.ts :: `mountMixer` now takes the player
- kind: warning-context
- logged: v0.34.0 · 2026-09-28

The session carries an optional master fader (`masterGainDb`, absent meaning 0 dB), set by `set-master-gain` (clamped, tenths of a dB, one undo step). The plan carries it, both the live and the bounce sends pass it, and the worklet hands it to the core. The mixer ends with a Master strip holding only a fader, its readout and a meter driven by the output peaks on the same scale and fall-back as the other meters. The first build failed `tsc` because `masterDb` was added to the plan's returned object but not to the `ClipPlan` type (the dev server does not type-check, so the harness ran regardless); the type and the player's initial empty plan now carry it. Bus metering, planned beside the master fader, was split into its own release. Verified: the Master strip came last with pan, mute, solo and output hidden; a -6 dB move was one undo step; the bounce equalled the engine's render exactly and equalled the unity bounce times f32(10^(-6/20)) exactly; during playback the Master strip's meter equalled the OUT meter (0.8, the 0.5 tone at -12 dBFS); undo restored 0 dB; no page errors; layout shift 0; mixer and render-parity regressions unchanged.

---

## v0.35.0 · bus metering

### src/audio/player-worklet.ts, player.ts, src/ui/mixer.ts, shell.css · bus meters on the strips
- refers-to: src/audio/player-worklet.ts :: `MAX_METERED_BUSES`, peaks buffer, `report`, `busPeaks`; src/audio/player.ts :: `onOutputLevel`, `emitLevel`; src/ui/mixer.ts :: meter driver; src/styles/shell.css :: `.fw-strip[data-kind="bus"]`
- kind: warning-context
- logged: v0.35.0 · 2026-09-28

Position replies now carry per-bus peak pairs, taken into the same buffer after the loudness values (up to 64 buses). Level listeners receive them as an optional last argument that defaults to empty, so every stop, end and not-playing path publishes silent bus levels unchanged. The mixer drives the Master and bus strips from one function with the other meters' scale and fall-back, and bus strips show their meter again (v0.33.0 hid it while it could not work). Ordering hazard, checked before wiring: the core reports buses in plan order, and the plan leaves muted buses out, so matching peaks to strips by document index would show a later bus's level on the wrong strip whenever an earlier bus is muted; the mixer walks the document's buses, advancing only past unmuted ones, and a muted bus reads silent. Verified with two tracks each routed to its own bus: bus meters visible; during playback each bus strip equalled its track's lane meter (0.9 and 0.9; 0.753 and 0.867); with the first bus muted it read silent and the second still showed its own track's level (0.756 and 0.867); no page errors; layout shift 0; mixer, master, buses (browser equal to engine), track meter and output meter regressions unchanged.

---

## v0.36.0 · cosmetic polish

### src/ui/lanes.ts, normalize.ts, shell.css · the four recorded cosmetic debts
- refers-to: src/ui/lanes.ts :: `AUTO_INSET`, `drawAutoLane`, `autoPointAt`, lane markup, `updateLane` (take labels); src/ui/normalize.ts :: Loudness button; src/styles/shell.css :: `.fw-arm`, `.fw-take-heads`, `.fw-auto-heads`
- kind: explainer
- logged: v0.36.0 · 2026-09-28

Automation rows now keep a 5 px inset (the point radius plus stroke) above the top value and below the bottom one, applied identically in the drawing and in the pointer mapping, so points at extreme values sit fully inside their row and still land exactly under the cursor; presses beyond the inset clamp to the extreme. The volume harness's click positions were moved onto the inset scale, its expected values unchanged. Take lanes have Take 1 to N labels in the header column, sharing the automation labels' styling, in the row below the automation rows when both are open. The Loudness button carries the waveform icon and a label span, like Export. The unarmed arm button's border uses the secondary text colour on the primary background, so it is visible without looking armed, and previews red on hover. Verified: pan points at hard left and right drew at y 5 and 43, each fully inside the 48 px row with its stroke, still exactly -1 and +1, the right channel exactly silent while hard left; volume points still exactly 0, -12 and -24 dB with the render exact against the engine and f32 interpolation; Take 1 to 3 labels centred on their rows with and without the automation rows open, and the automation labels centred beside take lanes; the Loudness button showed its icon and label (screenshot); the arm button's border matched --text-secondary and turned to the danger colour on hover; no page errors; layout shift 0; loudness normalization, arming and take lane regressions unchanged.

---

## v0.37.0 · Smart Tool

### src/engine/document.ts, src/ui/lanes.ts, shell.css · range selection in a clip's upper half
- refers-to: src/engine/document.ts :: `clear-range`; src/ui/lanes.ts :: `GestureKind` (`range`), `limits`, zone detection, `range`, `rangeDrag`, `startRange`, `drawRange`, `clearRange`, hover zones, `fw-lanes-rendered`, the keyboard handler; src/styles/shell.css :: `.fw-range`, `.fw-clip[data-zone]`
- kind: warning-context
- logged: v0.37.0 · 2026-09-28

The pointer now works as Pro Tools' Smart Tool: on a clip, the edges trim, the top corners set fades, the upper half of the body selects a time range and the lower half moves the clip; hovering shows an I-beam or a grab cursor by zone. A plain click anywhere on the body still selects the clip, and Spot and Shift-click treat both halves alike, so only a drag in the upper half changes meaning. The range is interface state on one track, grid-snapped, drawn as a band that follows zoom through a `fw-lanes-rendered` event fired after each render, and dropped by any press, by Escape, or when it would be empty. With a range, Delete runs `clear-range` (clips straddling it keep their outer parts, with source and take offsets and fades adjusted as `split-clip` does; in Shuffle the rest of the track closes the gap), and S splits at the range's end and then its start in one batch, as a split keeps the left piece's id. The clip gain line keeps priority in the upper half, and it shows no zone cursor. Found while verifying: the harness's first upper-half press landed on the gain line, which is drawn at 0 dB, 25% down the clip, and started a gain gesture; the hover logic had also shown the I-beam over it, promising a range the press would not make; the gain line, fade handles and take badge now keep their own cursors. `tsc` also failed first: `limits` had no case for the new gesture kind (a range never moves the clip, so it returns [0, 0]). No existing harness needed changing, as their gestures were all at mid-height or lower, or on edges and handles. Verified on the 10 s tone at 100 px per second: hover zones range and grab, none on the gain line; an upper-half drag from 100 to 200 px made the range 48,000 to 96,000 with no document change and the clip selected, and the band followed zoom (200 px at 2x); Delete in Slip left the range exactly silent and the rest exactly the tone, one step; Delete in Shuffle rendered the tone with exactly one second removed (432,000 frames), one step; S split at both edges in one step with the render still identical; a plain click in the upper half selected without a range; Escape cleared it; a lower-half drag moved the clip by 48,000 in one step; no page errors; layout shift 0; timeline, edit, grid and gain, selection, marquee, Shuffle, clipboard, group trim, edit mode and comping regressions unchanged.

---

## v0.38.0 · any format, every clip audible

### src/io/media-client.ts, src/ui/import.ts, record.ts, shell.ts, resample.ts, session.ts, src/engine/document.ts · import and sample-rate repair
- refers-to: src/io/media-client.ts :: `importFile` (rate), `resampleMedia`; src/ui/import.ts, src/ui/record.ts :: the session rate on import; src/ui/shell.ts :: the file picker's accept list; src/ui/resample.ts :: `mountResampleRepair`; src/ui/session.ts; src/engine/document.ts :: `resample-session`
- kind: warning-context
- logged: v0.38.0 · 2026-09-29

The owner's session showed the product failing at its basics: import took WAV only, and a clip at another rate than the session was silent ("until resampling arrives"); the session had started at 24 kHz from its first file, so the 48 kHz stereo clip played nothing. The file picker now offers every audio format and video files, and imports and recorded takes carry the session rate so the engine converts them (see the backend log). `mountResampleRepair` keeps every clip audible: whenever a session has files at another rate, or runs below 44.1 kHz, it converts those files in the engine and applies one `resample-session`, which moves the session to its new rate scaling every session-time field (clip starts, lengths and fades, automation times, markers, regions, the loop) and swaps each converted file in with its source and take offsets scaled by that file's own rate change. One undo step; an undo is repaired again at once, as silence is not allowed back. The player already rebuilds its audio context when the session rate changes. Verified with the formats from the backend log, and the owner's case: a 24 kHz file and a 48 kHz file imported together gave a 24 kHz session, then automatically 48 kHz with clips 240,000 to 480,000 and 72,000 to 144,000 long, the notice "Session at 48.0 kHz: converted 1 file, every clip plays", the converted tone still 440 Hz at RMS 0.3535, and the formerly silent stereo clip audible (peak 0.879); no page errors.

### src/ui/transport.ts, lanes.ts, styles/family.css, vendor/nodemode/themes.ts, index.html · transport basics and the family look
- refers-to: src/ui/transport.ts :: keydown (Space), `placePlayhead` (follow); src/ui/lanes.ts :: lane markup, `updateLane`, header mute and solo clicks; src/styles/family.css; src/vendor/nodemode/themes.ts :: `formcut`, `DEFAULT_THEME`, `DEFAULT_ACCENT`; index.html :: the theme boot's `formcut` profile and defaults; src/main.ts
- kind: warning-context
- logged: v0.38.0 · 2026-09-29

Owner-reported, from real use: Space did not play, the view did not follow the playhead, tracks had no mute button, and the look matched neither formcut nor formvis. Space: the transport's key handler returned early for any focused button, and after any toolbar click focus stays on that button, so Space re-clicked it instead of playing; Space now toggles the transport everywhere except text entry, cancelling the focused button's activation and blurring it. Follow: nothing scrolled during playback; `placePlayhead` now pages the view when the playhead passes 92% of the visible timeline or leaves it on the left, only when the playhead moves. Every track header has M and S buttons on the same undoable commands as the mixer. The family look: formcut's palette (v2.2.2 tokens) is a theme profile in both the vendored `themes.ts` and the pre-paint boot in `index.html`, and the default, with its amber cue as the default accent; `family.css` maps the rest of formcut's tokens (hover, input, radii, fonts, danger) and gives clips formcut's audio-tag green. A first attempt set the palette in CSS only and did nothing, as the theme boot writes the palette inline on the root element; a saved explicit theme choice is still honoured. The layout itself (formcut's panes) is not ported yet. Verified in Chromium: after clicking Grid, Space played without toggling Grid, and stopped; Space in the session name typed a space; zoomed to 8x, 2.5 s of playback scrolled the view from 0 to 1,886 px with the playhead in view; header M muted the track in one step (the mixer strip agreed, the track exactly silent) and S soloed; the background measured #121617, the accent #ffae2b and clips #50e2a5; no page errors; layout shift 0; first paint without shifts.

### src/vendor/formcut/, src/ui/lanes.ts, mixer.ts, grid.ts, shell.css, family.css · formcut's icons
- refers-to: src/vendor/formcut/icons.ts, src/vendor/formcut/icons-lucide.ts :: `icon`, `LUCIDE`; src/ui/lanes.ts :: lane markup; src/ui/mixer.ts :: `stripNode`, the Mixer toggle; src/ui/grid.ts :: `makeButton`; src/styles/shell.css :: `.fw-icon-btn`, `.fw-glyph-on`, `.fw-glyph-off`, `.fw-mode`; src/styles/family.css :: `--pane`
- kind: rationale
- logged: v0.38.0 · 2026-09-29

Owner-reported: track mute and solo were the letters M and S, not icons. formcut's icon system is vendored verbatim from formcut v2.2.2 (its own 16 px glyphs plus a Lucide set generated from the bundled IcoLab library, ISC); six glyphs it lacked were packed from the same IcoLab Lucide set with its `icon_search.py pack --format glyphs` (headphones, shuffle, crosshair, scissors-line-dashed as punch, grid-3x3, sliders-horizontal as mixer), none drawn by hand. Mute uses formcut's own track-control pattern, speaker when on and speaker-off when muted, swapped by CSS on `aria-pressed`; solo is headphones; automation is formcut's curve and takes its layers, each with its accessible name and tooltip; mixer strips use the same glyphs; the Grid, Shuffle, Spot, Punch and Mixer buttons carry their glyphs beside their labels. `--pane` is aliased for formcut glyphs that fill with it. Verified in Chromium: header mute, solo, automation and takes controls held SVG glyphs and no text, mute showed speaker-off only when pressed, all five mode buttons and the strip buttons held glyphs; no page errors; Space, follow, header mute and solo audio, mixer, edit mode and automation regressions unchanged.

### src/ui/shell.ts, media-pane.ts, inspector-pane.ts, grid.ts, mixer.ts, normalize.ts, lanes.ts, transport.ts, styles/workspace.css · formcut's workspace
- refers-to: src/ui/shell.ts :: the shell markup; src/ui/media-pane.ts :: `mountMediaPane`; src/ui/inspector-pane.ts :: `mountInspector`; src/ui/lanes.ts :: `markSelected` (`fw-selection`); src/ui/grid.ts, src/ui/mixer.ts :: the tool tray; src/ui/normalize.ts :: Loudness before Export; src/ui/transport.ts :: `placePlayhead`; src/styles/workspace.css
- kind: warning-context
- logged: v0.39.0 · 2026-09-29

Owner-reported: the layout looked nothing like formcut or formvis. The shell now follows formcut v2.2.2 (`app.css` titlebar, workspace, pane, pane header, tool tray and primary action; `containers.css` panes): a 44 px titlebar of three parts (identity and flat menu items, the session name and status, the engine and Loudness beside an amber Export), over a workspace of rounded panes 7 px apart, adapted for audio with the timeline as the centre pane between Media and Inspector. The timeline pane has formcut's tool tray (Grid, Shuffle, Spot, Punch, Mixer), which also keeps the narrower transport from overflowing (it had clipped the loudness readout, Mixer and IN). Media lists the session's files with format and length, imports from its header and adds any file to a new track at the playhead. Inspector shows the selected clip (start, length, gain, fades, curve) and its track (volume, pan), each edit one undoable command through the existing commands, fields refreshed without overwriting one being typed in; the lanes announce selection with `fw-selection`. Every existing class and data-action is kept. Found through the timeline harness: the view paged whenever a stopped playhead passed 92% of it, so a visible click near the right edge scrolled the timeline; paging ahead now happens only while playing, and a stopped playhead scrolls only when it lands out of view. The same harness had to grab its clip in the visible part to the right of the sticky header and in the lower half (the Smart Tool's move zone), as zoom can scroll the clip's start under the header in the narrower pane. Verified at 1440 by 900: Media, Timeline and Inspector left to right with 14 px corners under a 44 px titlebar, Export last and amber; the tool tray held the five modes and nothing overflowed the transport; Media listed both files and added one at the playhead in one step; Inspector showed the clip and applied start 1.5 s, gain -6 dB, fade in 0.5 s, S-curve and track volume -3 dB exactly, one step each, and summarised the session when nothing was selected; no page errors; layout shift 0; basics, mixer (docked at the transport's top), Smart Tool, edit mode and timeline regressions unchanged.

### src/ui/voice-pane.ts, shell.ts, media-pane.ts, main.ts, styles/workspace.css · formwave's voice in a Voice tab
- refers-to: src/ui/voice-pane.ts :: `mountVoicePane`; src/ui/shell.ts :: the left pane's tabs; src/ui/media-pane.ts :: `.fw-media-empty`; src/styles/workspace.css :: `.fw-pane-tabs`, `.fw-pane-tab`, `.fw-voice-body`, `.fw-field-stack`
- kind: warning-context
- logged: v0.40.0 · 2026-09-29

The left pane now has formcut-style tabs, Media and Voice. Voice speaks formwave's own contract at `/api/voice` (vendored in the backend): it lists formwave's Qwen3-TTS checkpoints and loads one; generates speech in the loaded checkpoint's modes (clone a voice from any file in Media with its words, a preset voice with optional notes, or a designed voice from a description) in ten languages, importing the result through the normal path (converted to the session rate, listed in Media) onto a new track at the playhead; and transcribes the selected clip with formwave's Qwen3-ASR or Whisper models. Controls are enabled only when formwave would accept them, and any failure formwave returns is shown and kept until the next action (the first version showed it for an instant before the status refresh overwrote it: found in verification). Verified in this container with CPU PyTorch and no Qwen packages or weights: formwave's routes answered (`/status` with its five checkpoints, four ASR models and the device; `/generate` without a model 400 "Model not loaded. Click 'Load' first."; `/transcribe` with a WAV 503 "Transcription not available."); the Voice tab listed them, disabled Generate and Transcribe, and after Load showed "Load failed: No module named 'qwen_tts'", the server staying healthy; the Media tab returned intact; no page errors; layout shift 0; the workspace regression unchanged. The panel was first cramped by the Inspector's three-column fields and a stacked-field rule that lost to the general one; measured after the fix: pickers 130 px, text 210 px, no field overflowing. The checkpoint picker is 76 px beside Load, its names cut until opened. Not verified here: generation and transcription themselves, which need the Qwen packages and weights on the owner's Mac.

### src/ui/inspector-pane.ts, src/engine/document.ts, styles/workspace.css · formcut's audio effects in the Inspector
- refers-to: src/ui/inspector-pane.ts :: the Effects section, its catalogue fetch and apply handler; src/engine/document.ts :: `set-clip-media`; src/styles/workspace.css :: the Inspector header
- kind: explainer
- logged: v0.41.0 (in progress) · 2026-09-29

The Inspector's Effects section offers formcut's audio effects (see the backend log): a one-click Enhance speech (formcut's voice-clean) and the whole grouped catalogue with Apply. Applying renders a new file in the engine and `set-clip-media` points the clip at it, adding it to the session's media with the clip's timing unchanged: one undo step, and undo returns the original, which is never altered. The Inspector's header now gives a long file name the leftover width, as it had run into the title. Verified in Chromium: the menu held 7 groups and 48 effects under a selected clip; Enhance speech pointed the clip at "mic (Enhance speech).wav" in one undo step with the notice "Applied Enhance speech to the clip", and undo restored the original; no page errors.

### src/ui/workspace-layout.ts, shell.ts, vendor/formvis/icons.ts, styles/workspace.css · formcut's workspace behaviour
- refers-to: src/ui/workspace-layout.ts :: `mountWorkspaceLayout`; src/ui/shell.ts :: the pane toggles and dividers; src/vendor/formvis/icons.ts (formvis v1.52.5, verbatim); src/styles/workspace.css :: the five-column workspace, `.fw-pane-divider`, `.fw-panel-toggle`, the Voice checkpoint row
- kind: warning-context
- logged: v0.42.0 (in progress) · 2026-09-29

After formcut's `workspace-layout.ts`: dividers between the panes resize Media and Inspector in pixels (keyboard: 16 px per arrow on a focused divider), titlebar toggles with formvis's collapse glyphs show or hide them, and the arrangement is kept in local storage and re-clamped on window resize (each side at least 200 px, the timeline at least 360). The workspace became five explicit columns. The Voice tab's checkpoint picker now has its own row, Load beneath it. Found in verification: clamping both panes from the old widths at once let a large Media drag squeeze the Inspector to its minimum (now each is clamped against the other's current width in turn), and hiding a pane left its column at full width because the inline width variable outranks the stylesheet's hidden rule (the script now writes zero for a hidden pane). Verified at 1440 by 900: defaults 240 and 284 px; a 100 px drag gave 340, kept after reload; an arrow gave 356; the Inspector dragged to 344; an oversized drag stopped Media at 708 with the timeline at 360 and the Inspector untouched; hiding Media moved the timeline to x 7 (1,075 px), hiding both gave 1,426 px, restoring returned every width; the checkpoint picker on its own row with Load below; no page errors; workspace and basics regressions unchanged.

### src/ui/mixer.ts, styles/shell.css, styles/workspace.css · containment: nothing floats, overlaps or overflows
- refers-to: src/ui/mixer.ts :: the panel's placement, `setOpen`; src/styles/shell.css :: `.fw-mixer`; src/styles/workspace.css :: the wrapping transport, narrow-window titlebar, number fields
- kind: warning-context
- logged: v0.42.0 · 2026-09-29

Owner-reported from a screenshot: the Mixer was a fixed, window-wide overlay on the menu layer, appended to the page and lying across the Media and Inspector panes, and the Inspector's number fields showed native spinners. The Mixer is now a section of the timeline pane between the tracks and the transport: opening it shrinks the tracks, it scrolls inside its own box, and it no longer measures anything to place itself. A containment test (`verify_containment.py`) now checks at 1440, 1280 and 1024 px wide with a session, a selection and the Mixer open: no page scroll, panes in view and not overlapping, the Mixer, tool tray and transport inside the timeline pane, no overflow in the titlebar, tool tray, transport, Inspector, Media or Voice, and no visible fixed element. It found two more faults before release: the transport overflowed at 1280 (127 px) and 1024 (383 px), and at 1024 the titlebar's menu group ran into the centre, because formcut's `1fr auto 1fr` titlebar gave the centre all the width its status text wanted. The transport now wraps inside a narrow pane (its height follows), and below 1180 px the menu items go icon-only (labels kept for screen readers, tooltips kept) and the titlebar's centre shrinks with an ellipsised status. Number fields dropped their spinners. Verified: all three sizes clean on every check; the mixer regression unchanged (its panel's bottom on the transport's top, strips, silences and meters); screenshot inspected.

### src/ui/media-pane.ts, inspector-pane.ts, styles/workspace.css · Generate and Analyze
- refers-to: src/ui/media-pane.ts :: the Generate section; src/ui/inspector-pane.ts :: the Analyze section (statistics, spectrogram), cleared on selection change; src/styles/workspace.css :: `.fw-generate`, `.fw-stats`, `.fw-spectrogram`
- kind: explainer
- logged: v0.43.0 · 2026-09-29

The Media tab gains a Generate section (tone at any frequency, three noises, silence, chirp, DTMF for typed digits, bleep; fields shown only for the signal that uses them) that adds the signal on a new track at the playhead at the session rate. The Inspector gains an Analyze section under a selected clip: Statistics fills a table (peak, RMS, DC offset, clipped runs) and Spectrogram shows the clip's spectrogram. The Effects menu needed no change: it lists the engine's catalogue, now 85 effects in 11 groups. Verified in Chromium: Generate added a 3 s tone track with its notice; the menu held 11 groups and 85 effects; Statistics read peak -6.02 and RMS -9.03 dBFS on the tone; the spectrogram loaded and fitted the pane; no page errors; the containment test clean at all three sizes.

### src/ui/transcript-pane.ts, src/engine/document.ts, shell.ts, main.ts, styles/workspace.css · Descript-style transcript editing
- refers-to: src/ui/transcript-pane.ts :: `mountTranscriptPane`, `sessionWords`, `rangesOf`; src/engine/document.ts :: `clear-ranges`; src/ui/shell.ts :: the Transcript tab; src/styles/workspace.css :: `.fw-transcript-*`, `.fw-word`
- kind: rationale
- logged: v0.44.0 (in progress) · 2026-09-29

A Transcript tab beside Media and Voice. Transcribe session transcribes each file used on the timeline once; the words shown are re-derived from the document on every change (a word belongs to a clip when its midpoint lies in the clip's trimmed source range and moves with it), so the transcript follows every edit and undo without bookkeeping. Click a word to seek, shift-click to select a run, Ctrl or Cmd-click to toggle; the word under the playhead is underlined in playback. Delete selected words, Remove filler words and Shorten gaps (over 0.75 s down to 0.3 s) each dispatch one `clear-ranges` command: ripple deletes on every track, latest range first so earlier ranges keep their positions, one undo step (Descript ripples the whole sequence, which keeps other tracks in sync with the speech). Verified in Chromium on the JFK recording (verify_transcript.py): the exact 22 words and no fillers; clicking "ask" sought to 3.34 s; deleting "so my fellow Americans," removed 1.48 s in one undo step, left 18 words from "And ask not what" and put "ask" at 1.86 s (3.34 minus 1.48); undo restored 22 words and 11.0 s; Shorten gaps removed 1.06 s (the 1.36 s pause kept at 0.3 s) with every word kept; Remove filler words reported none; no page errors; containment clean at three sizes.

### src/ui/transcript-pane.ts, styles/workspace.css · speaker labels by track, retake removal
- refers-to: src/ui/transcript-pane.ts :: `SessionWord.speaker`, `retakeRanges`, `RETAKE_RUN`, `RETAKE_WINDOW`, the speaker labels in `render`; src/styles/workspace.css :: `.fw-speaker`
- kind: rationale
- logged: v0.45.0 (in progress) · 2026-09-29

Speaker labels: each word carries its track's name, and when the transcript spans more than one, a label heads each change of speaker, as Descript labels a multitrack sequence; telling speakers apart inside one recording (diarization) is not attempted yet. Remove retakes: a run of four words said again within the next forty means the first attempt was abandoned; it goes from its first word up to where the retake starts, keeping the last take, in one ripple edit. Four words, because a single take can repeat three (the JFK line has "can do for you" and "can do for your"). Verified in Chromium (verify_retakes.py) on real speech: a single JFK take reported no earlier takes; with the recording again as "guest" from 11 s, the transcript showed 44 words labelled jfk then guest; Remove retakes removed 11.00 s in one undo step, leaving the last take's exact 22 words from 0 s without labels; undo restored 44 words and 22 s; no page errors; the transcript regression unchanged.

### src/ui/inspector-pane.ts · sliders for an effect's controls
- refers-to: src/ui/inspector-pane.ts :: `.fw-fx-params`, `showControls`, `currentParams`, the Apply request's `params`
- kind: explainer
- logged: v0.46.0 (in progress) · 2026-09-29 (entry written the session after its commit, `d4ac11d`)

The engine's catalogue now lists each adjustable effect's controls (see the backend log). Choosing such an effect in the Inspector shows a slider per control with its live value and unit, starting at the default; Apply sends the values, Enhance speech keeps its default. Verified in Chromium (verify_params.py): Amplify showed "Gain 6 dB", the slider moved to -3 read "-3 dB", and Apply produced "mic (Amplify -3dB).wav" at 0.7079 of the original peak (-3 dB); Invert showed no controls; no page errors.

### src/ui/lanes.ts, src/engine/document.ts, src/ui/inspector-pane.ts · effects on a Smart Tool range
- refers-to: src/ui/lanes.ts :: the `fw-range` announcements; src/engine/document.ts :: `set-range-media`; src/ui/inspector-pane.ts :: `range`, `find`'s range fallback, the apply target
- kind: warning-context
- logged: v0.47.0 · 2026-09-29

The timeline announces its Smart Tool range (`fw-range`, null when cleared). While a range exists it is the target of Enhance speech and Apply, as Audacity processes its selection: the clip the range overlaps on its track, whichever piece is selected (after a first range effect the selected piece is the left one, which the range does not overlap; the first version targeted it and applied a second effect to the wrong piece). `set-range-media` splits that clip at the range edges and puts the middle piece on the processed file, time-aligned because the engine renders the whole file and the piece keeps its source offset; fades stay on the outer edges; one undo step. Effects that change timing (the engine's `retimes` flag: tempo, speed, stretch, truncate silence, reverse) are refused inside a range with a message. The work sat on a branch until verified: two sessions of failures were the harness's own (a drag on the gain line, a comment that disabled the drag, a click-then-drag probe on the Inspector's pane divider, which lies over the clip's unseen part at 1440 px), each found by making the harness report instead of wait. Verified (verify_range_fx.py): a 2 to 4 s range and Amplify -6 dB gave three pieces with the middle starting 2.0 s into the new file at exactly 0.5012 of the peak, one undo step, the range kept; Change tempo inside it refused with the document unchanged; Invert on the same range changed only the middle piece, sample-exact; two undos stepped back to the single original clip; a click then a drag inside the visible clip made a range; no page errors; the Smart Tool regression unchanged.

### src/ui/transcript-pane.ts · Make a clip from selected words
- refers-to: src/ui/transcript-pane.ts :: `SessionWord.mediaId`, `mediaStart`, `mediaEnd`, the `clip` action
- kind: explainer
- logged: v0.48.0 · 2026-09-29

Descript's short clips: each transcript word now carries its recording and its times in that recording (clamped to the clip's trimmed range), so the selected words map straight to an excerpt from the first word's start to the last word's end, pauses between them kept; the excerpt lands on a new track at the playhead. A selection spanning two recordings is refused with a message. Verified in Chromium on the JFK recording (verify_wave3b.py): "ask not what your country can do for you," made a 3.98 s clip of 9 words named "jfk (clip 3.34 to 7.32 s)" on a second track; no page errors.

### src/engine/document.ts, src/ui/labels-pane.ts, ruler.ts, shell.ts, main.ts, styles/workspace.css · labels and markers (coverage wave 4)
- refers-to: src/engine/document.ts :: `remove-marker`, `set-marker`, `set-region`; src/ui/labels-pane.ts :: `mountLabelsPane`, `labelsOf`, `cues`, `toWebVtt`, `toSubRip`, `toChapters`, `parseSubRip`; src/ui/ruler.ts :: marker drawing; src/styles/workspace.css :: the left pane's header, `.fw-label-*`
- kind: warning-context
- logged: v0.49.0 (in progress) · 2026-09-29

The document already had markers and regions (with add-marker, add-region, remove-region and a batch command) and the ruler drew regions, but nothing in the interface used them: the work extends them rather than adding a second label system. New commands remove a marker and edit a marker's or region's time and label. A Labels tab adds a marker at the playhead or a region from the Smart Tool range, lists them by time (click to go there, type to rename, delete), exports WebVTT, SubRip and Podcasting 2.0 chapters (version 1.2.0; a marker becomes a cue to the next label, at least 1 s and at most 5 s) and imports SubRip (commas or dots) as regions in one undo step; the ruler now draws markers too. Labels live in the session document, so they save with it and undo like edits. Found in verification: the fourth tab stacked the tabs one per line (the header's three-column grid) and region rows left their name no width; the tabs now have a row of their own that fits 213 of 216 px at the default pane width, and names take their own line. Verified (verify_labels.py): a marker at 1.5 s and a 2 to 4 s region, one step each; the rename; the three downloads exactly (`00:00:01.500 --> 00:00:02.500 Intro`, `00:00:02.000 --> 00:00:04.000 Region 1`, the SubRip twin with commas, chapters startTime 1.5 and 2 to 4); two SubRip cues imported in one step; delete and undo; the third label sought 5.0 s; header 37 px on Labels, tabs overflow 0; containment clean at three sizes; no page errors.

### src/ui/spectrogram-view.ts, main.ts, styles/workspace.css · spectrogram view on the timeline (coverage wave 4)
- refers-to: src/ui/spectrogram-view.ts :: `mountSpectrogramView`; src/styles/workspace.css :: `.is-spectral`, `.fw-spectral-toggle`
- kind: rationale
- logged: v0.50.0 · 2026-09-29

A Spectrogram toggle in the tool tray; with it on, each clip shows its file's spectrogram under it and the waveform is hidden. One bare image of the whole file (2048 by 256, no legend, cached per file) is drawn as the clip's background, sized to the clip's width times file frames over clip frames and offset by the clip's trim, so it follows splits and trims without re-rendering; styles are written only when they change, after each timeline render (`fw-lanes-rendered`). The module does not touch lanes.ts. Verified (verify_spectrogram_view.py): the whole 10 s clip at 1000 px with the image at offset 0; after a 2 to 4 s cut the right 600 px piece showed the 1000 px image at exactly -400 px (its 4 s trim); a 2048 by 256 PNG; the tray without overflow at 1024; off restored the waveform; no page errors; containment clean at three sizes; the timeline regression unchanged. The first run's pass line compared "1000.00px" with the browser's normalized "1000px" and reported FAIL on matching values; it now compares numbers.

### src/ui/export.ts, src/io/render-client.ts, styles/workspace.css · the export dialog
- refers-to: src/ui/export.ts :: the dialog, `choice`, `run`; src/io/render-client.ts :: `ExportOptions`, `Mix.ext`, `Mix.stems`; src/styles/workspace.css :: `.fw-export-dialog`
- kind: explainer
- logged: v0.51.0 (in progress) · 2026-09-29

Export opens a native dialog (the browser's top layer, so no stacking rules): the format (WAV float, 24 or 16-bit, FLAC, MP3 320 or 192, OGG, M4A) and what to export (the mix, stems as a zip, or multichannel). The file is named from what the engine made; Ctrl or Cmd with Shift and E exports straight away with the last choice; Loudness still renders the float mix (the client's defaults are unchanged). Verified in Chromium (verify_export.py): the dialog opened, FLAC chosen, the download was "Untitled session.flac", the dialog closed and the notice reported peak and loudness; no page errors.

### src/ui/import.ts · audio files pasted from the OS clipboard (coverage wave 5)
- refers-to: src/ui/import.ts :: `importOne` (`at`), `importAll` (`at`), the `paste` listener
- kind: explainer
- logged: v0.52.0 (in progress) · 2026-09-29

Audacity takes audio files from the OS clipboard: a paste carrying files now imports each (converted to the session rate, one after another) onto a new track at the playhead; a paste into a text field is left to the field. Dropping files onto the timeline already existed here and keeps its place at 0; the import path gained a position so both share it. Verified in Chromium (verify_paste_files.py) with real File objects in genuine events: a paste with the playhead at 2 s made a "pasted" track starting at 2 s; the same paste on the session-name field did nothing; a drop still made a track at 0; no page errors.

### src/ui/export.ts · clipping warning on export
- refers-to: src/ui/export.ts :: the `clips` note in `run`
- kind: explainer
- logged: v0.52.0 · 2026-09-29

A mix peaking above full scale clips in every export format except 32-bit float WAV, silently until now. The export notice now says so when it happens and points to the Master fader, Loudness or float WAV. Verified in Chromium (verify_clip_warning.py): a session peaking at -6.0 dBFS exported as FLAC without the warning; one peaking at +1.0 dBFS warned for FLAC and MP3 and not for float WAV.

### src/ui/workspace-layout.ts, styles/workspace.css · saved workspace layouts (coverage wave 5)
- refers-to: src/ui/workspace-layout.ts :: `PRESETS`, `readSaved`, the Layout menu; src/styles/workspace.css :: `.fw-layout-select`
- kind: explainer
- logged: v0.53.0 (in progress) · 2026-09-29

Audacity's saved workspaces: a Layout menu in the tool tray applies preset layouts (Default, Timeline only, Editing, Transcript) and named layouts saved with Save current layout (a native prompt for the name, kept in browser storage beside the current layout), through the existing clamp-and-save path. Verified in Chromium (verify_layouts.py): Default 240 and 284 px; Timeline only hid both panes; Editing hid Media; saving as "Mine" added it to the menu; Transcript gave a 380 px left pane and no Inspector; Mine restored the saved arrangement exactly; Default restored 240 and 284; the menu reset after each choice; containment clean at three sizes; no page errors.

### src/ui/projects.ts, spectrogram-view.ts, styles/workspace.css · recent sessions; two visual faults the checks had missed
- refers-to: src/ui/projects.ts :: the recent sessions list (`showRecent`, `emptyStage`); src/ui/spectrogram-view.ts :: the toggle's class; src/styles/workspace.css :: `.fw-recent*`, the transport's height, the empty stage's scrolling
- kind: warning-context
- logged: v0.53.0 · 2026-09-30

Audacity's home screen of recent projects: the empty timeline lists the six latest saved sessions (newest first, tracks and date) and opens one through the existing open path (which asks before discarding unsaved changes); it refreshes when the timeline empties. A screenshot of it showed two faults the geometric checks had passed: the Spectrogram button (v0.50.0) carried a class the tool tray does not style (`fw-tool`; the tray's buttons are `fw-mode`), and at 1024 px the transport's wrapped second row (meters, loudness) was clipped, probably since v0.42.0, because a later rule fixed the transport's height over the wrap rule's automatic one and the containment test measured only horizontal overflow. The toggle now uses `fw-mode`, the transport's height is a minimum, and the containment test measures vertical overflow of the titlebar, tray and transport too. Verified: two sessions saved through the app listed newest first with their track counts and opened on click (verify_recent.py); the Spectrogram and Mixer buttons' computed styles equal; the home screen's transport 79 px tall with no vertical overflow at 1024; containment, now with vertical overflow, clean at three sizes.

### src/ui/inspector-pane.ts, styles/workspace.css · effect search and Apply to all clips (coverage wave 6)
- refers-to: src/ui/inspector-pane.ts :: the `search` filter, the `apply-all` handler; src/styles/workspace.css :: `.fw-fx-search`
- kind: explainer
- logged: v0.54.0 (in progress) · 2026-09-30

iZotope RX's module search: a search box filters the Effects menu by effect or group name as you type, hiding empty groups and moving the choice to the first match when the current one is hidden. Batch processing (Adobe Podcast's queue, RX's batch processor): Apply to all clips runs the chosen effect with its current controls on every clip, rendering each distinct file once and switching every clip in one batch command, one undo step. Verified in Chromium (verify_batch_search.py): "de-" left the nine de- effects; "zzz" left no options and no groups; clearing restored 88; Amplify -6 dB on all clips of a two-track session changed both in one undo step at 0.5012 of their peaks, and undo restored both; no Inspector overflow; containment with vertical overflow clean at three sizes; screenshot inspected; no page errors.

### src/ui/inspector-pane.ts, styles/workspace.css · Mic check in Analyze
- refers-to: src/ui/inspector-pane.ts :: the `mic` action, `.fw-mic-findings`, the `data-use` buttons; src/styles/workspace.css :: `.fw-finding`, `.fw-analyze-buttons`
- kind: explainer
- logged: v0.54.0 (in progress) · 2026-09-30

Analyze gains Mic check: the engine's findings for the inspected clip, marked OK, warning or problem, each with a Use button that selects its suggested effect (clearing any effect search) and shows its controls, ready to apply; findings clear when the selection changes. The screenshot showed the third Analyze button's label wrapping inside the button, which the overflow measures could not see: labels in these rows now never wrap and the row wraps whole buttons. Verified in Chromium (verify_mic_check.py) on the hum recording: two OK findings and one warning with Use Hum remover, which selected it, and Apply produced "hum (Hum remover).wav"; every Analyze and Apply button one line (28 px); no overflow; containment with vertical overflow clean at three sizes; no page errors.

### src/ui/inspector-pane.ts, styles/workspace.css · effect chains (coverage wave 6)
- refers-to: src/ui/inspector-pane.ts :: `chain`, `renderChain`, the `chain-add`, `chain-apply`, `chain-clear` and `data-chain-remove` actions; src/styles/workspace.css :: `.fw-chain`
- kind: explainer
- logged: v0.55.0 (in progress) · 2026-09-30

iZotope RX's module chains: Add to chain keeps the chosen effect with its current controls (labelled with their values), steps can be removed, and Apply chain runs them in order, each on the previous step's file, then changes the document once (the clip, or the range when one exists, as Apply does), so the whole chain is one undo step; a chain with a timing-changing step is refused inside a range. Verified in Chromium (verify_chain.py) on the 440 Hz clip: Amplify -6 dB, Invert and Amplify +12 dB listed, a removed and re-added step reordered; applying gave -1.9953 of every sample (+6 dB inverted, largest deviation 0.000019 across three renders) in one undo step; undo restored the original; with Change tempo added and a range dragged the chain was refused and the document unchanged; Clear hid the chain; containment with vertical overflow clean; screenshot inspected; no page errors.

### src/ui/inspector-pane.ts · Separate into stems
- refers-to: src/ui/inspector-pane.ts :: the `separate` action
- kind: explainer
- logged: v0.56.0 · 2026-09-30

Separate into stems sends the clip's trimmed range to the engine and, in one batch command, puts the four stems on new tracks starting where the clip starts and mutes the original track, so one undo reverses it all; the notice warns that separation takes about three times the clip's length on a CPU. Verified in Chromium (verify_separate.py) on a clip trimmed by 2 s: four tracks named for their stems, each starting at 2.0 s and 9.0 s long, the original muted, one undo step, undo restoring the original track unmuted and alone; no page errors. The separation's quality is in the backend log.

### src/styles/workspace.css · hidden action buttons were still shown
- refers-to: src/styles/workspace.css :: `.fw-ibtn[hidden]`
- kind: warning-context
- logged: v0.56.0 · 2026-09-30

A screenshot showed Apply chain and Clear chain with an empty chain: the buttons carried the hidden attribute, but the button class's display rule overrode it, and the chain harness had read the hidden property, which was true, rather than whether the buttons showed. Hidden action buttons are now never displayed, and the check reads computed display: none with an empty chain, flex with a step, none after Clear; the chain regression unchanged.

### src/ui/export.ts · streaming preview in the export dialog
- refers-to: src/ui/export.ts :: the `preview` choice in the dialog and in `run`
- kind: explainer
- logged: v0.57.0 (in progress) · 2026-09-30

The export dialog's What gains Streaming preview: rather than downloading, the engine's decoded preview lands on a new track at 0 s, to solo against the mix. Verified in Chromium (verify_preview.py): MP3 192 kbps added "Streaming preview (MP3, 192 kbps)" at 0 s, 11.0 s long; FLAC was refused with the engine's message; no page errors.

### src/ui/inspector-pane.ts · Deconstruct
- refers-to: src/ui/inspector-pane.ts :: the `deconstruct` action (sharing the separation handler)
- kind: explainer
- logged: v0.57.0 (in progress) · 2026-09-30

Deconstruct beside Separate into stems, through the same handler with its own route and wait note: the clip's trimmed range becomes tonal, noisy and transient tracks at the clip's start, the original muted, one undo step. Verified in Chromium (verify_deconstruct_ui.py): three tracks at 0 s, 4.0 s long, the original muted, one step, undo restoring it; the Separate regression unchanged through the shared handler; buttons one line; containment clean; screenshot inspected; no page errors.

### src/ui/inspector-pane.ts · automatic ducking (coverage wave 10)
- refers-to: src/ui/inspector-pane.ts :: the `data-duck` controls, `fillDuck`, the ducking handler
- kind: warning-context
- logged: v0.58.0 (in progress) · 2026-09-30

Audacity's Auto Duck and Audition's content-based ducking: in the track section, Duck under (another track) and By (3 to 30 dB) write this track's volume automation from the other track's active regions (merged when closer than attack plus release; 0.15 s down, hold, 0.4 s back), one undo step, editable in the automation lane. Found in verification: the Duck under menu first offered the selected track itself, because it refreshed before the selection listener had updated; it now refreshes after it. Verified in Chromium (verify_duck.py) with the JFK speech over a steady tone: "Ducked bed by 12 dB in 2 places under jfk", the rendered tone at -45.12 dB during speech and -33.12 dB in the pause, 12.0 dB exactly; one undo step; undo removed the envelope; the menu offered only the other track; no overflow; screenshot inspected; containment clean; no page errors.

### src/ui/ruler.ts · a draggable playhead (coverage wave 10)
- refers-to: src/ui/ruler.ts :: `dragHead`, `nearHead`, `seekSoon`, the pointer handlers
- kind: explainer
- logged: v0.59.0 (in progress) · 2026-09-30

Audacity 4's draggable playhead: a press on the ruler within 6 px of the playhead grabs it (the cursor shows ew-resize there) and dragging seeks once a frame, playing on if playing, instead of drawing a loop range; releasing seeks exactly where it was let go. A press anywhere else keeps click-to-seek and drag-for-loop. Verified in Chromium (verify_playhead_drag.py): the cursor at the playhead and not 60 px away; a drag from 2.0 s read 2.5, 3.0 ... 5.0 s as it moved and ended at 5.0 s with the loop unchanged; while playing, the playhead grabbed at 3.68 s and dragged back kept playing from about 1 s; a drag elsewhere still made a loop (0.4 to 1.4 s) and a click still seeked (1.7 s); containment clean; no page errors. The first run's loop and click checks failed because they aimed at 7 to 9 s, past the timeline pane's visible edge under the Inspector (the ruler canvas is 1,100 px wide, wider than the pane), so they never reached the ruler.

### src/engine/document.ts, src/ui/lanes.ts, styles/workspace.css · clip groups (coverage wave 10)
- refers-to: src/engine/document.ts :: `Clip.groupId`, `set-clip-group`; src/ui/lanes.ts :: `groupOf`, `expandGroups`, `markGroups`, the click and Ctrl/Cmd+G handling; src/styles/workspace.css :: `.fw-clip[data-group]`
- kind: explainer
- logged: v0.60.0 (in progress) · 2026-09-30

Audacity's clip groups as a persistent selection: Ctrl/Cmd+G groups the selected clips (two or more, across tracks) and Ctrl/Cmd+Shift+G ungroups them, each one undo step; a click on any member selects the whole group and Shift-click toggles it, so the existing multi-clip drag and delete carry the group; grouped clips show a dashed accent outline, kept current on every document change. The first cut of the shortcut replaced the Ctrl/Cmd block's opening line; it was restored at once and Ctrl+A is in the checks. Verified in Chromium (verify_groups.py) on three tracks: A and B grouped in one step with dashed outlines on them only; a click on C selected one clip and on A two; dragging A moved A and B to 1.0 s with C unmoved; Delete removed both and undo restored them; ungrouping cleared the group and a click on A then selected one; undoing back past the grouping removed the outlines; Ctrl+A selected all three; screenshot inspected; no page errors.

### src/engine/document.ts, src/audio/player.ts, src/audio/player-worklet.ts, src/ui/inspector-pane.ts, styles/workspace.css · realtime track effects (coverage wave 8)
- refers-to: src/engine/document.ts :: `TrackFx`, `Track.fx`, `set-track-fx`; src/audio/player.ts :: `planClips` (`fx`); src/audio/player-worklet.ts :: `fw_set_rate`, `fw_add_clip_fx`, `WorkletClip.fx`; src/ui/inspector-pane.ts :: `renderRtfx`, `commitRtfx`, the `data-rtfx` controls; src/styles/workspace.css :: `.fw-rtfx-*`
- kind: warning-context
- logged: v0.61.0 (in progress) · 2026-09-30

A track's realtime effects (high-pass, low-pass, peak EQ, low and high shelf) in the Inspector's track section: Add, frequency, gain for peak and shelves, Q, On (bypass) and Remove, each change one set-track-fx; the list rebuilds only when the track's effects change and never while an input in it has focus. The playback plan sends each clip its track's enabled stages in the core's codes and the worklet tells the core its sample rate, so playback runs the same filters as the export. Found: the served core (public/core, built by oc_install and git-ignored) was stale, without the new exports; the release gate builds the wasm32 target but never copies it, so it was refreshed with oc_install and the gate will compare the served core with the fresh build. Two harness errors on the way: the level hook is onOutputLevel, not onLevel (all peaks read 0), and a focused checkbox took Space, so one run never played; focus is cleared and playing is recorded per run. Verified in Chromium through the worklet on 100 Hz plus 5 kHz sines at 0.25: output peak 0.4969 without effects, 0.2636 with a 1 kHz high-pass (-5.51 dB, the 100 Hz half gone), 0.4969 again bypassed, playing in all three runs (verify_rtfx.py); add and edit two undo steps; Remove emptied the list; no page errors.

### src/engine/document.ts, src/audio/player.ts, src/audio/player-worklet.ts, src/ui/inspector-pane.ts · master effects and reordering (coverage wave 8)
- refers-to: src/engine/document.ts :: `SessionDoc.masterFx`, `set-master-fx`, `cleanFx`; src/audio/player.ts :: `flatFx`, `sendPlan`; src/audio/player-worklet.ts :: `fw_clear_master_fx`, `fw_add_master_fx`, the clips message's `masterFx`; src/ui/inspector-pane.ts :: `fxLists`, `renderFxList`, `commitRtfx`, `scopeOf`, the Master effects section
- kind: explainer
- logged: v0.62.0 (in progress) · 2026-09-30

The effects list is one component in two scopes: the selected track, and a Master effects section shown whenever the session has tracks. Rows gain Up and Down (disabled at the ends) to reorder; every change, the master's included, is one undo step. One `cleanFx` rule serves track and master in the reducer, and one `flatFx` turns stages into the core's codes for both. Verified in Chromium through the worklet (verify_master_fx.py) on the 100 Hz plus 5 kHz mix and a 1 kHz tone: the master section hidden when empty and shown with tracks; output peak 0.6219 without effects and 0.2768 with a 2 kHz master high-pass, playing in both runs; Down swapped Peak EQ and High-pass in one undo step with the rows in the new order, Up disabled on the first row, and undo restored the order; the track-effects regression unchanged (0.4969, 0.2636, 0.4969); no overflow at 1024 px; screenshot inspected; no page errors.

### src/engine/document.ts, src/audio/player.ts, src/audio/player-worklet.ts, src/ui/inspector-pane.ts · the compressor in playback and the Inspector (coverage wave 8)
- refers-to: src/engine/document.ts :: `FilterFx`, `CompressorFx`, `TrackFx`, `cleanFx`; src/audio/player.ts :: `flatFx`, `flatStages`, `planClips` (a track's own bus), `sendPlan`; src/audio/player-worklet.ts :: `WorkletBus.stages`, `fw_add_bus_stage`, `fw_add_master_stage`; src/ui/inspector-pane.ts :: the compressor's label, defaults and fields
- kind: warning-context
- logged: v0.63.0 (in progress) · 2026-09-30

TrackFx becomes a union of filters and the compressor (threshold, ratio, attack, release, makeup), each clamped to the core's ranges. The playback plan mirrors the export's: a track holding an enabled compressor and routed to the master gets its own bus carrying its whole chain as six-wide stages, filters elsewhere still run per clip, and the master chain travels as stages. The Inspector offers Compressor on tracks and the master with its five fields; values fill from the field each input names. Found: the first live reading (0.4898) took the peak over the whole playback, including the onset the compressor lets through during its 10 ms attack; measured after 400 ms of settling, as the export was measured from 1 s. Verified in Chromium through the worklet (verify_comp.py) on a 1 kHz sine at 0.5: output peak 0.5 without effects, 0.1659 (-15.6 dBFS) settled with a -20 dB 4:1 compressor, the export of the same session -15.6 dBFS, 0.5 again at ratio 1, playing in all runs; the track and master filter regressions unchanged; screenshot inspected; no page errors.

### src/ui/inspector-pane.ts · Transients in Analyze (coverage wave 10)
- refers-to: src/ui/inspector-pane.ts :: the `transients` action, `[data-an-sens]`
- kind: explainer
- logged: v0.64.0 (in progress) · 2026-09-30

Transients, with a Sensitivity from 0 to 1, puts a marker at each onset the engine finds inside the selected clip's visible span: file time is mapped through the clip's start, trim and the rate ratio, onsets outside the span are left out, and the markers go in one batch, one undo step. Verified in Chromium (verify_transients.py) on the drum-like clip moved to 1 s with its first 0.5 s cut: "Marked 4 transients" at 1.8018, 2.5509, 3.1005 and 3.7024 s (expected 1.80, 2.55, 3.10, 3.70; 0.5 to 2.4 ms), the cut burst left out, one undo step, undo removing all four; containment clean; screenshot inspected; no page errors.

### src/ui/inspector-pane.ts, styles/workspace.css · Split at transients and Quantize (coverage wave 10)
- refers-to: src/ui/inspector-pane.ts :: `clipTransients`, `selectedIds`, the `split-transients` and `quantize` actions, the Quantize section, `render` (its visibility); src/styles/workspace.css :: `.fw-q-field`
- kind: warning-context
- logged: v0.65.0 (in progress) · 2026-09-30

Pro Tools' groove edits on transients: Split at transients (in Analyze) cuts the clip at each onset more than 10 ms inside its edges, last to first so every cut targets the original clip, one undo step; Quantize moves the selected clips' starts (or the inspected clip's) to the nearest line of a BPM grid at 1/4, 1/8 or 1/16, one undo step, so split pieces, each starting on its transient, land on the beat. Found in verification: Quantize first lived in Analyze, which the Inspector hides whenever more than one clip is selected, so it was unreachable exactly when it is needed; it now has its own section, shown whenever any clip is selected. Verified in Chromium (verify_groove.py) on the drum-like clip: 6 pieces at 0, 0.301, 0.8018, 1.5509, 2.1005 and 2.7024 s in one step; with all six selected, 120 BPM at 1/8 moved five to 0.25, 0.75, 1.5, 2.0 and 2.75 s in one step; undo reversed each; containment clean; screenshot inspected; no page errors.

### src/ui/inspector-pane.ts, styles/workspace.css · tempo detection for Quantize; styled selects in button rows (coverage wave 10)
- refers-to: src/ui/inspector-pane.ts :: `estimateBpm`, the `detect-bpm` action; src/styles/workspace.css :: `.fw-analyze-buttons select`
- kind: warning-context
- logged: v0.66.0 (in progress) · 2026-09-30

Detect beside BPM estimates the inspected clip's tempo from its transients (the first part of Audacity's tempo detection): for each candidate from 60 to 180 BPM in 0.1 steps, the onsets' phase alignment at its period (their resultant length), weighted by the share of its beats holding an onset, which keeps hits every second from also reading as 120 BPM. It asks for one clip when several are selected. A screenshot of the new row showed the division menu as an unstyled native select, as the effect-kind menus in the Add rows had been since v0.61.0: selects in the Inspector's button rows now take the field select's tokens. Verified in Chromium (verify_tempo.py) on decaying bursts: 100 BPM with a missing beat and up to 5 ms of jitter read 99.9, hits every second read 60.0 (not 120), and 137 BPM read 137.0; the division and effect-kind menus' computed colours equal the Duck under field's; no overflow at 1024 px; containment clean; screenshot inspected; no page errors.

### src/engine/document.ts, src/ui/grid.ts, src/ui/ruler.ts, src/ui/inspector-pane.ts · a session tempo, a bars ruler and beat snapping (coverage wave 10)
- refers-to: src/engine/document.ts :: `SessionDoc.tempo`, `set-tempo`; src/ui/grid.ts :: `barsEnabled`, `setBeatGrid`, `snapSamples`, the Bars button; src/ui/ruler.ts :: the bars branch of `draw`; src/ui/inspector-pane.ts :: `syncTempo`, `commitTempo`, the Beats field, Detect
- kind: explainer
- logged: v0.67.0 (in progress) · 2026-09-30

Audacity's beats and measures ruler: the session holds one tempo (BPM and beats per bar, clamped, each change one undo step), edited by Quantize's BPM and Beats fields, which follow it, and set by Detect. Bars in the tool tray switches the ruler to bar numbers and beat ticks (bars numbered every 1, 2, 4... as zoom allows, beats labelled bar.beat from 48 px apart) and, with Grid on, snaps to the beat halved or doubled by powers of two to at least 12 px, down to a sixteenth. Verified in Chromium (verify_bars.py): 110 BPM in 3 set the session tempo; with Bars and Grid on a drag landed at 1.36365 s, 2.5 beats, on the half-beat subdivision and off the tenth-second grid; with Bars off the next drag landed at 2.0 s on the seconds grid and off the beat grid; Detect set 99.9 BPM keeping 3 beats and undo restored 110 with the fields following; the ruler read 1, 1.2, 1.3, 2, 2.2 (screenshot); containment clean; no page errors.

### src/engine/document.ts, src/ui/inspector-pane.ts · re-timed media keeps its clip in step; Stretch to tempo (coverage wave 10)
- refers-to: src/engine/document.ts :: `set-clip-media` (scaling); src/ui/inspector-pane.ts :: the `stretch-tempo` action
- kind: warning-context
- logged: v0.68.0 (in progress) · 2026-09-30

A fault found while building Stretch to tempo, present since the timing-changing effects arrived: set-clip-media swapped only the media id, so a clip re-timed by Change tempo kept its old length, cutting a slowed clip short and leaving a sped-up one running past its audio. When the new media's length differs, the clip's trim, length and fades now scale by the same ratio. Stretch to tempo (in Quantize) detects the clip's tempo, divides the session's by it and renders the pitch-keeping tempo effect at that factor (0.5 to 2 times), one undo step. Verified in Chromium (verify_stretch.py): Change tempo at -50% took the clip from 8.2 to 16.4 s and undo back to 8.2 (before the fix it stayed 8.2); from 99.9 to 110 BPM the clip became 7.447 s, exactly 8.2 x 99.9 / 110, in one step. Open, to fix before release: re-detection read 107.8 BPM from 5 transients, because Rubber Band at its default options smears these bursts' attacks (6 onsets of 12 at sensitivity 0.5, 26 split ones at 0.9, spacing 0.5601 s against 0.5449); a short window keeps the spacing (0.5435 s, 16 onsets), so a rhythmic stretch with window=short is next.

### src/ui/inspector-pane.ts · Stretch to tempo uses the rhythmic stretch (the open issue above, resolved)
- refers-to: src/ui/inspector-pane.ts :: the `stretch-tempo` action
- kind: explainer
- logged: v0.68.0 (in progress) · 2026-09-30

Stretch to tempo renders with Change tempo, rhythmic (Rubber Band's short window). Verified in Chromium (verify_stretch.py): from 99.9 to 110 BPM the clip became 7.447 s in one step and now re-detects at 109.4 BPM from 16 transients (107.8 from 5 with the default stretch); the half-speed length fix unchanged (8.2 to 16.4 s, undo 8.2); the Quantize section wraps to three rows at 1024 px with no overflow (screenshot); containment clean; no page errors.

### src/ui/import.ts, src/ui/inspector-pane.ts · tempo detection on import (coverage wave 10)
- refers-to: src/ui/import.ts :: `offerTempo`, `importOne`; src/ui/inspector-pane.ts :: `tempoEstimate`, `estimateBpm`
- kind: explainer
- logged: v0.69.0 (in progress) · 2026-09-30

Audacity's tempo detection on import: a file imported (chosen, dropped or pasted) into a session without a tempo has its tempo read from its transients, and a confident, regular beat (8 onsets or more, a score of at least 0.7 against Detect's 0.5) becomes the session tempo as its own undo step after the import, the notice saying so. Recordings, generated voice and separated stems are not imports and are left alone; an existing tempo is never replaced. The estimator now returns its score (tempoEstimate), and estimateBpm wraps it unchanged. Verified in Chromium (verify_import_tempo.py): JFK's speech and a file of 15 irregular hits set no tempo; beat100 set 99.9 BPM in a second undo step, one undo clearing the tempo and keeping the track; beat60 set 60.0 from exactly 8 hits; beat137 imported after beat100 left 99.9 in place; the Detect regression unchanged (99.9, 60.0, 137.0); containment clean; no page errors.
