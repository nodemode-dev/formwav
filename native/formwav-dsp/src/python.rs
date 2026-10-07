use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::PyBytes;

use crate::peaks::peak_pyramid;
use crate::render::{PlayClip, Player};
use crate::wav::{decode_wav, probe_wav};

const RENDER_BLOCK: usize = 128;

type RenderClip = (u32, u64, u64, u64, f32, f32, u64, u64, u8, u32, u32, u32);

#[pyfunction]
#[pyo3(signature = (sources, clips, frames, buses, envelopes, master_db, rate = 48000.0, fx = Vec::new(), master_fx = Vec::new(), chains = Vec::new(), fx_auto = Vec::new(), comps = Vec::new(), places = Vec::new(), fold = false, surround_format = 0, processors = Vec::new(), bus_auto = Vec::new(), pan_law = 0))]
#[allow(clippy::too_many_arguments)]
fn render<'py>(
    py: Python<'py>,
    sources: Vec<(u32, Bound<'py, PyBytes>)>,
    clips: Vec<RenderClip>,
    frames: usize,
    buses: Vec<(u32, f32, f32)>,
    envelopes: Vec<(Vec<(u64, f64)>, bool)>,
    master_db: f64,
    rate: f32,
    fx: Vec<(usize, u8, f32, f32, f32)>,
    master_fx: Vec<(u8, f32, f32, f32)>,
    chains: Vec<(u8, usize, u8, f32, f32, f32, f32, f32)>,
    fx_auto: Vec<(usize, usize, u8, u32)>,
    comps: Vec<(usize, usize, f32, f32, f32, f32, f32)>,
    places: Vec<(usize, [f32; 6])>,
    fold: bool,
    surround_format: u8,
    processors: Vec<String>,
    bus_auto: Vec<(usize, usize, u8, u32)>,
    pan_law: u8,
) -> PyResult<(Bound<'py, PyBytes>, f32, f32)> {
    let spec = |a: f32| processors.get(a as usize).map(String::as_str).unwrap_or("");
    let n_clips = clips.len();
    let mut player = Player::new();
    player.set_master_db(master_db);
    player.set_rate(rate);
    player.set_pan_law(pan_law);
    for &(kind, freq, gain_db, q) in &master_fx {
        player.add_master_fx(kind, freq, gain_db, q);
    }
    for (id, bytes) in &sources {
        let buf = decode_wav(bytes.as_bytes()).map_err(|e| PyValueError::new_err(e.to_string()))?;
        player.load_source(*id, buf);
    }
    for (points, db) in &envelopes {
        player.add_envelope(points, *db);
    }
    for (index, (source, start, source_in, length, gain, pan, fade_in, fade_out, fade_shape, bus, gain_env, pan_env)) in clips.into_iter().enumerate() {
        player.add_clip(PlayClip { source, start, source_in, length, gain, pan, fade_in, fade_out, fade_shape, bus, track: 0, gain_env, pan_env });
        // PT-33: the clip's own compressor, if any, after `at` of its filters (its own EQ, ahead of its track's)
        let comp = comps.iter().find(|c| c.0 == index);
        let mut added = 0usize;
        for &(_, kind, freq, gain_db, q) in fx.iter().filter(|f| f.0 == index) {
            if let Some(&(_, at, t, r, a, rel, m)) = comp {
                if added == at {
                    player.add_clip_comp(t, r, a, rel, m);
                }
            }
            player.add_clip_fx(kind, freq, gain_db, q);
            added += 1;
        }
        if let Some(&(_, at, t, r, a, rel, m)) = comp {
            if at >= added {
                player.add_clip_comp(t, r, a, rel, m);
            }
        }
        for &(_, stage, param, envelope) in fx_auto.iter().filter(|a| a.0 == index) {
            player.add_clip_fx_auto(stage, param, envelope);
        }
    }
    for (index, (id, gain, pan)) in buses.into_iter().enumerate() {
        player.add_bus(crate::render::Bus { id, gain, pan });
        for &(_, _, kind, a, b, c, d, e) in chains.iter().filter(|s| s.0 == 1 && s.1 == index) {
            if kind == crate::fx::PROCESSOR {
                player.add_bus_processor(spec(a));
            } else {
                player.add_bus_stage(kind, a, b, c, d, e);
            }
        }
        for &(_, stage, param, envelope) in bus_auto.iter().filter(|x| x.0 == index) {
            player.add_bus_fx_auto(stage, param, envelope);
        }
    }
    for &(_, _, kind, a, b, c, d, e) in chains.iter().filter(|s| s.0 == 2) {
        if kind == crate::fx::PROCESSOR {
            player.add_master_processor(spec(a));
        } else {
            player.add_master_stage(kind, a, b, c, d, e);
        }
    }
    if !places.is_empty() {
        // PT-38, AA-11: a 5.1 mix through the six-channel master bus, its channels interleaved in SMPTE order (L R C
        // LFE Ls Rs); the two peaks returned are L's and R's, the engine reading all six from the samples
        let mut per_clip: Vec<Option<[f32; 6]>> = vec![None; n_clips];
        for &(index, gains) in &places {
            if index < n_clips {
                per_clip[index] = Some(gains);
            }
        }
        player.set_surround_format(surround_format);
        player.set_places(&per_clip);
        if fold {
            // the stereo mix heard as the 5.1 bus folded to stereo, as playback hears it: the stereo render below folds
            player.set_fold_51(true);
        }
    }
    if !places.is_empty() && !fold {
        let mut chans: Vec<Vec<f32>> = (0..6).map(|_| vec![0.0f32; frames]).collect();
        let mut at = 0;
        while at < frames {
            let end = (at + RENDER_BLOCK).min(frames);
            let [c0, c1, c2, c3, c4, c5] = &mut chans[..] else { unreachable!() };
            let mut block: [&mut [f32]; 6] = [&mut c0[at..end], &mut c1[at..end], &mut c2[at..end], &mut c3[at..end], &mut c4[at..end], &mut c5[at..end]];
            player.render_surround(&mut block);
            at = end;
        }
        let peaks = player.take_peaks_51();
        let mut interleaved = Vec::with_capacity(frames * 24);
        for i in 0..frames {
            for c in &chans {
                interleaved.extend_from_slice(&c[i].to_le_bytes());
            }
        }
        return Ok((PyBytes::new(py, &interleaved), peaks[0], peaks[1]));
    }
    let mut left = vec![0.0f32; frames];
    let mut right = vec![0.0f32; frames];
    for (l, r) in left.chunks_mut(RENDER_BLOCK).zip(right.chunks_mut(RENDER_BLOCK)) {
        player.render(l, r);
    }
    let (peak_left, peak_right) = player.take_peaks();
    let mut interleaved = Vec::with_capacity(frames * 8);
    for i in 0..frames {
        interleaved.extend_from_slice(&left[i].to_le_bytes());
        interleaved.extend_from_slice(&right[i].to_le_bytes());
    }
    Ok((PyBytes::new(py, &interleaved), peak_left, peak_right))
}

