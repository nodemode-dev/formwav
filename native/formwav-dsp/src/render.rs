use std::collections::HashMap;

use crate::wav::AudioBuffer;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PlayClip {
    pub source: u32,
    pub start: u64,
    pub source_in: u64,
    pub length: u64,
    pub gain: f32,
}

#[derive(Debug, Default)]
pub struct Player {
    sources: HashMap<u32, AudioBuffer>,
    clips: Vec<PlayClip>,
    position: u64,
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
            for t in a..b {
                let s = (clip.source_in + (t - clip.start)) as usize;
                if s >= l.len() {
                    break;
                }
                let i = (t - from) as usize;
                left[i] += l[s] * clip.gain;
                right[i] += r[s] * clip.gain;
            }
        }
        self.position = to;
    }
}
