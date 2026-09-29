# HASHOUT_LOG · frontend · formwav

Living log of all comment content, explainers, rationale, TODOs and removed code for the frontend. formwav's own source files stay comment-free per dev-rules `sub-skills/hashout-log/SUB-SKILL.md`; everything they would have said lives here. Files under `src/vendor/` are third-party copies kept verbatim, upstream comments included, so they can be resynced. Read this first, then edit code surgically.

Current build version: v0.15.0
Last updated: 2026-09-28 · grid snapping, clip gain line, transport bar as a flex row

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
