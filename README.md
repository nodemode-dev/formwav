<p align="center"><img src="assets/formwav_folder_icon.png" width="112" alt="formwav"></p>
<h1 align="center">formwav</h1>
<p align="center"><b>Local-first audio editing, the audio member of the form family.</b></p>
<p align="center">
<img src="https://img.shields.io/badge/version-0.45.0-f97316" alt="version 0.45.0">
<img src="https://img.shields.io/badge/node-20.19%2B-339933" alt="node 20.19+">
<img src="https://img.shields.io/badge/python-3.12-3776AB" alt="python 3.12">
<img src="https://img.shields.io/badge/rust-stable-B7410E" alt="rust stable">
<img src="https://img.shields.io/badge/license-Apache--2.0-lightgrey" alt="Apache 2.0 license">
</p>

## What it is

formwav is an open-source audio editor that runs on your own machine: record, edit, repair, mix & export w/o an account, an upload or a usage meter. It is built to sit beside formcut (video, `.fmc`) & formvis (image, `.fmv`) w/ the same architecture & design system, & it saves `.fmw` projects. Its target is a measured 90% on a sourced parity scoreboard against the leading audio editors. This is v0.6.0: import or drop a WAV, or record from your microphone, & it lands as a track w/ its waveform; play the session through the Rust core running as WebAssembly in the browser's audio thread; undo & redo every change; save the session as a self-contained `.fmw` & open it again. Editing follows.

**Stack.** Vanilla TypeScript 7 & Vite 8 · Python 3.12 & FastAPI · Rust (`formwav-dsp`, also built into the engine as a Python module) · about 1,710 lines of formwav's own TypeScript, CSS, Python & Rust in v0.3.0, vendored design-system files excluded.

## Highlights

- **Engine link, verified.** The interface asks the engine for its health through the dev proxy & shows the answer in place; an engine that is down reads as offline, not as a spinner.
- **Zero-flash shell.** Mounted once & patched in place. Under 4x CPU throttling & a Fast 3G profile: layout shift 0, only the status chip's text & state change after mount, & the first frames are already the theme's background in dark & light profiles.
- **NodeMode design system.** Tokens, the 14 theme profiles & the pre-paint theme boot, vendored verbatim, so formwav matches formvis & NodeMode surface for surface.
- **Audio graph built for the whole plan.** Ports are N-channel audio or events from the first build, so MIDI, surround & ambisonics add nodes rather than reshape the graph. Kind mismatches, cycles & duplicate edges are refused.
- **Import, see, undo.** Import or drop a WAV (PCM 8 to 32 bit, float 32 & 64) & it lands as a track w/ a waveform drawn from peaks the Rust core computes; every change is an undo step, 200 deep, on Cmd or Ctrl Z.
- **Loopback only.** The interface & the engine bind 127.0.0.1; nothing listens on the network unless `HOST` says so.

## Quick Start

