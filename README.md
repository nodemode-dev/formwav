<p align="center">
  <img src="assets/app-icon/formwav-256.png" width="128" height="128" alt="FormWav icon: the f-note on a dark tile with a waveform running through it">
</p>

<h1 align="center">FormWav</h1>

<p align="center">
  <b>Audio editing and music; the multitrack studio of the Form family.</b><br>
  Record, edit, repair, mix and export on your own machine,<br>
  with no account, no upload and no usage meter. Claude Code works inside it over MCP.
</p>

<p align="center">
  <img alt="version 2.24.1" src="https://img.shields.io/badge/version-2.24.1-eef0f4?style=flat-square">
  <img alt="TypeScript and Vite" src="https://img.shields.io/badge/TypeScript-Vite-3178c6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="Python and FastAPI" src="https://img.shields.io/badge/Python-FastAPI-009688?style=flat-square">
  <img alt="Rust audio core" src="https://img.shields.io/badge/Rust-audio%20core-b7410e?style=flat-square">
  <img alt="macOS, Windows, Linux" src="https://img.shields.io/badge/macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-native-2f7bf5?style=flat-square">
  <img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-3a3a3a?style=flat-square">
  <img alt="Status: in development" src="https://img.shields.io/badge/status-in%20development-d69e2e?style=flat-square">
</p>

<p align="center">
  <a href="https://formwav.formai.studio/"><b>Download FormWav on formai.studio</b></a> ·
  <a href="#run-it-from-source">Run it from source</a>
</p>

<p align="center">
  <img src="docs/images/formwav-hero.jpg" alt="FormWav with a Final scene session: Dialogue and Music tracks drawn as waveforms, the effects browser on the left, and a Compressor and De-Esser chain with knobs on the Effects tab below" width="100%">
  <br>
  <sub>A dialogue and music scene with a compressor and de-esser chain on the voice track.</sub>
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#everything-in-the-box">In the box</a> ·
  <a href="#built-for-agents">Agents</a> ·
  <a href="#under-the-hood">Under the hood</a> ·
  <a href="#download">Download</a> ·
  <a href="#run-it-from-source">Run from source</a>
</p>

<table>
  <tr>
    <td width="25%" valign="top">
      <h3>Multitrack editing</h3>
      Cut, trim, fade, comp takes and move clips in four edit modes, with every edit one undo step.
    </td>
    <td width="25%" valign="top">
      <h3>Repair and mix</h3>
      De-hum, de-click, de-reverb and spectrogram healing, then sends, buses, VCAs and automation in a full mixer.
    </td>
    <td width="25%" valign="top">
      <h3>One core, two places</h3>
      The same Rust core mixes in the browser and renders exports in the engine, so what plays is what exports.
    </td>
    <td width="25%" valign="top">
      <h3>Agent-ready</h3>
      The window, a command line and an MCP server all run the same registry of commands on the open session.
    </td>
  </tr>
</table>

## Features

<table>
  <tr>
    <td width="50%" valign="top">
      <img src="docs/images/formwav-clip.png" alt="The pad clip selected on the timeline, with its name, start, length, gain, fades and sound type in the Clip tab" width="100%">
      <br><sub>A selected clip and its settings in the Clip tab.</sub>
      <h3>Clips you can shape</h3>
      Set gain, fades and their curve, split at the playhead, normalize, or run the repair assistant on a clip.
    </td>
    <td width="50%" valign="top">
      <img src="docs/images/formwav-spectrogram.png" alt="The four tracks drawn as spectrograms with a frequency ruler, over the mixer" width="100%">
      <br><sub>The same four stems as spectrograms.</sub>
      <h3>See the sound</h3>
      Switch clips to spectrograms, select a box, lasso or brush stroke of sound, and heal it in one undo step.
    </td>
  </tr>
</table>

## Everything in the box

<table>
  <tr>
    <td width="33%" valign="top">
      <h4>157 offline effects</h4>
      EQ and filters · Dynamics · Space and movement · Repair
    </td>
    <td width="33%" valign="top">
      <h4>Live processing</h4>
      19 realtime effects · 24 studio processors · Sends, buses and VCAs · Automation lanes · Loudness meters
    </td>
    <td width="33%" valign="top">
      <h4>Formats</h4>
      Opens: WAV · AIFF · FLAC · MP3 · M4A · OGG · Opus · a video's audio · MIDI · OMF · Saves: 12 export formats · Native: <code>.fmw</code>
    </td>
  </tr>
</table>

## Built for agents

One registry of 141 commands, the menu bar's items and the session tools. The window, the command line and the MCP server call the same ones.

```sh
./formwav cli list                    # every command on the open session
./formwav cli run <id> key=value      # run one command by id
```

`.mcp.json`, `.codex/config.toml` and `.cursor/mcp.json` are already wired in this repo. The engine also serves MCP at `http://127.0.0.1:8060/mcp`, and `backend/formwav_mcp/serve` runs a standalone stdio server. See [`AGENTS.md`](AGENTS.md).

## Extensions