type LevelTuple<'py> = (u32, u16, usize, Bound<'py, PyBytes>);

#[pyfunction]
fn probe(data: &[u8]) -> PyResult<(u32, u16, u64, &'static str)> {
    let info = probe_wav(data).map_err(|e| PyValueError::new_err(e.to_string()))?;
    Ok((info.sample_rate, info.channels, info.frames, info.format.name()))
}

#[pyfunction]
#[pyo3(signature = (data, base = 256, factor = 4, min_blocks = 64))]
fn peaks<'py>(py: Python<'py>, data: &[u8], base: u32, factor: u32, min_blocks: usize) -> PyResult<Vec<LevelTuple<'py>>> {
    let buf = decode_wav(data).map_err(|e| PyValueError::new_err(e.to_string()))?;
    let levels = peak_pyramid(&buf, base, factor, min_blocks);
    Ok(levels
        .into_iter()
        .map(|level| {
            let mut bytes = Vec::with_capacity(level.data.len() * 4);
            for v in &level.data {
                bytes.extend_from_slice(&v.to_le_bytes());
            }
            (level.samples_per_peak, level.channels, level.blocks, PyBytes::new(py, &bytes))
        })
        .collect())
}

#[pyfunction]
fn loudness(interleaved: &[u8], channels: usize, rate: u32) -> PyResult<Option<f64>> {
    if channels == 0 || interleaved.len() % (4 * channels) != 0 {
        return Err(PyValueError::new_err("the sample data does not divide into whole frames"));
    }
    let frames = interleaved.len() / (4 * channels);
    let mut planar = vec![Vec::with_capacity(frames); channels];
    for (i, s) in interleaved.chunks_exact(4).enumerate() {
        planar[i % channels].push(f32::from_le_bytes([s[0], s[1], s[2], s[3]]));
    }
    Ok(crate::loudness::integrated_loudness(&planar, rate))
}

