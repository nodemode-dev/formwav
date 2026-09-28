# HASHOUT_LOG · native · formwav

Living log of all comment content, explainers, rationale, TODOs and removed code for the Rust side. Source files stay comment-free per dev-rules `sub-skills/hashout-log/SUB-SKILL.md`; everything they would have said lives here. Read this first, then edit code surgically.

Current build version: v0.2.0
Last updated: 2026-09-28 · WAV decoding, peak pyramid, Python binding

---

## Org-navi-map

```
native/
└── formwav-dsp/
    ├── Cargo.toml               crate manifest, version site; rlib and cdylib; optional pyo3 behind the python feature
    ├── Cargo.lock               lockfile, version site
    ├── pyproject.toml           maturin build of the Python module formwav_dsp, python feature on
    └── src/
        ├── lib.rs               public surface and CRATE_VERSION
        ├── graph.rs             node and port model, connection rules, processing order
        ├── wav.rs               RIFF WAVE probe and decode to planar f32
        ├── peaks.rs             min and max peak pyramid for waveform drawing
        ├── python.rs            pyo3 module: probe() and peaks() (python feature only)
        ├── render.rs            Player: sources, clips, position, render to a stereo pair
        └── wasm.rs              C-ABI exports for the wasm32 build (fw_alloc, fw_load_wav, fw_render, ...)
```

---

## Table of contents

