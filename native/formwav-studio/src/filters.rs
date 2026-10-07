use std::f64::consts::PI;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Shape {
    Bell,
    LowShelf,
    HighShelf,
    HighPass,
    LowPass,
    Notch,
    BandPass,
}

/// Second-order section coefficients, normalised so a0 is 1 (the audio EQ cookbook's bilinear designs).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Coefs {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
}

impl Coefs {
    pub const PASS: Coefs = Coefs { b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0 };

    pub fn design(shape: Shape, freq: f32, q: f32, gain_db: f32, rate: f32) -> Coefs {
        let rate = f64::from(rate);
        let f = f64::from(freq).clamp(1.0, rate * 0.49);
        let w = 2.0 * PI * f / rate;
        let (s, c) = w.sin_cos();
        let q = f64::from(q).max(0.025);
        let alpha = s / (2.0 * q);
        let a = 10f64.powf(f64::from(gain_db) / 40.0);
        let (b0, b1, b2, a0, a1, a2) = match shape {
            Shape::Bell => (1.0 + alpha * a, -2.0 * c, 1.0 - alpha * a, 1.0 + alpha / a, -2.0 * c, 1.0 - alpha / a),
            Shape::LowShelf => {
                let k = 2.0 * a.sqrt() * alpha;
                (
                    a * ((a + 1.0) - (a - 1.0) * c + k),
                    2.0 * a * ((a - 1.0) - (a + 1.0) * c),
                    a * ((a + 1.0) - (a - 1.0) * c - k),
                    (a + 1.0) + (a - 1.0) * c + k,
                    -2.0 * ((a - 1.0) + (a + 1.0) * c),
                    (a + 1.0) + (a - 1.0) * c - k,
                )
            }
            Shape::HighShelf => {
                let k = 2.0 * a.sqrt() * alpha;
                (
                    a * ((a + 1.0) + (a - 1.0) * c + k),
                    -2.0 * a * ((a - 1.0) + (a + 1.0) * c),
                    a * ((a + 1.0) + (a - 1.0) * c - k),
                    (a + 1.0) - (a - 1.0) * c + k,
                    2.0 * ((a - 1.0) - (a + 1.0) * c),
                    (a + 1.0) - (a - 1.0) * c - k,
                )
            }
            Shape::HighPass => ((1.0 + c) / 2.0, -(1.0 + c), (1.0 + c) / 2.0, 1.0 + alpha, -2.0 * c, 1.0 - alpha),
            Shape::LowPass => ((1.0 - c) / 2.0, 1.0 - c, (1.0 - c) / 2.0, 1.0 + alpha, -2.0 * c, 1.0 - alpha),
            Shape::Notch => (1.0, -2.0 * c, 1.0, 1.0 + alpha, -2.0 * c, 1.0 - alpha),
            Shape::BandPass => (alpha, 0.0, -alpha, 1.0 + alpha, -2.0 * c, 1.0 - alpha),
        };
        Coefs { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
    }

    /// First-order low or high pass by the bilinear transform, as a section with its second-order terms at zero.
    pub fn first_order(high: bool, freq: f32, rate: f32) -> Coefs {
        let rate = f64::from(rate);
        let k = (PI * f64::from(freq).clamp(0.1, rate * 0.49) / rate).tan();
        let a1 = (k - 1.0) / (k + 1.0);
        if high {
            Coefs { b0: 1.0 / (k + 1.0), b1: -1.0 / (k + 1.0), b2: 0.0, a1, a2: 0.0 }
        } else {
            Coefs { b0: k / (k + 1.0), b1: k / (k + 1.0), b2: 0.0, a1, a2: 0.0 }
        }
    }
}

/// A stereo second-order section in transposed direct form II, run in double precision.
#[derive(Debug, Clone)]
pub struct Section {
    c: Coefs,
    z: [[f64; 2]; 2],
}

impl Default for Section {
    fn default() -> Self {
        Section { c: Coefs::PASS, z: [[0.0; 2]; 2] }
    }
}

impl Section {
    pub fn new(c: Coefs) -> Section {
        Section { c, z: [[0.0; 2]; 2] }
    }

