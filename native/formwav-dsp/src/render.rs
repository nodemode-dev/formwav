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
        let from = self.position;
        let to = from + n as u64;
        for clip in &self.clips {
            let Some(src) = self.sources.get(&clip.source) else { continue };
            let Some(l) = src.channels.first() else { continue };
            let r = src.channels.get(1).unwrap_or(l);
            let a = from.max(clip.start);
            let b = to.min(clip.start + clip.length);
            let (pan_left, pan_right) = pan_gains(clip.pan);
            let gain_left = clip.gain * pan_left;
            let gain_right = clip.gain * pan_right;
            for t in a..b {
                let s = (clip.source_in + (t - clip.start)) as usize;
                if s >= l.len() {
                    break;
                }
                let i = (t - from) as usize;
                left[i] += l[s] * gain_left;
                right[i] += r[s] * gain_right;
            }
        }
        for i in 0..n {
            self.peak_left = self.peak_left.max(left[i].abs());
            self.peak_right = self.peak_right.max(right[i].abs());
        }
        self.position = to;
    }

    pub fn take_peaks(&mut self) -> (f32, f32) {
        let peaks = (self.peak_left, self.peak_right);
        self.peak_left = 0.0;
        self.peak_right = 0.0;
        peaks
    }
}