formwav loads extensions made to the Form Extension Contract: installed through FormPortal, or run from a folder while you make one with form.ext. They show in the **Extensions** menu (each extension's commands, Extensions panel, Reload extensions, Manage in FormPortal), in the Extensions panel under the editor's More (name, version, source, permissions, state), as panels in the editor or as dialogs, and in the command palette. Each runs in a sandboxed frame, reads and changes the session only through formwav's own commands (all of one call is one undo step), and asks before its first use. Agents reach them with `extensions_list` and `extension_command`, or `./formwav cli extensions`. What an extension can call is in [`docs/EXTENSIONS.md`](docs/EXTENSIONS.md).

## Under the hood

- **One mixer:** the Rust core (`native/formwav-dsp`) runs as WebAssembly in the browser and as a Python module in the engine.
- **Local first:** the interface and the engine bind 127.0.0.1; nothing listens on the network unless you turn it on.
- **26 languages:** English by default, with 25 more interface languages.

## Download

| Platform | Download | Release |
|---|---|---|
| macOS | [Download FormWav for macOS](https://formai.studio/get/formwav/macos) | [FormWav releases on FormCompiler](https://github.com/nodemode-dev/formcompiler/releases?q=formwav-v&expanded=true) |
| Windows | [Download FormWav for Windows](https://formai.studio/get/formwav/windows) | [FormWav releases on FormCompiler](https://github.com/nodemode-dev/formcompiler/releases?q=formwav-v&expanded=true) |
| Linux | [Download FormWav for Linux](https://formai.studio/get/formwav/linux) | [FormWav releases on FormCompiler](https://github.com/nodemode-dev/formcompiler/releases?q=formwav-v&expanded=true) |

All FormWav builds are compiled and released from [FormCompiler](https://github.com/nodemode-dev/formcompiler); this repo holds the source.

**Updates come through FormPortal.** FormWav does not update itself: install [FormPortal](https://formai.studio/formportal/) and it keeps FormWav up to date, or download the new version from the links above.

## Demo

Three offline demos open in a browser with no install, no engine and no network, each on real public-domain or CC0 audio or your own:

- [`demo/index.html`](demo/index.html), Mix: FormWav's waveform and spectrogram views and nineteen edits, including De-hum and Reduce noise repairs, on a five-track session of public-domain recordings (credits in [`demo/CREDITS.md`](demo/CREDITS.md); see [`demo/README.md`](demo/README.md)).
- [`demos/repair/index.html`](demos/repair/index.html), Repair: one noisy 1917 record on a live chain of Heal selection, De-click, De-hum, Reduce noise, EQ, a compressor and a loudness target, with a before and after A/B (see [`demos/repair/README.md`](demos/repair/README.md)).
- [`demos/produce/index.html`](demos/produce/index.html), Produce: a 32 bar piece at 130 BPM built from CC0 stems and one-shots with the step sequencer, effect chains, automation, markers and a bounce of the mix (see [`demos/produce/README.md`](demos/produce/README.md)).

## Run it from source

Prefer it in your browser, or want to contribute? Run the web UI straight from this repo.
**Requires:** Node 20.19 or newer, Python 3.12, Rust stable, git, and `ffmpeg` on your PATH. On Debian and Ubuntu add `libasound2-dev pkg-config`.

```sh
git clone git@github.com:nodemode-dev/formwav.git
cd formwav
./formwav_oc_install     # engine venv, audio core and interface
./formwav                # web UI at http://localhost:3060
```

On Windows use `formwav_oc_install.bat` and `formwav.bat`. Optional keys (`ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `FAL_KEY`) go in `backend/.env`.

> **Status:** in development. The Windows scripts are written but not run on Windows, and the models run against stand-ins here; the reasoning and the gaps are kept in [`backend/HASHOUT_LOG.md`](backend/HASHOUT_LOG.md).

**Contributing:** branch from `main`, keep changes to source here, and leave packaging and releases to formcompiler. See [`CONTRIBUTING.md`](CONTRIBUTING.md), [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) and [`AGENTS.md`](AGENTS.md). Report security issues privately as [`SECURITY.md`](SECURITY.md) describes.

## Repository

| Path | What it is |
|---|---|
| `backend/` | FastAPI engine, routes under `/api`, and the MCP server in `formwav_mcp/` |
| `frontend/` | Vanilla TypeScript and Vite interface |
| `native/` | Rust audio core (`formwav-dsp`) and the studio processors |

---

## Maintainers

| Maintainer | Role |
|---|---|
| [@nodemode-ai](https://github.com/nodemode-ai) | Owner |
| [@gbarnai](https://github.com/gbarnai) | Co-owner |

Code owners are set in [`.github/CODEOWNERS`](.github/CODEOWNERS).

## License

FormWav is licensed under the Apache License 2.0 ([`LICENSE`](LICENSE), SPDX `Apache-2.0`). Copyright 2026 NodeAgentc, Inc. Third-party notices: [`NOTICE`](NOTICE), [`LICENSES.md`](LICENSES.md). Responsible use: [`USE_POLICY.md`](USE_POLICY.md).

<sub>Screenshot content: music stems made for the Form family, CC0.</sub>
