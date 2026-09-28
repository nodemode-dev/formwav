use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::PyBytes;

use crate::peaks::peak_pyramid;
use crate::render::{PlayClip, Player};
use crate::wav::{decode_wav, probe_wav};

const RENDER_BLOCK: usize = 128;

type RenderClip = (u32, u64, u64, u64, f32, f32);

#[pyfunction]
fn render<'py>(py: Python<'py>, sources: Vec<(u32, Bound<'py, PyBytes>)>, clips: Vec<RenderClip>, frames: usize) -> PyResult<(Bound<'py, PyBytes>, f32, f32)> {
    let mut player = Player::new();
    for (id, bytes) in &sources {
        let buf = decode_wav(bytes.as_bytes()).map_err(|e| PyValueError::new_err(e.to_string()))?;
        player.load_source(*id, buf);
    }
    for (source, start, source_in, length, gain, pan) in clips {
        player.add_clip(PlayClip { source, start, source_in, length, gain, pan });
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

#[pymodule]
fn formwav_dsp(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(probe, m)?)?;
    m.add_function(wrap_pyfunction!(peaks, m)?)?;
    m.add_function(wrap_pyfunction!(render, m)?)?;
    m.add("__version__", crate::CRATE_VERSION)?;
    Ok(())
}