Requirements: Node 20.19 or newer, Python 3.12 (the tested version), Rust stable (the installer builds the audio core into the engine; get it from https://rustup.rs), git.

### macOS & Linux

```bash
git clone https://github.com/nodemode-ai/formwav.git
cd formwav
./formwav_oc_install
./formwav
```

### Windows

```bat
git clone https://github.com/nodemode-ai/formwav.git
cd formwav
formwav_oc_install.bat
formwav.bat
```

| Service | URL | Notes |
| --- | --- | --- |
| Interface (dev) | http://localhost:3060 | Vite, loopback only, strict port, proxies `/api` to the engine |
| Interface (preview) | http://localhost:3061 | `npm run preview` of the built interface, same proxy |
| Engine | http://127.0.0.1:8060 | FastAPI; health at `/api/health` |

## Configuration

The engine reads `backend/.env`, which is never committed; `backend/.env.example` is the template.

| Variable | Purpose |
| --- | --- |
| `HOST` | Engine bind address; loopback when unset |
| `FORMWAV_PORT` | Engine port |
| `FORMWAV_CORS_ORIGINS` | Browser origins allowed to call the engine directly |
| `FORMWAV_DATA_DIR` | Where imported media is stored; `backend/data` when unset |
| `FORMWAV_MAX_IMPORT_MB` | Largest file the engine accepts for import |

## Architecture

```text
formwav/
├── formwav, formwav.bat               boot both sides; stops both on exit
├── formwav_oc_install(.bat)           install both sides
├── assets/                            repo art (README logo), not app runtime files
├── backend/                           FastAPI engine, app.main:app, routes under /api
├── frontend/                          vanilla TypeScript & Vite interface
│   ├── src/engine/                    headless state w/ granular events, no DOM
│   ├── src/extensions/                registry & one folder per feature (engine-link)
│   ├── src/io/                        engine client
│   ├── src/ui/                        shell & icons
│   ├── src/styles/                    formwav's own styles, tokens only
│   └── src/vendor/nodemode/           verbatim NodeMode tokens, themes, DOM helpers (MIT)
└── native/formwav-dsp/                Rust audio core: graph & port model, WAV decoding, peaks, Python module
```

Each side keeps a `HASHOUT_LOG.md` at its root: a map of its files & the reasoning the code would otherwise carry as comments. Read it before editing.

## Not built or not verified yet

- **Editing.** Import, lanes, undo, playback, recording, save & open work (Space to play & stop, R to record, Home to the start, click a lane to seek, Cmd or Ctrl S to save & O to open); there is no clip editing yet, & takes are not yet shifted for audio latency. Loop is shown disabled so the transport's layout is fixed.
- **Windows scripts.** Written, not run on Windows yet.
- **Desktop app.** The Tauri shell arrives w/ packaging; v0.1.0 runs in the browser only.
- **Native core in the interface.** The interface runs `formwav-dsp` as WebAssembly for playback; the desktop build of the core comes w/ packaging. Clips at a sample rate other than the session's stay silent until resampling lands.
- **Formats beyond WAV.** Import reads WAV (PCM 8 to 32 bit, float 32 & 64, extensible headers); other formats arrive w/ the ffmpeg sidecar.

## Development

`main` plus short-lived work branches. Contributions follow the dev-rules laws: single-region hand edits, zero DOM flash or re-render, no emoji, no em dash, no icon-library dependencies, `v*.*.*` versions, Conventional Commits w/ the version in parentheses.

## Status

v0.45.0 adds to transcript editing: speaker labels (each track's name heads its words when the session has more than one speaker) & Remove retakes (a phrase said again drops the earlier attempt & keeps the last take). v0.44.0 brought Descript-style transcript editing: the left pane's Transcript tab transcribes the session word by word (Whisper, locally), & you edit audio by editing text: click a word to go there, shift-click to select a run, Delete selected words, Remove filler words (um, uh, you know, I mean), Shorten gaps; each is one undo step, ripples every track, & the transcript follows every edit. Needs the transcript runtime, from `backend/`: `pip install -r requirements_transcript.txt` (the model downloads on first use). v0.43.0 was the first coverage wave: 37 more effects written against Audacity's built-ins, iZotope RX's repair modules & Audition (amplify, invert, reverse, DC offset, click & gap repair, truncate silence, EQ, tempo, pitch & speed, de-clip, de-crackle, mouth de-click, de-plosive, de-wind, de-noise, leveler, dither, phase, channel tools, peak normalize, loudness targets, exciter), 85 effects in all; Generate in the Media tab (tones, noises, silence, chirp, DTMF, bleep); Analyze in the Inspector (statistics, spectrogram). Every one of the 224 reference features now has a status or a scheduled release in the coverage record. v0.42.0 made the interface hold together: the Mixer docks inside the timeline pane (it had floated over the side panes), nothing overflows or overlaps at 1024 to 1440 px wide, & the Media & Inspector panes resize by dragging their dividers & hide from the titlebar, remembered between sessions. What comes next, release by release (Descript's transcript editing first, then Audacity's menus, labels, spectrogram & export, then Adobe Podcast), is the roadmap at the top of the dev plan. v0.41.0 brought formcut's audio effects into the Inspector: select a clip for one-click Enhance speech (formcut's voice-clean) or any of formcut's 48 effects (clean up, dynamics, tone, spaces, characters, modulation, pitch); each renders a new file & points the clip at it, so one undo returns the original. v0.40.0 brought formwave's generative voice into formwav: the left pane's Voice tab loads a Qwen3-TTS checkpoint & generates speech onto a new track at the playhead (clone a voice from any file in Media, a preset voice, or a voice designed from a description, in ten languages), & transcribes the selected clip w/ Qwen3-ASR or Whisper. The voice runtime is optional; on a Mac, from `backend/`: `pip install -r requirements_voice_macos.txt`, then `pip install --no-deps -r requirements_voice_qwen.txt`; set `FORMWAV_MODELS_ROOT` to reuse formwave's downloaded models. v0.39.0 brought formwav into its family's layout: formcut's titlebar (Save, Open, Import on the left, the session in the middle, Loudness & an amber Export on the right) over three panes, Media (every file in the session; + adds one to a new track at the playhead), the Timeline w/ formcut's tool tray (Grid, Shuffle, Spot, Punch, Mixer) & the Inspector (the selected clip's start, gain, fades & fade curve, & its track's volume & pan). v0.38.0 opened formwav to all audio: Import takes MP3, M4A/AAC, FLAC, OGG, Opus, AIFF, WAV & the audio of video files (MP4, MOV, MKV, WebM), converted w/ a high-quality resampler to the session's rate, so every clip plays; sessions start at 48 kHz unless the first file is 44.1, 48, 88.2 or 96 kHz, & an older session below 44.1 kHz is raised to 48 kHz automatically. Needs ffmpeg for anything but WAV (macOS: `brew install ffmpeg`). Also here: the Smart Tool (drag in a clip's upper half to select a range, lower half to move it) & the mixer (Mixer button or X), w/ a strip for every track & bus & a Master strip. Also here: volume & pan automation lanes, take lanes w/ comping by drag, loop recording w/ alternate takes, live loudness metering (momentary, short-term & integrated LUFS), punch-in, track arming w/ recording meters in the track header, loudness normalization & four edit modes (Slip, Grid G, Shuffle H w/ reordering, Spot T). The editing surface has a timeline ruler, zoom (`=`, `-`, `0`) that keeps the playhead in place, & clips you can select, cut, copy & paste, drag, split (S), delete, trim, fade w/ four curves & turn up or down w/ a gain line, one clip or a whole selection at a time; every edit is one undo step. On top of Phase 2: import, recording, sample-accurate looping, `.fmw` save & open w/ revision checks, pan, buses, crossfades, & Export w/ peak & BS.1770 loudness; the engine's render matches the browser's (exactly, or within 1e-7 where fades or pan use `sin` or `cos`). Still to come in Phase 3: sends & inserts, & recording latency compensation.

## Contributors

- **nodemode-ai** · owner & build

## Licensing

Apache License 2.0, in [`LICENSE`](LICENSE). Third-party pieces & their licences are in [`NOTICE`](NOTICE); responsible use is in [`USE_POLICY.md`](USE_POLICY.md).
