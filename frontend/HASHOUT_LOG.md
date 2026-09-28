# HASHOUT_LOG · frontend · formwav

Living log of all comment content, explainers, rationale, TODOs and removed code for the frontend. formwav's own source files stay comment-free per dev-rules `sub-skills/hashout-log/SUB-SKILL.md`; everything they would have said lives here. Files under `src/vendor/` are third-party copies kept verbatim, upstream comments included, so they can be resynced. Read this first, then edit code surgically.

Current build version: v0.4.1
Last updated: 2026-09-28 · prefetch on import, loading notice, cached worklet views, data-action on transport buttons

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
    │   └── media-client.ts      importFile, fetchPeaks
    ├── ui/
    │   ├── icons.ts             fourteen NodeMode icons plus the icon() helper
    │   ├── shell.ts             mounts the shell once, patches status and clock in place
    │   ├── session.ts           wires lanes, import, undo and redo buttons, shortcuts
    │   ├── lanes.ts             keyed track lanes, clip boxes, canvas waveforms
    │   ├── import.ts            Import button, file picker, drop on the stage, notice line
    │   ├── shortcuts.ts         Cmd or Ctrl with Z, Shift Z and Y
    │   └── transport.ts         transport buttons, playhead, click to seek, Space and Home
    ├── audio/
    │   ├── player.ts            AudioContext at the session rate, media into the worklet, bounce()
    │   └── player-worklet.ts    AudioWorklet hosting the wasm player (public/core, built at install)
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
