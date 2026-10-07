use crate::dynamics::{Compressor, Expander};
use crate::filters::{Coefs, Cut, Section, Shape};
use crate::{gain_of, Processor};

const PARAMS: usize = 22;

/// Input gain; a four-band EQ behind an optional low cut; a gate and a compressor; output gain. The order switch
/// puts the EQ before or after the dynamics.
pub struct ChannelStrip {
    rate: f32,
    v: [f32; PARAMS],
    gate: Expander,
    comp: Compressor,
    low_cut: Cut,
    eq: [Section; 4],
    input: f32,
    output: f32,
    peak: f32,
}

impl ChannelStrip {
    pub fn new(rate: f32) -> ChannelStrip {
        let mut gate = Expander::new(rate);
        gate.set(1, 40.0);
        gate.set(3, 0.5);
        gate.set(4, 20.0);
        let mut comp = Compressor::new(rate);
        comp.set(4, 4.0);
        let mut strip = ChannelStrip { rate, v: [0.0; PARAMS], gate, comp, low_cut: Cut::default(), eq: Default::default(), input: 1.0, output: 1.0, peak: 0.0 };
        for (i, p) in crate::spec("channel_strip").map(|s| s.params).unwrap_or(&[]).iter().enumerate() {
            strip.set(i, p.default);
        }
        strip
    }

    fn design_eq(&mut self) {
        let (v, rate) = (&self.v, self.rate);
        let shelf_q = std::f32::consts::FRAC_1_SQRT_2;
        self.low_cut.design(true, v[3], 1, rate);
        self.eq[0].set(Coefs::design(Shape::LowShelf, v[5], shelf_q, v[4], rate));
        self.eq[1].set(Coefs::design(Shape::Bell, v[7], 0.9, v[6], rate));
        self.eq[2].set(Coefs::design(Shape::Bell, v[9], v[10], v[8], rate));
        self.eq[3].set(Coefs::design(Shape::HighShelf, v[12], shelf_q, v[11], rate));
    }

    #[inline]
    fn equalise(&mut self, cut: bool, a: f32, b: f32) -> (f32, f32) {
        let (mut a, mut b) = (a, b);
        if cut {
            a = self.low_cut.tick(0, a);
            b = self.low_cut.tick(1, b);
        }
        for s in &mut self.eq {
            a = s.tick(0, a);
            b = s.tick(1, b);
        }
        (a, b)
    }
}

impl Processor for ChannelStrip {
    fn set(&mut self, index: usize, v: f32) {
        let Some(slot) = self.v.get_mut(index) else { return };
        *slot = v;
        match index {
            0 => self.input = gain_of(v),
            3..=12 => self.design_eq(),
            14 => self.comp.set(0, v),
            15 => self.comp.set(1, v),
            16 => self.comp.set(2, v),
            17 => self.comp.set(3, v),
            19 => self.gate.set(0, v),
            20 => self.gate.set(2, v),
            21 => self.output = gain_of(v),
            _ => {}
        }
    }

    fn reset(&mut self) {
        self.gate.reset();
        self.comp.reset();
        self.low_cut.reset();
        for s in &mut self.eq {
            s.reset();
        }
        self.peak = 0.0;
    }

    fn run(&mut self, left: &mut [f32], right: &mut [f32]) {
        let dynamics_first = self.v[1] >= 0.5;
        let (cut, comp_on, gate_on) = (self.v[2] >= 0.5, self.v[13] >= 0.5, self.v[18] >= 0.5);
        self.gate.begin_block();
        self.comp.begin_block();
        for (l, r) in left.iter_mut().zip(right.iter_mut()) {
            let (mut a, mut b) = (*l * self.input, *r * self.input);
            if !dynamics_first {
                (a, b) = self.equalise(cut, a, b);
            }
            if gate_on {
                (a, b) = self.gate.tick(a, b);
            }
            if comp_on {
                (a, b) = self.comp.tick(a, b);
            }
            if dynamics_first {
                (a, b) = self.equalise(cut, a, b);
            }
            (*l, *r) = (a * self.output, b * self.output);
        }
        self.peak = (if gate_on { self.gate.last_reduction() } else { 0.0 }) + (if comp_on { self.comp.last_reduction() } else { 0.0 });
    }

    fn reduction_db(&self) -> f32 {
        self.peak
    }
}
