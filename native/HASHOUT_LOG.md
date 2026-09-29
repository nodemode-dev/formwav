# HASHOUT_LOG · native · formwav

Living log of all comment content, explainers, rationale, TODOs and removed code for the Rust side. Source files stay comment-free per dev-rules `sub-skills/hashout-log/SUB-SKILL.md`; everything they would have said lives here. Read this first, then edit code surgically.

Current build version: v0.11.0
Last updated: 2026-09-28 · buses in render.rs: master path unchanged, per-bus scratch, bus gain and pan

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
        ├── wasm.rs              C-ABI exports for the wasm32 build (fw_alloc, fw_load_wav, fw_render, ...)
        └── loudness.rs          BS.1770-4 integrated loudness: K-weighting for any rate, 400 ms blocks, two gates
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
- [formwav-dsp/src/loudness.rs](#src-loudness)

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

---

## v0.7.0 · pan, master peaks, native render

### src/render.rs · pan law
- refers-to: src/render.rs :: `pan_gains`, `PlayClip::pan`
- kind: rationale
- logged: v0.7.0 · 2026-09-28

A balance law with constant-power attenuation of the far side: at pan 0 both gains are exactly 1.0, so every unpanned render stays bit-identical to v0.4.0's; panning right by p leaves the right side at 1.0 and scales the left by cos(p times pi/2), and the mirror for left. Hard left and hard right are pinned to exactly 0.0 on the far side: the first version computed cos(pi/2) in f32, which is -4.4e-8 because pi/2 is not exact, and leaked 2.2e-8 (about -153 dBFS) of a mono source into the silent side; it also relied on two different `cos` implementations (native libm and the wasm port) agreeing at that point. Gains are computed once per clip per block, not per sample. Pan is per track; mono sources feed both sides.

### src/render.rs · master peaks
- refers-to: src/render.rs :: `Player::render`, `Player::take_peaks`
- kind: explainer
- logged: v0.7.0 · 2026-09-28

After mixing a block, the absolute peak of each side of the master sum is kept until `take_peaks` reads and resets it. The engine's render reports them; the interface's output meter is not built yet. Loudness (BS.1770) is not measured yet.

### src/python.rs · render()
- refers-to: src/python.rs :: `render`, `RENDER_BLOCK`
- kind: explainer
- logged: v0.7.0 · 2026-09-28

`render(sources, clips, frames)` takes `(id, wav bytes)` pairs and `(source, start, source_in, length, gain, pan)` tuples, decodes with the same `decode_wav`, runs the same `Player` in 128-frame blocks like the worklet, and returns interleaved little-endian f32 bytes with the master peaks. It is the engine's offline renderer and the reference for Phase 2's exit check.

### Phase 2 exit check · native render against the browser's render
- refers-to: src/render.rs, src/python.rs, src/wasm.rs
- kind: explainer
- logged: v0.7.0 · 2026-09-28

The same session (a stereo WAV at -6 dB panned -0.5 and a mono WAV at -3 dB panned +0.75, 480,000 frames) rendered by the interface's playback path (the AudioWorklet and the wasm32 core, run in an OfflineAudioContext) and by the engine's pyo3 core matched exactly: maximum difference 0.0 on both channels. The stated null threshold is 0.0 for sessions like this one; pan values away from 0 and the endpoints use f32 `cos`, which native and wasm computed identically here but are not guaranteed to, so the general threshold is 1e-7 (about -140 dBFS). The comparison is against the realtime renderer's code run offline, not a capture of audible output, which headless Chromium cannot provide.

---

## v0.8.0 · fades and crossfades

### src/render.rs · fade gains
- refers-to: src/render.rs :: `fade_curve`, `PlayClip::fade_in`, `fade_out`, `fade_shape`, `Player::render`
- kind: rationale
- logged: v0.8.0 · 2026-09-28

Fade lengths are in session samples from the clip's start and end; the fade-out is limited to what the fade-in leaves. At clip sample k the fade-in gain is curve(k / F), so the first sample is 0, and the fade-out gain is curve((length - k) / F), so the last sample is 1 / F. Shapes: 0 linear (x), 1 equal power (sin(x times pi/2)). Outside the fade zones the gain is exactly 1.0 and the multiplication order is unchanged, so unfaded renders stay bit-identical to v0.7.0 (verified). A crossfade is a fade-out on the left clip and a fade-in on the right clip over their overlap: linear sums to 1 at every sample (right for correlated material), equal power keeps the sum of squares at 1 (right for uncorrelated material, and 3 dB loud mid-overlap on identical material).

### src/render.rs · verification v0.8.0
- refers-to: src/render.rs :: fades
- kind: explainer
- logged: v0.8.0 · 2026-09-28

On a 440 Hz sine with two aligned clips overlapping by one second: a linear crossfade reproduced the source within 3.0e-8 and the browser and engine renders were identical (0.0); an equal-power crossfade peaked at 1.414 times the source mid-overlap (sqrt 2 is 1.4142) and was exact outside the overlap; a linear 0.5 s fade-in started at 0 and followed k / F within 2.7e-8. Equal-power fades differ between the native and wasm builds by up to 6.0e-8 (about -144 dBFS), because `sin` in native libm and in the wasm libm port round one ulp apart; that is inside the general threshold of 1e-7 stated in v0.7.0. Linear fades use no transcendental function and stay identical.

---

## v0.9.0 · looping

### src/render.rs · sample-accurate loop
- refers-to: src/render.rs :: `Player::render`, `Player::set_loop`, `Player::mix`
- kind: rationale
- logged: v0.9.0 · 2026-09-28

`render` walks the block in spans: while a loop is set and the position is before its end, a span stops exactly at the end, the position wraps to the loop start, and the next span continues in the same block, so a loop point never waits for a block boundary and a loop shorter than a block wraps as often as it needs. Playback that starts past the loop end is not pulled back. `set_loop(start, end)` with end at or before start clears the loop. The clip mixing moved unchanged into `mix`, which adds a span's clips into a slice; peaks are taken over the whole block afterwards. Offline renders (`python.rs`) do not loop: a mixdown is linear.

### src/wasm.rs · fw_set_loop and verification v0.9.0
- refers-to: src/wasm.rs :: `fw_set_loop`; src/render.rs :: `render`
- kind: explainer
- logged: v0.9.0 · 2026-09-28

Checked in Node against the wasm module, sample by sample against the source: a loop of 1000 to 1300 started at 900 produced 900..1299, then 1000..1299 twice, then 1000..1023 over 1,024 frames with no mismatch and ended at 1024; starting at 2000 with the same loop ran linearly to 3024; a cleared loop ran linearly; a 50-sample loop wrapped twice inside one 128-frame block and ended at 528. Unlooped render and playback regressions were unchanged (0.0).

---

## formwav-dsp/src/loudness.rs {#src-loudness}

### src/loudness.rs · BS.1770-4 integrated loudness
- refers-to: src/loudness.rs :: `k_weighting`, `integrated_loudness`
- kind: rationale
- logged: v0.10.0 · 2026-09-28

Both K-weighting stages (the high shelf and the RLB high-pass) are designed for the actual sample rate from the standard's analog prototypes, the approach libebur128 takes, so 44.1 kHz is measured as correctly as 48 kHz; at 48 kHz they reduce to the coefficient table in BS.1770. Filtering runs in f64. Mean-square power per channel comes from prefix sums over 400 ms blocks every 100 ms; channel weights are 1.0 (stereo; surround weights and LFE exclusion arrive with multichannel buses). Blocks at or below -70 LUFS are dropped (absolute gate), then blocks more than 10 LU below the mean of the rest (relative gate). Returns `None` for silence or anything shorter than one block. `python.rs` exposes it as `loudness(interleaved_f32_bytes, channels, rate)`.

### src/loudness.rs · verification v0.10.0
- refers-to: src/loudness.rs :: `integrated_loudness`
- kind: explainer
- logged: v0.10.0 · 2026-09-28

Against the standards' own references: a 997 Hz sine at 0 dBFS in the left channel read -3.010 LUFS (BS.1770 gives -3.01); EBU Tech 3341 cases read -22.993 (1 kHz at -23 dBFS, 48 kHz), -22.991 (the same at 44.1 kHz), -32.993 (-33 dBFS) and -23.014 (the -36, -23, -36 dBFS gating sequence), all inside the stated ±0.1 LU; silence and a 300 ms tone gave no reading. Against pyloudnorm (installed only for the check): formwav read 0.041 to 0.045 LU higher on every signal, white noise included. A constant offset points to a difference in filter design, not in gating or blocking, and the -3.01 reference is met exactly here and missed by 0.042 there, so the evidence favours these filters; the agreement is recorded as within 0.045 LU, not identical.

---

## v0.11.0 · buses

### src/render.rs · bus stage
- refers-to: src/render.rs :: `Bus`, `PlayClip::bus`, `Player::mix_buses`, `Player::mix`
- kind: rationale
- logged: v0.11.0 · 2026-09-28

A clip carries the bus it feeds, 0 meaning master. Each span mixes master clips straight into the output exactly as before, then `mix_buses` sums each bus's clips into a scratch pair and adds it to the output scaled by the bus gain and the bus pan law (the same balance law as tracks). With no buses `mix_buses` returns at once, so master-only sessions are bit-identical to v0.10.0 (verified). The scratch pair lives on the player and only grows, so the audio thread does not allocate per block once warm. A clip naming a bus the player does not have is silent; both planners only emit known buses. Buses are the node that effects attach to in Phase 4; today they only gain and pan. `fw_clear_buses` and `fw_add_bus` in wasm.rs and a `buses` argument to `render` in python.rs carry them.

### src/render.rs · verification v0.11.0
- refers-to: src/render.rs :: buses
- kind: explainer
- logged: v0.11.0 · 2026-09-28

With one track on a bus at -6 dB panned 0.5 and one on master: browser and engine renders identical (0.0); the bus track soloed matched source times bus gain times cos(pi/4) within 4.3e-8; two tracks on one bus matched the sum of their solo renders within 3.7e-8 (the bus sums before its gain, a different rounding order); a muted bus equalled a muted track exactly; removing the bus returned its track to master bit-identical to a session that never had one.
