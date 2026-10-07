use std::collections::VecDeque;

use crate::delay::Line;
use crate::filters::{Coefs, Section, Shape, Split};
use crate::{ballistic, db_of, gain_of, Processor};

/// The level a compressor lets out for `x` dB in: unchanged below the knee, `ratio` to 1 above it, and a quadratic
/// bend `knee` dB wide around the threshold.
#[inline]
pub(crate) fn compressed(x: f32, threshold: f32, ratio: f32, knee: f32) -> f32 {
    let over = x - threshold;
    if knee > 0.0 && over.abs() <= knee * 0.5 {
        let t = over + knee * 0.5;
        x + (1.0 / ratio - 1.0) * t * t / (2.0 * knee)
    } else if over > 0.0 {
        threshold + over / ratio
    } else {
        x
    }
}

/// Moves `current` toward `target` dB of reduction: by `attack` while the reduction grows, by `release` while it
/// shrinks.
#[inline]
pub(crate) fn follow(current: f32, target: f32, attack: f32, release: f32) -> f32 {
    let a = if target > current { attack } else { release };
    target + a * (current - target)
}

/// Both channels delayed by the same whole number of samples.
#[derive(Debug, Clone)]
pub(crate) struct Lookahead {
    lines: [Line; 2],
    delay: usize,
}

impl Lookahead {
    pub fn new(max: usize) -> Lookahead {
        Lookahead { lines: [Line::new(max + 1), Line::new(max + 1)], delay: 0 }
    }

    pub fn set(&mut self, delay: usize) {
        self.delay = delay.min(self.lines[0].capacity() - 1);
    }

    pub fn delay(&self) -> usize {
        self.delay
    }

    #[inline]
    pub fn tick(&mut self, l: f32, r: f32) -> (f32, f32) {
        self.lines[0].push(l);
        self.lines[1].push(r);
        (self.lines[0].at(self.delay), self.lines[1].at(self.delay))
    }

    pub fn clear(&mut self) {
        for line in &mut self.lines {
            line.clear();
        }
    }
}

pub struct Compressor {
    rate: f32,
    threshold: f32,
    ratio: f32,
    knee: f32,
    makeup: f32,
    mix: f32,
    attack: f32,
    release: f32,
    filter_on: bool,
    filter: Section,
    ahead: Lookahead,
    reduction: f32,
    peak: f32,
}

impl Compressor {
    pub fn new(rate: f32) -> Compressor {
        Compressor {
            rate,
            threshold: -18.0,
            ratio: 3.0,
            knee: 4.0,
            makeup: 1.0,
            mix: 1.0,
            attack: ballistic(8.0, rate),
            release: ballistic(200.0, rate),
            filter_on: false,
            filter: Section::new(Coefs::design(Shape::HighPass, 90.0, std::f32::consts::FRAC_1_SQRT_2, 0.0, rate)),
            ahead: Lookahead::new((0.020 * rate).ceil() as usize),
            reduction: 0.0,
            peak: 0.0,
        }
    }

    /// One stereo sample, the sidechain linked across both channels.
    #[inline]
    pub(crate) fn tick(&mut self, l: f32, r: f32) -> (f32, f32) {
        let (sl, sr) = if self.filter_on { (self.filter.tick(0, l), self.filter.tick(1, r)) } else { (l, r) };
        let level = db_of(sl.abs().max(sr.abs()));
        let target = level - compressed(level, self.threshold, self.ratio, self.knee);
        self.reduction = follow(self.reduction, target.max(0.0), self.attack, self.release);
        self.peak = self.peak.max(self.reduction);
        let (dl, dr) = self.ahead.tick(l, r);
        let g = gain_of(-self.reduction) * self.makeup;
        (dl + (dl * g - dl) * self.mix, dr + (dr * g - dr) * self.mix)
    }

    pub(crate) fn begin_block(&mut self) {
        self.peak = 0.0;
    }

    pub(crate) fn last_reduction(&self) -> f32 {
        self.peak
    }
}

impl Processor for Compressor {
    fn set(&mut self, index: usize, v: f32) {
        match index {
            0 => self.threshold = v,
            1 => self.ratio = v.max(1.0),
            2 => self.attack = ballistic(v, self.rate),
            3 => self.release = ballistic(v, self.rate),
            4 => self.knee = v.max(0.0),
            5 => self.makeup = gain_of(v),
            6 => self.filter_on = v >= 0.5,
            7 => self.filter.set(Coefs::design(Shape::HighPass, v, std::f32::consts::FRAC_1_SQRT_2, 0.0, self.rate)),
            8 => self.ahead.set((v * 0.001 * self.rate).round() as usize),
            9 => self.mix = (v / 100.0).clamp(0.0, 1.0),
            _ => {}
        }
    }