/// Transient positions (samples) in a WAV file's mono mix, with its rate (onsets.rs).
#[pyfunction]
#[pyo3(signature = (data, sensitivity = 0.5))]
fn onsets(data: &[u8], sensitivity: f32) -> PyResult<(u32, Vec<u64>)> {
    let buf = decode_wav(data).map_err(|e| PyValueError::new_err(e.to_string()))?;
    let n = buf.channels.iter().map(|c| c.len()).min().unwrap_or(0);
    let count = buf.channels.len().max(1) as f32;
    let mono: Vec<f32> = (0..n).map(|i| buf.channels.iter().map(|c| c[i]).sum::<f32>() / count).collect();
    Ok((buf.sample_rate, crate::onsets::detect(&mono, buf.sample_rate, sensitivity)))
}

/// The built-in instrument (crate::synth): notes as (start frame, held frames, MIDI pitch, velocity) rendered at
/// `rate` with the given patch (a cutoff of 0 leaves it unfiltered); returns mono 32-bit float samples, the release
/// included.
#[pyfunction]
#[pyo3(signature = (notes, rate = 48000, wave = "triangle", attack = 0.005, decay = 0.15, sustain = 0.7, release = 0.2, gain = 0.25, cutoff = 0.0, resonance = 0.707))]
#[allow(clippy::too_many_arguments)]
fn render_notes<'py>(py: Python<'py>, notes: Vec<(u64, u64, u8, u8)>, rate: u32, wave: &str, attack: f32, decay: f32, sustain: f32, release: f32, gain: f32, cutoff: f32, resonance: f32) -> PyResult<Bound<'py, PyBytes>> {
    let wave = crate::synth::Wave::parse(wave).ok_or_else(|| PyValueError::new_err(format!("no waveform named {wave}")))?;
    let patch = crate::synth::Patch { wave, attack, decay, sustain, release, gain, cutoff, resonance };
    let notes: Vec<crate::synth::Note> = notes.into_iter().map(|(start, length, pitch, velocity)| crate::synth::Note { start, length, pitch, velocity }).collect();
    let samples = crate::synth::render(&notes, rate, &patch);
    let bytes: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
    Ok(PyBytes::new(py, &bytes))
}

/// PT-15: notes played by the sampler: `sample` as little-endian f32 (mono) at `sample_rate`, re-pitched from `root`.
#[pyfunction]
#[pyo3(signature = (notes, rate, sample, sample_rate, root = 60, attack = 0.002, decay = 0.0, sustain = 1.0, release = 0.1, gain = 1.0))]
#[allow(clippy::too_many_arguments)]
fn render_sampled<'py>(py: Python<'py>, notes: Vec<(u64, u64, u8, u8)>, rate: u32, sample: &[u8], sample_rate: u32, root: u8, attack: f32, decay: f32, sustain: f32, release: f32, gain: f32) -> PyResult<Bound<'py, PyBytes>> {
    let sample: Vec<f32> = sample.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
    let patch = crate::synth::Patch { wave: crate::synth::Wave::Sine, attack, decay, sustain, release, gain, ..Default::default() };
    let notes: Vec<crate::synth::Note> = notes.into_iter().map(|(start, length, pitch, velocity)| crate::synth::Note { start, length, pitch, velocity }).collect();
    let samples = crate::synth::render_sampled(&notes, rate, &patch, &sample, sample_rate, root);
    let bytes: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
    Ok(PyBytes::new(py, &bytes))
}

