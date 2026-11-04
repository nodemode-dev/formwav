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
  <img alt="version 2.21.11" src="https://img.shields.io/badge/version-2.21.11-eef0f4?style=flat-square">
  <img alt="TypeScript and Vite" src="https://img.shields.io/badge/TypeScript-Vite-3178c6?style=flat-square&logo=typescript&logoColor=white">
  <img alt="Python and FastAPI" src="https://img.shields.io/badge/Python-FastAPI-009688?style=flat-square">
  <img alt="Rust audio core" src="https://img.shields.io/badge/Rust-audio%20core-b7410e?style=flat-square">
  <img alt="macOS, Windows, Linux" src="https://img.shields.io/badge/macOS%20%C2%B7%20Windows%20%C2%B7%20Linux-native-2f7bf5?style=flat-square">
  <img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-3a3a3a?style=flat-square">
  <img alt="Status: in development" src="https://img.shields.io/badge/status-in%20development-d69e2e?style=flat-square">
</p>

<p align="center">
  <a href="https://formwav.formai.studio/"><b>Download FormWav on formai.studio</b></a> ·
  <a href="#run-it-from-source">Run it from source</a> ·
  <a href="#the-form-family">All Form apps</a>
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
  <a href="#run-it-from-source">Run from source</a> ·
  <a href="#the-form-family">Form family</a>
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

## Under the hood

- **One mixer:** the Rust core (`native/formwav-dsp`) runs as WebAssembly in the browser and as a Python module in the engine.
- **Local first:** the interface and the engine bind 127.0.0.1; nothing listens on the network unless you turn it on.
- **26 languages:** English by default, with 25 more interface languages.

## Download

