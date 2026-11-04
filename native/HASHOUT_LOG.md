# HASHOUT_LOG · native · formwav

Living log of all comment content, explainers, rationale, TODOs and removed code for the Rust side. Source files stay comment-free per dev-rules `sub-skills/hashout-log/SUB-SKILL.md`; everything they would have said lives here. Read this first, then edit code surgically.

Current build version: v2.22.0
Last updated: 2026-11-03 · v2.22.0 no core change (the version only). Before: 2026-10-31 · v2.21.9: no core change (the version only). Before: 2026-10-23 · v2.20.4, the bundle audit: libsndfile (LGPL-2.1) is no longer linked statically on Windows by build_fwnyq, build_fwvamp or build_fwlv2; each links it as a DLL and copies what its .exe loads (ldd, the MSYS2 prefix's DLLs) into its dlls/, which build_windows_app.ps1 gathers into src-tauri/binaries/dlls and tauri.windows.conf.json places beside the helpers with one glob (`binaries/dlls/*.dll` to `./`, which tauri-utils 2.10's resource code maps to the resource root by file name). portaudio (MIT) stays static in fwnyq; -static-libgcc and -static-libstdc++ keep the GCC runtime out. Not built here (no MSYS2). formwav-nyquist/runtime: aud-do-support.lsp (GPL-2.0, the host scripting helpers formwav has no use for) is removed and init.lsp no longer loads it, the second marked change to the 2.4.2 runtime; v2.18.6, PLAN_v13 S17 phase C, formwav-host. instrument.rs render_vst3: a .vst3 module's notes through an IEventList (Vst3Notes, the block's note-on and note-off events at their sample offsets), no audio input, the event bus activated; fwhost instrument picks it by the path's .vst3. offline.rs vst3_instruments reads IPluginFactory2's subcategories (Instrument), and the scan marks those classes instrument, so the engine's instruments() and note tracks offer them. editor.rs edit_clap (fwhost edit clap <plugin> <state-in|-> <state-out> [seconds], unix): the plug-in made, its state loaded, its editor in an X11 toplevel titled with its name (WM_DELETE_WINDOW in WM_PROTOCOLS), driven through the host's TIMERS and FDS as the clap-gui spike drove them, plus standard input, until the window closes (ClientMessage delete or DestroyNotify), a line close or the end of input, or the time; then clap.params flush with no events and clap.state save. Standard input matters: the engine keeps a pipe open and writes close for Done; a caller that leaves input closed ends the run at once ("input closed"). Fixtures: vst3-sine (no input, an event bus, a sine per note from its offset, 2 ms release, IPluginFactory2 giving Instrument|Synth) and clap-knob (a gain kept as eight bytes of state and set by a press or drag at x in its own 240 x 80 X11 window, whose connection it registers with the host's posix-fd-support). Measured: three VST3 notes at frames 24000, 60001 and 100123 sound from the next sample (0.021 ms); under Xvfb the editor's window and the plug-in's child show in xwininfo, an xdotool drag takes the state from 0.9 to 0.25, a render with it plays at exactly 0.25, closing the window ends the run as "window closed". Not done: VST3 editors (a VST3 view's edits come through IComponentHandler and need applying to the component before its state is read), Cocoa and Win32 windows. · v2.18.5, PLAN_v13 S17 phase B and PLAN_v12 C7, formwav-dsp. render.rs, delay compensation everywhere: chain_latency sums a chain's stages; bus_ahead walks a bus's way to the master adding each chain's latency and the master's, so a bus reads its clips that far ahead (a bus into a bus included); the stereo and surround renders read their direct clips ahead by the master chain's latency; mix_one reads a delaying clip chain's clip ahead by its latency (silence past the clip's end) and primes it where the clip starts or, with `prime`, in the first block after a discontinuity. The per-bus priming (bus_primed) gave way to one `primed` flag and Player::prime: before the first block after a seek, a loop's wrap or a changed chain, the whole mix over the span the longest read-ahead covers is played into the pre-roll scratch and dropped (mix_signed plays silence for the part before 0), so every chain has heard what it reads past; with no read-ahead the clips prime themselves instead. Sessions with no delaying stage render unchanged. Buses now run in route order (bus_run, rebuilt by set_bus_out and add_bus: the longest way to the master first, the order added among equals) instead of the order added, and set_bus_out refuses only a loop, so a track's own bus added after the user bus it plays into works (C7). fx.rs: HOSTED (21), the Insert trait (process_block, latency, reset, key) and Hosted, a stage holding one; a copy holds none and passes the signal (the master chain's surround copies); Stage::process runs it as a one-frame block. render.rs add_bus_insert and take_inserts. plugin.rs (feature native, never wasm): ClapInsert hosts a CLAP effect live: the library is loaded once per path and its entry initialised once (LOADED, counted, deinitialised after its last instance); open makes the plug-in, loads the saved state (clap.state), activates it for blocks up to MAX_BLOCK (4096) and reads its latency; process_block starts processing at the first block (the audio thread), copies through preallocated buffers in pieces of up to MAX_BLOCK, sends the values with the first block and passes the signal through if the plug-in will not start or fails; reset calls the plug-in's reset; Drop stops, deactivates, destroys and releases; key() is path, then a hash of the state and values, by which native.rs set_mix takes an instance back after an edit. native.rs: the mix's plugins list (path, state bytes, values), bus stages [21, k, ...]; set_mix makes only the inserts an edit adds, before locking (the installed keys kept beside the player), takes the rest back from the chains, drops the unused after unlocking and returns what could not be made; bus routes (out) are applied now (they had been ignored). python.rs render takes plugins and hosts kind-21 bus stages the same way (an insert that cannot be made fails the render); NativeOutput.set_mix returns the failures and releases the GIL while it works. Measured with a scratch harness: the CLAP gain fixture declaring 1000 samples of latency on a bus lands its clicks on the dry render's samples exactly, and through a second bus with a de-reverb within 9e-8; a seek mid-way matches the straight render exactly; formwav's De-noise live in 256-frame blocks is bit-identical to fwhost process; 150 warm blocks through an insert allocate nothing. The fixture's delay line is a static shared by every instance, so two latent fixture instances in one process garble each other (a fixture limit, not the host's). tests/processors.rs expects the master chain read ahead; tests/buses.rs expects a route to hold whichever bus was added first. · v2.18.4, PLAN_v13 S17 phase A, formwav-host. VST3 gets what CLAP got at v2.18.3: params.rs MemStream is an in-memory IBStream (read, write, seek, tell); vst3_process calls the component's setState after initialize when a state is given and getState after setActive(0) when one is asked for; Vst3Timed is one parameter's automation as an IParamValueQueue whose points are those inside the current block, each at its offset from the block's start, and Vst3Changes lists the first-block values (as before) then the parameters with points in this block (block(), any()); inputParameterChanges is null in a block with nothing to offer. process_with accepts automation and state for CLAP and VST3 and refuses them for the rest. fixtures/vst3-gain (new workspace member) is the vst3 crate's own gain example (0.3.0, examples/gain.rs, MIT OR Apache-2.0, credited in its header) changed twice so the host can be measured: the processor keeps its gain as eight bytes of state, and each gain point takes effect at its own sample offset. Measured (Linux bundle vst3-gain.vst3/Contents/x86_64-linux): with Gain 0.3 saved, a fresh instance given the state renders bit-identical (state 000000403333d33f); a step from 1 to 0.25 at frame 100000 leaves frames 0 to 99999 exactly the dry input and frame 100000 on exactly a quarter of it, so the host's in-block offsets are right to the sample (the CLAP path sets them the same way; no CLAP plug-in here honours them). Before, v2.18.3, PLAN_v13 S17 begun, formwav-host. params.rs: ClapEvents keeps its first-block values and gains timed events (with_automation, block): each block offers the events whose frame falls in it, header.time set to the offset within the block, after the values (CLAP wants a list in time order); parse_automation reads `frame id value` breakpoints and samples each parameter's line every AUTOMATION_STEP (32) frames between them, held after the last; StateReader, state_read and state_write are the clap_istream and clap_ostream over bytes. offline.rs: process_with (process folded into it and removed, its only caller now passing the new arguments) refuses automation or state for any format but CLAP; clap_process loads a given state after init and before activate, calls block() before each process call, and saves the state after deactivate. main.rs: `fwhost process` takes three more optional arguments, an automation file, a state to load and a file to save the state into ("-" for none), and reports automation_events and state_bytes. Measured with formwav's own CLAP bundle (native/formwav-clap, De-noise): a fresh instance given the 23-byte state saved after a Reduction 30 render renders bit-identical to it, the state the same bytes on its way back out; a step from 0 to 40 at frame 100000 is identical to the fixed-0 render up to 99840, the start of the 256-frame block, as this plug-in applies events at its block start (an honouring plug-in would get them at frame 160 of that block; none here does, so the offset is set but not measured at the sample), and the last second equals the fixed-40 render's level, -61.52 dB; a 0 to 40 ramp falls -16.2, -26.1, -38.7 and -52.9 dB second by second. The VST3 path and the ARA and instrument paths are unchanged (ara.rs still builds an empty ClapEvents). v2.18.2: no core change (the release is the renderer panel and two interface fixes; the core's render of the page's own clips message, run in Node through the wasm build, is how the meter defect was told apart from the audio). v2.18.1, PLAN_v13 S16 (surround), the core's part. src/layout.rs is the one table of speaker layouts (ids 0 5.1 and 1 first-order ambisonics as before, 2 to 12 stereo, LCR, quad, 5.0, 6.1, 7.1, 5.1.2, 5.1.4, 7.1.2, 7.1.4, 9.1.6): each channel's name, azimuth, elevation and WAVE mask bit in file order (the bit order of dwChannelMask), positions from ITU-R BS.775 and BS.2051 where a named system exists, and the stereo fold-down per channel built by rule (fronts 1 to their side, centre and sides 0.7071, rear pairs 0.7071 or 0.5 beside a side pair, a back centre and every height channel 0.5, LFE 0); 5.1's fold equals the old Lo = L + 0.7071 C + 0.7071 Ls term for term, so 5.1 folds are bit-identical. src/pan.rs is the panner, now the only copy of the law (the engine's and the page's copies are gone): pairwise constant power on the ear-height ring, a gap wider than 180 degrees (stereo, LCR) clamped to the nearer end, a direction exactly on a speaker given to it alone; spread s = 1 - (1 - divergence) r between the point and an even share, which at divergence 0 is the old r * point + (1 - r) * even; the centre percent moving (1 - t) of C's power equally to the speakers either side; height raising the source onto the top ring by cos and sin of h pi/2; the LFE send as before; ambisonics as foa_gains was. render.rs: the bus is N channels (MAX_CH 16), the master chain copied per channel pair (an odd last channel runs as the left of its pair), set_places takes places and set_place_gains takes gains (the core's tests use the latter), and set_bus_places places a placed track's own bus: in render_surround its output, after its chain, gain and pan, is summed to mono and spread by its gains (its LFE through its own low-pass pair) instead of going to L and R. That closes the defect found at S1, where a placed track with a compressor, echo, gate, reverb or processor played on L and R. Bindings: wasm fw_set_bus_places, fw_set_surround_layout, fw_take_peaks_surround (fw_set_surround_format and fw_take_peaks_51 kept); python render's bus_places argument (last), surround_layouts, surround_channels and place_gains; native mixes' busPlaces. Measured: cargo test passes unchanged in substance (three test calls moved to set_place_gains); 5.1 renders of a tone at C, at Rs and a mix of three places equal the v2.18.0 core within 6e-8; a 7.1.4 fold-down equals its 12 channels times the fold table to -130.9 dB. Before, v2.18.0: no core change (the release is the form family look, the MCP server's open-session tools and the agents' configurations). Before, v2.17.2: no core change (the release is the new app icon). Before, v2.17.1: no core change (the release is the Claude Code dock and an everyday-user pass in the interface and engine). Before, v2.17.0: no core change (comments only: no competing product named; the Nyquist runner's provenance now names the upstream sources and release). Before, v2.16.9: no core change (PLAN_v13 S15's picture is decoded by the page, its proxies made by ffmpeg). v2.16.8: PLAN_v13 S14, written here from the behaviour the study describes. formwav-dsp/src/instruments.rs: a subtractive synth (two polyBLEP oscillators with pitch, detune and mix; a per-voice state-variable low-pass, its cutoff moved up to six octaves either way by its own ADSR; glide from the last note in semitones over a time; velocity sensitivity; sixteen voices, the oldest released one giving way) and a drum synth on the General MIDI map (kick 35 and 36, clap 37 and 39, snare 38 and 40, closed 42 and pedal 44 hats choking the open 46 within 5 ms, six toms, crash 49 and 57, ride 51 and 59; tune, decay and snappy values; noise from a per-hit xorshift seeded by the note and the hit count, so a render repeats; twenty-four voices). One Instrument takes note-on and note-off and adds its voices to a buffer; render() feeds it a clip's notes on their frames, so the live instrument and a rendering are equal sample for sample through uneven blocks (tests/instruments.rs, six tests, 74 in all). render.rs: the live instrument is instruments::Live (the built-in synth or one of these), set_live_instrument keeps a sounding kind's voices; wasm.rs fw_live_instrument; python.rs render_instrument, instrument_params and process_chain (a chain run with its latency read first, then in the render's 128-frame blocks, as a bus's chain runs in an export). v2.16.7: no core change. v2.16.6: no core change (PLAN_v13 S13 is the interface's and the engine's). v2.16.5: no core change (PLAN_v13 S12's demo renders its Keys through render_notes as it is). v2.16.4: no core change (PLAN_v13 S11 is the interface's tempo map; the core plays samples). v2.16.3: buses into buses (formwav-dsp/src/render.rs set_bus_out, bus_outs, bus_in; wasm.rs fw_set_bus_out; python.rs render's bus_outs pairs, default empty). Buses run in the order they were added, so a destination is kept only when it comes after its source; otherwise, or for 0 or an unknown id, the bus plays into the master, which is what makes a loop impossible in the core whatever the document says. A bus's input is its clips plus whatever earlier buses sent into bus_in, summed before its chain; clear_buses clears the outs. tests/buses.rs. Before, v2.16.2: the master volume envelope (formwav-dsp/src/render.rs set_master_envelope, master_ramp; wasm.rs fw_set_master_envelope; python.rs render's master_env, default 0). It is an envelope id from add_envelope, so it is cleared with the others on every load; applied per block after the master chain, in render and in render_surround on all six channels, read at the block's own position so a loop wrapping mid-block is followed; with id 0 nothing runs, so a session without a master lane renders bit for bit as before (tests/master.rs holds both). v2.16.1, v2.16.0, v2.15.5, v2.15.4, v2.15.3, v2.15.2, v2.15.1, v2.15.0, v2.14.7, v2.14.6 and v2.14.5: no change to the core (the version only). v2.14.4: the logarithmic fade and a shape for each fade (src/render.rs `fade_curve`, `fade_shapes`; tests/fades.rs). v2.14.3: no change to the core (the version only). v2.14.2: the true peak, 4x oversampled (src/loudness.rs `true_peak`, `quarter_points`, its entry in src/python.rs; tests/bounce.rs). v2.14.1: a filter's automation on a bus (src/render.rs `add_bus_fx_auto`, `run_bus_chain`), the -3, -4.5 and -6 dB pan laws for a mono source (`law_gains`, `set_pan_law`, `clip_pan`), each processor's gain reduction (`take_reductions`), their entries in src/wasm.rs, src/python.rs and src/native.rs; tests/mixer.rs. v2.14.0: formwav's own studio processors (the formwav-studio crate) run as a processor stage (src/fx.rs `Processor`, kind 20), entries in src/render.rs, src/wasm.rs, src/python.rs and src/native.rs; bus and master chains run stage by stage over a block; tests/processors.rs. v2.13.1: no change to the core (the version only). v2.13.0: the synth's low-pass, in render() and the live instrument alike (src/synth.rs), and its two new parameters through src/python.rs and src/wasm.rs; most stages added since v1.11.0 have no entry in this log

---

## Org-navi-map

```
native/
├── formwav-studio/              the studio processors: 24 stereo block processors with named parameters, no dependencies
│   ├── src/lib.rs               the catalogue (Spec, Param, Unit, Taper, Category), build(), the Processor trait
│   ├── src/filters.rs           biquads (RBJ cookbook, f64), the Linkwitz-Riley crossover, Butterworth cascades
│   ├── src/rng.rs, delay.rs     seeded noise (SplitMix64), delay lines read between samples, the modulation sine
│   ├── src/eq.rs, strip.rs      Band EQ, 7-Band EQ, Channel Strip
│   ├── src/dynamics.rs          Compressor, Gate/Expander, De-Esser, Maximizer
│   ├── src/space.rs             Room (a feedback delay network) and Plate (Dattorro's tank)
│   ├── src/modulation.rs        Modulated Delay, Chorus, Flanger, Phaser
│   ├── src/color.rs, pitch.rs   Drive, Bit Crusher, Rectifier; Pitch Shift
│   ├── src/utility.rs           Time Offset, Gain, Trim, Polarity, DC Block, Test Tone, Dither
│   └── tests/studio.rs          what each family should do, measured (cargo test)
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
    │   ├── loudness.rs          BS.1770-4 integrated loudness: K-weighting for any rate, 400 ms blocks, two gates
    │   ├── fx.rs                the nineteen live stages (filters to de-reverb) and the processor stage: design, process, reset, latency
    │   ├── onsets.rs            transient detection
    │   ├── synth.rs             the built-in instrument: note tracks rendered, the live instrument, a resonant low-pass on both
    │   ├── midi.rs              MIDI input read by the engine (feature "native"), for the desktop app
    │   └── native.rs            native output and capture through cpal (feature "native")
    └── tests/
        ├── stages.rs            the 19 live effect kinds held to the interface's catalogue (cargo test)
        └── processors.rs        the processor stage against the processor run on its own, its spec, its table
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
- [formwav-dsp/src/fx.rs](#src-fx)
- [formwav-dsp/src/native.rs](#src-native)
- [formwav-dsp/src/synth.rs](#src-synth)
- [formwav-dsp/tests/stages.rs](#tests-stages)
- [formwav-studio and the processor stage](#formwav-studio)
- [The mixer basics in the core (PLAN_v13 S2)](#mixer-s2)
- [The true peak, 4x oversampled (PLAN_v13 S3)](#true-peak-s3)
- [The logarithmic fade and a shape for each fade (PLAN_v13 S5)](#fades-s5)
- [The macOS helpers' header room (v2.21.8)](#macos-headerpad)

---

## The macOS helpers' header room (v2.21.8) {#macos-headerpad}

### formwav-nyquist/build_fwnyq, formwav-vamp/build_fwvamp, formwav-lv2/build_fwlv2 · -headerpad_max_install_names on macOS
- refers-to: each script's `Darwin)` LINK; ../src-tauri/gather_macos_libs; ../build_macos_app
- kind: rationale
- logged: v2.21.8 · 2026-10-30

On macOS the three helpers linked Homebrew's libsndfile, portaudio and lilv by their /opt/homebrew paths, so the app ran only where Homebrew had them, and a signed app with the hardened runtime may not load them from there at all. The desktop build now copies those libraries into formwav.app/Contents/Frameworks and rewrites each reference to `@executable_path/../Frameworks/<name>` with install_name_tool (src-tauri/gather_macos_libs). A new name can be longer than the old one (`@executable_path/../Frameworks/libportaudio.2.dylib` against `/opt/homebrew/opt/portaudio/lib/libportaudio.2.dylib`), and ld leaves little room in a Mach-O header by default, so the helpers are linked with `-Wl,-headerpad_max_install_names` on Darwin (Homebrew's own libraries already are). Linux and Windows links are unchanged. Not run here: no macOS machine.

---

## The logarithmic fade and a shape for each fade (PLAN_v13 S5) {#fades-s5}

### src/render.rs · fade_curve, fade_shapes
- refers-to: render.rs :: `FADE_LOGARITHMIC`, `fade_curve`, `fade_shapes`, the clip loop's in_shape and out_shape; tests/fades.rs
- kind: rationale
- logged: v2.14.4 · 2026-10-08

The logarithmic curve is log10(1 + 9x), code 4: 0 at the silent end and 1 at full level like every shape, rising fast and levelling off (half gain, -6 dB, about a quarter of the way in, at x = 0.24), the mirror in feel of the exponential's slow start, which stays the square it has always been, so older sessions sound as they did. A clip keeps one fade code across every binding (wasm, Python, native), so the two edges share it: the low four bits are the fade-in's shape, the high four the fade-out's plus one, zero meaning the fade-in's; every code below 16, which is every code made before, is one shape for both edges, and an older core given a newer code plays it linear, which the interface's chip already asks to rebuild. tests/fades.rs holds every shape to 0 and 1 at its ends, the logarithmic one to log10(3.25), log10(5.5) and log10(7.75) at a quarter, a half and three quarters (0.511883, 0.740363, 0.889302), the code's two halves, and a clip of constant level rendered with a linear fade-in and a logarithmic fade-out sample by sample.

## The true peak, 4x oversampled (PLAN_v13 S3) {#true-peak-s3}

### src/loudness.rs · true_peak, quarter_points
- refers-to: loudness.rs :: `PEAK_HALF`, `quarter_points`, `true_peak`; python.rs :: `true_peak`; tests/bounce.rs
- kind: rationale
- logged: v2.14.2 · 2026-10-08

The export's report gains the true peak (ITU-R BS.1770's 4x oversampled peak, which catches the overs between samples that an encoder or a converter turns into clipping). Each channel is read at four times its rate: its own samples, and the three points a quarter, a half and three quarters of the way to the next, each interpolated from the 12 samples either side (PEAK_HALF) by a sinc under a Kaiser window (beta 8, the Bessel function summed until its terms fall below 1e-12 of the total), each set of 24 weights scaled to sum to one so a constant reads as itself. The weights are worked out once per call, in f64, and the sums run in f64. The points are worked out only near loud samples, where a sample within two either side reaches a quarter (-12 dB) of the channel's sample peak, so a long quiet stretch costs one comparison a sample. true_peak returns the highest reading in dBTP, sample peaks included, or None for digital silence; formwav's own integrated loudness stays the report's, unchanged. tests/bounce.rs: a sine at a quarter of the rate, phased 45 degrees, has every sample at 0.707 of its height (-3.01 dB) and a true peak of 0 dB; the reading is +0.107 dBTP, the overshoot of a sine switched on and off at full height, while the same weights away from the ends read +0.0004 dB; a slow sine's true peak is its sample peak; silence has none.

## The mixer basics in the core (PLAN_v13 S2) {#mixer-s2}

### src/render.rs · a filter's automation on a bus, the pan law, each processor's gain reduction
- refers-to: render.rs :: `bus_fx_spec`, `bus_fx_auto`, `add_bus_stage`, `add_bus_processor`, `add_bus_fx_auto`, `run_bus_chain`, `mix_buses`, `pan_law`, `set_pan_law`, `clip_pan`, `mix_one`, `take_reductions`, `clear_buses`, `add_bus`; wasm.rs :: `fw_add_bus_fx_auto`, `fw_set_pan_law`, `fw_take_reductions`; python.rs :: `render(bus_auto=..., pan_law=...)`; native.rs :: `MixBus.fx_auto`, `Mix.pan_law`; tests/mixer.rs
- kind: rationale
- logged: v2.14.1 · 2026-10-07

Every kind but the five filters now runs on a track's sum (a bus of its own), so a track with an echo or a gate takes its filters onto that bus too; their automation went only to clip chains, so it would have been lost there, as it already was on a track with a compressor. A bus stage's automation is added as a clip's is (the stage, parameter 0 to 2 for frequency, gain and Q, an envelope), for the five filters only, refused otherwise; add_bus_stage now keeps each stage's kind and settings (bus_fx_spec, a processor's as kind 20) so an automated filter can be redesigned. run_bus_chain runs a chain stage by stage over the block as before when nothing on the bus is automated; otherwise it splits the block on the same absolute 32-sample grid the clip chains retune on, redesigns each automated filter from its envelopes at the piece's start, then runs the stages over the piece, so a sweep on a track's bus equals the same sweep on its clip sample for sample (measured in backend/tests/test_mixer.py). The read-ahead is kept: the primed samples are retuned at `from`, the block at `from + ahead`, its own session time.

The pan law (law_gains) is a session setting coded 1 to 3, the three a console offers; 0, and any other code, is the balance every session had, so no old session changes. With p the pan from 0 (left) to 1 (right): 1 is constant power, the cosine and sine of p times a quarter turn, whose squares always sum to one (-3.01 dB each side at the centre); 3 is linear, 1 - p and p, whose gains always sum to one (-6.02 dB); 2 is the geometric mean of the two (-4.52 dB), halfway between them in decibels everywhere. It applies to a mono source only, the clip's pan and its pan automation alike: a stereo source's pan stays the balance it was, its image kept whole at the centre. The centre is measured in the export (tests/mixer.rs, within 0.02 dB of -3.0103, -4.5154 and -6.0206).

take_reductions writes each processor's gain_reduction_db in the order the bus chains and then the master hold them, and returns the count whatever the room, so a caller with too little room knows it was cut. The browser's plan names whose each processor is in the same order.

## formwav-studio and the processor stage {#formwav-studio}

### formwav-studio · the studio processors, and why a crate of their own
- refers-to: native/formwav-studio (Cargo.toml, src/lib.rs, each family's file, tests/studio.rs); formwav-dsp/Cargo.toml (the path dependency)
- kind: rationale
- logged: v2.14.0 · 2026-10-07

PLAN_v13 asks for studio processors beside the core's nineteen live stages: equalisers, dynamics, two reverbs, delay and modulation, colour, pitch and the utilities a mix needs. A core stage is five numbers, made for clip chains and their automation; a processor has named parameters (the channel strip 22, the 7-band EQ 23) and a description an interface draws its controls from. So they are a crate of their own: no dependencies, unsafe code forbidden, no threads, files or clocks, edition 2021 as the core is, so it builds unchanged for wasm32, the Python module and the native output, and its own tests run on it alone (`cargo test` in native/formwav-studio).

The shape: one static catalogue of Specs (id, name, short name, category, and each parameter's id, name, range, default, unit, taper and choices), build() making a processor at a rate with every parameter at its default and every buffer clear, and the Processor trait (set by index in the spec's order, reset, run a stereo block in place, latency, tail, reduction_db). Values are held to their ranges before they reach a processor (Param::clamp: NaN and infinities to the default, switches and choices to whole numbers), so no processor checks its own; nothing allocates while running, every delay line sized at build for the longest setting at that rate; a parameter takes effect at once, since the core makes a stage anew whenever its settings change. The shared parts: the audio EQ cookbook's biquads (Bristow-Johnson) in transposed direct form II run in f64, first-order sections for the odd slopes and Butterworth cascades for the rest, a fourth-order Linkwitz-Riley split whose two bands sum to an all-pass, a one-pole smoother (filters.rs); delay lines read between samples by cubic Hermite interpolation, and a sine for modulation (delay.rs); SplitMix64 noise with a fixed seed for each processor, so a render repeats exactly (rng.rs).

The families: the Band EQ is one cookbook section of seven types; the 7-Band EQ is a low and a high cut of 6 to 24 dB an octave, two shelves and three bells; the Channel Strip is a four-band EQ behind a low cut, a gate and a compressor, the EQ before or after the dynamics. The compressor reads the louder channel (linked), bends into its ratio over a quadratic knee, moves its reduction by attack and release ballistics, can high-pass its sidechain and look ahead (its latency), with makeup and a dry mix; the gate is a downward expander with a hold and a floor; the de-esser splits at its frequency and turns the upper band down 4 to 1 above the threshold, at most its depth, Listen playing that band alone; the maximizer raises the input by the threshold and holds the ceiling with a gain held at its lowest across a look-ahead window and averaged over it, so the gain has come down by the time a peak leaves the delay, then recovers by the release. The Room is a feedback delay network: four all-passes a side, then eight lines fed back through a Householder matrix, each damped and scaled for the decay time; the Plate is the figure-of-eight tank of Dattorro's "Effect Design, Part 1" (J. Audio Eng. Soc., 1997), its lengths scaled from his 29761 Hz to the session's rate and by the size. The modulated delay sways its time with a sine and darkens its repeats; the chorus is a voice a side, the right one's sweep offset by the spread; the flanger sweeps a short delay with feedback of either sign; the phaser sweeps up to twelve first-order all-passes two octaves either side of its centre, the last fed back to the first. Drive bends the raised input by a hyperbolic tangent (Soft), the same off centre with its offset removed for even harmonics (Warm) or a cubic that meets full scale flat (Hard), then a low pass for the tone; the bit crusher cuts the words to its bits and holds each sample until the next tick of its downsampling clock, with hiss; the rectifier folds the negative half up or removes it. Pitch Shift reads a delay line faster or slower than it is written and, when the read head has drifted across the window, hands over to a new head placed where the last few milliseconds best match those under the old one (a search outward from half a window back, a farther candidate taken only when it matches clearly better), crossfading the two, so a steady tone keeps its new pitch without a beat. The utilities: a time offset in milliseconds plus samples, a gain, a trim with a polarity switch, a polarity flip, a DC block (a first-order high pass), a test tone (four waveforms, pink noise as rows of noise each held twice as long as the last, white noise) and dither (triangular at the target word's step, rounded to it; with shaping, each sample's rounding error taken from the next, which moves the noise toward the top of the band; exact silence stays silent).

tests/studio.rs holds each family to what it is for, measured on tones and noise rather than read back from the code: every processor in the catalogue builds at rates from 22.05 to 192 kHz, its defaults in range and one choice a step; silence stays silent, and noise stays finite with every parameter drawn at random across its range; a bell gives its gain at its frequency and a notch takes its frequency out; a cut falls by its slope an octave past its corner; a compressor settles on its curve and reports its look-ahead as latency; a gate closes to its floor; a de-esser turns down the band above its frequency and leaves the rest; a maximizer never passes its ceiling; each reverb decays 60 dB in about its decay time; an octave up puts 440 Hz at 880 Hz and an octave down at 220 Hz; full-wave rectifying doubles a tone; the utilities do exactly what they say; the test tone plays each wave at its level; dither lands on the word's steps, keeps silence and keeps a tone below a step; the delays and modulators delay, sweep and colour. The browser core grew from 635 kB to 758 kB.

### src/fx.rs · Processor, the stage that runs one of the studio processors
- refers-to: src/fx.rs :: `PROCESSOR` (20), `Processor` (design, made, latency, tail, gain_reduction_db, reset, process, process_block, Clone, PartialEq, Debug), `processors_json`, `Stage::processor`, `Stage::process_block`; tests/processors.rs
- kind: rationale
- logged: v2.14.0 · 2026-10-07

A stage's five numbers cannot carry a processor's parameters (the channel strip has 22, the 7-band EQ 23), so a processor is made from a spec: its id, then param=value pairs by the catalogue's parameter ids, each value held to its parameter's range (Param::clamp, NaN to the default), unknown names and malformed pairs skipped, an unknown id refused. Processor builds it at the session's rate, sets every value, then resets, so a stage starts from silence at its settings, in the browser and the export alike. Clone remakes the processor from its id and values (the master chain is cloned for the 5.1 pairs); a processor that cannot be remade passes audio through. process_block runs a block in place, whatever its length; process runs one frame for the chains that still run frame by frame (clip chains, the 5.1 path). Bus and master chains now run stage by stage over each block (Stage::process_block) instead of frame by frame through the whole chain: each stage sees the same input samples in the same order, so the existing stages give the same output (tests/processors.rs checks five kinds sample for sample), and a processor gets a whole block per call. The processor's latency joins Stage::latency, so a bus reads ahead by it as it does for the core's delaying stages; the master is not read ahead (PLAN_v13 S17). processors_json writes the catalogue for the engine and the interface; the interface's copy (frontend/src/engine/processors.ts) is held equal to it by backend/tests/test_processors.py.

### src/render.rs, src/wasm.rs, src/python.rs, src/native.rs · the entries
- refers-to: render.rs :: `add_master_processor`, `add_bus_processor`, the master loop in `render`, `mix_buses`; wasm.rs :: `fw_add_master_processor`, `fw_add_bus_processor`; python.rs :: `render(processors=...)`, `processors()`; native.rs :: `Mix.processors`
- kind: rationale
- logged: v2.14.0 · 2026-10-07

A chain stays a list of six numbers per stage everywhere it travels; a processor's stage is [20, k, 0, 0, 0, 0], k naming its spec in a list carried beside the chains (the worklet's message, the engine's render call, the native output's mix), so the planners, the plan parity test and the worklet keep their shape. The browser passes the spec as bytes through fw_alloc (the audio worklet has no TextEncoder in every browser, and a spec is ASCII).

---

## formwav-dsp/src/synth.rs {#src-synth}

### src/synth.rs · Cutoff and Resonance, the same filter live and rendered
- refers-to: src/synth.rs :: `Patch` (cutoff, resonance), `Lowpass` (design, retune, process), `render`, `Synth` (filter, set_patch, render); tests the_cutoff_takes_the_top_off_and_leaves_the_low_end, the_live_instrument_plays_exactly_what_render_makes
- kind: explainer
- logged: v2.13.0 · 2026-10-07

The Synth tab's two filter knobs. The patch gains cutoff (0 is open, and so is anything at or above 0.45 of the rate) and resonance (the low-pass's Q, 0.707 flat). Lowpass is the RBJ cookbook low-pass in transposed direct form II, in f64, applied to the sum of the voices, once in render() over the whole note buffer and per sample in the live Synth; set_patch retunes the coefficients and keeps the filter's state, so a knob turned while a note holds does not click. Because both paths filter the same sum the same way, the live instrument still renders exactly what render() makes, which its test holds; the cutoff test checks that a 440 Hz saw under a 220 Hz cutoff keeps under half its level, that a 55 Hz sine under 8 kHz changes by under 1 percent, and that a cutoff past 0.45 of the rate leaves the output identical to an open one. cargo test --release --lib: 30 passed.

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

### src/python.rs · render_notes takes the filter
- refers-to: src/python.rs :: `render_notes` (cutoff = 0.0, resonance = 0.707)
- kind: explainer
- logged: v2.13.0 · 2026-10-07

Two keyword arguments with defaults that leave older callers' sound unchanged; the engine's /api/midi/render passes the patch's values (backend/HASHOUT_LOG.md, app/routers/midi.py).

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

### src/wasm.rs · fw_live_patch takes the filter
- refers-to: src/wasm.rs :: `fw_live_patch` (cutoff, resonance after gain)
- kind: explainer
- logged: v2.13.0 · 2026-10-07

The worklet's live-patch message passes the session's cutoff and resonance, so the Synth keys, Pads and a MIDI keyboard sound through the same filter the note clips render with. frontend/public/core/formwav_dsp.wasm is built at install (it is not tracked), so a checkout picks the new export up with its next install.

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

The first realtime track effects: RBJ Audio EQ Cookbook biquads (high-pass, low-pass, peak, low and high shelf), designed in f64 at the player's rate and run in f32, transposed direct form II, per channel. A track's chain runs on each of its clips before fades, gain and pan; the filters are linear and time-invariant, so filtering each clip and summing equals filtering the track, which leaves buses untouched (a nonlinear effect such as a compressor would need a true per-track stage). meter_tracks mixes every clip again for its meters, so each clip holds two copies of its chain, one advanced by the audio mix and one by the meter pass, each once a block; a shared state would have advanced twice. Seeks and loop wraps clear the filters' memory, as a fresh render would. Both bindings take the rate and stages; the Python render's new arguments have defaults, so existing callers are unchanged. The first high-pass unit test failed on its own measurement (sample peaks of an 8 kHz sine, 6 samples a cycle, read -0.56 dB through a flat filter); a throwaway probe measured the filter at -40.02 dB at 100 Hz as theory gives, and the tests now measure by RMS. Verified: cargo test (high-pass, peak, refusals) and the locked native, python and wasm32 builds pass; through the export render, a 1 kHz high-pass moved 100 Hz by -40.03 dB and 5 kHz by -0.01 dB, a bypassed stage rendered byte for byte as none, and a +6 dB peak at 1 kHz gave +6.00 dB.

### src/render.rs, src/wasm.rs, src/python.rs · a master filter chain (coverage wave 8)
- refers-to: src/render.rs :: `Player::master_fx`, `clear_master_fx`, `add_master_fx`, `reset_fx`, `render`; src/wasm.rs :: `fw_clear_master_fx`, `fw_add_master_fx`; src/python.rs :: `render` (`master_fx`)
- kind: explainer
- logged: v0.62.0 (in progress) · 2026-09-30

The master stack: a chain run on the summed mix, after the tracks and buses and before the master gain, so the meters and loudness see it. It runs inside the block loop on each span right after that span is mixed, so a loop wrap's reset falls exactly where a fresh render would start; seeks reset it too. As a single signal path it is also where a nonlinear stage can go later. The Python render's new argument defaults to empty. Verified through the export render: a 2 kHz master high-pass moved 100 Hz by -52.14 dB, 1 kHz by -12.38 dB (theory -12.3) and 5 kHz by -0.10 dB; a bypassed master stage rendered byte for byte as none; a track low-pass with a master peak combined as expected (-34.62 dB at 5 kHz, the low-pass's -40 plus the peak's 6).

### src/fx.rs, src/render.rs, src/wasm.rs, src/python.rs · a compressor; stage chains on buses and the master (coverage wave 8)
- refers-to: src/fx.rs :: `Compressor`, `Stage`, `COMPRESSOR`; src/render.rs :: `Player::bus_fx`, `master_fx` (stages), `add_master_stage`, `add_bus_stage`, `clear_buses`, `add_bus`, `mix_buses`, `reset_fx`; src/wasm.rs :: `fw_add_master_stage`, `fw_add_bus_stage`; src/python.rs :: `render` (`chains`)
- kind: rationale
- logged: v0.63.0 (in progress) · 2026-09-30

A compressor (feed-forward, stereo-linked, hard knee, gain reduction in dB smoothed with attack and release, makeup gain) cannot run per clip as the filters do, being nonlinear, so it runs where a signal is already summed: bus and master chains now hold stages (a filter or a compressor), run a stereo frame at a time on the bus's sum before its gain and pan, and on the mix before the master gain. The plan gives a track holding a compressor a bus of its own carrying its whole chain in order; filter-only tracks keep the per-clip path. Bus chains stay parallel to the buses and reset with them; the python render takes ordered `chains` (bus by add order, or master), defaulting to empty. Verified: cargo test (the static curve, -6 dBFS through -20 dB at 4:1 within 1 dB of -16.5; a quiet sine unchanged within 0.05 dB) and the locked builds; through the export render a track compressor gave -16.00 dBFS where the static curve gives -16.51 (0.5 dB, the peak detector easing between waveform peaks), a quiet tone through the track's own bus came out at -33.9794 dBFS with and without it (the bus adds nothing), the master compressor matched the track's, and the per-clip high-pass regression held at -40.03 dB.

### src/onsets.rs, src/python.rs · transient detection (coverage wave 10)
- refers-to: src/onsets.rs :: `detect`; src/python.rs :: `onsets`
- kind: warning-context
- logged: v0.64.0 (in progress) · 2026-09-30

Transient detection: the mono mix is first-differenced (attacks over sustained tones), cut into 256-sample frames whose energy is taken in dB; an onset is a local peak of the energy rise above both a threshold (18 dB at sensitivity 0 down to 4 dB at 1) and the local median, at least 50 ms from the last, placed on its frame's largest first-difference sample. Verified: cargo test (a five-click train found within 2 samples of each click; silence and a steady tone give none); through the engine, decaying noise bursts over a sustained 110 Hz tone at 0.30, 0.80, 1.55, 2.10 and 2.70 s were found within 0.5 to 2.4 ms, with no false onsets. Stated limit: 0.4 ms rectangular clicks buried in white noise were missed at sensitivity 0.5 (the noise's high frequencies dominate the first difference) and found at 0.85 (6 of 7) and 1.0 (all 7, exactly on time).

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

## formwav-dsp/src/fx.rs {#src-fx}

### src/fx.rs · Stage::latency names every stage that delays, and where that delay is cancelled
- refers-to: src/fx.rs :: `Stage::latency`; src/render.rs :: `mix_buses`, `mix_one`; backend app/services/render.py :: `plan`; frontend src/audio/player.ts :: `planClips`
- kind: warning-context
- logged: v2.12.5 (in progress) · 2026-10-06

Its doc comment said every stage but Voice runs without delay; DeClick (round(rate × 0.0035) + 4 samples, 172 at 48 kHz) and DeReverb (1023 samples) delay theirs too, and it now says so. The core cancels a chain's latency only on a bus, reading the bus's clips that far ahead (mix_buses, primed after a seek, a loop's wrap or a new stage). The de-click entry below calls it "compensated as Voice's is", but the planners that choose a stage's chain sent only a compressor, a reverb or the dialogue isolate to a track's own bus, so de-click and de-reverb on a track played and exported late by those amounts until v2.12.5 added them to that rule (the backend log's render entry; the measurements there). A clip's chain (mix_one) and the master chain have no read-ahead, so these stages there still play late: a read-ahead per clip chain would belong in mix_one with priming state per chain as the buses keep (bus_primed), and the master's would read the whole mix ahead.

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

---

## formwav-dsp/src/native.rs {#src-native}

### Native capture: every channel of an interface, through the engine
- refers-to: native/formwav-dsp/src/native.rs (NativeInput, input_devices, build_input); src/python.rs (NativeInput, native_input_devices); backend/app/routers/native_audio.py (/api/audio/inputs, /record/start, /record/levels, /record/stop); sidecar verification/native_capture
- kind: explainer
- logged: v2.10.8 (in progress) · 2026-10-06

The comparison's Multitrack recording row, past two inputs. A browser takes at most two channels of one interface (measured, and sourced, at the previous entry in the interface's log), so capture of more goes through the engine: NativeInput opens an interface through cpal on its own thread, as the native output does, with the most channels it offers at the rate or the count asked (as an I/O set-up names an interface's width), a 1024-frame buffer within the device's range (a device's default can reach for the top of a very wide range), and float or integer samples converted to float. Its callback takes the lock rather than trying it, unlike the output's: a missed render is silence, a missed capture would be a hole in the take. The engine drains the take every quarter second into a file per track holding that track's channels, so a long take with many channels never sits whole in memory, and on stop each becomes a float WAV in the media store with the take's start on the engine's clock. Checked against a virtual eight-channel ALSA interface fed through a pipe at real-time pace with a tone per channel and a click on every channel each half second: the interface listed, opened at eight channels, levels of 0.2 on every channel mid-take (the tones' level), eight takes of one channel each at the same length, each its own channel's tone, and the clicks on identical frames in all eight. Not yet measured: that virtual interface is not clocked (ALSA's null plugin under it runs about 2.1 times real time and pads silence), so level and frequency fidelity in real time wait for a clocked interface; the harness is kept in the sidecar. The recorder choosing native capture for such an interface, and placing its takes, comes next.

---

## formwav-dsp/tests/stages.rs {#tests-stages}

### tests/stages.rs · the live effect kinds held to the interface's catalogue
- refers-to: tests/stages.rs :: CATALOGUE, and every test in the file
- kind: rationale
- logged: v2.12.5 · 2026-10-06

PLAN_v11's 4.1, written on the owner's explicit ask (2026-10-06: "Write the tests now", answering whether the tests dev-rules bans unasked should be written). Each of the 19 live kinds is held to what the interface promises in frontend/src/ui/editor-tabs.ts (label, one-line promise, parameter ranges and defaults), through the crate's public Stage API only, so the tests read the promise and not the implementation. Over every kind: designs at 44.1, 48 and 96 kHz; stays finite and under 1000 at every corner of its ranges against a hostile signal (full-scale noise, DC, ±4 impulses, a +12 dB tone); silence stays silent; reset leaves no tail; the latency it reports is where its output correlates best with its input; and the settings the catalogue makes neutral (mix 0, depth 0, ratio 1, 0 dB, strength 0) give the input back with the residual under -60 dB. The catalogue's two numbers hold: De-reverb 21 ms and De-click 3.5 ms behind at 48 kHz. Per kind, the untested ones: the low-pass and both shelves, echo repeats at the delay each the feedback times the last, the limiter never past its ceiling by 0.1 dB (a +12 dB tone and noise, two ceilings) and leaving audio under it untouched, the gate reaching its range in a long gap while keeping what is above the threshold and closing faster at a shorter release, tremolo dipping 8 times in 2 s at 4 Hz and steady at depth 0, chorus and flanger moving a steady tone by more than 6 dB, the phaser's notch passing over at least two of four tones, and dialogue isolate equal to RNNoise (nnnoiseless) called directly to within 1e-5 once aligned by a frame, taking room-like noise down more than 10 dB and leaving it at strength 0.

Two first runs failed, and neither failure was a fault in the DSP: dialogue isolate took full-band white noise down only 1.1 dB, which a probe showed is RNNoise's own behaviour on that signal (the stage matched nnnoiseless called directly to 0.1 dB; low-passed noise came down 35 to 41 dB), so the test uses room-like noise and checks the stage against RNNoise itself; and the gate's gap measured 23 dB down 0.2 to 0.5 s after the sound stopped, because its release is the time constant of a gain smoothed in linear terms, so a -60 dB range is reached about seven releases later (about 0.7 s at 100 ms; 17 dB down at 0.2 s). The catalogue does not say which a release means, so the test holds what it does say; whether a release should instead move the gain in decibels and reach the range in one release time is the owner's call, reported. rustfmt is not enforced: the crate has never been formatted with it (245 places would change, this file's 25 among them), and running it over the crate is the kind of scripted rewrite dev-rules' SEDO law forbids. Clippy's 18 warnings in the library predate this file, which has none.
