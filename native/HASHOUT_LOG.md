# HASHOUT_LOG · native · formwav

Living log of all comment content, explainers, rationale, TODOs and removed code for the Rust side. Source files stay comment-free per dev-rules `sub-skills/hashout-log/SUB-SKILL.md`; everything they would have said lives here. Read this first, then edit code surgically.

Current build version: v2.12.4
Last updated: 2026-09-30 · no Rust change since v0.64.0's transient detection (the last entry below); the header had read v0.35.0

---

## Org-navi-map

```
native/
└── formwav-dsp/
    ├── Cargo.toml               crate manifest, version site; rlib and cdylib; optional pyo3 behind the python feature
    ├── Cargo.lock               lockfile, version site
    ├── pyproject.toml           maturin build of the Python module formwav_dsp, python feature on
    ├── src/
    │   ├── lib.rs               public surface and CRATE_VERSION
    │   ├── graph.rs             node and port model, connection rules, processing order
    │   ├── wav.rs               RIFF WAVE probe and decode to planar f32
    │   ├── peaks.rs             min and max peak pyramid for waveform drawing
    │   ├── python.rs            pyo3 module: probe() and peaks() (python feature only)
    │   ├── render.rs            Player: sources, clips, position, render to a stereo pair
    │   ├── wasm.rs              C-ABI exports for the wasm32 build (fw_alloc, fw_load_wav, fw_render, ...)
    │   └── loudness.rs          BS.1770-4 integrated loudness: K-weighting for any rate, 400 ms blocks, two gates
    └── tests/
        └── stages.rs            the 19 live effect kinds held to the interface's catalogue (cargo test)
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
- [formwav-dsp/tests/stages.rs](#tests-stages)

---

## formwav-dsp/Cargo.toml {#cargo-toml}

### De-reverb in the live rack, and an FFT in the core
- refers-to: native/formwav-dsp/src/fx.rs (Fft; DeReverb, kind 19; tests); backend/app/services/render.py; frontend/src/engine/document.ts, src/audio/player.ts, src/ui/lanes.ts, src/ui/inspector-pane.ts, src/ui/editor-tabs.ts, src/ui/browser-effects.ts; sidecar verification/verify_dereverb.py
- kind: explainer
- logged: v2.11.5 (in progress) · 2026-10-06

The rest of L6. The core had no FFT, so it gained one (iterative radix-2, in place) and a short-time stage on it: late reverberation suppression (Lebart et al. 2001, Habets 2007). Reverb decays at a known rate for a reverb time, so the late reverberation in a band is predicted from the band's power 50 ms before, decayed by that much; a spectral gain takes it out, floored at the reduction allowed, smoothed over time, one gain for both channels; 1024-point frames 256 apart with square-root Hann windows, 1023 samples behind, reported as latency. Rust tests: the FFT against a direct transform; at no reduction the input back delayed within 1e-4 (the first run failed by 1.08, a frame written N places along its ring, found and fixed); bursts in a 1 s room, the tail over 6 dB down and the bursts within 2 dB. Through the export renderer on the JFK speech in a synthetic room (T60 0.8 s, direct and reverberant energy equal), swept: at most 6 dB was the one setting that improved every reading (the tail in the pauses from -23.4 to -25.6 dB against the speech, SI-SDR from -1.7 to -0.5 dB, DNSMOS overall 2.24 to 2.28, background 2.85 to 3.02, speech 2.94 to 2.92), and is the default; at 12 dB the tail went to -26.5 dB but speech quality fell (overall 2.19), as spectral subtraction trades. Wired as de-hum and de-click were; a default edit's guard caught Denoise's export default sharing the line's text and left it alone. In Chromium: 19 effects, De-reverb in all four add lists, a session played with it, no layout shift, no page error.

### Restoration in the live rack: de-hum and de-click while playing
- refers-to: native/formwav-dsp/src/fx.rs (DeHum, kind 17; DeClick, kind 18; tests); backend/app/services/render.py; frontend/src/engine/document.ts, src/audio/player.ts, src/ui/lanes.ts, src/ui/inspector-pane.ts, src/ui/editor-tabs.ts, src/ui/browser-effects.ts; sidecar verification/verify_live_restoration.py
- kind: explainer
- logged: v2.11.3 (in progress) · 2026-10-06

The comparison's L6: repair only offline. Two stages join the core, so they run live in the browser's rack and in export alike. De-hum: notches (RBJ, f64 state) at the hum's frequency and its harmonics, no latency. De-click: a click is a second-difference residual far above its running level (threshold times it, above -80 dBFS, after a 20 ms warm-up); a run longer than a click is an onset and is left alone; a click is replaced by cubic Hermite interpolation from the samples either side, which the stage sees by running 3.5 ms behind, reported as latency and compensated as Voice's is. The first tests caught two faults: de-hum's measurement inside the notch's 0.16 s settling (the test now measures after it), and de-click repairing onsets from silence and over-long runs (now a warm-up, and long runs abandoned). Rust tests: harmonics of 60 Hz over 40 dB down, 1 kHz within 0.5 dB; clean audio through de-click bit-exact, ten clicks repaired within 0.05. Through the export renderer on the JFK speech: the hum alone, each of eight harmonics down 122 to 197 dB; the speech alone, -0.23 dB in level and 0.033 dB on average in its spectrum away from the notches; 40 clicks, the worst error at a click 0.60 before and 0.006 after; clean speech through de-click, 46 samples of 527,828 changed (transients taken for clicks). Wired through the document, the player's two maps, automation (none for these), the export table, the inspector's lists and cards and the effects browser's Repair group; TypeScript caught three places treating any unnamed kind as a filter. De-reverb live is not built: it needs a spectral stage with its own latency, the next of L6.

### Native capture: every channel of an interface, through the engine
- refers-to: native/formwav-dsp/src/native.rs (NativeInput, input_devices, build_input); src/python.rs (NativeInput, native_input_devices); backend/app/routers/native_audio.py (/api/audio/inputs, /record/start, /record/levels, /record/stop); sidecar verification/native_capture
- kind: explainer
- logged: v2.10.8 (in progress) · 2026-10-06

The comparison's Multitrack recording row, past two inputs. A browser takes at most two channels of one interface (measured, and sourced, at the previous entry in the interface's log), so capture of more goes through the engine: NativeInput opens an interface through cpal on its own thread, as the native output does, with the most channels it offers at the rate or the count asked (as an I/O set-up names an interface's width), a 1024-frame buffer within the device's range (a device's default can reach for the top of a very wide range), and float or integer samples converted to float. Its callback takes the lock rather than trying it, unlike the output's: a missed render is silence, a missed capture would be a hole in the take. The engine drains the take every quarter second into a file per track holding that track's channels, so a long take with many channels never sits whole in memory, and on stop each becomes a float WAV in the media store with the take's start on the engine's clock. Checked against a virtual eight-channel ALSA interface fed through a pipe at real-time pace with a tone per channel and a click on every channel each half second: the interface listed, opened at eight channels, levels of 0.2 on every channel mid-take (the tones' level), eight takes of one channel each at the same length, each its own channel's tone, and the clicks on identical frames in all eight. Not yet measured: that virtual interface is not clocked (ALSA's null plugin under it runs about 2.1 times real time and pads silence), so level and frequency fidelity in real time wait for a clocked interface; the harness is kept in the sidecar. The recorder choosing native capture for such an interface, and placing its takes, comes next.

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

### src/wasm.rs · fw_take_peaks
- refers-to: src/wasm.rs :: `fw_take_peaks`; src/render.rs :: `Player::take_peaks`
- kind: explainer
- logged: v0.17.0 · 2026-09-28

Writes the master-bus peaks since the last call into a two-float buffer the caller owns, then resets them, so each worklet report carries the loudest sample of its own interval. Verified in Node: after one 128-frame block at 0 and at 72,000 the peaks equalled the source block's absolute maxima exactly (0.000336 and 0.399963, then 0.400238 and 0.399963), and a second call without rendering returned 0 and 0.

### src/render.rs · four fade shapes
- refers-to: src/render.rs :: `fade_curve`, `FADE_S_CURVE`, `FADE_EXPONENTIAL`
- kind: explainer
- logged: v0.21.0 · 2026-09-28

`fade_curve` now matches on four codes: 0 linear, 1 equal-power (sine), 2 S-curve (raised cosine, 0.5 - 0.5 cos(pi x)), 3 exponential (x squared); unknown codes stay linear, so older sessions and callers are unchanged. The shape still travels as a `u8` through both bindings, so `wasm.rs` and `python.rs` needed no change. Verified in Node on the wasm32 build: a 24,000-sample fade-in rendered within float32 precision of the source times each formula (linear 2.7e-8, equal-power 5.2e-8, S-curve 8.3e-8, exponential 5.7e-8).

### src/render.rs, src/wasm.rs, src/python.rs · per-track peak metering
- refers-to: src/render.rs :: `PlayClip.track`, `Player::mix`, `Player::meter_tracks`, `Player::take_track_peaks`; src/wasm.rs :: `fw_add_clip`, `fw_take_track_peaks`; src/python.rs :: `render`
- kind: rationale
- logged: v0.22.0 · 2026-09-28

A track's level is the peak of the sum of its clips, which can exceed any single clip's peak where clips overlap, so each track's clips are summed into a meter scratch and measured there (after track gain and pan, before any bus). The pass runs after each rendered segment and never writes to the output; `mix` now takes a clip filter instead of a bus id, doing the same arithmetic in the same order, so the audio is unchanged. The cost is mixing each metered clip twice; tracks become real summing nodes in the Phase 8 graph work, which will remove it. Clips carry a 1-based track number (0 is not metered; engine renders pass 0). Verified in Node on the wasm32 build over 1,125 blocks: output rendered with and without track numbers was bit-identical (0); each track's peaks equalled the peaks of that track rendered alone (0), including an equal-power crossfade overlap on one track; peaks reset after each read.

### src/loudness.rs, src/render.rs, src/wasm.rs · live loudness
- refers-to: src/loudness.rs :: `gated_loudness`, `LiveLoudness`; src/render.rs :: `Player::reset_loudness`, `Player::loudness`, `render`; src/wasm.rs :: `fw_loudness_reset`, `fw_loudness`
- kind: rationale
- logged: v0.27.0 · 2026-09-28

`LiveLoudness` streams the master output through the same K-weighting as `integrated_loudness`, sums energy per 100 ms step, and forms 400 ms blocks on the same boundaries; momentary is the last 4 steps, short-term the last 30 (each only once that much has been measured), and integrated gates all blocks since the last reset. The gating tail of `integrated_loudness` moved into `gated_loudness`, with the same arithmetic in the same order, so the offline and live meters share it. The player feeds its finished output to the meter after the peak scan and never writes to it. Verified in Node on the wasm32 build: stereo 1 kHz sines at -23 and -33 dBFS read -22.993 and -32.993 for M, S and I (EBU Tech 3341's tolerance is 0.1 LU); 10 s of tone then 10 s of silence held I at -23.059 while M and S fell to -inf; metered output bit-identical to unmetered; over the whole 3 s stereo test file the live integrated value was -8.2363 against the engine's offline -8.24.

### src/render.rs, src/wasm.rs, src/python.rs · automation envelopes
- refers-to: src/render.rs :: `Envelope`, `Envelope::value_at`, `PlayClip::gain_env`, `PlayClip::pan_env`, `Player::add_envelope`, `Player::clear_envelopes`, `mix`; src/wasm.rs :: `fw_add_clip`, `fw_add_envelope`, `fw_clear_envelopes`; src/python.rs :: `render`, `RenderClip`
- kind: rationale
- logged: v0.31.0 · 2026-09-28

The player holds an envelope table; a clip may reference a volume envelope (linear gain on top of its own gain) and a pan envelope (replacing its pan), each evaluated per sample by linear interpolation between points, the first and last values held. Volume points arrive in dB as f64 on both paths (wasm and pyo3) and are converted to linear gain once, in Rust, on load, so the browser and the engine compute identical gains. Clips without envelopes keep the exact previous arithmetic. Verified in Node on the wasm32 build: a 0 to -20 dB ramp over 48,000 samples equalled f32 linear interpolation of the gains exactly (0), and the hold after the last point exactly; browser and engine renders with volume automation were identical (0.0 over 480,000 frames), and with pan automation too within 3e-8 (sine and cosine in the two math libraries).

### src/render.rs, src/wasm.rs, src/python.rs · master fader
- refers-to: src/render.rs :: `Player::master_gain`, `Player::set_master_db`, `render`; src/wasm.rs :: `fw_set_master_db`; src/python.rs :: `render` (`master_db`)
- kind: rationale
- logged: v0.34.0 · 2026-09-28

The master fader scales the finished mix after the buses and before the peak scan and live loudness, so those meters report what is heard. The dB value is converted once, in Rust, on both the wasm and pyo3 paths; 0 dB clears the stage entirely rather than multiplying by one, so every session at 0 dB renders exactly as before. Verified in Node on the wasm32 build over 288,000 samples: at 0 dB the output was bit-identical to a player never given a master level, and at -6 dB every sample equalled the unity output times f32(10^(-6/20)) exactly.

### src/render.rs, src/wasm.rs · bus metering
- refers-to: src/render.rs :: `Player::bus_peaks`, `mix_buses`, `Player::take_bus_peaks`; src/wasm.rs :: `fw_take_bus_peaks`
- kind: rationale
- logged: v0.35.0 · 2026-09-28

Each bus is measured as it is added to the mix, after its gain and pan: the contribution is bound to a local, added, and its magnitude kept as that bus's peak, the same multiply and add as before, so the audio cannot change. Peaks are kept in the order buses were added (the player's plan order, which leaves muted buses out) and reset when taken. Verified in Node on the wasm32 build: a two-bus session rendered bit-identically on this core and on the v0.34.0 core, and over 750 blocks bus 1's reported peak equalled the output peak of a player holding only bus 1's clip exactly.

### src/fx.rs, src/render.rs, src/wasm.rs, src/python.rs · realtime track filters (coverage wave 8)
- refers-to: src/fx.rs :: `Biquad`; src/render.rs :: `Player::rate`, `clip_fx`, `meter_fx`, `set_rate`, `add_clip_fx`, `reset_fx`, `mix`, `mix_buses`, `meter_tracks`; src/wasm.rs :: `fw_set_rate`, `fw_add_clip_fx`; src/python.rs :: `render` (`rate`, `fx`)
- kind: warning-context
- logged: v0.61.0 (in progress) · 2026-09-30

The first realtime track effects (Audacity's realtime stacks, as a reference): RBJ Audio EQ Cookbook biquads (high-pass, low-pass, peak, low and high shelf), designed in f64 at the player's rate and run in f32, transposed direct form II, per channel. A track's chain runs on each of its clips before fades, gain and pan; the filters are linear and time-invariant, so filtering each clip and summing equals filtering the track, which leaves buses untouched (a nonlinear effect such as a compressor would need a true per-track stage). meter_tracks mixes every clip again for its meters, so each clip holds two copies of its chain, one advanced by the audio mix and one by the meter pass, each once a block; a shared state would have advanced twice. Seeks and loop wraps clear the filters' memory, as a fresh render would. Both bindings take the rate and stages; the Python render's new arguments have defaults, so existing callers are unchanged. The first high-pass unit test failed on its own measurement (sample peaks of an 8 kHz sine, 6 samples a cycle, read -0.56 dB through a flat filter); a throwaway probe measured the filter at -40.02 dB at 100 Hz as theory gives, and the tests now measure by RMS. Verified: cargo test (high-pass, peak, refusals) and the locked native, python and wasm32 builds pass; through the export render, a 1 kHz high-pass moved 100 Hz by -40.03 dB and 5 kHz by -0.01 dB, a bypassed stage rendered byte for byte as none, and a +6 dB peak at 1 kHz gave +6.00 dB.

### src/render.rs, src/wasm.rs, src/python.rs · a master filter chain (coverage wave 8)
- refers-to: src/render.rs :: `Player::master_fx`, `clear_master_fx`, `add_master_fx`, `reset_fx`, `render`; src/wasm.rs :: `fw_clear_master_fx`, `fw_add_master_fx`; src/python.rs :: `render` (`master_fx`)
- kind: explainer
- logged: v0.62.0 (in progress) · 2026-09-30

Audacity's master stack: a chain run on the summed mix, after the tracks and buses and before the master gain, so the meters and loudness see it. It runs inside the block loop on each span right after that span is mixed, so a loop wrap's reset falls exactly where a fresh render would start; seeks reset it too. As a single signal path it is also where a nonlinear stage can go later. The Python render's new argument defaults to empty. Verified through the export render: a 2 kHz master high-pass moved 100 Hz by -52.14 dB, 1 kHz by -12.38 dB (theory -12.3) and 5 kHz by -0.10 dB; a bypassed master stage rendered byte for byte as none; a track low-pass with a master peak combined as expected (-34.62 dB at 5 kHz, the low-pass's -40 plus the peak's 6).

### src/fx.rs, src/render.rs, src/wasm.rs, src/python.rs · a compressor; stage chains on buses and the master (coverage wave 8)
- refers-to: src/fx.rs :: `Compressor`, `Stage`, `COMPRESSOR`; src/render.rs :: `Player::bus_fx`, `master_fx` (stages), `add_master_stage`, `add_bus_stage`, `clear_buses`, `add_bus`, `mix_buses`, `reset_fx`; src/wasm.rs :: `fw_add_master_stage`, `fw_add_bus_stage`; src/python.rs :: `render` (`chains`)
- kind: rationale
- logged: v0.63.0 (in progress) · 2026-09-30

A compressor (feed-forward, stereo-linked, hard knee, gain reduction in dB smoothed with attack and release, makeup gain) cannot run per clip as the filters do, being nonlinear, so it runs where a signal is already summed: bus and master chains now hold stages (a filter or a compressor), run a stereo frame at a time on the bus's sum before its gain and pan, and on the mix before the master gain. The plan gives a track holding a compressor a bus of its own carrying its whole chain in order; filter-only tracks keep the per-clip path. Bus chains stay parallel to the buses and reset with them; the python render takes ordered `chains` (bus by add order, or master), defaulting to empty. Verified: cargo test (the static curve, -6 dBFS through -20 dB at 4:1 within 1 dB of -16.5; a quiet sine unchanged within 0.05 dB) and the locked builds; through the export render a track compressor gave -16.00 dBFS where the static curve gives -16.51 (0.5 dB, the peak detector easing between waveform peaks), a quiet tone through the track's own bus came out at -33.9794 dBFS with and without it (the bus adds nothing), the master compressor matched the track's, and the per-clip high-pass regression held at -40.03 dB.

### src/onsets.rs, src/python.rs · transient detection (coverage wave 10)
- refers-to: src/onsets.rs :: `detect`; src/python.rs :: `onsets`
- kind: warning-context
- logged: v0.64.0 (in progress) · 2026-09-30

Pro Tools' transient detection, as a reference: the mono mix is first-differenced (attacks over sustained tones), cut into 256-sample frames whose energy is taken in dB; an onset is a local peak of the energy rise above both a threshold (18 dB at sensitivity 0 down to 4 dB at 1) and the local median, at least 50 ms from the last, placed on its frame's largest first-difference sample. Verified: cargo test (a five-click train found within 2 samples of each click; silence and a steady tone give none); through the engine, decaying noise bursts over a sustained 110 Hz tone at 0.30, 0.80, 1.55, 2.10 and 2.70 s were found within 0.5 to 2.4 ms, with no false onsets. Stated limit: 0.4 ms rectangular clicks buried in white noise were missed at sensitivity 0.5 (the noise's high frequencies dominate the first difference) and found at 0.85 (6 of 7) and 1.0 (all 7, exactly on time).

### src/render.rs · per-track metering in one pass over a (track, start) order, not one mix per track (playback at 2048 tracks)
- refers-to: src/render.rs :: `Player::order`, `order_dirty`, `ensure_order`, `mix_one`, `meter_tracks`
- kind: warning-context
- logged: v0.95.0 (in progress) · 2026-10-01

The v0.94.0 finding at 2048 tracks (the realtime thread taking the whole core, the kernel throttling it) was this: `meter_tracks` called `mix` once per track with a selector, and `mix` iterates every clip, so per 128-sample block the core made tracks times clips visits, 4.2 million at 2048 tracks and 1.5 billion per second, with a meter-buffer fill per track besides. The per-clip body of `mix` is now `mix_one`, which tests the clip's overlap with the block before touching its source or pan; `mix` keeps its selector for the bus and main passes; `meter_tracks` walks a `(track, start)`-sorted index of clip positions (rebuilt lazily after `clear_clips` or `add_clip`) in one pass, a run per track, and meters a run only when one of its clips overlaps the block, so the cost per block is one visit per clip plus the mix of the clips that actually sound. The audio and the peaks are unchanged: a clip that did not overlap did nothing in the old path either, so biquad state advances identically. Verified: cargo test 7 passed; through the wasm core in Chromium with the v0.93.0 protocol, 2048 tracks laid end to end start playing 257 ms after Space and 2048 with 80 clips overlapping 448 ms, both holding real time exactly (position against wall time to the sample, ratio 1.0) where both had hung the page past 250 s; verify_track_meters.py, verify_play.py and verify_loop.py unchanged and passing. The remaining decay in the page's responsiveness during that run was on the main thread (the player's report queue), fixed in the same release.

### src/render.rs, src/wasm.rs · sources that stream in: allocated silent, written as pieces arrive
- refers-to: src/render.rs :: `Player::alloc_source`, `Player::write_source`, the `a_streamed_source_plays_what_was_written_and_silence_elsewhere` test; src/wasm.rs :: `fw_source_alloc`, `fw_source_write`
- kind: explainer
- logged: v1.11.0 (in progress) · 2026-10-01

A long file had to arrive whole before it could play. A source can now be allocated silent at its full length and filled with interleaved frames written at any offset (clipped to the length; an unknown source or an offset past the end writes nothing), so the player can start on the piece under the playhead and fill the rest behind it. Verified: the new unit test (written frames read back, silence around them, writes clipped at the end, unknown sources ignored) and the other seven pass; through the wasm core a 70 s stereo file streamed in 2 s pieces and bounced matched the engine's export to 0.0 at 3371 points across the file. Stated: the source is still held whole in memory once filled; this changes when the audio arrives, not how much is held.

---

## formwav-dsp/tests/stages.rs {#tests-stages}

### tests/stages.rs · the live effect kinds held to the interface's catalogue
- refers-to: tests/stages.rs :: CATALOGUE, and every test in the file
- kind: rationale
- logged: v2.12.5 · 2026-10-06

PLAN_v11's 4.1, written on the owner's explicit ask (2026-10-06: "Write the tests now", answering whether the tests dev-rules bans unasked should be written). Each of the 19 live kinds is held to what the interface promises in frontend/src/ui/editor-tabs.ts (label, one-line promise, parameter ranges and defaults), through the crate's public Stage API only, so the tests read the promise and not the implementation. Over every kind: designs at 44.1, 48 and 96 kHz; stays finite and under 1000 at every corner of its ranges against a hostile signal (full-scale noise, DC, ±4 impulses, a +12 dB tone); silence stays silent; reset leaves no tail; the latency it reports is where its output correlates best with its input; and the settings the catalogue makes neutral (mix 0, depth 0, ratio 1, 0 dB, strength 0) give the input back with the residual under -60 dB. The catalogue's two numbers hold: De-reverb 21 ms and De-click 3.5 ms behind at 48 kHz. Per kind, the untested ones: the low-pass and both shelves, echo repeats at the delay each the feedback times the last, the limiter never past its ceiling by 0.1 dB (a +12 dB tone and noise, two ceilings) and leaving audio under it untouched, the gate reaching its range in a long gap while keeping what is above the threshold and closing faster at a shorter release, tremolo dipping 8 times in 2 s at 4 Hz and steady at depth 0, chorus and flanger moving a steady tone by more than 6 dB, the phaser's notch passing over at least two of four tones, and dialogue isolate equal to RNNoise (nnnoiseless) called directly to within 1e-5 once aligned by a frame, taking room-like noise down more than 10 dB and leaving it at strength 0.

Two first runs failed, and neither failure was a fault in the DSP: dialogue isolate took full-band white noise down only 1.1 dB, which a probe showed is RNNoise's own behaviour on that signal (the stage matched nnnoiseless called directly to 0.1 dB; low-passed noise came down 35 to 41 dB), so the test uses room-like noise and checks the stage against RNNoise itself; and the gate's gap measured 23 dB down 0.2 to 0.5 s after the sound stopped, because its release is the time constant of a gain smoothed in linear terms, so a -60 dB range is reached about seven releases later (about 0.7 s at 100 ms; 17 dB down at 0.2 s). The catalogue does not say which a release means, so the test holds what it does say; whether a release should instead move the gain in decibels and reach the range in one release time is the owner's call, reported. rustfmt is not enforced: the crate has never been formatted with it (245 places would change, this file's 25 among them), and running it over the crate is the kind of scripted rewrite dev-rules' SEDO law forbids. Clippy's 18 warnings in the library predate this file, which has none.