**Get the app:** download FormWav from [formai.studio](https://formwav.formai.studio/). That is the easiest way to install it.

**Releases:** [`nodemode-dev/formcompiler`](https://github.com/nodemode-dev/formcompiler/releases?q=formwav-v&expanded=true) (no FormWav release yet).

**Keep it updated:** [FormPortal](https://github.com/nodemode-dev/formportal) installs, updates and rolls back every Form app from the same signed catalogue.

| Platform | Target |
|---|---|
| macOS | Apple silicon |
| Linux and Windows | x64 (Linux also arm64) |

Not released yet. Run it from source below. All FormWav builds are compiled and released from FormCompiler, not from this repo. This repo holds the source.

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

**Contributing:** branch from `main`, keep changes to source here, and leave packaging and releases to formcompiler. See [`AGENTS.md`](AGENTS.md).

## Repository

| Path | What it is |
|---|---|
| `backend/` | FastAPI engine, routes under `/api`, and the MCP server in `formwav_mcp/` |
| `frontend/` | Vanilla TypeScript and Vite interface |
| `native/` | Rust audio core (`formwav-dsp`) and the studio processors |

## The Form family

FormWav is one of the **Form apps**: native creative tools that install, update and roll back through FormPortal and can all be driven by agents.

| | App | What it's for | Download | Code |
|:-:|---|---|---|---|
| <img src=".github/assets/family/form.md.png" alt="" width="32" height="32"> | **form.md** | Documents, databases and realtime editing together | [formai.studio](https://formmd.formai.studio/) | [GitHub](https://github.com/nodemode-dev/form.md) |
| <img src=".github/assets/family/format.png" alt="" width="32" height="32"> | **FormAT** | Chat and agent workspace on your key | [formai.studio](https://format.formai.studio/) | [GitHub](https://github.com/nodemode-dev/format) |
| <img src=".github/assets/family/formCAD.png" alt="" width="32" height="32"> | **FormCAD** | Drafting, parametric parts and NURBS surfaces | | [GitHub](https://github.com/nodemode-dev/formCAD) |
| <img src=".github/assets/family/formcel.png" alt="" width="32" height="32"> | **FormCel** | Spreadsheets agents can read and edit | [formai.studio](https://formcel.formai.studio/) | [GitHub](https://github.com/nodemode-dev/formcel) |
| <img src=".github/assets/family/formcraft.png" alt="" width="32" height="32"> | **FormCraft** | Generate images, video, audio, 3D and worlds | | [GitHub](https://github.com/nodemode-dev/formcraft) |
| <img src=".github/assets/family/formcut.png" alt="" width="32" height="32"> | **FormCut** | Multi-track video editing with no upload | [formai.studio](https://formcut.formai.studio/) | [GitHub](https://github.com/nodemode-dev/formcut) |
| <img src=".github/assets/family/formDAM.png" alt="" width="32" height="32"> | **FormDAM** | Photo library and asset manager | [formai.studio](https://formdam.formai.studio/) | [GitHub](https://github.com/nodemode-dev/formDAM) |
| <img src=".github/assets/family/formdeck.png" alt="" width="32" height="32"> | **FormDeck** | Presentations and pitch decks | [formai.studio](https://formdeck.formai.studio/) | [GitHub](https://github.com/nodemode-dev/formdeck) |
| <img src=".github/assets/family/formdesign.png" alt="" width="32" height="32"> | **FormDesign** | Page layout for print and the web | [formai.studio](https://formdesign.formai.studio/) | [GitHub](https://github.com/nodemode-dev/formdesign) |
| <img src=".github/assets/family/formencoder.png" alt="" width="32" height="32"> | **FormEncoder** | Media encoding queue with presets | [formai.studio](https://formencoder.formai.studio/) | [GitHub](https://github.com/nodemode-dev/formencoder) |
| <img src=".github/assets/family/formfabric.png" alt="" width="32" height="32"> | **FormFabric** | Sewing patterns draped with cloth simulation | | [GitHub](https://github.com/nodemode-dev/formfabric) |
| <img src=".github/assets/family/formlit.png" alt="" width="32" height="32"> | **FormLit** | Photo library and raw development | [formai.studio](https://formlit.formai.studio/) | [GitHub](https://github.com/nodemode-dev/formlit) |
| <img src=".github/assets/family/formmorpheus.png" alt="" width="32" height="32"> | **FormMorpheus** | Frame-by-frame and performed animation | | [GitHub](https://github.com/nodemode-dev/formmorpheus) |
| <img src=".github/assets/family/formNET.png" alt="" width="32" height="32"> | **FormNET** | See what your computer sends online | | [GitHub](https://github.com/nodemode-dev/formNET) |
| <img src=".github/assets/family/formpath.png" alt="" width="32" height="32"> | **FormPath** | Vector illustration with artboards and type | [formai.studio](https://formpath.formai.studio/) | [GitHub](https://github.com/nodemode-dev/formpath) |
| <img src=".github/assets/family/formpdf.png" alt="" width="32" height="32"> | **FormPDF** | Edit, redact, sign and fill PDFs | [formai.studio](https://formpdf.formai.studio/) | [GitHub](https://github.com/nodemode-dev/formpdf) |
| <img src=".github/assets/family/formpromo.png" alt="" width="32" height="32"> | **FormPromo** | Promo films from your own media | [formai.studio](https://formpromo.formai.studio/) | [GitHub](https://github.com/nodemode-dev/formpromo) |
| <img src=".github/assets/family/formref.png" alt="" width="32" height="32"> | **FormRef** | Reference boards for creative work | [formai.studio](https://formref.formai.studio/) | [GitHub](https://github.com/nodemode-dev/formref) |
| <img src=".github/assets/family/formrig.png" alt="" width="32" height="32"> | **FormRig** | Rig, skin and retarget any mesh | | [GitHub](https://github.com/nodemode-dev/formrig) |
| <img src=".github/assets/family/formsculpt.png" alt="" width="32" height="32"> | **FormSculpt** | 3D sculpting, remeshing and painting | [formai.studio](https://formsculpt.formai.studio/) | [GitHub](https://github.com/nodemode-dev/formsculpt) |
| <img src=".github/assets/family/formsurface.png" alt="" width="32" height="32"> | **FormSurface** | Texture painting with PBR export | [formai.studio](https://formsurface.formai.studio/) | [GitHub](https://github.com/nodemode-dev/formsurface) |
| <img src=".github/assets/family/formtools.png" alt="" width="32" height="32"> | **FormTools** | Viewers, batch tools and file utilities | | [GitHub](https://github.com/nodemode-dev/formtools) |
| <img src=".github/assets/family/formtxt.png" alt="" width="32" height="32"> | **FormTxt** | Word processing with .docx round trips | [formai.studio](https://formtxt.formai.studio/) | [GitHub](https://github.com/nodemode-dev/formtxt) |
| <img src=".github/assets/family/formvfx.png" alt="" width="32" height="32"> | **FormVFX** | Motion graphics and VFX compositing | [formai.studio](https://formvfx.formai.studio/) | [GitHub](https://github.com/nodemode-dev/formvfx) |
| <img src=".github/assets/family/formvis.png" alt="" width="32" height="32"> | **FormVis** | Layered image editing with local AI | [formai.studio](https://formvis.formai.studio/) | [GitHub](https://github.com/nodemode-dev/formvis) |
| <img src=".github/assets/family/formwav.png" alt="" width="32" height="32"> | **FormWav** | Multitrack audio editing and mixing | [formai.studio](https://formwav.formai.studio/) | [GitHub](https://github.com/nodemode-dev/formwav) |
| <img src=".github/assets/family/formweb.png" alt="" width="32" height="32"> | **FormWeb** | Visual website building with a CMS | [formai.studio](https://formweb.formai.studio/) | [GitHub](https://github.com/nodemode-dev/formweb) |
| <img src=".github/assets/family/formportal.png" alt="" width="32" height="32"> | **FormPortal** | Install, update and roll back Form apps | [formai.studio](https://formportal.formai.studio/) | [GitHub](https://github.com/nodemode-dev/formportal) |
| <img src=".github/assets/family/formtray.png" alt="" width="32" height="32"> | **FormTray** | One dock icon for every app | [formai.studio](https://formtray.formai.studio/) | [GitHub](https://github.com/nodemode-dev/formtray) |
| <img src=".github/assets/family/formMCP.png" alt="" width="32" height="32"> | **FormMCP** | One MCP connection to the family | [formai.studio](https://formmcp.formai.studio/) | [GitHub](https://github.com/nodemode-dev/formMCP) |
| <img src=".github/assets/family/formskills.png" alt="" width="32" height="32"> | **FormSkills** | Every app's agent skills in one place | [formai.studio](https://formskill.formai.studio/) | [GitHub](https://github.com/nodemode-dev/formskills) |
| <img src=".github/assets/family/formbench.png" alt="" width="32" height="32"> | **FormBench** | Parity, testing and rankings for the family | [formai.studio](https://formranker.formai.studio/) | [GitHub](https://github.com/nodemode-dev/formbench) |
| <img src=".github/assets/family/formslot.png" alt="" width="32" height="32"> | **FormSlot** | Codebase memory for coding agents | | [GitHub](https://github.com/nodemode-dev/formslot) |
| <img src=".github/assets/family/subform.png" alt="" width="32" height="32"> | **SubForm** | Workbench for parallel Claude Code agents | | [GitHub](https://github.com/nodemode-dev/subform) |
| <img src=".github/assets/family/formcompiler.png" alt="" width="32" height="32"> | **FormCompiler** | Builds, signs and releases every app | [formai.studio](https://formcompiler.formai.studio/) | [GitHub](https://github.com/nodemode-dev/formcompiler) |
| <img src=".github/assets/family/formpipe.png" alt="" width="32" height="32"> | **FormPipe** | Release pipeline and update feeds | | [GitHub](https://github.com/nodemode-dev/formpipe) |

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
