# FormWav demo 3: Produce

An offline, in-browser music and sound-design arrangement. It runs entirely in the page: no engine, no desktop shell, no network, no account, and nothing you open leaves your computer. It is the third of three demos; the first (`../../demo/`) edits a multitrack field report and the second (`../repair/`) repairs one noisy recording.

## Open it

- Double-click `demos/produce/index.html` (it works from `file://`), or
- serve the folder with any static server, for example `python3 -m http.server 8000 --directory demos/produce`, and open `http://localhost:8000/`.

Every script, style, font and the logo are local files; nothing is fetched. The audio is in `assets/media/` as JavaScript data packs.

## What it shows

It opens on "Cold Open, 32 bars at 130 BPM": a Satie piano opening and a Saturn plasma-wave bed, a build that opens a low-pass filter over the stems, a first drop of the CC0 drums, bass and keys with a groove played by the step sequencer, a break on the keys alone, a launch-roar riser and a second drop. Seven tracks, seven markers (Cold open, Build, Drop A, Break, Riser, Drop B, Outro) on the ruler, automation on the tracks, and a region over the second drop. Sources, licences and changes are in [CREDITS.md](CREDITS.md). Open or drop your own audio (whatever your browser decodes) and it lands on its own track at the playhead.

- Arrangement in bars and beats with clips on tracks: drag to move, drag an edge to trim, Split (S), Duplicate (D), Delete, snap to bar, beat, sixteenth or off, zoom, fit and follow. Drag a sound from the Sounds list onto a track, or click it to place it at the playhead; the play button next to it auditions it.
- Sounds: nine 8-bar stems, three 1-bar loops and eight one-shots, all CC0, plus the piano and the two NASA textures; the patterns you make and the bounces you render join the list under "Yours and bounces".
- Effects as live chains on every track, shown as cards with knobs, a bypass and remove, in the app's own style: high and low pass, peak and shelf EQ, compressor, limiter, reverb, echo, chorus, flanger, phaser and tremolo. Add one from the Effects list or the card row, drag a knob (Shift for fine), and what plays is the chain.
- Automation lanes: pick a parameter (volume, pan, or any filter or effect parameter on the track), click to add a point, drag it, double-click to remove it, or press Rise and Fall to ramp across the region, the clip or the track. Points are linear between and held outside.
- Sequencer: 16 steps and eight rows of real one-shots with a velocity per step (Shift-click cycles accent, normal and ghost), swing from 50 to 75 percent on the off-beat sixteenths, a length of one to four bars, Hear, Place at the playhead (the pattern becomes a clip on the Pattern track), Save and Delete for patterns kept in the session.
- Mixer: a fader, pan, mute, solo and meter per track, and a master with a limiter ceiling and the mix's integrated loudness.
- Markers with a name, colour and comment, added at the playhead (M), dragged along the ruler, and turned into a region from one marker to the next.
- Bounce: the whole arrangement, the region, or the selected track through its effects, with a reverb tail, an optional loudness target (as mixed, -14, -16 or -9 LUFS) and a 16-bit, 24-bit or 32-bit float WAV; Hear the bounce plays what was saved. Bounce track renders one track through its chain into a new track and mutes the original.
- Undo and redo of every edit (Ctrl or Cmd Z), and the app's own themes and accent colours from the title bar.

## How it is made

`src` is a small Vite project that reuses the app's real stylesheets (`frontend/src/styles`), its knob (`frontend/src/ui/knob.ts`), its theme module and the pre-paint theme boot (written into `src/index.html`), and the first demo's `dsp.ts` (loudness and peaks), `wav.ts` and icons. One graph builder (`audio.ts`) makes the Web Audio chain for live playback and for the offline bounce, so what plays is what is saved. The audio core in `native/formwav-dsp` is Rust; this demo uses the browser's audio nodes and is not byte-identical to it.

Packs are injected as script tags and decoded with the Web Audio API, because Chrome blocks fetching local files from `file://`. The empty arrangement reads "Loading the session media: n of 23" in its reserved space, the Sounds list and the effect cards are hidden in place until the packs are decoded, and then the session appears in one step.

## Rebuild

From the repository root:

```sh
cd demos/produce
node ../../frontend/node_modules/vite/bin/vite.js build --config ./vite.config.mjs
```

`frontend/node_modules` must exist (`npm ci` in `frontend`). The build writes `index.html`, `assets/produce.js` and `assets/style.css` here and leaves `assets/media/` alone. A dev server is `node ../../frontend/node_modules/vite/bin/vite.js --config ./vite.config.mjs` on port 3073, bound to loopback.

## Limits

- The tempo is fixed at 130 BPM in 4/4 and there are no tempo changes, no time stretch and no MIDI.
- No sends, buses or hosted plug-ins; effects are per track.
- The master limiter is the browser's compressor node set as a brick-wall, so a bounce's peaks can sit a little under the ceiling.
- Everything is held in memory; a bounce of the whole arrangement takes a few seconds.
- No saving of sessions and no encoding other than WAV.
