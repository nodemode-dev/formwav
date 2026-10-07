use crate::filters::{Coefs, Section, Smooth};
use crate::rng::Noise;
use crate::{gain_of, Processor};

/// The DC blocker after any shaping that leaves an offset.
fn dc_blocker(rate: f32) -> Section {
    Section::new(Coefs::first_order(true, 8.0, rate))
}

const WARM_BIAS: f32 = 0.25;

/// The input raised by the drive and bent: Soft a hyperbolic tangent, Warm the same curve off centre (its offset
/// removed, so it adds even harmonics), Hard a cubic that meets full scale flat; each passes a small signal at its
/// own level. Then a low pass for the tone.
pub struct Drive {
    rate: f32,
    drive: f32,
    character: usize,
    mix: f32,
    output: f32,
    tone: Smooth,
    tone_on: bool,
    dc: Section,
}

impl Drive {
    pub fn new(rate: f32) -> Drive {
        Drive { rate, drive: gain_of(10.0), character: 0, mix: 1.0, output: 1.0, tone: Smooth::default(), tone_on: false, dc: dc_blocker(rate) }
    }

    #[inline]
    fn bend(&self, u: f32) -> f32 {
        match self.character {
            0 => u.tanh(),
            1 => (u + WARM_BIAS).tanh() - WARM_BIAS.tanh(),
            _ => {
                let v = u / 1.5;
                if v.abs() >= 1.0 {
                    v.signum()
                } else {
                    1.5 * v - 0.5 * v * v * v
                }
            }
        }
    }
}

impl Processor for Drive {
    fn set(&mut self, index: usize, v: f32) {
        match index {
            0 => self.drive = gain_of(v),
            1 => self.character = v.round().max(0.0) as usize,
            2 => {
                self.tone_on = v < 19_999.0;
                self.tone.design(v, self.rate);
            }
            3 => self.output = gain_of(v),
            4 => self.mix = v / 100.0,
            _ => {}
        }
    }

    fn reset(&mut self) {
        self.tone.reset();
        self.dc.reset();
    }

    fn run(&mut self, left: &mut [f32], right: &mut [f32]) {
        for (ch, buf) in [left, right].into_iter().enumerate() {
            for x in buf.iter_mut() {
                let mut y = self.bend(*x * self.drive);
                if self.character == 1 {
                    y = self.dc.tick(ch, y);
                }
                if self.tone_on {
                    y = self.tone.tick(ch, y);
                }
                *x = (*x + (y - *x) * self.mix) * self.output;
            }
        }
    }
}

/// Words cut to the chosen bits, a sample held until the next tick of the downsampling clock, and hiss.
pub struct Crusher {
    rate: f32,
    step: f32,
    levels: f32,
    hiss: f32,
    mix: f32,
    phase: f32,
    held: [f32; 2],
    rng: Noise,
}

impl Crusher {
    pub fn new(rate: f32) -> Crusher {
        Crusher { rate, step: 16000.0 / rate, levels: 2048.0, hiss: 0.0, mix: 1.0, phase: 1.0, held: [0.0; 2], rng: Noise::new(0xC205) }
    }
}

impl Processor for Crusher {
    fn set(&mut self, index: usize, v: f32) {
        match index {
            0 => self.levels = 2f32.powf(v.round() - 1.0),
            1 => self.step = (v / self.rate).min(1.0),
            2 => self.hiss = v / 100.0 * gain_of(-36.0),
            3 => self.mix = v / 100.0,
            _ => {}
        }
    }

    fn reset(&mut self) {
        self.phase = 1.0;
        self.held = [0.0; 2];
        self.rng.reset();
    }

    fn run(&mut self, left: &mut [f32], right: &mut [f32]) {
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            self.phase += self.step;
            if self.phase >= 1.0 {
                self.phase -= self.phase.floor();
                self.held = [(*l * self.levels).round() / self.levels, (*r * self.levels).round() / self.levels];
            }
            let hiss = if self.hiss > 0.0 { self.rng.bipolar() * self.hiss } else { 0.0 };
            *l += (self.held[0] + hiss - *l) * self.mix;
            *r += (self.held[1] + hiss - *r) * self.mix;
        }
    }
}

/// Full-wave (folded up) or half-wave (the negative half removed) rectification, its offset removed.
pub struct Rectifier {
    full: bool,
    blend: f32,
    output: f32,
    dc: Section,
}

impl Rectifier {
    pub fn new(rate: f32) -> Rectifier {
        Rectifier { full: true, blend: 1.0, output: gain_of(-6.0), dc: dc_blocker(rate) }
    }
}

impl Processor for Rectifier {
    fn set(&mut self, index: usize, v: f32) {
        match index {
            0 => self.full = v < 0.5,
            1 => self.blend = v / 100.0,
            2 => self.output = gain_of(v),
            _ => {}
        }
    }

    fn reset(&mut self) {
        self.dc.reset();
    }

    fn run(&mut self, left: &mut [f32], right: &mut [f32]) {
        for (ch, buf) in [left, right].into_iter().enumerate() {
            for x in buf.iter_mut() {
                let bent = if self.full { x.abs() } else { x.max(0.0) };
                let y = self.dc.tick(ch, bent);
                *x = (*x + (y - *x) * self.blend) * self.output;
            }
        }
    }
}
