# FormWav demo

An offline, in-browser demo of FormWav's audio editing. It runs entirely in the page: no engine, no desktop shell, no network, no account, and nothing you open leaves your computer.

## Open it

- Double-click `demo/index.html` (it works from `file://`), or
- serve the folder with any static server, for example `python3 -m http.server 8000 --directory demo`, and open `http://localhost:8000/`.

Every script, style, font and the logo are local files in this folder; nothing is fetched.

## What it shows

It opens on "Round the Moon, a field report", a five-track session of real public-domain recordings: NASA launch radio (shown as a spectrogram), a LibriVox reading of Jules Verne, a Satie piano piece, a Saturn plasma-wave bed and a second, muted reading with 60 Hz mains hum to repair. The sources, licences and changes are in [CREDITS.md](CREDITS.md). Open or drop your own audio (WAV, MP3, FLAC, OGG, Opus, M4A, whatever your browser decodes) and it becomes another track at 44.1 kHz.

- Tracks drawn as waveforms or as spectrograms, with a time ruler, zoom, fit, follow and a drag selection (double-click a track to select all of it)
- Playback of the mix with mute, solo, per-track gain, loop of the selection, a clock and level meters
- Measurements: peak, RMS and integrated loudness (BS.1770 K-weighted, gated) per track or selection, the same for the whole mix, and a spectrum tab that is live while playing and an average of the range while stopped
- Nineteen real client-side operations on the selected track and range, every one a single undo step: Trim to selection, Delete selection, Silence, Reverse, Invert polarity, Gain, Normalize peak, Normalize loudness, Fade in, Fade out, High-pass, Low-pass, Band EQ, De-hum, Reduce noise (a spectral gate that learns the steady noise from the quietest tenth of the range), Compressor, Strip silence, Change speed and Mono mixdown
- The Sounds tab adds any of the session's recordings, or a synthetic sample, as another track
- A History tab that jumps to any step, with undo and redo (Ctrl or Cmd Z, plus Shift for redo)
- A generator for tone, sweep, pink noise and a click track
- Export of the mixdown or the selected track, whole or the selection only, as 16-bit, 24-bit or 32-bit float WAV
- The app's own themes and accent colours from the title bar

## How it is made

`demo/src` is a small Vite project that reuses the app's real stylesheets (`frontend/src/styles`), its theme module (`frontend/src/vendor/formvis/themes.ts`) and the pre-paint theme boot, and its inline currentColor icons (`frontend/src/ui/icons.ts`). The audio core in `native/formwav-dsp` is Rust and needs a native or WebAssembly build, so the demo carries a TypeScript equivalent of the operations it shows (`demo/src/dsp.ts`, `demo/src/ops.ts`). It is not byte-identical to the Rust core; it demonstrates the same kinds of edit.

The session's recordings ship as JavaScript data packs in `demo/assets/media/` (each sets `window.__FW_MEDIA[name]` to the base64 of an mp3), injected as script tags when needed and decoded with the Web Audio API, because Chrome blocks fetching local files from `file://`. The page shows "Loading the session media" in the empty timeline and the status bar until they are decoded, then the tracks appear in one step. If a pack fails to load, the demo falls back to the synthetic sample audio generated in `demo/src/synth.ts` (an additive and formant voice, an arpeggio and pad, and a drum pattern), which is not third-party material.

## Rebuild

From the repository root:

```sh
cd frontend
npm ci
npx vite build --config ../demo/vite.config.ts
```

The build writes `demo/index.html`, `demo/assets/demo.js` and `demo/assets/style.css` and leaves `demo/assets/media/` alone (a classic deferred script, so `file://` works, and fonts inlined in the stylesheet). The dev server for the demo, if you want one, is `npx vite --config ../demo/vite.config.ts` on port 3070, bound to loopback.

## Limits

- Everything is held in memory; a very long file makes the spectrogram and loudness measurements slower.
- One selected track at a time is edited; effects are applied (destructively, with undo) rather than kept as live chains.
- There is no recording, no saving of sessions and no encoding other than WAV.