- [formwav-dsp/Cargo.toml](#cargo-toml)
- [formwav-dsp/pyproject.toml](#pyproject)
- [formwav-dsp/src/lib.rs](#src-lib)
- [formwav-dsp/src/graph.rs](#src-graph)
- [formwav-dsp/src/wav.rs](#src-wav)
- [formwav-dsp/src/peaks.rs](#src-peaks)
- [formwav-dsp/src/python.rs](#src-python)
- [formwav-dsp/src/render.rs](#src-render)
- [formwav-dsp/src/wasm.rs](#src-wasm)

---

## formwav-dsp/Cargo.toml {#cargo-toml}

### Cargo.toml · crate type and targets
- refers-to: Cargo.toml :: `[lib]`
- kind: todo
- logged: v0.1.0 · 2026-09-28

`rlib` only in v0.1.0. Phase 2 adds the three builds from `DEV_PLAN.md`: a `cdylib` with a pyo3 feature for the engine's offline render, the native build linked into the Tauri shell for realtime I/O, and a wasm32 build for the AudioWorklet. Every dependency added then is cleared against the licensing policy first; none is used now.

---

## formwav-dsp/src/lib.rs {#src-lib}

### src/lib.rs · CRATE_VERSION
- refers-to: src/lib.rs :: `CRATE_VERSION`
- kind: explainer
- logged: v0.1.0 · 2026-09-28

Read from Cargo at compile time, so the crate version is stated once in Cargo.toml and bumped with the other version sites.

---

## formwav-dsp/src/graph.rs {#src-graph}

### src/graph.rs · PortKind
- refers-to: src/graph.rs :: `PortKind`
- kind: rationale
- logged: v0.1.0 · 2026-09-28

Two kinds from the first build, per the v0.0.1 plan decision: `Audio { channels }` with any channel count from 1 to 65,535 (mono, stereo, 5.1, 7.1.4, ambisonic orders all fit), and `Event` for note and control data. MIDI tracks, instruments, surround buses and ambisonic buses then arrive as new nodes, not as a reshaped graph. A zero-channel audio port is refused when the node is added.

### src/graph.rs · connect rules
- refers-to: src/graph.rs :: `Graph::connect`
- kind: rationale
- logged: v0.1.0 · 2026-09-28

A connection is accepted only when both ports exist, the kinds are identical (a stereo output never feeds a 5.1 input directly; up-mix and down-mix are explicit nodes so the conversion is visible and automatable), the edge is new, and it would not close a cycle. Fan-in and fan-out are allowed: several sources into one audio input are summed, several event sources are merged, by the processing code that lands in Phase 2. The cycle check walks forward from the target to see whether it reaches the source.

### src/graph.rs · order
- refers-to: src/graph.rs :: `Graph::order`
- kind: explainer
- logged: v0.1.0 · 2026-09-28

Kahn's algorithm over node indegrees gives the processing order, sources first. Feedback paths (a delay feeding back) will need an explicit one-block delay node rather than a cycle in this graph.

### src/graph.rs · verification v0.1.0
- refers-to: src/graph.rs :: whole module
- kind: explainer
- logged: v0.1.0 · 2026-09-28

`cargo check` passes on Rust 1.98.1. A scratch crate outside the repo exercised the rules once: event to instrument, instrument to bus and bus to master accepted; stereo into 5.1, event into audio, a duplicate edge, a cycle, a zero-channel port and a missing port refused with the matching error; `order()` returned a valid topological order. Clippy was not run: the minimal toolchain lacks the component.

### Cargo.toml · v0.2.0 crate types and the python feature
- refers-to: Cargo.toml :: `[lib]`, `[features]`, `[dependencies]`
- kind: rationale
- logged: v0.2.0 · 2026-09-28

The crate now builds as `rlib` and `cdylib`. The `python` feature pulls in pyo3 0.29.2 (abi3 for Python 3.10 and newer, so one wheel serves every later Python) and compiles `src/python.rs`; without the feature the crate has no dependencies. Every crate the feature resolves was checked with `cargo metadata` before adding: MIT or Apache-2.0 throughout, plus target-lexicon (Apache-2.0 with LLVM exception) and unicode-ident (adds Unicode-3.0), both build-time. The wasm32 build and the native Tauri build still arrive later in Phase 2.

---

## formwav-dsp/pyproject.toml {#pyproject}

### pyproject.toml · maturin build
- refers-to: pyproject.toml :: `[tool.maturin]`
- kind: explainer
- logged: v0.2.0 · 2026-09-28

`backend/oc_install` runs `maturin develop --release -m ../native/formwav-dsp/Cargo.toml` inside the engine's venv; this file turns the `python` feature on and names the module `formwav_dsp`. The version is dynamic, read from Cargo.toml, so it is not a separate version site.

---

## formwav-dsp/src/wav.rs {#src-wav}

### src/wav.rs · what it reads
- refers-to: src/wav.rs :: `layout`, `decode_wav`, `to_f32`
- kind: explainer
- logged: v0.2.0 · 2026-09-28

RIFF WAVE with a `fmt ` and a `data` chunk: PCM 8 (unsigned), 16, 24 and 32 bit, IEEE float 32 and 64 bit, and the extensible header (format tag read from the sub-format GUID). Output is planar f32, one vector per channel, PCM scaled by 2 to the power of (bits minus 1). Chunks are walked with even-byte padding; unknown chunks are skipped.

### src/wav.rs · streaming writers
- refers-to: src/wav.rs :: `layout`, the `data` branch
- kind: warning-context
- logged: v0.2.0 · 2026-09-28

Recorders that stream to disk often leave the data size at 0 or at 0xFFFFFFFF. A size of 0, or one larger than the bytes present, is read as "to the end of the file", then rounded down to whole frames. Verified v0.2.0 with a size-0 file: all 4,800 frames recovered.

### src/wav.rs · not yet
- refers-to: src/wav.rs :: module
- kind: todo
- logged: v0.2.0 · 2026-09-28

RF64 and BW64 (WAV files over 4 GB), and every other container, arrive with the LGPL ffmpeg sidecar import in Phase 7. Rejected encodings name their format tag and bit depth in the error so the engine can say why.

---

## formwav-dsp/src/peaks.rs {#src-peaks}

### src/peaks.rs · layout of a level
- refers-to: src/peaks.rs :: `PeakLevel`, `peak_pyramid`
- kind: explainer
- logged: v0.2.0 · 2026-09-28

Level 0 takes the min and max of every `base` samples (256 by default); each next level folds `factor` blocks of the previous one (4 by default) until a level has `min_blocks` or fewer (64 by default). A level's `data` is per block, then per channel, a min then a max. Higher levels are built from the level below, never from the samples, so a whole pyramid costs little more than level 0.

---

## formwav-dsp/src/python.rs {#src-python}

### src/python.rs · module surface
- refers-to: src/python.rs :: `probe`, `peaks`, `formwav_dsp`
- kind: explainer
- logged: v0.2.0 · 2026-09-28

`probe(bytes)` returns `(sample_rate, channels, frames, format_name)`; `peaks(bytes, base=256, factor=4, min_blocks=64)` returns one `(samples_per_peak, channels, blocks, payload)` tuple per level, where `payload` is little-endian f32 in the level layout above. Decode errors raise `ValueError` with the decoder's message. `__version__` is the crate version. The engine does not yet release the GIL around decoding; that comes with the jobs surface.

---

## formwav-dsp/src/render.rs {#src-render}

### src/render.rs · Player
- refers-to: src/render.rs :: `Player::render`
- kind: explainer
- logged: v0.4.0 · 2026-09-28

Holds decoded sources by small integer id and a flat list of clips (source, start, source_in, length, linear gain). `render` zeroes a stereo pair, adds every clip overlapping the block from its source (mono sources to both sides, channels past two ignored for now), and advances the position. Positions are samples at the session rate; a source at another rate would play at the wrong speed, so the interface leaves such clips out until resampling lands. The graph in graph.rs does not drive playback yet: this flat mixer is the first renderer and becomes graph nodes when buses and effects arrive.

---

## formwav-dsp/src/wasm.rs {#src-wasm}

### src/wasm.rs · export surface
- refers-to: src/wasm.rs :: all `fw_*` functions
- kind: rationale
- logged: v0.4.0 · 2026-09-28

A plain C ABI, compiled only for `wasm32`, so the module has no imports and needs no generated JavaScript (33,115 bytes in v0.4.0). JavaScript owns memory through `fw_alloc` and `fw_free`; the player is a boxed pointer from `fw_player_new`. Sample positions cross as f64 because JavaScript numbers cannot carry u64 without BigInt. The same `decode_wav` the engine uses decodes files inside the browser.

### src/wasm.rs · verification v0.4.0
- refers-to: src/wasm.rs :: module
- kind: explainer
- logged: v0.4.0 · 2026-09-28

Built with `cargo build --release --locked --target wasm32-unknown-unknown --lib`; Node listed exactly the ten `fw_*` exports plus `memory` and no imports. In Chromium, an offline render of a 3 s stereo 16-bit WAV through the AudioWorklet and this module matched the source samples exactly (maximum difference 0.0 on both channels) and, at -6 dB track gain, within 3.7e-8.
