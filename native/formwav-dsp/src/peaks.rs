use crate::wav::AudioBuffer;

#[derive(Debug, Clone, PartialEq)]
pub struct PeakLevel {
    pub samples_per_peak: u32,
    pub channels: u16,
    pub blocks: usize,
    pub data: Vec<f32>,
}

pub fn peak_pyramid(buf: &AudioBuffer, base: u32, factor: u32, min_blocks: usize) -> Vec<PeakLevel> {
    let base = base.max(1) as usize;
    let factor = factor.max(2) as usize;
    let ch = buf.channels.len();
    let frames = buf.frames();
    if ch == 0 || frames == 0 {
        return Vec::new();
    }
    let stride = ch * 2;
    let blocks = frames.div_ceil(base);
    let mut data = Vec::with_capacity(blocks * stride);
    for b in 0..blocks {
        let start = b * base;
        let end = (start + base).min(frames);
        for channel in &buf.channels {
            let (lo, hi) = channel[start..end]
                .iter()
                .fold((f32::INFINITY, f32::NEG_INFINITY), |(lo, hi), &v| (lo.min(v), hi.max(v)));
            data.push(lo);
            data.push(hi);
        }
    }
    let mut levels = vec![PeakLevel { samples_per_peak: base as u32, channels: ch as u16, blocks, data }];
    let floor = min_blocks.max(1);
    loop {
        let next = match levels.last() {
            Some(prev) if prev.blocks > floor => {
                let blocks = prev.blocks.div_ceil(factor);
                let mut data = Vec::with_capacity(blocks * stride);
                for b in 0..blocks {
                    let s = b * factor;
                    let e = (s + factor).min(prev.blocks);
                    for c in 0..ch {
                        let mut lo = f32::INFINITY;
                        let mut hi = f32::NEG_INFINITY;
                        for k in s..e {
                            lo = lo.min(prev.data[k * stride + c * 2]);
                            hi = hi.max(prev.data[k * stride + c * 2 + 1]);
                        }
                        data.push(lo);
                        data.push(hi);
                    }
                }
                PeakLevel {
                    samples_per_peak: prev.samples_per_peak.saturating_mul(factor as u32),
                    channels: ch as u16,
                    blocks,
                    data,
                }
            }
            _ => break,
        };
        levels.push(next);
    }
    levels
}