    pub fn set(&mut self, c: Coefs) {
        self.c = c;
    }

    #[inline]
    pub fn tick(&mut self, ch: usize, x: f32) -> f32 {
        let c = &self.c;
        let z = &mut self.z[ch & 1];
        let x = f64::from(x);
        let y = c.b0 * x + z[0];
        z[0] = c.b1 * x - c.a1 * y + z[1];
        z[1] = c.b2 * x - c.a2 * y;
        y as f32
    }

    pub fn reset(&mut self) {
        self.z = [[0.0; 2]; 2];
    }
}

/// A low or high cut of 6, 12, 18 or 24 dB an octave: a first-order section for the odd slopes, Butterworth
/// sections for the rest.
#[derive(Debug, Clone, Default)]
pub struct Cut {
    sections: [Section; 2],
    used: usize,
}

impl Cut {
    pub fn design(&mut self, high_pass: bool, freq: f32, slope: usize, rate: f32) {
        let shape = if high_pass { Shape::HighPass } else { Shape::LowPass };
        let (first, second): (Coefs, Option<Coefs>) = match slope {
            0 => (Coefs::first_order(high_pass, freq, rate), None),
            1 => (Coefs::design(shape, freq, std::f32::consts::FRAC_1_SQRT_2, 0.0, rate), None),
            2 => (Coefs::first_order(high_pass, freq, rate), Some(Coefs::design(shape, freq, 1.0, 0.0, rate))),
            _ => (Coefs::design(shape, freq, 0.541_196_1, 0.0, rate), Some(Coefs::design(shape, freq, 1.306_563, 0.0, rate))),
        };
        self.sections[0].set(first);
        self.used = 1;
        if let Some(c) = second {
            self.sections[1].set(c);
            self.used = 2;
        }
    }

    #[inline]
    pub fn tick(&mut self, ch: usize, x: f32) -> f32 {
        let mut y = x;
        for s in &mut self.sections[..self.used] {
            y = s.tick(ch, y);
        }
        y
    }

    pub fn reset(&mut self) {
        for s in &mut self.sections {
            s.reset();
        }
    }
}

/// A fourth-order Linkwitz-Riley split at one frequency: the low and high bands sum to an all-pass.
#[derive(Debug, Clone, Default)]
pub struct Split {
    low: [Section; 2],
    high: [Section; 2],
}

impl Split {
    pub fn design(&mut self, freq: f32, rate: f32) {
        let q = std::f32::consts::FRAC_1_SQRT_2;
        let lp = Coefs::design(Shape::LowPass, freq, q, 0.0, rate);
        let hp = Coefs::design(Shape::HighPass, freq, q, 0.0, rate);
        for s in &mut self.low {
            s.set(lp);
        }
        for s in &mut self.high {
            s.set(hp);
        }
    }

    /// The low and the high band of one sample.
    #[inline]
    pub fn tick(&mut self, ch: usize, x: f32) -> (f32, f32) {
        let l = self.low[0].tick(ch, x);
        let h = self.high[0].tick(ch, x);
        (self.low[1].tick(ch, l), self.high[1].tick(ch, h))
    }

    pub fn reset(&mut self) {
        for s in self.low.iter_mut().chain(self.high.iter_mut()) {
            s.reset();
        }
    }
}

/// A one-pole low pass with a cutoff in hertz, for damping and smoothing.
#[derive(Debug, Clone, Copy, Default)]
pub struct Smooth {
    a: f32,
    z: [f32; 2],
}

impl Smooth {
    pub fn design(&mut self, freq: f32, rate: f32) {
        self.a = (-2.0 * std::f32::consts::PI * freq.clamp(1.0, rate * 0.49) / rate).exp();
    }

    #[inline]
    pub fn tick(&mut self, ch: usize, x: f32) -> f32 {
        let z = &mut self.z[ch & 1];
        *z = x + self.a * (*z - x);
        *z
    }

    pub fn reset(&mut self) {
        self.z = [0.0; 2];
    }
}