    fn reset(&mut self) {
        self.filter.reset();
        self.ahead.clear();
        self.reduction = 0.0;
        self.peak = 0.0;
    }

    fn run(&mut self, left: &mut [f32], right: &mut [f32]) {
        self.begin_block();
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            (*l, *r) = self.tick(*l, *r);
        }
    }

    fn latency(&self) -> usize {
        self.ahead.delay()
    }

    fn reduction_db(&self) -> f32 {
        self.peak
    }
}

/// A downward expander: below the threshold the level falls `ratio` times as fast as the input's, at most `range`
/// dB, held open `hold` after the signal last crossed the threshold.
pub struct Expander {
    rate: f32,
    threshold: f32,
    ratio: f32,
    range: f32,
    attack: f32,
    release: f32,
    hold: usize,
    held: usize,
    envelope: f32,
    decay: f32,
    reduction: f32,
    peak: f32,
}

impl Expander {
    pub fn new(rate: f32) -> Expander {
        Expander {
            rate,
            threshold: -50.0,
            ratio: 40.0,
            range: 50.0,
            attack: ballistic(0.8, rate),
            release: ballistic(200.0, rate),
            hold: 0,
            held: 0,
            envelope: 0.0,
            decay: ballistic(10.0, rate),
            reduction: 0.0,
            peak: 0.0,
        }
    }

    #[inline]
    pub(crate) fn tick(&mut self, l: f32, r: f32) -> (f32, f32) {
        self.envelope = l.abs().max(r.abs()).max(self.envelope * self.decay);
        let level = db_of(self.envelope);
        let target = if level < self.threshold { ((self.threshold - level) * (self.ratio - 1.0)).min(self.range) } else { 0.0 };
        if level >= self.threshold {
            self.held = self.hold;
        }
        if target < self.reduction {
            self.reduction = target + self.attack * (self.reduction - target);
        } else if self.held > 0 {
            self.held -= 1;
        } else {
            self.reduction = target + self.release * (self.reduction - target);
        }
        self.peak = self.peak.max(self.reduction);
        let g = gain_of(-self.reduction);
        (l * g, r * g)
    }

    pub(crate) fn begin_block(&mut self) {
        self.peak = 0.0;
    }

    pub(crate) fn last_reduction(&self) -> f32 {
        self.peak
    }
}

impl Processor for Expander {
    fn set(&mut self, index: usize, v: f32) {
        match index {
            0 => self.threshold = v,
            1 => self.ratio = v.max(1.0),
            2 => self.range = v.max(0.0),
            3 => self.attack = ballistic(v, self.rate),
            4 => self.hold = (v * 0.001 * self.rate).round() as usize,
            5 => self.release = ballistic(v, self.rate),
            _ => {}
        }
    }

    fn reset(&mut self) {
        self.held = 0;
        self.envelope = 0.0;
        self.reduction = 0.0;
        self.peak = 0.0;
    }

    fn run(&mut self, left: &mut [f32], right: &mut [f32]) {
        self.begin_block();
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            (*l, *r) = self.tick(*l, *r);
        }
    }

    fn reduction_db(&self) -> f32 {
        self.peak
    }
}

/// A split-band de-esser: the band above `freq` is turned down by as much as it rises over the threshold (at 4 to
/// 1, at most `range` dB) and added back to the band below it untouched.
pub struct DeEsser {
    rate: f32,
    split: Split,
    threshold: f32,
    range: f32,
    listen: bool,
    attack: f32,
    release: f32,
    reduction: f32,
    peak: f32,
}

impl DeEsser {
    pub fn new(rate: f32) -> DeEsser {
        let mut split = Split::default();
        split.design(7000.0, rate);
        DeEsser { rate, split, threshold: -26.0, range: 10.0, listen: false, attack: ballistic(0.3, rate), release: ballistic(60.0, rate), reduction: 0.0, peak: 0.0 }
    }
}

