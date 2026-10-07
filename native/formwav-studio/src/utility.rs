use crate::delay::Line;
use crate::filters::{Coefs, Section};
use crate::rng::Noise;
use crate::{gain_of, Processor};

/// The signal moved later by milliseconds plus samples, up to two seconds and 9600 samples.
pub struct Offset {
    rate: f32,
    lines: [Line; 2],
    ms: f32,
    samples: f32,
}

impl Offset {
    pub fn new(rate: f32) -> Offset {
        let max = (2.0 * rate) as usize + 9601;
        Offset { rate, lines: [Line::new(max), Line::new(max)], ms: 0.0, samples: 0.0 }
    }

    fn delay(&self) -> usize {
        (self.ms * 0.001 * self.rate + self.samples).round().max(0.0) as usize
    }
}

impl Processor for Offset {
    fn set(&mut self, index: usize, v: f32) {
        match index {
            0 => self.ms = v,
            1 => self.samples = v.round(),
            _ => {}
        }
    }

    fn reset(&mut self) {
        for l in &mut self.lines {
            l.clear();
        }
    }

    fn run(&mut self, left: &mut [f32], right: &mut [f32]) {
        let d = self.delay().min(self.lines[0].capacity() - 1);
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            self.lines[0].push(*l);
            self.lines[1].push(*r);
            (*l, *r) = (self.lines[0].at(d), self.lines[1].at(d));
        }
    }

    fn tail(&self) -> usize {
        self.delay()
    }
}

/// A gain, and for Trim a polarity switch beside it.
pub struct Gain {
    with_invert: bool,
    gain: f32,
    invert: bool,
}

impl Gain {
    pub fn new(with_invert: bool) -> Gain {
        Gain { with_invert, gain: 1.0, invert: false }
    }
}

impl Processor for Gain {
    fn set(&mut self, index: usize, v: f32) {
        match index {
            0 => self.gain = gain_of(v),
            1 if self.with_invert => self.invert = v >= 0.5,
            _ => {}
        }
    }

    fn reset(&mut self) {}

    fn run(&mut self, left: &mut [f32], right: &mut [f32]) {
        let g = if self.invert { -self.gain } else { self.gain };
        for x in left.iter_mut().chain(right.iter_mut()) {
            *x *= g;
        }
    }
}

pub struct Polarity;

impl Processor for Polarity {
    fn set(&mut self, _: usize, _: f32) {}

    fn reset(&mut self) {}

    fn run(&mut self, left: &mut [f32], right: &mut [f32]) {
        for x in left.iter_mut().chain(right.iter_mut()) {
            *x = -*x;
        }
    }
}

/// A first-order high pass at the cutoff.
pub struct DcBlock {
    rate: f32,
    filter: Section,
}

impl DcBlock {
    pub fn new(rate: f32) -> DcBlock {
        DcBlock { rate, filter: Section::new(Coefs::first_order(true, 6.0, rate)) }
    }
}

impl Processor for DcBlock {
    fn set(&mut self, index: usize, v: f32) {
        if index == 0 {
            self.filter.set(Coefs::first_order(true, v, self.rate));
        }
    }

    fn reset(&mut self) {
        self.filter.reset();
    }

    fn run(&mut self, left: &mut [f32], right: &mut [f32]) {
        for (ch, buf) in [left, right].into_iter().enumerate() {
            for x in buf.iter_mut() {
                *x = self.filter.tick(ch, *x);
            }
        }
    }
}

const PINK_ROWS: usize = 12;

/// A test signal in place of the input: a sine, triangle, square or sawtooth at the frequency, or pink or white
/// noise (pink as the sum of noise rows each held twice as long as the last), at the level in dBFS.
pub struct Tone {
    rate: f32,
    wave: usize,
    freq: f32,
    level: f32,
    phase: f64,
    rng: Noise,
    rows: [f32; PINK_ROWS],
    count: u32,
}

impl Tone {
    pub fn new(rate: f32) -> Tone {
        Tone { rate, wave: 0, freq: 1000.0, level: gain_of(-18.0), phase: 0.0, rng: Noise::new(0x704E), rows: [0.0; PINK_ROWS], count: 0 }
    }

    #[inline]
    fn pink(&mut self) -> f32 {
        self.count = self.count.wrapping_add(1);
        let row = (self.count.trailing_zeros() as usize).min(PINK_ROWS - 1);
        self.rows[row] = self.rng.bipolar();
        let sum: f32 = self.rows.iter().sum::<f32>() + self.rng.bipolar();
        sum / (PINK_ROWS as f32 + 1.0).sqrt() * 0.5
    }
}

impl Processor for Tone {
    fn set(&mut self, index: usize, v: f32) {
        match index {
            0 => self.wave = v.round().max(0.0) as usize,
            1 => self.freq = v,
            2 => self.level = gain_of(v),
            _ => {}
        }
    }

    fn reset(&mut self) {
        self.phase = 0.0;
        self.rng.reset();
        self.rows = [0.0; PINK_ROWS];
        self.count = 0;
    }

    fn run(&mut self, left: &mut [f32], right: &mut [f32]) {
        let step = f64::from(self.freq) / f64::from(self.rate);
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            let p = self.phase as f32;
            let v = match self.wave {
                0 => (2.0 * std::f32::consts::PI * p).sin(),
                1 => 1.0 - 4.0 * (p - 0.5).abs(),
                2 => {
                    if p < 0.5 {
                        1.0
                    } else {
                        -1.0
                    }
                }
                3 => 2.0 * p - 1.0,
                4 => self.pink(),
                _ => self.rng.bipolar(),
            };
            self.phase = (self.phase + step).fract();
            *l = v * self.level;
            *r = *l;
        }
    }
}

/// Triangular dither at the target word's step, the result rounded to that word; with shaping, each sample's
/// rounding error is taken from the next, which moves the noise toward the top of the band.
pub struct Dither {
    step: f32,
    shaping: bool,
    rng: Noise,
    error: [f32; 2],
}

impl Dither {
    pub fn new() -> Dither {
        Dither { step: 2f32.powi(-15), shaping: false, rng: Noise::new(0xD17E), error: [0.0; 2] }
    }
}

impl Processor for Dither {
    fn set(&mut self, index: usize, v: f32) {
        match index {
            0 => self.step = 2f32.powi(1 - [24, 20, 16][(v.round().max(0.0) as usize).min(2)]),
            1 => self.shaping = v >= 0.5,
            _ => {}
        }
    }

    fn reset(&mut self) {
        self.rng.reset();
        self.error = [0.0; 2];
    }

    fn run(&mut self, left: &mut [f32], right: &mut [f32]) {
        for (ch, buf) in [left, right].into_iter().enumerate() {
            for x in buf.iter_mut() {
                if *x == 0.0 && self.error[ch] == 0.0 {
                    continue;
                }
                let wanted = *x - if self.shaping { self.error[ch] } else { 0.0 };
                let tpdf = (self.rng.unit() - self.rng.unit()) * self.step;
                let q = ((wanted + tpdf) / self.step).round() * self.step;
                self.error[ch] = q - wanted;
                *x = q;
            }
        }
    }
}
