# HASHOUT_LOG · frontend · formwav

Living log of all comment content, explainers, rationale, TODOs and removed code for the frontend. formwav's own source files stay comment-free per dev-rules `sub-skills/hashout-log/SUB-SKILL.md`; everything they would have said lives here. Files under `src/vendor/` are third-party copies kept verbatim, upstream comments included, so they can be resynced. Read this first, then edit code surgically.

Current build version: v0.1.0
Last updated: 2026-09-28 · shell, engine link, themes, first throttled verification

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
    │   └── index.ts             headless state with granular events (link, transport)
    ├── extensions/
    │   ├── registry.ts          register, activateAll, disposeAll
    │   └── engine-link/
    │       └── index.ts         asks the engine for health, sets link state
    ├── io/
    │   └── engine-client.ts     fetchHealth with timeout
    ├── ui/
    │   ├── icons.ts             twelve NodeMode icons plus the icon() helper
    │   └── shell.ts             mounts the shell once, patches status and clock in place
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
