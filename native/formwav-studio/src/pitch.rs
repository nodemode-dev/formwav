use crate::delay::Line;
use crate::Processor;

const MATCH_MS: f32 = 5.0;
const SEARCH_MS: f32 = 8.0;

/// A delay line read faster or slower than it is written, which moves the pitch by the ratio of the two speeds. When
/// the read head has drifted across the window it hands over to a new head half a window back (or on), placed where
/// the last few milliseconds of the signal there best match those under the old head, and the two are crossfaded:
/// the hand-over lands in step with the waveform, so a steady tone keeps its new pitch without a beat.
pub struct PitchShifter {
    rate: f32,
    lines: [Line; 2],
    mono: Line,
    semitones: f32,
    cents: f32,
    window: f32,
    mix: f32,
    head: f32,
    next: f32,
    fade: Option<f32>,
}

impl PitchShifter {
    pub fn new(rate: f32) -> PitchShifter {
        let max = ((0.12 + 0.002 * (MATCH_MS + 2.0 * SEARCH_MS)) * rate) as usize + 64;
        let mut p = PitchShifter { rate, lines: [Line::new(max), Line::new(max)], mono: Line::new(max), semitones: 0.0, cents: 0.0, window: 0.06 * rate, mix: 1.0, head: 0.0, next: 0.0, fade: None };
        p.head = p.floor() + p.window * 0.5;
        p
    }

    fn matched(&self) -> usize {
        (MATCH_MS * 0.001 * self.rate) as usize
    }

    fn searched(&self) -> f32 {
        SEARCH_MS * 0.001 * self.rate
    }

    /// The shortest delay a head may have: the matched stretch must lie wholly in the past.
    fn floor(&self) -> f32 {
        self.matched() as f32 + 4.0
    }

    fn ceiling(&self) -> f32 {
        (self.mono.capacity() as f32 - self.searched() - self.matched() as f32 - 8.0).max(self.floor() + 8.0)
    }

    /// The delay near `target` whose recent signal best matches the one under the current head (normalised
    /// correlation of the mono sum, sample by sample). Candidates are tried outward from the target and a farther one
    /// wins only when it matches clearly better, so a periodic signal, which matches every period alike, keeps the
    /// hand-over near the middle of the window.
    fn aligned(&self, target: f32) -> f32 {
        let span = self.matched();
        let here = self.head.round() as usize;
        let reach = self.searched().min((self.window * 0.15).max(16.0)) as isize;
        let centre = target.round() as isize;
        let (lo, hi) = (self.floor() as isize, self.ceiling() as isize);
        let fraction = self.head - self.head.round();
        let mut best: Option<(f32, f32)> = None;
        for step in 0..=(2 * reach) {
            let offset = if step % 2 == 0 { step / 2 } else { -(step + 1) / 2 };
            let d = centre + offset;
            if d < lo || d > hi {
                continue;
            }
            let (mut dot, mut energy) = (0f32, 1e-12f32);
            for k in 0..span {
                let v = self.mono.at(d as usize + k);
                dot += self.mono.at(here + k) * v;
                energy += v * v;
            }
            let score = dot / energy.sqrt();
            let better = match best {
                None => true,
                Some((s, _)) => score > s + 0.02 * s.abs().max(1e-6),
            };
            if better {
                best = Some((score, d as f32 + fraction));
            }
        }
        best.map_or(target, |(_, d)| d)
    }
}

impl Processor for PitchShifter {
    fn set(&mut self, index: usize, v: f32) {
        match index {
            0 => self.semitones = v,
            1 => self.cents = v,
            2 => self.window = v * 0.001 * self.rate,
            3 => self.mix = v / 100.0,
            _ => {}
        }
    }

    fn reset(&mut self) {
        for l in self.lines.iter_mut().chain(std::iter::once(&mut self.mono)) {
            l.clear();
        }
        self.head = self.floor() + self.window * 0.5;
        self.fade = None;
    }

    fn run(&mut self, left: &mut [f32], right: &mut [f32]) {
        let ratio = 2f32.powf((self.semitones + self.cents / 100.0) / 12.0);
        let unity = (ratio - 1.0).abs() < 1e-6;
        let slope = 1.0 - ratio;
        let width = self.window.min(self.ceiling() - self.floor()).max(16.0);
        let fade_len = (width * 0.25 / slope.abs().max(1.0)).max(32.0);
        let low = self.floor() + fade_len * slope.abs().max(0.0) + 2.0;
        let high = self.floor() + width;
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            self.lines[0].push(*l);
            self.lines[1].push(*r);
            self.mono.push(0.5 * (*l + *r));
            if unity {
                continue;
            }
            self.head = (self.head + slope).clamp(2.0, self.ceiling());
            let read = |lines: &[Line; 2], d: f32| (lines[0].read(d), lines[1].read(d));
            let (mut wl, mut wr) = read(&self.lines, self.head);
            if let Some(p) = self.fade {
                self.next = (self.next + slope).clamp(2.0, self.ceiling());
                let g = 0.5 - 0.5 * (std::f32::consts::PI * p).cos();
                let (nl, nr) = read(&self.lines, self.next);
                wl += (nl - wl) * g;
                wr += (nr - wr) * g;
                let p = p + 1.0 / fade_len;
                if p >= 1.0 {
                    self.head = self.next;
                    self.fade = None;
                } else {
                    self.fade = Some(p);
                }
            } else if (slope < 0.0 && self.head <= low) || (slope > 0.0 && self.head >= high) {
                let target = if slope < 0.0 { self.head + width * 0.5 } else { self.head - width * 0.5 };
                self.next = self.aligned(target);
                self.fade = Some(0.0);
            }
            *l += (wl - *l) * self.mix;
            *r += (wr - *r) * self.mix;
        }
    }
}
