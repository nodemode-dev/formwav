# FormWav demo 2: Repair

An offline, in-browser repair and mastering bench. It runs entirely in the page: no engine, no desktop shell, no network, no account, and nothing you open leaves your computer. It is the second of three demos; the first (`../../demo/`) edits a multitrack session and the third (`../produce/`) builds a beat.

## Open it

- Double-click `demos/repair/index.html` (it works from `file://`), or
- serve the folder with any static server, for example `python3 -m http.server 8000 --directory demos/repair`, and open `http://localhost:8000/`.

Every script, style, font and the logo are local files; nothing is fetched. The two recordings that belong to this demo are in `assets/media/`; two more are read from the first demo's `demo/assets/media/`, so keep the repository's folder layout.

## What it shows

It opens on the Original Dixieland Jass Band's "Dixie Jass Band One-Step" (1917), a public-domain 78 rpm record that crackles, pops and sits in a narrow band, already repaired by a live chain. The Source menu holds three more: Caruso's "Vesti la giubba" (1907, shellac), a LibriVox reading with 60 Hz mains hum, and NASA launch commentary over the roar of a shuttle. Open or drop your own audio (WAV, MP3, FLAC, OGG, Opus, M4A, whatever your browser decodes) and it becomes a fifth source, the first two minutes of it. Sources, licences and changes are in [CREDITS.md](CREDITS.md).

- A fixed rack in the app's order: Heal selection, De-click, De-hum, Reduce noise, EQ, Compressor, Loudness and limiter. Every stage has a power switch and its own parameters, and a one-line result under its name ("111 clicks repaired", "Up to 4.4 dB reduction", "+9.8 dB, -16.0 LUFS"). All on and Reset sit above the rack.
- Everything is non-destructive and live: changing a stage re-renders the chain, using the cached result of every stage before it, and the views and measurements follow.
- Spectrogram views: Compare (the original over the repaired one), Original, Repaired, with a waveform that carries the original as a ghost and click marks in red.
- Heal selection as the app defines it: pick Heal box, drag a box on a spectrogram, then press Heal selection. The box joins the Heal stage and its cells are rebuilt from the sound around it. A drag alone repairs nothing, and there is no brush that heals.
- A and B playback of the original and the repaired recording at the same position (keys A and B), with Match level so the comparison is not won by loudness. A range selection can loop.
- Measure, Spectrum, Dynamics and History tabs: integrated loudness (BS.1770), peak, RMS, how far the noise sits below the level, mains hum, clicks found and clicks left, peak to loudness; the average spectra with the EQ curve; the level over time with the compressor's gain reduction; and a history that jumps to any step.
- Export of the repaired or the original recording, whole or the selected range, as a 16-bit, 24-bit or 32-bit float WAV. The loudness stage targets -16 LUFS by default and the exported file measures that.
- The app's own themes and accent colours from the title bar.

## How it is made

`src` is a small Vite project that reuses the app's real stylesheets (`frontend/src/styles`), its theme module and the pre-paint theme boot of the first demo (injected from `demo/src/index.html` at build time, so it cannot drift), the first demo's `dsp.ts` (FFT, spectrogram, loudness, spectral gate, filters), `wav.ts` and icons. New code lives in `fx.ts` (de-click, heal, soft-knee compressor, limiter, loudness master, measures), `stages.ts` and `bench.ts` (the chain and its cache), `rack.ts`, `views.ts`, `panels.ts`, `player.ts` and `main.ts`. The audio core in `native/formwav-dsp` is Rust; this demo carries TypeScript equivalents of what it shows and is not byte-identical to it.

The two recordings ship as JavaScript data packs (each sets `window.__FW_MEDIA[name]` to the base64 of an mp3), injected as script tags and decoded with the Web Audio API, because Chrome blocks fetching local files from `file://`. The rack and views are static markup patched in place; while a recording decodes, the stage shows "Loading" in its reserved space.

## Rebuild

From the repository root:

```sh
cd demos/repair
node ../../frontend/node_modules/vite/bin/vite.js build --config ./vite.config.mjs
```

`frontend/node_modules` must exist (`npm ci` in `frontend`). The build writes `index.html`, `assets/repair.js` and `assets/style.css` here and leaves `assets/media/` alone. A dev server is `node ../../frontend/node_modules/vite/bin/vite.js --config ./vite.config.mjs` on port 3071, bound to loopback.

## Limits

- One mono recording at a time; stereo files are mixed to mono.
- Reduce noise learns from the quietest tenth of the recording, so it suits steady noise, not speech babble.
- De-click rebuilds short pops by linear prediction and is tuned for 78 rpm crackle; it is not a general declipper.
- Everything is held in memory; a long file is cut to its first two minutes.
- No saving of sessions and no encoding other than WAV.