/// Native capture for the engine (crate::native::NativeInput): every channel of an interface, which a browser cannot
/// give past two. stop() hands the take back as little-endian float bytes, interleaved over the device's channels.
#[cfg(feature = "native")]
#[pyclass(name = "NativeInput")]
struct PyNativeInput {
    inner: Option<crate::native::NativeInput>,
}

#[cfg(feature = "native")]
impl PyNativeInput {
    fn input(&self) -> PyResult<&crate::native::NativeInput> {
        self.inner.as_ref().ok_or_else(|| PyValueError::new_err("the input is closed"))
    }
}

#[cfg(feature = "native")]
#[pymethods]
impl PyNativeInput {
    #[new]
    #[pyo3(signature = (rate, device=None, channels=None))]
    fn new(rate: u32, device: Option<String>, channels: Option<u16>) -> PyResult<Self> {
        let input = crate::native::NativeInput::open(device, rate, channels).map_err(PyValueError::new_err)?;
        Ok(Self { inner: Some(input) })
    }

    #[getter]
    fn device(&self) -> PyResult<String> {
        Ok(self.input()?.name.clone())
    }

    #[getter]
    fn rate(&self) -> PyResult<u32> {
        Ok(self.input()?.rate)
    }

    #[getter]
    fn channels(&self) -> PyResult<usize> {
        Ok(self.input()?.channels)
    }

    fn start(&self) -> PyResult<()> {
        self.input()?.start();
        Ok(())
    }

    fn stop<'py>(&self, py: Python<'py>) -> PyResult<Bound<'py, PyBytes>> {
        let frames = self.input()?.stop();
        let mut bytes = Vec::with_capacity(frames.len() * 4);
        for x in frames {
            bytes.extend_from_slice(&x.to_le_bytes());
        }
        Ok(PyBytes::new(py, &bytes))
    }

    /// The take so far (little-endian floats, interleaved), handed over while recording goes on.
    fn drain<'py>(&self, py: Python<'py>) -> PyResult<Bound<'py, PyBytes>> {
        let frames = self.input()?.drain();
        let mut bytes = Vec::with_capacity(frames.len() * 4);
        for x in frames {
            bytes.extend_from_slice(&x.to_le_bytes());
        }
        Ok(PyBytes::new(py, &bytes))
    }

    fn peaks(&self) -> PyResult<Vec<f32>> {
        Ok(self.input()?.peaks())
    }

    fn close(&mut self) {
        if let Some(mut input) = self.inner.take() {
            input.close();
        }
    }
}

/// The input devices (name, most channels) native capture can open.
#[cfg(feature = "native")]
#[pyfunction]
fn native_input_devices() -> Vec<(String, u16)> {
    crate::native::input_devices()
}

/// Native audio output for the engine (crate::native): the Player on a device's stream, driven by the worklet's
/// messages; sources load straight from WAV bytes (the engine's media files).
#[cfg(feature = "native")]
#[pyclass(name = "NativeOutput")]
struct PyNativeOutput {
    inner: Option<crate::native::NativeOutput>,
}

#[cfg(feature = "native")]
impl PyNativeOutput {
    fn out(&self) -> PyResult<&crate::native::NativeOutput> {
        self.inner.as_ref().ok_or_else(|| PyValueError::new_err("the native output is closed"))
    }
}