impl Processor for DeEsser {
    fn set(&mut self, index: usize, v: f32) {
        match index {
            0 => self.split.design(v, self.rate),
            1 => self.threshold = v,
            2 => self.range = v.max(0.0),
            3 => self.listen = v >= 0.5,
            _ => {}
        }
    }

    fn reset(&mut self) {
        self.split.reset();
        self.reduction = 0.0;
        self.peak = 0.0;
    }

    fn run(&mut self, left: &mut [f32], right: &mut [f32]) {
        self.peak = 0.0;
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            let (ll, lh) = self.split.tick(0, *l);
            let (rl, rh) = self.split.tick(1, *r);
            let level = db_of(lh.abs().max(rh.abs()));
            let target = ((level - self.threshold) * 0.75).clamp(0.0, self.range);
            self.reduction = follow(self.reduction, target, self.attack, self.release);
            self.peak = self.peak.max(self.reduction);
            if self.listen {
                (*l, *r) = (lh, rh);
            } else {
                let g = gain_of(-self.reduction);
                (*l, *r) = (ll + lh * g, rl + rh * g);
            }
        }
    }

    fn reduction_db(&self) -> f32 {
        self.peak
    }
}

/// A look-ahead peak limiter: the input raised by the threshold, never past the ceiling. The gain needed at each
/// sample is held at its lowest over the look-ahead and averaged across it, so the gain has reached what a peak
/// needs by the time that peak leaves the delay; it then recovers by the release.
pub struct Maximizer {
    drive: f32,
    ceiling: f32,
    release: f32,
    rate: f32,
    ahead: Lookahead,
    lows: VecDeque<(u64, f32)>,
    window: Vec<f32>,
    sum: f64,
    at: usize,
    n: u64,
    gain: f32,
    peak: f32,
}

impl Maximizer {
    pub fn new(rate: f32) -> Maximizer {
        let look = (0.0015 * rate).round().max(1.0) as usize;
        let mut ahead = Lookahead::new(look);
        ahead.set(look);
        Maximizer {
            drive: 1.0,
            ceiling: gain_of(-0.5),
            release: ballistic(60.0, rate),
            rate,
            ahead,
            lows: VecDeque::with_capacity(look + 2),
            window: vec![1.0; look],
            sum: look as f64,
            at: 0,
            n: 0,
            gain: 1.0,
            peak: 0.0,
        }
    }
}

impl Processor for Maximizer {
    fn set(&mut self, index: usize, v: f32) {
        match index {
            0 => self.drive = gain_of(-v),
            1 => self.ceiling = gain_of(v),
            2 => self.release = ballistic(v, self.rate),
            _ => {}
        }
    }

    fn reset(&mut self) {
        self.ahead.clear();
        self.lows.clear();
        self.window.iter_mut().for_each(|v| *v = 1.0);
        self.sum = self.window.len() as f64;
        self.at = 0;
        self.n = 0;
        self.gain = 1.0;
        self.peak = 0.0;
    }

    fn run(&mut self, left: &mut [f32], right: &mut [f32]) {
        self.peak = 0.0;
        let look = self.window.len();
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            let (xl, xr) = (*l * self.drive, *r * self.drive);
            let top = xl.abs().max(xr.abs());
            let need = if top > self.ceiling { self.ceiling / top } else { 1.0 };
            while self.lows.back().is_some_and(|&(_, v)| v >= need) {
                self.lows.pop_back();
            }
            self.lows.push_back((self.n, need));
            while self.lows.front().is_some_and(|&(i, _)| i + (look as u64) < self.n) {
                self.lows.pop_front();
            }
            let low = self.lows.front().map_or(1.0, |&(_, v)| v);
            self.sum += f64::from(low) - f64::from(self.window[self.at]);
            self.window[self.at] = low;
            self.at = if self.at + 1 == look { 0 } else { self.at + 1 };
            let smooth = (self.sum / look as f64) as f32;
            self.gain = if smooth < self.gain { smooth } else { smooth + self.release * (self.gain - smooth) };
            self.n += 1;
            let (dl, dr) = self.ahead.tick(xl, xr);
            let c = self.ceiling;
            (*l, *r) = ((dl * self.gain).clamp(-c, c), (dr * self.gain).clamp(-c, c));
            self.peak = self.peak.max(-db_of(self.gain));
        }
    }

    fn latency(&self) -> usize {
        self.ahead.delay()
    }

    fn reduction_db(&self) -> f32 {
        self.peak
    }
}
