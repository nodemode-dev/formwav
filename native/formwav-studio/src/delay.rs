/// A mono delay line of fixed capacity, read at whole or fractional delays (cubic Hermite between samples).
#[derive(Debug, Clone)]
pub struct Line {
    buf: Vec<f32>,
    pos: usize,
}

impl Line {
    /// Room for delays up to `max` samples.
    pub fn new(max: usize) -> Line {
        Line { buf: vec![0.0; max.max(1) + 4], pos: 0 }
    }

    pub fn capacity(&self) -> usize {
        self.buf.len() - 4
    }

    #[inline]
    pub fn push(&mut self, x: f32) {
        self.pos = if self.pos + 1 == self.buf.len() { 0 } else { self.pos + 1 };
        self.buf[self.pos] = x;
    }

    /// The sample pushed `delay` pushes ago (0 the latest).
    #[inline]
    pub fn at(&self, delay: usize) -> f32 {
        let n = self.buf.len();
        let d = delay.min(n - 1);
        self.buf[(self.pos + n - d) % n]
    }

    /// The signal `delay` samples ago, between samples by cubic Hermite interpolation.
    #[inline]
    pub fn read(&self, delay: f32) -> f32 {
        let d = delay.clamp(1.0, (self.capacity() - 1) as f32);
        let whole = d.floor() as usize;
        let t = d - whole as f32;
        let (y0, y1, y2, y3) = (self.at(whole - 1), self.at(whole), self.at(whole + 1), self.at(whole + 2));
        let c1 = 0.5 * (y2 - y0);
        let c2 = y0 - 2.5 * y1 + 2.0 * y2 - 0.5 * y3;
        let c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
        ((c3 * t + c2) * t + c1) * t + y1
    }

    pub fn clear(&mut self) {
        self.buf.iter_mut().for_each(|v| *v = 0.0);
        self.pos = 0;
    }
}

/// A sine oscillator for modulation, its phase in cycles.
#[derive(Debug, Clone, Copy, Default)]
pub struct Lfo {
    phase: f32,
    step: f32,
}

impl Lfo {
    pub fn set(&mut self, hz: f32, rate: f32) {
        self.step = hz / rate;
    }

    /// The next value, offset by `offset` cycles, from -1 to 1.
    #[inline]
    pub fn value(&self, offset: f32) -> f32 {
        (2.0 * std::f32::consts::PI * (self.phase + offset)).sin()
    }

    #[inline]
    pub fn advance(&mut self) {
        self.phase += self.step;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }
    }

    pub fn reset(&mut self) {
        self.phase = 0.0;
    }
}
