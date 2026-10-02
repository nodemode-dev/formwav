use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::PyBytes;

use crate::peaks::peak_pyramid;
use crate::render::{PlayClip, Player};
use crate::wav::{decode_wav, probe_wav};

const RENDER_BLOCK: usize = 128;

type RenderClip = (u32, u64, u64, u64, f32, f32, u64, u64, u8, u32, u32, u32);

#[pyfunction]
#[pyo3(signature = (sources, clips, frames, buses, envelopes, master_db, rate = 48000.0, fx = Vec::new(), master_fx = Vec::new(), chains = Vec::new()))]
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
) -> PyResult<(Bound<'py, PyBytes>, f32, f32)> {
    let mut player = Player::new();
    player.set_master_db(master_db);
    player.set_rate(rate);
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
        for &(_, kind, freq, gain_db, q) in fx.iter().filter(|f| f.0 == index) {
            player.add_clip_fx(kind, freq, gain_db, q);
        }
    }
    for (index, (id, gain, pan)) in buses.into_iter().enumerate() {
        player.add_bus(crate::render::Bus { id, gain, pan });
        for &(_, _, kind, a, b, c, d, e) in chains.iter().filter(|s| s.0 == 1 && s.1 == index) {
            player.add_bus_stage(kind, a, b, c, d, e);
        }
    }
    for &(_, _, kind, a, b, c, d, e) in chains.iter().filter(|s| s.0 == 2) {
        player.add_master_stage(kind, a, b, c, d, e);
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
/// `rate` with the given patch; returns mono 32-bit float samples, the release included.
#[pyfunction]
#[pyo3(signature = (notes, rate = 48000, wave = "triangle", attack = 0.005, decay = 0.15, sustain = 0.7, release = 0.2, gain = 0.25))]
#[allow(clippy::too_many_arguments)]
fn render_notes<'py>(py: Python<'py>, notes: Vec<(u64, u64, u8, u8)>, rate: u32, wave: &str, attack: f32, decay: f32, sustain: f32, release: f32, gain: f32) -> PyResult<Bound<'py, PyBytes>> {
    let wave = crate::synth::Wave::parse(wave).ok_or_else(|| PyValueError::new_err(format!("no waveform named {wave}")))?;
    let patch = crate::synth::Patch { wave, attack, decay, sustain, release, gain };
    let notes: Vec<crate::synth::Note> = notes.into_iter().map(|(start, length, pitch, velocity)| crate::synth::Note { start, length, pitch, velocity }).collect();
    let samples = crate::synth::render(&notes, rate, &patch);
    let bytes: Vec<u8> = samples.iter().flat_map(|s| s.to_le_bytes()).collect();
    Ok(PyBytes::new(py, &bytes))
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

#[pymodule]
fn formwav_dsp(m: &Bound<'_, PyModule>) -> PyResult<()> {
    #[cfg(feature = "native")]
    m.add_class::<PyNativeOutput>()?;
    m.add_function(wrap_pyfunction!(probe, m)?)?;
    m.add_function(wrap_pyfunction!(render_notes, m)?)?;
    m.add_function(wrap_pyfunction!(peaks, m)?)?;
    m.add_function(wrap_pyfunction!(render, m)?)?;
    m.add_function(wrap_pyfunction!(loudness, m)?)?;
    m.add_function(wrap_pyfunction!(onsets, m)?)?;
    m.add("__version__", crate::CRATE_VERSION)?;
    Ok(())
}
