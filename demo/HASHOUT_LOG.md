# HASHOUT_LOG · demo · formwav

Rationale and removed-code notes for the browser demo. Source files here stay comment-free; what they would have said lives here.

Current build version: v2.24.1
Last updated: 2026-11-10 · v2.26.2 the config's paths are file system paths (a checkout path with a space, or on Windows, builds); 2026-11-07 · v2.24.1 no demo change (the version only); 2026-11-07 · v2.24.0 no demo change (the version only); 2026-11-07 · v2.23.3 the link row to the Repair and Produce demos (demos/); 2026-11-07 · v2.23.2 no demo change (the version only); v2.23.1 the media pass: real public-domain session audio, Reduce noise, stale Clip stats fixed; v2.23.0 first version of the demo

---

## v2.26.2 the config's paths are file system paths

- refers-to: vite.config.ts :: root, resolve.alias "@fontsource"; ../demos/produce/vite.config.mjs and ../demos/repair/vite.config.mjs :: here
- kind: fix
- logged: v2.26.2 · 2026-11-10
- `new URL(p, import.meta.url).pathname` is a URL path, not a file system path: it keeps percent-encoding (a checkout under `My Projects` gives `My%20Projects`) and on Windows starts `/C:/`, so vite's root and the `@fontsource` alias pointed at folders that do not exist and the build and dev server failed. The config now imports `fileURLToPath` from `node:url` (a Node built-in, so it still resolves when the config is loaded from `frontend/`) and uses it for both paths; the two demos under `demos/` do the same in their `here` helper. Checked by building the three demos (outDir sent to a scratch folder) from a copy under a folder named `My Projects`: all three build; with the old configs the demo and repair builds failed there. Not run on Windows.

## v2.23.1 media pass

- The demo now opens on real, public-domain audio (see CREDITS.md) instead of synthetic tracks: "Round the Moon, a field report". Story and order: NASA launch radio cold open (0 to 15.7 s), a LibriVox reading of Jules Verne from 16.4 s over a Satie piano bed with a Saturn plasma-wave texture from 18 s. A second reading with real 60 Hz mains hum sits muted on its own track as the repair bench, and the launch radio is itself a noisy real recording (speech over a rocket roar).
- Lead-in offsets are baked as leading zeros when a clip is decoded (`media.ts`), because a track here is one buffer from time zero. Track gains (-3 dB on piano and Saturn) are session settings, not baked into the files.
- Packs, not files: Chrome blocks fetch of local files on `file://`, so each clip is `assets/media/<id>.js` setting a base64 string on `window.__FW_MEDIA`, injected as a script tag and decoded with `decodeAudioData`. The page string is deleted after decoding to free memory; decoded buffers are cached per id and offset, and are never mutated, so "Reload the session" reuses them. The packs are written by a one-off generator outside the repo from ffmpeg-encoded mp3 files.
- Zero flash: the shell is revealed at once; the empty timeline reads "Loading the session media" and the status bar counts clips; the tracks then appear in one commit and the timeline fits. On any failure the demo falls back to the synthetic session and says so.
- Why mp3: it decodes in every browser, unlike Ogg Opus in Safari. 96 kbps mono for speech, 160 kbps for the piano, 128 kbps for the NASA stereo clips.
- Levels: clips were gained with a static dB value to about -20 LUFS (speech), -24 (piano), and checked for peaks below -0.8 dBFS after the mp3 encode. The first attempt at +6 dB clipped after encoding because the source peaked at -4.4 dBFS; the gain was cut to +4 dB with a peak limiter.
- Reduce noise (`denoise` in `dsp.ts`, op "Reduce noise"): spectral gate, 2048-point sqrt-Hann frames at 50 percent overlap, the noise spectrum is the mean power of the quietest tenth of the frames in the range, per-bin gain is the square root of one minus over-subtraction times noise over power, floored at the chosen reduction, smoothed across bins and time. It was added because the brief asks for repair tools on a real noisy recording and De-hum alone does not touch broadband noise. Measured on the hum reading: a quiet stretch fell from -53.9 to -68.4 dBFS RMS while a loud word moved from -15.6 to -15.7. A first version with 75 percent overlap took 875 ms for 22 s of audio in Node; this one takes 208 ms. De-hum and Reduce noise now form a "Repair" group; De-hum defaults to 60 Hz and four harmonics to match the real hum.
- Clip tab stats were stale after an edit: the cache key used the length and two sample values, so an edit that kept the length and those two samples (a gain or a notch on the middle of a track) reused the old numbers. The key is now the track id plus a per-buffer identity (a WeakMap counter), which changes whenever an operation produces new arrays. The spectrum tab's static average had the same flaw and uses the same key.
- Track lane height went from 96 to 80 px so five tracks fit above the bottom panel at 1440 by 900.
- Not done: no per-clip fades or offsets editing (a track is one buffer from zero), no recording, no mp3 export.

## Why it is shaped this way

- The full interface needs the engine (`/api/*`) and the Rust core, so importing `frontend/src/main.ts` with a shim would stub most of the screen. The demo is its own small interface in the app's layout idiom (title bar, tools pane, timeline, bottom tabs, transport bar) that reuses the real tokens and stylesheets, and the class names `fw-pane`, `fw-tbtn`, `fw-ibtn`, `fw-mode`, `fw-clock`, `fw-status` so form-family.css and canvas.css style it as they style the app.
- `native/formwav-dsp` has no committed WebAssembly, and a build needs a Rust wasm toolchain, so the operations are re-written in TypeScript (`dsp.ts`, `ops.ts`). Loudness follows ITU-R BS.1770 (K-weighting, 400 ms blocks at 75 percent overlap, absolute gate at -70 LUFS and relative gate 10 LU lower).
- Module scripts do not load from `file://` in Chrome, so `vite.config.ts` builds an IIFE and a post plugin rewrites the module script tag to a deferred classic one and drops `crossorigin` from the stylesheet link. Fonts are inlined as data URLs (`assetsInlineLimit`) for the same reason.
- The config is a plain object that imports only the Node built-in `node:url` (for `fileURLToPath`, since v2.26.2) so it resolves from `frontend/`, where vite is installed; `root` is `demo/src` and `outDir` is `demo` with `emptyOutDir: false`, so the output sits beside `README.md` and `src/`. Vite warns that outDir is a parent of root; that is intended.
- `@fontsource` is aliased to `frontend/node_modules`, and only the latin subsets are imported, which keeps the stylesheet near 530 KB instead of several megabytes.
- Zero DOM flash: all panes are static markup in `index.html`; track rows are created once per track and patched in place; op forms are built once and shown or hidden; canvases are sized by a ResizeObserver and redrawn in place; the playhead, selection and meters move by transform; the page is hidden until the first frame and the theme boot runs inline before the first paint.
- Edits are destructive per track with whole-track snapshots in a history list (the arrays are never mutated, so a snapshot is a set of references).
- Playback restarts nothing on mute, solo or gain (gain nodes are updated live); any edit stops playback.

## Sample audio

Generated by code, deterministic (seeded). Dialogue is a glottal pulse through three formant resonators gliding between vowels, with a little noise and a 50 Hz hum with harmonics so De-hum has something to remove. Music is a plucked arpeggio over four chords with a detuned pad and a short stereo delay. Drums are a kick, snare and hat pattern at 100 BPM.

## Not done

- No recording, no multiple clips per track, no live effect chains, no automation.
- No MP3, FLAC or other encoders; export is WAV only.
- A track's spectrogram uses 1024-point frames at a capped column count, which is coarse for very long files.