#[cfg(feature = "native")]
#[pymethods]
impl PyNativeOutput {
    #[new]
    #[pyo3(signature = (rate, device=None))]
    fn new(rate: u32, device: Option<String>) -> PyResult<Self> {
        let out = crate::native::NativeOutput::open(device, rate).map_err(PyValueError::new_err)?;
        Ok(Self { inner: Some(out) })
    }

    #[getter]
    fn device(&self) -> PyResult<String> {
        Ok(self.out()?.device.clone())
    }

    #[getter]
    fn rate(&self) -> PyResult<u32> {
        Ok(self.out()?.rate)
    }

    fn load_wav(&self, id: u32, data: &[u8]) -> PyResult<()> {
        let buf = decode_wav(data).map_err(|e| PyValueError::new_err(e.to_string()))?;
        self.out()?.load_source(id, buf.sample_rate, buf.channels);
        Ok(())
    }

    fn set_mix(&self, json: &str) -> PyResult<()> {
        self.out()?.set_mix(json).map_err(PyValueError::new_err)
    }

    fn seek(&self, position: u64) -> PyResult<()> {
        self.out()?.seek(position);
        Ok(())
    }

    fn set_loop(&self, start: u64, end: u64) -> PyResult<()> {
        self.out()?.set_loop(start, end);
        Ok(())
    }

    fn play(&self) -> PyResult<()> {
        self.out()?.play();
        Ok(())
    }

    fn stop(&self) -> PyResult<()> {
        self.out()?.stop();
        Ok(())
    }

    fn report(&self) -> PyResult<String> {
        Ok(self.out()?.report())
    }

    fn close(&mut self) {
        self.inner = None;
    }

    #[staticmethod]
    fn devices() -> Vec<String> {
        crate::native::devices()
    }
}

/// AU-37: a MIDI input device read by the engine (crate::midi): MidiInput(name) opens it, poll() drains what arrived
/// (midir's timestamp in microseconds and the message's bytes), close() lets it go; MidiInput.inputs() lists devices.
#[cfg(feature = "native")]
#[pyclass(name = "MidiInput")]
struct PyMidiInput {
    inner: Option<crate::midi::MidiListener>,
}

#[cfg(feature = "native")]
#[pymethods]
impl PyMidiInput {
    #[new]
    fn new(name: &str) -> PyResult<Self> {
        crate::midi::MidiListener::open(name).map(|l| PyMidiInput { inner: Some(l) }).map_err(pyo3::exceptions::PyRuntimeError::new_err)
    }

    fn poll(&self) -> Vec<(u64, Vec<u8>)> {
        self.inner.as_ref().map(|l| l.drain()).unwrap_or_default()
    }

    fn close(&mut self) {
        self.inner = None;
    }

    #[staticmethod]
    fn inputs() -> PyResult<Vec<String>> {
        crate::midi::inputs().map_err(pyo3::exceptions::PyRuntimeError::new_err)
    }
}

#[pyfunction]
fn processors() -> String {
    crate::fx::processors_json()
}

#[pymodule]
fn formwav_dsp(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(processors, m)?)?;
    #[cfg(feature = "native")]
    m.add_class::<PyNativeOutput>()?;
    #[cfg(feature = "native")]
    m.add_class::<PyNativeInput>()?;
    #[cfg(feature = "native")]
    m.add_function(wrap_pyfunction!(native_input_devices, m)?)?;
    #[cfg(feature = "native")]
    m.add_class::<PyMidiInput>()?;
    m.add_function(wrap_pyfunction!(probe, m)?)?;
    m.add_function(wrap_pyfunction!(render_notes, m)?)?;
    m.add_function(wrap_pyfunction!(render_sampled, m)?)?;
    m.add_function(wrap_pyfunction!(peaks, m)?)?;
    m.add_function(wrap_pyfunction!(render, m)?)?;
    m.add_function(wrap_pyfunction!(loudness, m)?)?;
    m.add_function(wrap_pyfunction!(onsets, m)?)?;
    m.add("__version__", crate::CRATE_VERSION)?;
    Ok(())
}
