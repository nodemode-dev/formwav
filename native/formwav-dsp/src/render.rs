use std::collections::HashMap;

use crate::wav::AudioBuffer;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PlayClip {
    pub source: u32,
    pub start: u64,
    pub source_in: u64,
    pub length: u64,
    pub gain: f32,
    pub pan: f32,
    pub fade_in: u64,
    pub fade_out: u64,
    pub fade_shape: u8,
    pub bus: u32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Bus {
    pub id: u32,
    pub gain: f32,
    pub pan: f32,
}

pub const FADE_LINEAR: u8 = 0;
pub const FADE_EQUAL_POWER: u8 = 1;
pub const FADE_S_CURVE: u8 = 2;
pub const FADE_EXPONENTIAL: u8 = 3;

/// Gain of a fade at position `x` (0 at the silent end, 1 at full level).
/// Shape codes: 0 linear, 1 equal-power (sine), 2 S-curve (raised cosine), 3 exponential (square); unknown codes are linear.
pub fn fade_curve(x: f32, shape: u8) -> f32 {
    let x = x.clamp(0.0, 1.0);
    match shape {
        FADE_EQUAL_POWER => (x * std::f32::consts::FRAC_PI_2).sin(),
        FADE_S_CURVE => 0.5 - 0.5 * (x * std::f32::consts::PI).cos(),
        FADE_EXPONENTIAL => x * x,
        _ => x,
    }
}

pub fn pan_gains(pan: f32) -> (f32, f32) {
    let p = pan.clamp(-1.0, 1.0);
    let far = |amount: f32| if amount >= 1.0 { 0.0 } else { (amount * std::f32::consts::FRAC_PI_2).cos() };
    let left = if p > 0.0 { far(p) } else { 1.0 };
    let right = if p < 0.0 { far(-p) } else { 1.0 };
    (left, right)
}

#[derive(Debug, Default)]
pub struct Player {
    sources: HashMap<u32, AudioBuffer>,
    clips: Vec<PlayClip>,
    position: u64,
    peak_left: f32,
    peak_right: f32,
    loop_range: Option<(u64, u64)>,
    buses: Vec<Bus>,
    scratch_left: Vec<f32>,
    scratch_right: Vec<f32>,
}

impl Player {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn load_source(&mut self, id: u32, buf: AudioBuffer) {
        self.sources.insert(id, buf);
    }

    pub fn clear_clips(&mut self) {
        self.clips.clear();
    }

    pub fn add_clip(&mut self, clip: PlayClip) {
        self.clips.push(clip);
    }

    pub fn seek(&mut self, position: u64) {
        self.position = position;
    }

    pub fn position(&self) -> u64 {
        self.position
    }

    pub fn render(&mut self, left: &mut [f32], right: &mut [f32]) {
        let n = left.len().min(right.len());
        left[..n].fill(0.0);
        right[..n].fill(0.0);
        let mut done = 0;
        while done < n {
            let from = self.position;
            let mut span = (n - done) as u64;
            if let Some((_, end)) = self.loop_range {
                if from < end {
                    span = span.min(end - from);
                }
            }
            let len = span as usize;
            self.mix(&mut left[done..done + len], &mut right[done..done + len], from, 0);
            self.mix_buses(&mut left[done..done + len], &mut right[done..done + len], from);
            done += len;
            self.position = from + span;
            if let Some((start, end)) = self.loop_range {
                if self.position == end {
                    self.position = start;
                }
            }
        }
        for i in 0..n {
            self.peak_left = self.peak_left.max(left[i].abs());
            self.peak_right = self.peak_right.max(right[i].abs());
        }
    }

    pub fn set_loop(&mut self, start: u64, end: u64) {
        self.loop_range = if end > start { Some((start, end)) } else { None };
    }

    pub fn clear_buses(&mut self) {
        self.buses.clear();
    }

    pub fn add_bus(&mut self, bus: Bus) {
        self.buses.push(bus);
    }

    fn mix_buses(&mut self, left: &mut [f32], right: &mut [f32], from: u64) {
        if self.buses.is_empty() {
            return;
        }
        let n = left.len().min(right.len());
        let mut scratch_left = std::mem::take(&mut self.scratch_left);
        let mut scratch_right = std::mem::take(&mut self.scratch_right);
        if scratch_left.len() < n {
            scratch_left.resize(n, 0.0);
            scratch_right.resize(n, 0.0);
        }
        for bus in &self.buses {
            scratch_left[..n].fill(0.0);
            scratch_right[..n].fill(0.0);
            self.mix(&mut scratch_left[..n], &mut scratch_right[..n], from, bus.id);
            let (pan_left, pan_right) = pan_gains(bus.pan);
            let gain_left = bus.gain * pan_left;
            let gain_right = bus.gain * pan_right;
            for i in 0..n {
                left[i] += scratch_left[i] * gain_left;
                right[i] += scratch_right[i] * gain_right;
            }
        }
        self.scratch_left = scratch_left;
        self.scratch_right = scratch_right;
    }

    fn mix(&self, left: &mut [f32], right: &mut [f32], from: u64, bus: u32) {
        let n = left.len().min(right.len());
        let to = from + n as u64;
        for clip in &self.clips {
            if clip.bus != bus {
                continue;
            }
            let Some(src) = self.sources.get(&clip.source) else { continue };
            let Some(l) = src.channels.first() else { continue };
            let r = src.channels.get(1).unwrap_or(l);
            let a = from.max(clip.start);
            let b = to.min(clip.start + clip.length);
            let (pan_left, pan_right) = pan_gains(clip.pan);
            let gain_left = clip.gain * pan_left;
            let gain_right = clip.gain * pan_right;
            let fade_in = clip.fade_in.min(clip.length);
            let fade_out = clip.fade_out.min(clip.length - fade_in);
            for t in a..b {
                let k = t - clip.start;
                let s = (clip.source_in + k) as usize;
                if s >= l.len() {
                    break;
                }
                let mut fade = 1.0f32;
                if k < fade_in {
                    fade *= fade_curve(k as f32 / fade_in as f32, clip.fade_shape);
                }
                if k >= clip.length - fade_out {
                    fade *= fade_curve((clip.length - k) as f32 / fade_out as f32, clip.fade_shape);
                }
                let i = (t - from) as usize;
                left[i] += l[s] * gain_left * fade;
                right[i] += r[s] * gain_right * fade;
            }
        }
    }

    pub fn take_peaks(&mut self) -> (f32, f32) {
        let peaks = (self.peak_left, self.peak_right);
        self.peak_left = 0.0;
        self.peak_right = 0.0;
        peaks
    }
}
