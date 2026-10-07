use crate::filters::{Coefs, Cut, Section, Shape};
use crate::{gain_of, Processor};

const SHAPES: [Shape; 7] = [Shape::HighPass, Shape::LowShelf, Shape::Bell, Shape::Notch, Shape::BandPass, Shape::HighShelf, Shape::LowPass];

pub struct OneBand {
    rate: f32,
    shape: Shape,
    freq: f32,
    gain: f32,
    q: f32,
    output: f32,
    band: Section,
}

impl OneBand {
    pub fn new(rate: f32) -> OneBand {
        OneBand { rate, shape: Shape::Bell, freq: 1000.0, gain: 0.0, q: 0.9, output: 1.0, band: Section::default() }
    }

    fn design(&mut self) {
        self.band.set(Coefs::design(self.shape, self.freq, self.q, self.gain, self.rate));
    }
}

impl Processor for OneBand {
    fn set(&mut self, index: usize, v: f32) {
        match index {
            0 => self.shape = SHAPES[(v.round().max(0.0) as usize).min(SHAPES.len() - 1)],
            1 => self.freq = v,
            2 => self.gain = v,
            3 => self.q = v,
            4 => self.output = gain_of(v),
            _ => return,
        }
        self.design();
    }

    fn reset(&mut self) {
        self.band.reset();
    }

    fn run(&mut self, left: &mut [f32], right: &mut [f32]) {
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            *l = self.band.tick(0, *l) * self.output;
            *r = self.band.tick(1, *r) * self.output;
        }
    }
}

/// Input gain, a low cut, a low shelf, three bells, a high shelf, a high cut and output gain, in that order.
pub struct SevenBand {
    rate: f32,
    v: [f32; 21],
    low_cut: Cut,
    high_cut: Cut,
    bands: [Section; 5],
    input: f32,
    output: f32,
}

impl SevenBand {
    pub fn new(rate: f32) -> SevenBand {
        let mut eq = SevenBand {
            rate,
            v: [0.0; 21],
            low_cut: Cut::default(),
            high_cut: Cut::default(),
            bands: Default::default(),
            input: 1.0,
            output: 1.0,
        };
        for (i, p) in crate::spec("seven_band_eq").map(|s| s.params).unwrap_or(&[]).iter().enumerate() {
            if let Some(slot) = eq.v.get_mut(i) {
                *slot = p.default;
            }
        }
        eq.design();
        eq
    }

    fn design(&mut self) {
        let v = &self.v;
        let rate = self.rate;
        let shelf_q = std::f32::consts::FRAC_1_SQRT_2;
        self.input = gain_of(v[0]);
        self.low_cut.design(true, v[2], v[3].round() as usize, rate);
        self.bands[0].set(Coefs::design(Shape::LowShelf, v[5], shelf_q, v[4], rate));
        self.bands[1].set(Coefs::design(Shape::Bell, v[7], v[8], v[6], rate));
        self.bands[2].set(Coefs::design(Shape::Bell, v[10], v[11], v[9], rate));
        self.bands[3].set(Coefs::design(Shape::Bell, v[13], v[14], v[12], rate));
        self.bands[4].set(Coefs::design(Shape::HighShelf, v[16], shelf_q, v[15], rate));
        self.high_cut.design(false, v[18], v[19].round() as usize, rate);
        self.output = gain_of(v[20]);
    }
}

impl Processor for SevenBand {
    fn set(&mut self, index: usize, v: f32) {
        if let Some(slot) = self.v.get_mut(index) {
            *slot = v;
            self.design();
        }
    }

    fn reset(&mut self) {
        self.low_cut.reset();
        self.high_cut.reset();
        for b in &mut self.bands {
            b.reset();
        }
    }

    fn run(&mut self, left: &mut [f32], right: &mut [f32]) {
        let (lc, hc) = (self.v[1] >= 0.5, self.v[17] >= 0.5);
        for (ch, buf) in [left, right].into_iter().enumerate() {
            for x in buf.iter_mut() {
                let mut y = *x * self.input;
                if lc {
                    y = self.low_cut.tick(ch, y);
                }
                for b in &mut self.bands {
                    y = b.tick(ch, y);
                }
                if hc {
                    y = self.high_cut.tick(ch, y);
                }
                *x = y * self.output;
            }
        }
    }
}
